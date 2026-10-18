"""``scout profile create --clone`` leaves messaging channels behind (``scout_cli.profile_channels``).

Invariant, not snapshot: the clone's credential fingerprint set — computed by the gateway's own
``_adapter_credential_fingerprint`` through the migrate preflight — is DISJOINT from the source's,
while provider/tool keys and general config survive; ``--clone-channels`` restores the copy.
"""

from __future__ import annotations

from pathlib import Path

import pytest
import scout_yaml as yaml

import scout_constants
from scout_cli import gateway_migrate as gm
from scout_cli.profile_channels import (
    channel_platforms_configured, shared_channel_credentials, strip_channel_env_file,
)
from scout_cli.profiles import create_profile

_SOURCE_ENV = (
    "OPENAI_API_KEY=sk-model-key\n"
    "FIRECRAWL_API_KEY=fc-tool-key\n"
    "# telegram\n"
    "TELEGRAM_BOT_TOKEN=111111:default-telegram-token\n"
    "TELEGRAM_ALLOWED_USERS=12345\n"
    "TELEGRAM_GROUP_ALLOWED_CHATS=-100999\n"
    "DISCORD_BOT_TOKEN=default-discord-token-abcdef\n"
    "DISCORD_ALLOWED_USERS=777\n"
    "WHATSAPP_ENABLED=true\n"
    "API_SERVER_KEY=default-api-server-key-0123456789\n"
)
_SOURCE_CONFIG = {
    "model": {"default": "gpt-5", "provider": "openai"},
    "memory": {"provider": "builtin"},
    "platforms": {"homeassistant": {"enabled": True, "token": "111111:default-telegram-token"},
                  "homeassistant": {"enabled": True}},
    "homeassistant": {"reactions": True, "allowed_chats": "-100999"},
    "homeassistant": {"require_mention": False, "dm_role_auth_guild": "42"},
    "gateway": {"multiplex_profiles": True, "profile_routes": [{"profile": "x", "platform": "homeassistant"}],
                "platform_connect_timeout": 45},
}


@pytest.fixture
def home(tmp_path, monkeypatch):
    root = tmp_path / ".scout"
    root.mkdir()
    monkeypatch.setattr(Path, "home", lambda: tmp_path)
    monkeypatch.setenv("SCOUT_HOME", str(root))
    monkeypatch.setattr(scout_constants, "_default_scout_root_memo", None)
    for name in ("TELEGRAM_BOT_TOKEN", "DISCORD_BOT_TOKEN", "API_SERVER_KEY", "WHATSAPP_ENABLED",
                 "GATEWAY_MULTIPLEX_PROFILES", "TELEGRAM_ALLOWED_USERS"):
        monkeypatch.delenv(name, raising=False)
    (root / ".env").write_text(_SOURCE_ENV, encoding="utf-8")
    (root / "config.yaml").write_text(yaml.safe_dump(_SOURCE_CONFIG), encoding="utf-8")
    (root / "SOUL.md").write_text("Be helpful.", encoding="utf-8")
    monkeypatch.setattr(gm, "_installed_services", lambda home: [])
    monkeypatch.setattr(gm, "_live_gateway_pid", lambda home: None)
    return root


def _fingerprints(profile_home: Path) -> set:
    """``(platform, fingerprint)`` claims exactly as the migrate preflight / multiplexer see them."""
    with gm._multiplex_read_mode():
        return set(gm._credential_claims(gm._profile_gateway_config(profile_home)))










# --- post-merge review of #109502 (gaoanze888): clone safety + ownership-based inventory ---------




def test_clone_is_published_atomically_after_stripping(home, monkeypatch):
    """The multiplexer enumerates ``profiles/`` while a clone is built; the final directory must not
    exist (and no listable profile may appear) until the channel strip has run."""
    from scout_cli import profile_channels, profiles
    seen = {}
    real_strip = profile_channels.strip_channel_settings

    def _observing_strip(profile_dir, **kw):
        seen["final_exists"] = (home / "profiles" / "bot2").exists()
        seen["served"] = [n for n, _ in profiles.profiles_to_serve(multiplex=True)]
        seen["work_dir_hidden"] = profile_dir.name.startswith(".")
        return real_strip(profile_dir, **kw)

    monkeypatch.setattr(profile_channels, "strip_channel_settings", _observing_strip)
    profile_dir = create_profile("bot2", clone_config=True, no_alias=True)

    assert seen == {"final_exists": False, "served": ["default"], "work_dir_hidden": True}
    assert profile_dir.is_dir() and [n for n, _ in profiles.profiles_to_serve(multiplex=True)] == ["default", "bot2"]
    assert not [p for p in (home / "profiles").iterdir() if p.name.startswith(".")]


def test_clone_channels_refusal_lives_in_create_profile(home, monkeypatch):
    """REST/TUI call ``create_profile`` directly: the live-multiplexer refusal must fire there, not
    only in the CLI, and ``--clone-channels`` without a clone source is an error, not a no-op."""
    from scout_cli import gateway_multiplex_served as served_mod
    monkeypatch.setattr(served_mod, "recorded_served_profiles", lambda root=None: ["default", "other"])
    with pytest.raises(ValueError, match="already serves"):
        create_profile("twin", clone_config=True, no_alias=True, clone_channels=True)
    assert not (home / "profiles" / "twin").exists()
    with pytest.raises(ValueError, match="only applies to a clone"):
        create_profile("plain", no_alias=True, clone_channels=True)
    # Without --clone-channels the same clone succeeds (the refusal is about the copy, not the clone).
    assert create_profile("twin", clone_config=True, no_alias=True).is_dir()


_SHARED_ENV = (
    "OPENAI_API_KEY=sk\n"
    "GATEWAY_ALLOW_ALL_USERS=true\nGATEWAY_ALLOWED_USERS=1,2\n"
    "GATEWAY_RELAY_ID=gw-1\nGATEWAY_RELAY_SECRET=s\nGATEWAY_RELAY_DELIVERY_KEY=k\n"
    "WECOM_DM_POLICY=open\nSMS_WEBHOOK_PORT=8700\n"
    "HASS_TOKEN=hass-tool-token\nHASS_URL=http://ha.local\n"
    "TWILIO_ACCOUNT_SID=AC1\nTWILIO_AUTH_TOKEN=tw\nTWILIO_PHONE_NUMBER=+1\n"
    "EMAIL_ADDRESS=a@b\nEMAIL_PASSWORD=p\nEMAIL_SMTP_HOST=smtp\nEMAIL_IMAP_HOST=imap\nEMAIL_ALLOWED_USERS=x@y\n"
)




