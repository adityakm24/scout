"""The `scout` command runs only in the app backend's context, never in a person's shell."""

import subprocess
import sys

import pytest


def _run(env_extra: dict, monkeypatch, *args: str) -> subprocess.CompletedProcess:
    import os

    env = {k: v for k, v in os.environ.items() if k not in {"SCOUT_AGENT", "AI_AGENT"}}
    env.update(env_extra)
    return subprocess.run([sys.executable, "-m", "scout_backend.main", *args], env=env,
                          capture_output=True, text=True, timeout=120)


def test_human_shell_is_refused(monkeypatch):
    result = _run({}, monkeypatch, "memory", "status")

    assert result.returncode == 2
    assert "no command line for people" in result.stderr


def test_backend_context_runs_commands(monkeypatch):
    result = _run({"SCOUT_AGENT": "true"}, monkeypatch, "memory", "status")

    assert result.returncode == 0, result.stderr
    assert "Memory: built-in" in result.stdout


@pytest.mark.parametrize("argv", [["--help"], []])
def test_server_entry_exports_the_marker_before_running_scout(monkeypatch, argv):
    from scout_backend import server_entry

    monkeypatch.delenv("SCOUT_AGENT", raising=False)
    seen = {}
    monkeypatch.setattr(server_entry, "_start_gateway", lambda: None)
    monkeypatch.setattr("scout_backend.main.main", lambda: seen.update(agent=__import__("os").environ.get("SCOUT_AGENT"),
                                                                     argv=list(sys.argv)))
    if argv == ["--help"]:
        with pytest.raises(SystemExit):
            server_entry.main(argv)
        return
    server_entry.main(argv)

    assert seen["agent"] == "true"
    assert seen["argv"][1:3] == ["dashboard", "--no-open"]
