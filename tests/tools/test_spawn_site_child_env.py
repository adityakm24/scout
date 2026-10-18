"""Real children started by the production spawn sites observe the secret scrub."""

import json
import sys
from pathlib import Path

import pytest

from tests.tools._child_env_fixtures import child_env  # noqa: F401

_TIER1 = ("GH_TOKEN", "HASS_TOKEN")
_PROVIDER = "OPENAI_API_KEY"


def _plant(monkeypatch):
    for name in (*_TIER1, _PROVIDER):
        monkeypatch.setenv(name, f"fake-{name.lower()}")


def _probe_script(path: Path, out: Path, names) -> Path:
    path.write_text(
        f"#!{sys.executable}\nimport json, os\n"
        f"open({str(out)!r}, 'w').write(json.dumps({{n: os.environ.get(n) for n in {list(names)!r}}}))\n",
        encoding="utf-8")
    path.chmod(0o755)
    return path


def _compute_host_seen(child_env, monkeypatch, names):
    from tui_gateway.host_supervisor import HostSupervisor

    hello = ("import json, os, sys; print(json.dumps({'type': 'hello', 'seen': "
             f"{{n: os.environ.get(n) for n in {names!r}}}}}), flush=True); sys.stdin.readline()")
    sup = HostSupervisor(registry_path=child_env / "host.json", argv=[sys.executable, "-c", hello],
                         cwd=child_env, expected_build_sha="unknown", autostart=False)
    try:
        sup.start()
        return sup._hello["seen"]
    finally:
        sup.shutdown()


def _openviking_server_seen(child_env, monkeypatch, names):
    import subprocess

    import plugins.memory.openviking as ov

    out = child_env / "seen.json"
    probe = _probe_script(child_env / "openviking-server", out, names)
    monkeypatch.setattr(ov, "_local_openviking_port_is_open", lambda host, port: False)
    monkeypatch.setattr(ov.shutil, "which", lambda name: str(probe))
    real_popen, children = subprocess.Popen, []

    def _record(*args, **kwargs):
        children.append(real_popen(*args, **kwargs))
        return children[-1]

    monkeypatch.setattr(ov.subprocess, "Popen", _record)
    state, _ = ov._start_local_openviking_server("http://127.0.0.1:1933")
    assert state == ov._LOCAL_SERVER_STARTED
    children[0].wait(timeout=30)
    return json.loads(out.read_text(encoding="utf-8-sig"))


def test_compute_host_is_scout_and_keeps_its_full_environment(child_env, monkeypatch):
    # It runs agent turns for the dashboard, so it needs what the turn needs: keys set only in the
    # process env (Docker -e, systemd) are not in any .env for it to reload (#65895).
    _plant(monkeypatch)
    names = [*_TIER1, _PROVIDER]
    assert _compute_host_seen(child_env, monkeypatch, names) == {n: f"fake-{n.lower()}" for n in names}






