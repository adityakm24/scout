"""The OpenShell sandboxes the two agents and the bridge guard run in, and their policies.

- ``scout-user``: the User Agent's terminal. Network: Google's APIs read-only (L7 ``access:
  read-only``, so a send cannot leave even if the model tries) plus the OAuth token refresh.
  Nothing else on the internet is reachable.
- ``scout-browser``: the Browser Agent's browser. Network: per task, only that task's allowed
  domains, set by a live policy update before the task starts and cleared after it.
- ``scout-guard``: NeMo Guardrails, which checks every Browser Agent answer. No network after setup.

OpenShell denies by default, so a rule missing here is a capability the agent does not have.
Every call fails closed: when OpenShell is unavailable, the operation is refused, never run on
the host instead.
"""

from __future__ import annotations

import json
import logging
import subprocess
import threading
from pathlib import Path
from typing import Any, Dict, Iterable, List, Optional, Sequence

logger = logging.getLogger(__name__)

USER_SANDBOX = "scout-user"
BROWSER_SANDBOX = "scout-browser"
GUARD_SANDBOX = "scout-guard"

GUARD_DIR = "/sandbox/scout-guard"
GUARD_RUNNER = f"{GUARD_DIR}/nemo_guard/runner.py"  # `sandbox upload` nests the directory
# Ubuntu's base image ships no Python; the guard rail and the Google scripts need one.
PYTHON_IMAGE = "python:3.12-slim"
# Headless Chromium for the Browser Agent; its DevTools port is forwarded to the backend.
BROWSER_IMAGE = "chromedp/headless-shell:latest"
BROWSER_DIR = "/headless-shell"
BROWSER_CDP_PORT = 9333
NEMOGUARDRAILS_PIN = "nemoguardrails==0.24.1"

_PYTHON_BINARIES = [{"path": "/usr/bin/python3*"}, {"path": "/usr/local/bin/python3*"}]
_GOOGLE_READ_HOSTS = (
    "gmail.googleapis.com", "www.googleapis.com", "people.googleapis.com", "sheets.googleapis.com",
    "docs.googleapis.com", "content.googleapis.com",
)
_KNOWN_DIRS = ("/opt/homebrew/bin", "/usr/local/bin", "~/.local/bin")
_create_lock = threading.Lock()


class SandboxUnavailable(RuntimeError):
    """OpenShell is missing or a sandbox could not be reached. The caller must refuse, not fall back."""


def _base(read_write: Sequence[str] = ("/tmp",)) -> Dict[str, Any]:
    return {
        "version": 1,
        "filesystem_policy": {"include_workdir": True, "read_only": ["/usr", "/lib", "/etc", "/bin", "/opt"],
                              "read_write": list(read_write)},
        "landlock": {"compatibility": "best_effort"},
        "process": {"run_as_user": "sandbox", "run_as_group": "sandbox"},
    }


def user_policy() -> Dict[str, Any]:
    policy = _base(("/tmp", "/sandbox"))
    policy["network_policies"] = {
        "google_read": {
            "endpoints": [{"host": h, "port": 443, "protocol": "rest", "enforcement": "enforce", "access": "read-only"}
                          for h in _GOOGLE_READ_HOSTS],
            "binaries": _PYTHON_BINARIES,
        },
        "google_token_refresh": {
            "endpoints": [{"host": "oauth2.googleapis.com", "port": 443, "protocol": "rest", "enforcement": "enforce",
                           "rules": [{"allow": {"method": "POST", "path": "/token"}}]}],
            "binaries": _PYTHON_BINARIES,
        },
    }
    return policy


def browser_policy() -> Dict[str, Any]:
    """No network until a task opens its domains (``open_browser_domains``)."""
    policy = _base(("/tmp", "/sandbox", "/dev/null", "/dev/shm"))
    policy["filesystem_policy"]["read_only"] += [BROWSER_DIR, "/dev/urandom", "/proc", "/sys"]
    return policy


def guard_setup_policy() -> Dict[str, Any]:
    """Only PyPI, read-only, and only while NeMo Guardrails is installed; removed right after."""
    policy = _base(("/tmp", "/sandbox"))
    policy["network_policies"] = {"pypi_setup": {
        "endpoints": [{"host": h, "port": 443, "protocol": "rest", "enforcement": "enforce", "access": "read-only"}
                      for h in ("pypi.org", "files.pythonhosted.org")],
        "binaries": _PYTHON_BINARIES,
    }}
    return policy


def openshell() -> str:
    from scout_platform.resolver import locate_command

    found = locate_command("openshell", known_dirs=_KNOWN_DIRS)
    if not found.command:
        raise SandboxUnavailable("OpenShell is required and the `openshell` program is not installed")
    return found.command[0]


def _run(args: Sequence[str], *, timeout: float = 120, stdin: Optional[str] = None) -> subprocess.CompletedProcess:
    try:
        return subprocess.run([openshell(), *args], capture_output=True, text=True, timeout=timeout, input=stdin)
    except (OSError, subprocess.TimeoutExpired) as exc:
        raise SandboxUnavailable(f"openshell {args[0] if args else ''} failed: {exc}") from exc


def _policy_path(name: str, policy: Dict[str, Any]) -> Path:
    """The policy file OpenShell reads. JSON is valid YAML, so no YAML writer is needed."""
    from scout_constants import get_scout_home

    path = get_scout_home() / "openshell" / f"{name}.yaml"
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(policy, indent=2), encoding="utf-8")
    return path


def existing() -> List[str]:
    proc = _run(["sandbox", "list", "-o", "json"], timeout=30)
    if proc.returncode != 0:
        raise SandboxUnavailable(f"openshell sandbox list failed: {proc.stderr.strip()[:300]}")
    try:
        rows = json.loads(proc.stdout or "[]")
    except ValueError as exc:
        raise SandboxUnavailable("openshell sandbox list returned no JSON") from exc
    rows = rows.get("sandboxes", rows) if isinstance(rows, dict) else rows
    return [str(r.get("name")) for r in rows if isinstance(r, dict) and r.get("name")]


def _create(name: str, policy: Dict[str, Any], extra: Iterable[str] = (),
            command: Sequence[str] = ("sleep", "infinity")) -> None:
    proc = _run(["sandbox", "create", "--name", name, "--policy", str(_policy_path(name, policy)), "--detach",
                 *extra, "--", *command], timeout=600)
    if proc.returncode != 0:
        raise SandboxUnavailable(f"could not create sandbox {name}: {proc.stderr.strip()[:300]}")


def exec_in(name: str, argv: Sequence[str], *, workdir: Optional[str] = None, stdin: Optional[str] = None,
            timeout: float = 120) -> subprocess.CompletedProcess:
    args = ["sandbox", "exec", "-n", name]
    if workdir:
        args += ["--workdir", workdir]
    return _run([*args, "--", *argv], timeout=timeout, stdin=stdin)


# The Google skill inside the User Agent's sandbox: pinned client libraries (the ``google`` extra in
# pyproject.toml), the skill's scripts, a ``scout google`` shim so the skill's commands run
# unchanged, and the sign-in token. Scout itself is never installed there.
GOOGLE_PINS = ("google-api-python-client==2.194.0", "google-auth==2.55.1", "google-auth-oauthlib==1.3.1",
               "google-auth-httplib2==0.3.1", "httplib2==0.32.0", "pyasn1==0.6.4")
USER_HOME = "/sandbox/.scout"
USER_BIN = "/sandbox/bin"
_GOOGLE_SCRIPTS = Path(__file__).resolve().parents[2] / "skills" / "productivity" / "google-workspace" / "scripts"
_SCOUT_SHIM = """#!/bin/sh
# `scout google ...` inside the User Agent's sandbox: only the Google skill exists here.
if [ "$1" = "google" ]; then shift; exec python3 /sandbox/google-workspace/scripts/google_api.py "$@"; fi
echo "Only 'scout google' is available in this sandbox." >&2; exit 2
"""
# Prefix for every User Agent terminal command.
USER_SHELL_ENV = f"export PATH={USER_BIN}:$PATH SCOUT_HOME={USER_HOME}; "
_user_ready: Optional[str] = None


def _files_digest(*paths: Path) -> str:
    import hashlib

    digest = hashlib.sha256()
    for root in paths:
        for path in sorted(root.rglob("*") if root.is_dir() else [root]):
            if path.is_file() and "__pycache__" not in path.parts:
                digest.update(str(path.relative_to(root.parent)).encode() + b"\0" + path.read_bytes())
    return digest.hexdigest()


def _user_setup_policy() -> Dict[str, Any]:
    policy = user_policy()
    policy["network_policies"]["pypi_setup"] = guard_setup_policy()["network_policies"]["pypi_setup"]
    return policy


def _sync_user_files(digest: str) -> None:
    """Scripts, shim and the current sign-in token, re-sent whenever any of them changes."""
    from scout_constants import get_scout_home

    steps = [_run(["sandbox", "upload", USER_SANDBOX, str(_GOOGLE_SCRIPTS), "/sandbox/google-workspace"], timeout=120),
             exec_in(USER_SANDBOX, ["sh", "-c", f"mkdir -p {USER_BIN} {USER_HOME} && cat > {USER_BIN}/scout && "
                                     f"chmod 755 {USER_BIN}/scout"], stdin=_SCOUT_SHIM, timeout=30)]
    token = get_scout_home() / "google_token.json"
    if token.is_file():
        steps.append(_run(["sandbox", "upload", USER_SANDBOX, str(token), f"{USER_HOME}/google_token.json"], timeout=60))
    steps.append(exec_in(USER_SANDBOX, ["sh", "-c", f"printf %s {digest} > {USER_HOME}/.files-digest"], timeout=30))
    failed = next((step for step in steps if step.returncode != 0), None)
    if failed is not None:
        raise SandboxUnavailable(f"could not prepare the User Agent's sandbox: {failed.stderr.strip()[:300]}")


def ensure_user_sandbox() -> None:
    """The User Agent's sandbox, created on first use with the Google libraries installed (PyPI is
    reachable only during that install), and its scripts and token kept current."""
    global _user_ready
    from scout_constants import get_scout_home

    token = get_scout_home() / "google_token.json"
    import hashlib

    files = _files_digest(_GOOGLE_SCRIPTS, *([token] if token.is_file() else []))
    digest = hashlib.sha256((files + _SCOUT_SHIM).encode()).hexdigest()
    if _user_ready == digest:
        return
    with _create_lock:
        if USER_SANDBOX not in existing():
            _create(USER_SANDBOX, _user_setup_policy(), ["--from", PYTHON_IMAGE])
            install = exec_in(USER_SANDBOX, ["python3", "-m", "pip", "install", "--user", "--no-input", *GOOGLE_PINS],
                              timeout=900)
            closed = _run(["policy", "update", USER_SANDBOX, "--remove-rule", "pypi_setup", "--wait"], timeout=120)
            if install.returncode != 0 or closed.returncode != 0:
                raise SandboxUnavailable("could not install the Google libraries in the User Agent's sandbox: "
                                         f"{(install.stderr or closed.stderr).strip()[:300]}")
        current = exec_in(USER_SANDBOX, ["cat", f"{USER_HOME}/.files-digest"], timeout=30)
        if current.returncode != 0 or current.stdout.strip() != digest:
            _sync_user_files(digest)
        _user_ready = digest


def _rail_digest() -> str:
    import hashlib

    src = Path(__file__).resolve().parent / "nemo_guard"
    digest = hashlib.sha256()
    for path in sorted(src.iterdir()):
        if path.is_file():
            digest.update(path.name.encode() + b"\0" + path.read_bytes())
    return digest.hexdigest()


_guard_ready: Optional[str] = None


def _upload_rail(digest: str) -> None:
    src = Path(__file__).resolve().parent / "nemo_guard"
    upload = _run(["sandbox", "upload", GUARD_SANDBOX, str(src), GUARD_DIR], timeout=120)
    stamp = exec_in(GUARD_SANDBOX, ["sh", "-c", f"printf %s {digest} > {GUARD_DIR}/.rail-digest"], timeout=30)
    if upload.returncode != 0 or stamp.returncode != 0:
        raise SandboxUnavailable(f"could not upload the guard rail: {(upload.stderr or stamp.stderr).strip()[:300]}")


def ensure_guard_sandbox() -> None:
    """Create the guard sandbox, install pinned NeMo Guardrails, then close its network. The rail
    files are re-uploaded whenever they change, so a stale rail never judges a message."""
    global _guard_ready
    digest = _rail_digest()
    if _guard_ready == digest:
        return
    with _create_lock:
        if GUARD_SANDBOX not in existing():
            _create(GUARD_SANDBOX, guard_setup_policy(), ["--from", PYTHON_IMAGE])
            install = exec_in(GUARD_SANDBOX, ["python3", "-m", "pip", "install", "--user", "--no-input",
                                              NEMOGUARDRAILS_PIN], timeout=900)
            closed = _run(["policy", "update", GUARD_SANDBOX, "--remove-rule", "pypi_setup", "--wait"], timeout=120)
            if install.returncode != 0 or closed.returncode != 0:
                raise SandboxUnavailable("could not install NeMo Guardrails in the guard sandbox: "
                                         f"{(install.stderr or closed.stderr).strip()[:300]}")
        current = exec_in(GUARD_SANDBOX, ["cat", f"{GUARD_DIR}/.rail-digest"], timeout=30)
        if current.returncode != 0 or current.stdout.strip() != digest:
            _upload_rail(digest)
        _guard_ready = digest


_CHROME = (f"{BROWSER_DIR}/headless-shell --no-sandbox --no-zygote --disable-gpu "
           f"--remote-debugging-address=127.0.0.1 --remote-debugging-port={BROWSER_CDP_PORT} "
           "--user-data-dir=/tmp/chrome about:blank")
# Chromium restarts from an empty profile whenever it exits; ``restart_browser`` ends it before each
# task, so no cookie, history or cached DNS answer outlives the task that made it.
_BROWSER_COMMAND = ("/bin/sh", "-c", f"while :; do rm -rf /tmp/chrome; {_CHROME}; sleep 0.2; done")


def _browser_task_policy(domains: Sequence[str]) -> Dict[str, Any]:
    """The browser sandbox with only *domains* (and their subdomains) reachable, by Chromium only.
    TLS passes through uninspected: the browser verifies sites itself, OpenShell enforces the hosts."""
    policy = browser_policy()
    if domains:
        hosts = [h for d in domains for h in (d, f"*.{d}")]
        policy["network_policies"] = {"browse_task": {
            "endpoints": [{"host": h, "ports": [443, 80], "tls": "skip"} for h in hosts],
            "binaries": [{"path": f"{BROWSER_DIR}/headless-shell"}],
        }}
    return policy


def _forward_running() -> bool:
    proc = _run(["forward", "list"], timeout=30)
    return any(BROWSER_SANDBOX in line and str(BROWSER_CDP_PORT) in line and "running" in line
               for line in (proc.stdout or "").splitlines())


def ensure_browser_sandbox() -> str:
    """Chromium running in the browser sandbox, its DevTools port forwarded; returns the CDP URL."""
    with _create_lock:
        if BROWSER_SANDBOX not in existing():
            _create(BROWSER_SANDBOX, browser_policy(), ["--from", BROWSER_IMAGE], command=_BROWSER_COMMAND)
        if not _forward_running():
            # The background forwarder outlives this call: it must not inherit our pipes, or
            # waiting for the command's output would wait for the forwarder itself.
            try:
                subprocess.run([openshell(), "forward", "start", "--background", str(BROWSER_CDP_PORT), BROWSER_SANDBOX],
                               stdin=subprocess.DEVNULL, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
                               start_new_session=True, timeout=60, check=False)
            except (OSError, subprocess.TimeoutExpired) as exc:
                raise SandboxUnavailable(f"could not forward the browser port: {exc}") from exc
    return _wait_for_browser()


def _wait_for_browser() -> str:
    import time
    import urllib.request

    url = f"http://127.0.0.1:{BROWSER_CDP_PORT}"
    for _ in range(30):
        try:
            with urllib.request.urlopen(f"{url}/json/version", timeout=2):
                return url
        except OSError:
            time.sleep(1)
    raise SandboxUnavailable("the sandboxed browser did not answer on its DevTools port")


def restart_browser() -> str:
    """A fresh Chromium (empty profile, empty DNS cache) for the next task; returns the CDP URL."""
    proc = exec_in(BROWSER_SANDBOX, ["/bin/sh", "-c", "kill $(pidof headless-shell) 2>/dev/null; true"], timeout=30)
    if proc.returncode != 0:
        raise SandboxUnavailable(f"could not restart the sandboxed browser: {proc.stderr.strip()[:300]}")
    import time
    time.sleep(1)
    return _wait_for_browser()


def set_browser_domains(domains: Sequence[str]) -> None:
    """Open the browser sandbox's network to exactly *domains* (empty closes it), live."""
    path = _policy_path(f"{BROWSER_SANDBOX}-task", _browser_task_policy(domains))
    proc = _run(["policy", "set", BROWSER_SANDBOX, "--policy", str(path), "--wait"], timeout=120)
    if proc.returncode != 0:
        raise SandboxUnavailable(f"could not set the browser sandbox's domains: {proc.stderr.strip()[:300]}")
