import asyncio
import subprocess
import time
from datetime import datetime
from unittest.mock import AsyncMock, MagicMock

import pytest

import gateway.run as gateway_run
from agent.i18n import t
from gateway.platforms.event import MessageEvent, MessageType
from gateway.restart import (
    DEFAULT_GATEWAY_SIGNAL_INTERRUPT_GRACE_TIMEOUT,
)
from gateway.session import SessionEntry, build_session_key
from tests.gateway.restart_test_helpers import make_restart_runner, make_restart_source




def test_load_busy_text_mode_follows_input_mode_and_honors_legacy(tmp_path, monkeypatch):
    monkeypatch.setattr(gateway_run, "_scout_home", tmp_path)
    monkeypatch.delenv("SCOUT_GATEWAY_BUSY_TEXT_MODE", raising=False)
    monkeypatch.delenv("SCOUT_GATEWAY_BUSY_INPUT_MODE", raising=False)

    # No knobs set → follows busy_input_mode, which defaults to interrupt.
    assert gateway_run.GatewayRunner._load_busy_text_mode() == "interrupt"

    # busy_input_mode=queue propagates to text handling (single source of truth).
    (tmp_path / "config.yaml").write_text(
        "display:\n  busy_input_mode: queue\n", encoding="utf-8"
    )
    assert gateway_run.GatewayRunner._load_busy_text_mode() == "queue"

    # Legacy explicit busy_text_mode still wins for backward compat.
    (tmp_path / "config.yaml").write_text(
        "display:\n  busy_input_mode: interrupt\n  busy_text_mode: queue\n",
        encoding="utf-8",
    )
    assert gateway_run.GatewayRunner._load_busy_text_mode() == "queue"

    # Legacy env override wins too.
    (tmp_path / "config.yaml").write_text(
        "display:\n  busy_input_mode: interrupt\n", encoding="utf-8"
    )
    monkeypatch.setenv("SCOUT_GATEWAY_BUSY_TEXT_MODE", "queue")
    assert gateway_run.GatewayRunner._load_busy_text_mode() == "queue"

    # Bogus legacy value is ignored → falls through to busy_input_mode (interrupt).
    monkeypatch.setenv("SCOUT_GATEWAY_BUSY_TEXT_MODE", "bogus")
    assert gateway_run.GatewayRunner._load_busy_text_mode() == "interrupt"


def test_load_signal_interrupt_grace_timeout_from_typed_config(
    tmp_path, monkeypatch, caplog
):
    monkeypatch.setattr(gateway_run, "_scout_home", tmp_path)

    assert (
        gateway_run.GatewayRunner._load_signal_interrupt_grace_timeout()
        == DEFAULT_GATEWAY_SIGNAL_INTERRUPT_GRACE_TIMEOUT
    )

    (tmp_path / "config.yaml").write_text(
        "gateway:\n  signal_interrupt_grace_timeout: 0.25\n",
        encoding="utf-8",
    )
    assert gateway_run.GatewayRunner._load_signal_interrupt_grace_timeout() == 0.25

    (tmp_path / "config.yaml").write_text(
        "gateway:\n  signal_interrupt_grace_timeout: 0\n",
        encoding="utf-8",
    )
    assert gateway_run.GatewayRunner._load_signal_interrupt_grace_timeout() == 0.0

    (tmp_path / "config.yaml").write_text(
        "gateway:\n  signal_interrupt_grace_timeout: .inf\n",
        encoding="utf-8",
    )
    assert (
        gateway_run.GatewayRunner._load_signal_interrupt_grace_timeout()
        == DEFAULT_GATEWAY_SIGNAL_INTERRUPT_GRACE_TIMEOUT
    )

    (tmp_path / "config.yaml").write_text(
        "gateway:\n  signal_interrupt_grace_timeout: invalid\n",
        encoding="utf-8",
    )
    assert (
        gateway_run.GatewayRunner._load_signal_interrupt_grace_timeout()
        == DEFAULT_GATEWAY_SIGNAL_INTERRUPT_GRACE_TIMEOUT
    )














@pytest.mark.platforms("windows")
@pytest.mark.asyncio
async def test_windows_detached_restart_scrubs_gateway_marker(monkeypatch, tmp_path):
    """Faking sys.platform="win32" on Linux could not reach the real Windows
    detach branch (msvcrt/creationflags spawn, Lib/site-packages venv layout);
    this runs on the Windows CI job instead."""
    runner, _adapter = make_restart_runner()
    popen_calls = []

    monkeypatch.setattr(gateway_run, "_resolve_scout_bin", lambda: ["scout"])
    monkeypatch.setattr(gateway_run.os, "getpid", lambda: 321)
    monkeypatch.setenv("_SCOUT_GATEWAY", "1")

    import scout_cli._subprocess_compat as subprocess_compat

    monkeypatch.setattr(
        subprocess_compat,
        "windows_detach_popen_kwargs",
        lambda: {},
    )

    def fake_popen(cmd, **kwargs):
        popen_calls.append((cmd, kwargs))
        return MagicMock()

    monkeypatch.setattr(subprocess, "Popen", fake_popen)

    await runner._launch_detached_restart_command()

    assert len(popen_calls) == 1
    cmd, kwargs = popen_calls[0]
    assert cmd[-3:] == ["scout", "gateway", "restart"]
    assert kwargs["env"].get("_SCOUT_GATEWAY") is None
    # The watcher is an installation-bound command: PM's bootstrap selects the
    # dependency generation at child start, no venv is captured in its env.
    from scout_cli._launchers import runtime_command
    from pathlib import Path
    assert cmd[:3] == runtime_command(Path(gateway_run.__file__).resolve().parent.parent)[:3]
    assert kwargs["stdout"] is subprocess.DEVNULL
    assert kwargs["stderr"] is subprocess.DEVNULL


@pytest.mark.platforms("windows")
@pytest.mark.asyncio
async def test_windows_detached_restart_watcher_keeps_console_python(monkeypatch, tmp_path):
    """The restart watcher must run sys.executable (console python) under the
    hidden-console detach kwargs — NOT swap in GUI-subsystem pythonw.exe,
    which would leave the watcher console-less and make its descendants
    flash visible conhosts (#54220/#56747).

    Faking sys.platform on Linux could not enter the Windows-only watcher
    spawn branch this asserts on, so it runs on the Windows CI job.
    """
    runner, _adapter = make_restart_runner()
    popen_calls = []
    venv_dir = tmp_path / "venv"
    site_packages = venv_dir / "Lib" / "site-packages"
    site_packages.mkdir(parents=True)

    monkeypatch.setattr(gateway_run.sys, "executable", r"C:\venv\Scripts\python.exe")
    monkeypatch.setattr(gateway_run, "_resolve_scout_bin", lambda: ["scout"])
    monkeypatch.setattr(gateway_run.os, "getpid", lambda: 321)
    monkeypatch.setenv("VIRTUAL_ENV", str(venv_dir))

    import scout_cli._subprocess_compat as subprocess_compat

    monkeypatch.setattr(
        subprocess_compat,
        "windows_detach_popen_kwargs",
        lambda: {"creationflags": 0x08000200},
    )

    def fake_popen(cmd, **kwargs):
        popen_calls.append((cmd, kwargs))
        return MagicMock()

    monkeypatch.setattr(subprocess, "Popen", fake_popen)

    await runner._launch_detached_restart_command()

    assert len(popen_calls) == 1
    cmd, kwargs = popen_calls[0]
    assert cmd[0] == r"C:\venv\Scripts\python.exe"
    assert cmd[-3:] == ["scout", "gateway", "restart"]
    assert kwargs["creationflags"] == 0x08000200


# ── Shutdown notification tests ──────────────────────────────────────








def _wedged_agent(idle_seconds: float = 4000.0) -> MagicMock:
    """Agent double whose activity summary reports it idle past the timeout."""
    agent = MagicMock()
    agent.get_activity_summary = MagicMock(
        return_value={"seconds_since_activity": idle_seconds}
    )
    return agent


def _live_agent(idle_seconds: float = 1.0) -> MagicMock:
    agent = MagicMock()
    agent.get_activity_summary = MagicMock(
        return_value={"seconds_since_activity": idle_seconds}
    )
    return agent














def test_wedged_cron_check_parses_jobs_once_per_run(monkeypatch, tmp_path):
    """The restart drain polls the wedged count every 0.1 s on the event loop; the job interval
    must be resolved once per in-flight run, not by a full jobs.json parse per job per tick."""
    import cron.scheduler as sched

    monkeypatch.setenv("SCOUT_HOME", str(tmp_path))
    loads = []
    monkeypatch.setattr("cron.jobs.load_jobs", lambda: loads.append(1) or [
        {"id": jid, "schedule": {"kind": "interval", "minutes": 360}} for jid in ("job-a", "job-b", "job-c")])
    for jid in ("job-a", "job-b", "job-c"):
        assert sched.try_register_running_job(jid)
    try:
        for _ in range(50):
            assert sched.get_wedged_job_ids() == frozenset()
        assert len(loads) == 1
        with sched._running_lock:
            sched._running_since[sched._inflight_key("job-b")] = time.time() - 13 * 3600
        assert sched.get_wedged_job_ids() == frozenset({"job-b"})
        assert len(loads) == 1
    finally:
        for jid in ("job-a", "job-b", "job-c"):
            sched.release_running_job(jid)
    assert not sched._running_allowance_s
