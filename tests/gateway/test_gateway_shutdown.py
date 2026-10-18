import asyncio
import subprocess
from unittest.mock import AsyncMock, MagicMock, patch

import pytest

import gateway.run as gateway_run
from gateway.config import HomeChannel, Platform
from gateway.platforms.event import MessageEvent
from gateway.restart import DEFAULT_GATEWAY_POST_INTERRUPT_GRACE_TIMEOUT, GATEWAY_SERVICE_RESTART_EXIT_CODE
from gateway.session import build_session_key
from tests.gateway.restart_test_helpers import make_restart_runner, make_restart_source
from tools import browser_tool_lifecycle as bt_lifecycle






def test_cron_provider_stop_cannot_override_gateway_exit_code():
    provider = MagicMock()
    provider.stop.side_effect = SystemExit(GATEWAY_SERVICE_RESTART_EXIT_CODE)

    gateway_run._stop_cron_provider(provider)

    provider.stop.assert_called_once_with()

















# ---------------------------------------------------------------------------
# gateway_state persistence on shutdown (issue #42675)
#
# On Docker/s6, container_boot.py only auto-starts gateways whose last
# persisted gateway_state was "running". An unexpected external signal
# (the SIGTERM s6/Docker sends on `docker compose up --force-recreate`,
# OOM, bare kill) must NOT persist "stopped" — otherwise the gateway
# stays down after every container restart. An operator-initiated stop
# writes a planned-stop marker first, so it is NOT signal-initiated and
# DOES persist "stopped", respecting the explicit intent.
# ---------------------------------------------------------------------------


def _persisted_states(runner) -> list:
    """All gateway_state values passed to _update_runtime_status, in order."""
    states = []
    for call in runner._update_runtime_status.call_args_list:
        args, kwargs = call
        state = kwargs.get("gateway_state", args[0] if args else None)
        states.append(state)
    return states


def _stopped_state_persisted(runner) -> bool:
    """True iff _update_runtime_status was called with gateway_state='stopped'."""
    return "stopped" in _persisted_states(runner)




# ── #42126: zombie PID must be treated as dead in _pid_exists ────────────────
# Under systemd Restart=always, the old gateway becomes a zombie (still in the
# process table, not yet reaped) when the replacement starts. _pid_exists must
# report it dead so --replace proceeds instead of waiting on it and aborting
# with exit 1 (a silent crash loop).


def test_pid_exists_zombie_via_psutil_returns_false(monkeypatch):
    """The live path is psutil. psutil.pid_exists() returns True for a zombie,
    so _pid_exists must additionally check Process.status() == STATUS_ZOMBIE."""
    import sys
    import types

    from gateway import status

    fake_psutil = types.SimpleNamespace()
    fake_psutil.STATUS_ZOMBIE = "zombie"

    class NoSuchProcess(Exception):
        pass

    class PsutilError(Exception):
        pass

    fake_psutil.NoSuchProcess = NoSuchProcess
    fake_psutil.Error = PsutilError

    class _Proc:
        def __init__(self, pid):
            self.pid = pid

        def status(self):
            return "zombie"

    fake_psutil.Process = _Proc
    # Without the zombie guard, this True would make the caller treat the
    # zombie as a live gateway.
    fake_psutil.pid_exists = lambda pid: True

    monkeypatch.setitem(sys.modules, "psutil", fake_psutil)

    assert status._pid_exists(4242) is False




@pytest.mark.asyncio
async def test_shutdown_mcp_servers_nonblocking_keeps_loop_responsive():
    """A wedged MCP shutdown must not freeze the gateway event loop (#82874)."""
    started = asyncio.Event()
    loop = asyncio.get_running_loop()

    def wedged_shutdown(**_kwargs):  # the caller divides its budget across per-profile passes
        loop.call_soon_threadsafe(started.set)
        import time as _time

        _time.sleep(30)

    heartbeats = 0

    async def heartbeat():
        nonlocal heartbeats
        while True:
            heartbeats += 1
            await asyncio.sleep(0.05)

    hb = asyncio.create_task(heartbeat())
    try:
        with patch("tools.mcp_tool_lifecycle.shutdown_mcp_servers", wedged_shutdown):
            done = await asyncio.wait_for(
                gateway_run._shutdown_mcp_servers_nonblocking(timeout=0.5),
                timeout=5,
            )
    finally:
        hb.cancel()

    assert started.is_set()
    assert done is False  # wedged shutdown exceeded the budget
    # The loop kept running while the shutdown thread was wedged.
    assert heartbeats >= 5


@pytest.mark.asyncio
async def test_shutdown_mcp_servers_nonblocking_completes_fast_path():
    calls = []
    with patch("tools.mcp_tool_lifecycle.shutdown_mcp_servers", lambda **_kw: calls.append(1)):
        done = await gateway_run._shutdown_mcp_servers_nonblocking(timeout=5)
    assert done is True
    assert calls == [1]
