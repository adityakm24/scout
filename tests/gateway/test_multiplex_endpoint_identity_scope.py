"""Invariant: an adapter's endpoint/identity resolves through the SAME profile scope as its secret.

Under ``gateway.multiplex_profiles`` ``os.environ`` holds the DEFAULT profile's values; a secondary
profile's ``.env`` exists only in its secret scope. Every adapter here already read its *secret*
scope-aware but read the paired homeserver / URL / client_id / from-number / webhook URL raw from
``os.environ`` — so the secondary's credential was sent to the default profile's host or identity.
"""

from __future__ import annotations


import pytest

from agent import secret_scope as ss
from gateway.config import PlatformConfig
from tests.gateway._plugin_adapter_loader import load_plugin_adapter

DEFAULT_ENV = {
    "MATRIX_HOMESERVER": "https://default.matrix.example", "MATRIX_USER_ID": "@default:example",
    "MATRIX_DEVICE_ID": "DEFAULTDEV", "MATRIX_ACCESS_TOKEN": "default-matrix-token",
    "HASS_URL": "http://default-ha.example:8123", "HASS_TOKEN": "default-ha-token",
    "TEAMS_CLIENT_ID": "default-client-id", "TEAMS_TENANT_ID": "default-tenant",
    "TEAMS_CLIENT_SECRET": "default-teams-secret", "TEAMS_HOME_CHANNEL": "default-conv",
    "DINGTALK_CLIENT_ID": "default-ding-id", "DINGTALK_CLIENT_SECRET": "default-ding-secret",
    "DINGTALK_WEBHOOK_URL": "https://oapi.dingtalk.com/robot/send?access_token=DEFAULT",
    "TELEGRAM_WEBHOOK_URL": "https://default.example/tg",
}
SECONDARY = {
    "MATRIX_HOMESERVER": "https://bot2.matrix.example", "MATRIX_USER_ID": "@bot2:example",
    "MATRIX_DEVICE_ID": "BOT2DEV", "MATRIX_ACCESS_TOKEN": "bot2-matrix-token",
    "HASS_URL": "http://bot2-ha.example:8123", "HASS_TOKEN": "bot2-ha-token",
    "TEAMS_CLIENT_ID": "bot2-client-id", "TEAMS_TENANT_ID": "bot2-tenant",
    "TEAMS_CLIENT_SECRET": "bot2-teams-secret", "TEAMS_HOME_CHANNEL": "bot2-conv",
    "DINGTALK_CLIENT_ID": "bot2-ding-id", "DINGTALK_CLIENT_SECRET": "bot2-ding-secret",
    "DINGTALK_WEBHOOK_URL": "https://oapi.dingtalk.com/robot/send?access_token=BOT2",
    "TELEGRAM_WEBHOOK_URL": "https://bot2.example/tg",
}


@pytest.fixture
def secondary_scope(monkeypatch):
    """Default profile in os.environ, multiplex on, secondary profile's scope installed."""
    for key, value in DEFAULT_ENV.items():
        monkeypatch.setenv(key, value)
    ss.set_multiplex_active(True)
    token = ss.set_secret_scope(SECONDARY)
    yield
    ss.reset_secret_scope(token)
    ss.set_multiplex_active(False)


def test_homeassistant_url_follows_the_scoped_token(secondary_scope):
    from plugins.platforms.homeassistant.adapter import HomeAssistantAdapter

    adapter = HomeAssistantAdapter(PlatformConfig(enabled=True))
    assert (adapter._hass_url, adapter._hass_token) == (SECONDARY["HASS_URL"], SECONDARY["HASS_TOKEN"])


@pytest.mark.asyncio
async def test_homeassistant_standalone_send_targets_scoped_url(secondary_scope, monkeypatch):
    import aiohttp
    from plugins.platforms.homeassistant import adapter as ha

    seen = {}

    class _Resp:
        status = 200
        async def __aenter__(self): return self
        async def __aexit__(self, *a): return False
        async def text(self): return ""

    class _Sess:
        def __init__(self, *a, **k): pass
        async def __aenter__(self): return self
        async def __aexit__(self, *a): return False
        def post(self, url, **kw): seen["url"] = url; return _Resp()

    monkeypatch.setattr(aiohttp, "ClientSession", _Sess)
    await ha._standalone_send(PlatformConfig(enabled=True), "x", "hi")
    assert seen["url"].startswith(SECONDARY["HASS_URL"] + "/")






