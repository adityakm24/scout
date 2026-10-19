"""Regression tests for #100489 — desktop multiplex ticker must not deliver a
secondary profile's cron output through the default profile's identity.

Two halves:

1. ``_deliver_result``'s standalone fallback pool (taken when the caller has a
   RUNNING event loop — the desktop dashboard shape) spawns a fresh thread that
   did not inherit the profile ContextVars; it must run inside a copy of the
   active context so the sender reads THIS profile's home + secrets.
2. The desktop ticker must stand down, per tick, for a profile whose OWN
   gateway is running — that gateway ticks it with live adapters, and racing it
   on the tick lock lets the adapter-less desktop ticker deliver standalone.
"""
import threading
from unittest.mock import patch

import pytest


def test_multiplex_ticker_profile_gate_skips_rejected_profile(tmp_path):
    from cron.scheduler_provider import InProcessCronScheduler
    from scout_constants import get_scout_home

    own_gateway = tmp_path / "own-gateway"
    orphan = tmp_path / "orphan"
    for home in (own_gateway, orphan):
        (home / "cron").mkdir(parents=True)

    stop = threading.Event()
    ticked: list[str] = []

    def _tick(*args, **kwargs):
        ticked.append(str(get_scout_home()))
        if len(ticked) >= 3:
            stop.set()
        return 0

    provider = InProcessCronScheduler()
    with patch("cron.scheduler.tick", side_effect=_tick):
        thread = threading.Thread(
            target=provider.start,
            args=(stop,),
            kwargs={
                "interval": 0,
                "profile_homes": [("own-gateway", own_gateway), ("orphan", orphan)],
                "profile_gate": lambda name, home: name != "own-gateway",
            },
            daemon=True,
        )
        thread.start()
        thread.join(timeout=5)
        stop.set()
        thread.join(timeout=5)

    assert not thread.is_alive()
    assert set(ticked) == {str(orphan)}
    # The gated profile gets no tick-loop success marker either: its own
    # gateway owns that status surface.
    assert not (own_gateway / "cron" / "ticker_last_success").exists()
    assert (orphan / "cron" / "ticker_last_success").exists()


@pytest.mark.parametrize("profile_count", [1, 2])
def test_desktop_ticker_gates_on_profile_gateway_running(tmp_path, monkeypatch, profile_count):
    """Desktop yields to each live gateway, including a single-profile install."""
    from scout_backend import web_server

    homes = [("default", tmp_path / "default"), ("ops", tmp_path / "ops")][:profile_count]
    running = {homes[-1][1]}
    monkeypatch.setattr(
        "scout_backend.profiles.profiles_to_serve", lambda multiplex=False: list(homes)
    )
    monkeypatch.setattr(
        "scout_backend.profiles._check_gateway_running", lambda home: home in running
    )
    monkeypatch.setattr("scout_backend.profiles._served_by_running_multiplexer", lambda name: False)
    captured = {}

    class _Provider:
        name = "fake"

        def start(self, stop_event, **kwargs):
            captured.update(kwargs)

    from cron import scheduler_provider as sp

    monkeypatch.setattr(web_server, "resolve_cron_scheduler", lambda: _Provider(), raising=False)
    monkeypatch.setattr(sp, "resolve_cron_scheduler", lambda: _Provider())
    monkeypatch.setattr(sp, "InProcessCronScheduler", _Provider)
    monkeypatch.setattr("scout_logging.enable_profile_log_routing", lambda homes: None)

    web_server._start_desktop_cron_ticker(threading.Event(), interval=0)

    # The Desktop hands the scheduler a live enumerator, not a startup snapshot,
    # so profiles created or deleted while the app runs are picked up per tick.
    profile_homes = captured.get("profile_homes")
    assert callable(profile_homes)
    assert profile_homes() == homes
    gate = captured.get("profile_gate")
    assert gate is not None, "desktop ticker did not install a profile gate"
    for name, home in homes:
        assert gate(name, home) is (home not in running)

    # Re-evaluate on each tick: Desktop resumes fallback after gateway exit
    # and stands down again if a gateway starts later.
    running.clear()
    assert all(gate(name, home) for name, home in homes)
    running.update(home for _, home in homes)
    assert not any(gate(name, home) for name, home in homes)
