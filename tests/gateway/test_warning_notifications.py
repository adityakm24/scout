"""Warning delivery is independent of normal replies and operational state."""

import asyncio
from types import SimpleNamespace
from unittest.mock import AsyncMock

import pytest

from agent.notices import AgentNotice
from agent.status_output import StatusOutputMixin
from gateway.config import Platform
from gateway.run import GatewayRunner, _load_gateway_config
from gateway.run_turn_runner import TurnRunner
from gateway.session import SessionSource
from gateway.turn_context import TurnContext


from tests.gateway.test_session_hygiene import HygieneCaptureAdapter


class RecordingAdapter(HygieneCaptureAdapter):
    config = SimpleNamespace(extra={})

    def __init__(self):
        super().__init__()
        self.sent = []

    async def send(self, chat_id, content, **kwargs):
        self.sent.append((chat_id, content, kwargs))
        return SimpleNamespace(success=True, message_id=str(len(self.sent)))


class Emitter(StatusOutputMixin):
    suppress_status_output = True
    log_prefix = ""




@pytest.mark.parametrize("enabled", [True, False])
def test_direct_warning_delivery_keeps_failure_state(tmp_path, monkeypatch, enabled):
    from gateway import run

    (tmp_path / "config.yaml").write_text(f"display: {{suppress_warning_notifications: {str(not enabled).lower()}}}")
    monkeypatch.setenv("SCOUT_HOME", str(tmp_path))
    monkeypatch.setattr(run, "_scout_home", tmp_path)
    adapter = RecordingAdapter()
    source = SessionSource(platform=Platform.HOMEASSISTANT, chat_id="chat", user_id="user")
    gateway = object.__new__(GatewayRunner)
    gateway._delivery_adapter_for = lambda source: adapter
    gateway._session_db_init_error = "database is locked"
    gateway._session_db_handle_cache = None
    gateway._home_channel_transports = lambda: [(Platform.HOMEASSISTANT, None, SimpleNamespace(chat_id="chat"), adapter)]
    gateway._send_home_channel_message = AsyncMock()
    asyncio.run(gateway._hmwa_hygiene_notify(source, {}, "Compression failed", "failure"))
    asyncio.run(gateway._run_agent_inactivity_warning(SimpleNamespace(agent_warning=60, agent_timeout=120), source, {}))
    asyncio.run(gateway._send_session_db_warning_notifications())
    assert len(adapter.sent) == (2 if enabled else 0)
    assert gateway._send_home_channel_message.await_count == int(enabled)
    assert gateway._session_db_init_error == "database is locked"
