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
    return _base(("/tmp", "/sandbox"))


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
    import yaml
    from scout_constants import get_scout_home

    path = get_scout_home() / "openshell" / f"{name}.yaml"
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(yaml.safe_dump(policy, sort_keys=False), encoding="utf-8")
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


def _create(name: str, policy: Dict[str, Any], extra: Iterable[str] = ()) -> None:
    proc = _run(["sandbox", "create", "--name", name, "--policy", str(_policy_path(name, policy)), "--detach",
                 *extra, "--", "sleep", "infinity"], timeout=600)
    if proc.returncode != 0:
        raise SandboxUnavailable(f"could not create sandbox {name}: {proc.stderr.strip()[:300]}")


def exec_in(name: str, argv: Sequence[str], *, workdir: Optional[str] = None, stdin: Optional[str] = None,
            timeout: float = 120) -> subprocess.CompletedProcess:
    args = ["sandbox", "exec", "-n", name]
    if workdir:
        args += ["--workdir", workdir]
    return _run([*args, "--", *argv], timeout=timeout, stdin=stdin)


def ensure_user_sandbox() -> None:
    with _create_lock:
        if USER_SANDBOX not in existing():
            _create(USER_SANDBOX, user_policy())


def ensure_guard_sandbox() -> None:
    """Create the guard sandbox, install pinned NeMo Guardrails, then close its network."""
    with _create_lock:
        if GUARD_SANDBOX in existing():
            return
        _create(GUARD_SANDBOX, guard_setup_policy())
        src = Path(__file__).resolve().parent / "nemo_guard"
        upload = _run(["sandbox", "upload", GUARD_SANDBOX, str(src), GUARD_DIR], timeout=120)
        if upload.returncode != 0:
            raise SandboxUnavailable(f"could not upload the guard rail: {upload.stderr.strip()[:300]}")
        install = exec_in(GUARD_SANDBOX, ["python3", "-m", "pip", "install", "--user", "--no-input",
                                          NEMOGUARDRAILS_PIN], timeout=900)
        closed = _run(["policy", "update", GUARD_SANDBOX, "--remove-rule", "pypi_setup", "--wait"], timeout=120)
        if install.returncode != 0 or closed.returncode != 0:
            raise SandboxUnavailable("could not install NeMo Guardrails in the guard sandbox: "
                                     f"{(install.stderr or closed.stderr).strip()[:300]}")
