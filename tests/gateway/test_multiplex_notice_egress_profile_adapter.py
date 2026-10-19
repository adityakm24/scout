"""Out-of-band gateway egress for a SECONDARY profile session leaves through that profile's bot.

Shutdown/restart/update notices and ``/loop`` wakeups resolved their adapter by bare platform from
``runner.adapters`` — the default profile's map — so a secondary session's notice landed in the
user's chat with the wrong bot (and for ``/loop`` the wakeup ran the default profile's turn).  They
must use the session's own profile adapter and fail closed when that profile has none.
"""
import json
from types import SimpleNamespace

import pytest

from gateway.config import GatewayConfig, HomeChannel, Platform, PlatformConfig
from gateway.platforms.event import MessageEvent, MessageType
from gateway.run import GatewayRunner
from gateway.session import SessionSource
from gateway.slash_commands import _restart_notify_payload


class _Adapter:
    def __init__(self):
        self.sent, self.handled = [], []

    async def send(self, chat_id, content=None, metadata=None, **kw):
        self.sent.append(chat_id)
        return SimpleNamespace(success=True, message_id="m", error=None)

    async def handle_message(self, event):
        self.handled.append(event.text)


def _runner():
    r = object.__new__(GatewayRunner)
    r.config = GatewayConfig(platforms={Platform.HOMEASSISTANT: PlatformConfig(enabled=True, token="t")})
    r.adapters = {Platform.HOMEASSISTANT: _Adapter()}
    r._profile_adapters = {"sec": {Platform.HOMEASSISTANT: _Adapter()}, "nobot": {}}
    r._primary_profile_name = "default"
    r.session_store = None
    r._session_sources = None
    r._running_agents = {}
    r._restart_requested = False
    r._restart_command_source = None
    return r






@pytest.mark.asyncio
async def test_loop_wakeup_from_secondary_route_fires_through_its_own_bot(monkeypatch):
    from scout_backend import loops

    class _Mgr:
        state = SimpleNamespace(ticks_fired=1)

        def __init__(self, session_id=None):
            pass

        def is_due(self, now):
            return True

        def fire_tick(self):
            return "tick"

        def complete_tick(self, *_):
            return {}

    monkeypatch.setattr(loops, "LoopManager", _Mgr)
    monkeypatch.setattr(loops, "goal_blocks_loop_tick", lambda sid: False)
    r = _runner()
    r._running = True
    route = {"platform": "homeassistant", "chat_id": "42", "chat_type": "dm", "user_id": "42", "profile": "sec"}
    state = SimpleNamespace(awaiting_response=False, next_due_at=0, route=route)

    await r._loop_wakeup_fire_one("sid", state, 1e12, set())
    await r._loop_wakeup_fire_one("sid2", SimpleNamespace(**{**vars(state), "route": {**route, "profile": "nobot"}}), 1e12, set())

    assert r._profile_adapters["sec"][Platform.HOMEASSISTANT].handled == ["tick"]
    assert r.adapters[Platform.HOMEASSISTANT].handled == []


def _home_config(platform: Platform, chat_id: str, *, notify: bool = True) -> GatewayConfig:
    return GatewayConfig(platforms={platform: PlatformConfig(
        enabled=True, token="t", gateway_restart_notification=notify,
        home_channel=HomeChannel(platform=platform, chat_id=chat_id, name=chat_id))})


