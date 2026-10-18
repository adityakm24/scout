"""Regression tests for #48820 Bug 2: an explicit ``platforms.<x>.enabled: false``
in config.yaml must survive ``_apply_env_overrides`` when that platform's
credentials are present in the environment.

Before the fix, twelve credential-presence branches (weixin, whatsapp_cloud,
homeassistant, email, sms, dingtalk, feishu, wecom, wecom_callback, bluebubbles,
qqbot, yuanbao) force-set ``enabled = True`` unconditionally, while Telegram /
Discord / Slack routed through ``_enable_from_env`` and honored the
``_enabled_explicit`` marker.  These tests drive the real ``load_gateway_config``
against a temp SCOUT_HOME — real YAML I/O, no mocks of the code under test.
"""

import logging

import pytest

from gateway import config_env as gateway_config_env
from gateway.config import Platform, load_gateway_config

# platform -> env credentials that trigger its env-enable branch
CRED_ENV = {
    "weixin": {
        "WEIXIN_TOKEN": "wx_9f8e7d6c5b4a3f2e1d0c9b8a7f6e5d4c3b2a1f0e",
        "WEIXIN_ACCOUNT_ID": "acct_12345",
    },
    "whatsapp_cloud": {
        "WHATSAPP_CLOUD_PHONE_NUMBER_ID": "1234567890",
        "WHATSAPP_CLOUD_ACCESS_TOKEN": "EAAB-test-access-token",
    },
    "homeassistant": {"HASS_TOKEN": "hass-long-lived-token"},
    # flag-driven, not credential-driven: WHATSAPP_ENABLED=true must not beat an explicit YAML disable (#73289)
    "whatsapp": {"WHATSAPP_ENABLED": "true"},
    "email": {
        "EMAIL_ADDRESS": "bot@example.com",
        "EMAIL_PASSWORD": "app-password",
        "EMAIL_IMAP_HOST": "imap.example.com",
        "EMAIL_SMTP_HOST": "smtp.example.com",
    },
    "sms": {"TWILIO_ACCOUNT_SID": "ACxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx"},
    "dingtalk": {"DINGTALK_CLIENT_ID": "ding-id", "DINGTALK_CLIENT_SECRET": "ding-secret"},
    "feishu": {"FEISHU_APP_ID": "cli_feishu", "FEISHU_APP_SECRET": "feishu-secret"},
    "wecom": {"WECOM_BOT_ID": "wecom-bot", "WECOM_SECRET": "wecom-secret"},
    "wecom_callback": {
        "WECOM_CALLBACK_CORP_ID": "corp-id",
        "WECOM_CALLBACK_CORP_SECRET": "corp-secret",
    },
    "bluebubbles": {
        "BLUEBUBBLES_SERVER_URL": "http://127.0.0.1:1234",
        "BLUEBUBBLES_PASSWORD": "bb-password",
    },
    "qqbot": {"QQ_APP_ID": "qq-app", "QQ_CLIENT_SECRET": "qq-secret"},
    "yuanbao": {"YUANBAO_APP_ID": "yb-app", "YUANBAO_APP_SECRET": "yb-secret"},
    # control: the pattern that always honored the explicit disable
    "homeassistant": {"TELEGRAM_BOT_TOKEN": "123456:ABC-DEF1234ghIkl-zyx57W2v1u123ew11"},
}

_PLATFORM_ENV_PREFIXES = (
    "TELEGRAM_", "DISCORD_", "SLACK_", "WEIXIN_", "WHATSAPP_", "HASS_", "EMAIL_",
    "TWILIO_", "DINGTALK_", "FEISHU_", "WECOM_", "BLUEBUBBLES_", "QQ_", "QQBOT_",
    "YUANBAO_", "GATEWAY_RELAY", "SIGNAL_", "MATTERMOST_", "MATRIX_",
)

def _isolate(monkeypatch, tmp_path, env):
    import os

    for key in list(os.environ):
        if key.startswith(_PLATFORM_ENV_PREFIXES):
            monkeypatch.delenv(key, raising=False)
    scout_home = tmp_path / ".scout"
    scout_home.mkdir()
    monkeypatch.setenv("SCOUT_HOME", str(scout_home))
    for k, v in env.items():
        monkeypatch.setenv(k, v)
    return scout_home




@pytest.fixture()
def _fresh_warn_dedup(monkeypatch):
    """The explicit-disable notice is one-time per process; start each test clean."""
    monkeypatch.setattr(gateway_config_env, "_EXPLICIT_DISABLE_WARNED", set())


@pytest.mark.usefixtures("_fresh_warn_dedup")
def test_no_warning_when_yaml_has_no_opinion_or_is_enabled(tmp_path, monkeypatch, caplog):
    scout_home = _isolate(monkeypatch, tmp_path, {**CRED_ENV["weixin"], **CRED_ENV["homeassistant"]})
    (scout_home / "config.yaml").write_text(
        "platforms:\n  homeassistant:\n    enabled: true\n", encoding="utf-8"
    )

    with caplog.at_level(logging.WARNING, logger="gateway.config"):
        config = load_gateway_config()

    assert config.platforms[Platform.HOMEASSISTANT].enabled is True
    assert config.platforms[Platform.HOMEASSISTANT].enabled is True
    assert not [r for r in caplog.records if "explicitly disabled" in r.getMessage()]

