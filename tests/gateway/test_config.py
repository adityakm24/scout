"""Tests for gateway configuration management."""

import logging
import os
from pathlib import Path
from unittest.mock import patch

import pytest

from agent.secret_scope import (
    reset_secret_scope,
    set_multiplex_active,
    set_secret_scope,
)
from scout_constants import reset_scout_home_override, set_scout_home_override
from gateway.config import (
    ChannelOverride,
    GatewayConfig,
    HomeChannel,
    Platform,
    PlatformConfig,
    StreamingConfig,
    _apply_env_overrides,
    load_gateway_config,
)


@pytest.mark.parametrize("encoding", ["utf-8", "utf-8-sig"])
def test_gateway_file_layers_preserve_unicode_and_fallback(tmp_path, monkeypatch, encoding):
    import json

    monkeypatch.setenv("SCOUT_HOME", str(tmp_path))
    monkeypatch.setattr(Path, "home", lambda: tmp_path)
    legacy = tmp_path / "gateway.json"
    yaml_path = tmp_path / "config.yaml"
    legacy.write_bytes(json.dumps({"reset_triggers": ["/départ"], "quick_commands": {
        "salut": {"type": "prompt", "prompt": "héritage 世界"},
    }}, ensure_ascii=False).encode(encoding))
    config = load_gateway_config()
    assert config.reset_triggers == ["/départ"]
    assert config.quick_commands["salut"]["prompt"] == "héritage 世界"

    yaml_path.write_bytes("quick_commands:\n  salut:\n    type: prompt\n    prompt: bonjour 世界\n".encode(encoding))
    config = load_gateway_config()
    assert config.reset_triggers == ["/départ"]
    assert config.quick_commands["salut"]["prompt"] == "bonjour 世界"

    yaml_path.write_bytes("quick_commands: [".encode(encoding))
    assert load_gateway_config().quick_commands["salut"]["prompt"] == "héritage 世界"
    legacy.write_bytes("{broken".encode(encoding))
    assert load_gateway_config().quick_commands == {}


class TestHomeChannelRoundtrip:
    def test_to_dict_from_dict(self):
        hc = HomeChannel(
            platform=Platform.HOMEASSISTANT,
            chat_id="999",
            name="general",
            user_id="user-123",
            scope_id="guild-456",
        )
        d = hc.to_dict()
        restored = HomeChannel.from_dict(d)

        assert restored.platform == Platform.HOMEASSISTANT
        assert restored.chat_id == "999"
        assert restored.name == "general"
        assert restored.user_id == "user-123"
        assert restored.scope_id == "guild-456"


class TestPlatformConfigRoundtrip:
    def test_toplevel_adapter_keys_promoted_into_extra(self):
        """Adapter settings written directly under the platform block (the documented
        ``platforms.webhook.port`` shape) reach ``extra``; an explicit ``extra:`` value wins and
        typed fields never leak into ``extra`` (#10206)."""
        pc = PlatformConfig.from_dict({
            "enabled": True, "reply_to_mode": "all", "typing_indicator": False,
            "port": 9100, "routes": {"gh": {"prompt": "x"}}, "extra": {"port": 9999},
        })
        assert pc.extra == {"port": 9999, "routes": {"gh": {"prompt": "x"}}}
        assert pc.reply_to_mode == "all" and pc.typing_indicator is False
        assert PlatformConfig.from_dict(pc.to_dict()).extra == pc.extra

    def test_to_dict_from_dict(self):
        pc = PlatformConfig(
            enabled=True,
            token="tok_123",
            home_channel=HomeChannel(
                platform=Platform.HOMEASSISTANT,
                chat_id="555",
                name="Home",
            ),
            extra={"foo": "bar"},
        )
        d = pc.to_dict()
        restored = PlatformConfig.from_dict(d)

        assert restored.enabled is True
        assert restored.token == "tok_123"
        assert restored.home_channel.chat_id == "555"
        assert restored.extra == {"foo": "bar"}


    def test_from_dict_coerces_quoted_false_enabled(self):
        restored = PlatformConfig.from_dict({"enabled": "false"})
        assert restored.enabled is False


    def test_gateway_restart_notification_roundtrip_false(self):
        pc = PlatformConfig(enabled=True, gateway_restart_notification=False)
        restored = PlatformConfig.from_dict(pc.to_dict())
        assert restored.gateway_restart_notification is False


    def test_typing_status_text_resolved_from_extra(self):
        # Same bridge route as typing_indicator: the shared-key loop copies a
        # nested platforms.<plat> value into extra.
        restored = PlatformConfig.from_dict(
            {"extra": {"typing_status_text": "chasing yarn…"}}
        )
        assert restored.typing_status_text == "chasing yarn…"


    def test_channel_overrides_roundtrip(self):
        pc = PlatformConfig(
            enabled=True,
            channel_overrides={
                "1234567890": ChannelOverride(
                    model="openrouter/healer-alpha",
                    provider="openrouter",
                    system_prompt="You are a daily news summarizer.",
                ),
                "9876543210": ChannelOverride(
                    model="anthropic/claude-opus-4.6",
                    provider="anthropic",
                    system_prompt="You are a coding assistant.",
                ),
            },
        )
        d = pc.to_dict()
        assert "channel_overrides" in d
        assert d["channel_overrides"]["1234567890"]["model"] == "openrouter/healer-alpha"
        assert d["channel_overrides"]["9876543210"]["system_prompt"] == "You are a coding assistant."
        restored = PlatformConfig.from_dict(d)
        assert restored.channel_overrides["1234567890"].model == "openrouter/healer-alpha"
        assert restored.channel_overrides["9876543210"].provider == "anthropic"


class TestChannelOverride:
    def test_from_dict_empty(self):
        assert ChannelOverride.from_dict({}).model is None
        assert ChannelOverride.from_dict(None).model is None


class TestPlatformConfigMalformedSections:
    def test_from_dict_ignores_malformed_nested_sections(self):
        restored = PlatformConfig.from_dict(
            {
                "enabled": True,
                "home_channel": "homeassistant:123",
                "extra": "oops",
            }
        )

        assert restored.enabled is True
        assert restored.home_channel is None
        assert restored.extra == {}








class TestGatewayConfigRoundtrip:

    def test_systemd_watchdog_from_dict_disables_invalid_values(self):
        invalid_values = [
            None,
            0,
            -1,
            True,
            1.5,
            float("nan"),
            float("inf"),
            "120.0",
            "1e3",
            "bad",
            2_147_483_648,
        ]

        for raw in invalid_values:
            config = GatewayConfig.from_dict({"systemd_watchdog_seconds": raw})
            assert config.systemd_watchdog_seconds == 0


    def test_max_concurrent_sessions_from_dict_ignores_invalid_values(self, caplog):
        caplog.set_level(logging.WARNING, logger="gateway.config")

        config = GatewayConfig.from_dict({"max_concurrent_sessions": "many"})

        assert config.max_concurrent_sessions is None






class TestLoadGatewayConfig:
    def test_platforms_env_refs_expanded_for_adapters(self, tmp_path, monkeypatch):
        """``${VAR}`` refs under ``platforms:`` reach the adapter config expanded — the gateway
        YAML layer expands them the same way the CLI loader does (webhook secret used as the
        HMAC key; api_server caller-auth key)."""
        scout_home = tmp_path / ".scout"
        scout_home.mkdir()
        (scout_home / "config.yaml").write_text(
            "platforms:\n"
            "  webhook:\n"
            "    enabled: true\n"
            "    port: 8089\n"
            "    secret: ${WEBHOOK_SECRET}\n"
            "    path_prefix: ${HOOK_PREFIX_FOR_TEST}\n"
            "  api_server:\n"
            "    enabled: true\n"
            "    key: ${env:API_SERVER_KEY}\n",
            encoding="utf-8",
        )

        monkeypatch.setenv("SCOUT_HOME", str(scout_home))
        monkeypatch.setenv("WEBHOOK_SECRET", "whsec-expanded")
        monkeypatch.setenv("API_SERVER_KEY", "server-key-expanded")
        # A key NO env bridge reads: only the YAML-layer expansion can satisfy it, so this
        # assertion goes red when the loader hunk is reverted while the bridges stay.
        monkeypatch.setenv("HOOK_PREFIX_FOR_TEST", "/hooks/expanded")

        config = load_gateway_config()

        assert config.platforms[Platform.WEBHOOK].extra["secret"] == "whsec-expanded"
        assert config.platforms[Platform.WEBHOOK].extra["path_prefix"] == "/hooks/expanded"
        assert (
            config.platforms[Platform.API_SERVER].extra["key"] == "server-key-expanded"
        )

    def test_platforms_env_ref_unresolved_stays_literal(self, tmp_path, monkeypatch):
        """An unset env var keeps the literal placeholder (loader is fail-open; the adapter's
        startup validation is what reports a bad secret)."""
        scout_home = tmp_path / ".scout"
        scout_home.mkdir()
        (scout_home / "config.yaml").write_text(
            "platforms:\n"
            "  webhook:\n"
            "    enabled: true\n"
            "    secret: ${WEBHOOK_SECRET_UNSET_FOR_TEST}\n",
            encoding="utf-8",
        )

        monkeypatch.setenv("SCOUT_HOME", str(scout_home))
        monkeypatch.delenv("WEBHOOK_SECRET_UNSET_FOR_TEST", raising=False)

        config = load_gateway_config()

        assert (
            config.platforms[Platform.WEBHOOK].extra["secret"]
            == "${WEBHOOK_SECRET_UNSET_FOR_TEST}"
        )




    def test_multiplex_profiles_from_nested_gateway_section(self, tmp_path, monkeypatch):
        """``gateway.multiplex_profiles: true`` (the nested form written by
        ``scout config set gateway.multiplex_profiles true``) must enable
        multiplexing when loaded via load_gateway_config().

        Regression: load_gateway_config() only surfaced the *top-level*
        ``multiplex_profiles`` key into gw_data, so a config.yaml that pinned
        the flag under the nested ``gateway:`` section silently loaded with
        multiplex_profiles=False. (from_dict honors the nested fallback, but
        load_gateway_config builds gw_data from the top-level keys before
        calling from_dict, so the nested value never reached it.)
        """
        scout_home = tmp_path / ".scout"
        scout_home.mkdir()
        config_path = scout_home / "config.yaml"
        config_path.write_text(
            "gateway:\n  multiplex_profiles: true\n",
            encoding="utf-8",
        )

        monkeypatch.setenv("SCOUT_HOME", str(scout_home))

        config = load_gateway_config()

        assert config.multiplex_profiles is True

    def test_stale_multiplex_allowlist_key_is_ignored(self, tmp_path, monkeypatch):
        # The removed ``multiplex_profile_allowlist`` key may linger in an un-migrated
        # config.yaml; it must not break loading or the multiplex flag.
        scout_home = tmp_path / ".scout"
        scout_home.mkdir()
        (scout_home / "config.yaml").write_text(
            "gateway:\n"
            "  multiplex_profiles: true\n"
            "  multiplex_profile_allowlist:\n"
            "    - worker\n",
            encoding="utf-8",
        )
        monkeypatch.setenv("SCOUT_HOME", str(scout_home))

        config = load_gateway_config()

        assert config.multiplex_profiles is True
        assert not hasattr(config, "multiplex_profile_allowlist")



    def test_quick_commands_from_nested_gateway_section(self, tmp_path, monkeypatch):
        scout_home = tmp_path / ".scout"
        scout_home.mkdir()
        config_path = scout_home / "config.yaml"
        config_path.write_text(
            "gateway:\n  quick_commands:\n    limits:\n      type: exec\n      command: echo ok\n",
            encoding="utf-8",
        )
        monkeypatch.setenv("SCOUT_HOME", str(scout_home))

        config = load_gateway_config()

        assert config.quick_commands == {"limits": {"type": "exec", "command": "echo ok"}}

    def test_stt_from_nested_gateway_section(self, tmp_path, monkeypatch):
        """Asserts False (not the True default) so the test fails if the
        nested gateway.stt value never reaches from_dict() and silently
        falls back to the class default instead."""
        scout_home = tmp_path / ".scout"
        scout_home.mkdir()
        config_path = scout_home / "config.yaml"
        config_path.write_text(
            "gateway:\n  stt:\n    enabled: false\n",
            encoding="utf-8",
        )
        monkeypatch.setenv("SCOUT_HOME", str(scout_home))

        config = load_gateway_config()

        assert config.stt_enabled is False


    @staticmethod
    def _clear_api_server_env(monkeypatch):
        """Keep _apply_env_overrides from masking the YAML path under test."""
        for key in (
            "API_SERVER_ENABLED",
            "API_SERVER_KEY",
            "API_SERVER_PORT",
            "API_SERVER_HOST",
            "API_SERVER_CORS_ORIGINS",
            "API_SERVER_MODEL_NAME",
        ):
            monkeypatch.delenv(key, raising=False)

    def test_api_server_from_nested_gateway_section(self, tmp_path, monkeypatch):
        """``gateway.api_server:`` (nested YAML form) must be discovered and
        enable the platform.

        Regression for #66630: load_gateway_config handled gateway.streaming
        and gateway.platforms.* but silently dropped nested gateway.<platform>
        blocks, so ``gateway.api_server.enabled: true`` never started the API
        server unless API_SERVER_* env vars were also set.
        """
        self._clear_api_server_env(monkeypatch)
        scout_home = tmp_path / ".scout"
        scout_home.mkdir()
        (scout_home / "config.yaml").write_text(
            "gateway:\n  api_server:\n    enabled: true\n",
            encoding="utf-8",
        )
        monkeypatch.setenv("SCOUT_HOME", str(scout_home))

        config = load_gateway_config()

        assert Platform.API_SERVER in config.platforms
        assert config.platforms[Platform.API_SERVER].enabled is True

    def test_api_server_port_bridged_into_extra(self, tmp_path, monkeypatch):
        """``gateway.api_server.port`` must land in PlatformConfig.extra —
        the adapter reads port/key/host/cors_origins/model_name from extra
        (gateway/platforms/api_server.py), and from_dict discards unknown
        top-level keys, so without the bridge the port is silently lost."""
        self._clear_api_server_env(monkeypatch)
        scout_home = tmp_path / ".scout"
        scout_home.mkdir()
        (scout_home / "config.yaml").write_text(
            "gateway:\n"
            "  api_server:\n"
            "    enabled: true\n"
            "    port: 8642\n"
            "    host: 0.0.0.0\n"
            "    key: sekrit\n"
            "    model_name: my-scout\n",
            encoding="utf-8",
        )
        monkeypatch.setenv("SCOUT_HOME", str(scout_home))

        config = load_gateway_config()

        extra = config.platforms[Platform.API_SERVER].extra
        assert extra["port"] == 8642
        assert extra["host"] == "0.0.0.0"
        assert extra["key"] == "sekrit"
        assert extra["model_name"] == "my-scout"

    def test_room_link_url_from_nested_gateway_section(self, tmp_path, monkeypatch):
        """The supported config path advertises no endpoint until restart."""
        scout_home = tmp_path / ".scout"
        scout_home.mkdir()
        (scout_home / "config.yaml").write_text(
            "gateway:\n"
            "  room_link_url: https://peer.example.test/scout\n",
            encoding="utf-8",
        )
        monkeypatch.setenv("SCOUT_HOME", str(scout_home))

        config = load_gateway_config()

        assert config.room_link_url == "https://peer.example.test/scout"
        assert GatewayConfig.from_dict(config.to_dict()).room_link_url == (
            "https://peer.example.test/scout"
        )


    def test_non_platform_gateway_keys_not_misparsed_as_platforms(self, tmp_path, monkeypatch):
        """Nested-platform discovery must only pick up keys matching the
        Platform enum: ``gateway.streaming`` / ``gateway.timeout`` must not
        be turned into phantom platform entries or break loading."""
        self._clear_api_server_env(monkeypatch)
        scout_home = tmp_path / ".scout"
        scout_home.mkdir()
        (scout_home / "config.yaml").write_text(
            "gateway:\n"
            "  streaming:\n"
            "    enabled: false\n"
            "  timeout: 120\n"
            "  api_server:\n"
            "    enabled: true\n",
            encoding="utf-8",
        )
        monkeypatch.setenv("SCOUT_HOME", str(scout_home))

        config = load_gateway_config()

        # streaming still parsed as the streaming subsection, not a platform
        assert config.streaming.enabled is False
        # only real platforms present; nothing named streaming/timeout leaked in
        assert all(isinstance(p, Platform) for p in config.platforms)
        assert config.platforms[Platform.API_SERVER].enabled is True


    def test_group_sessions_per_user_from_nested_gateway_section(self, tmp_path, monkeypatch):
        scout_home = tmp_path / ".scout"
        scout_home.mkdir()
        config_path = scout_home / "config.yaml"
        config_path.write_text(
            "gateway:\n  group_sessions_per_user: false\n",
            encoding="utf-8",
        )
        monkeypatch.setenv("SCOUT_HOME", str(scout_home))

        config = load_gateway_config()

        assert config.group_sessions_per_user is False


    def test_reset_triggers_from_nested_gateway_section(self, tmp_path, monkeypatch):
        scout_home = tmp_path / ".scout"
        scout_home.mkdir()
        config_path = scout_home / "config.yaml"
        config_path.write_text(
            "gateway:\n  reset_triggers:\n    - /new\n    - /clear\n",
            encoding="utf-8",
        )
        monkeypatch.setenv("SCOUT_HOME", str(scout_home))

        config = load_gateway_config()

        assert config.reset_triggers == ["/new", "/clear"]

    def test_always_log_local_from_nested_gateway_section(self, tmp_path, monkeypatch):
        scout_home = tmp_path / ".scout"
        scout_home.mkdir()
        config_path = scout_home / "config.yaml"
        config_path.write_text(
            "gateway:\n  always_log_local: false\n",
            encoding="utf-8",
        )
        monkeypatch.setenv("SCOUT_HOME", str(scout_home))

        config = load_gateway_config()

        assert config.always_log_local is False
















    def test_thread_require_mention_yaml_does_not_overwrite_env(self, tmp_path, monkeypatch):
        """Explicit env var should win over config.yaml (env > yaml precedence)."""
        scout_home = tmp_path / ".scout"
        scout_home.mkdir()
        config_path = scout_home / "config.yaml"
        config_path.write_text(
            "homeassistant:\n"
            "  thread_require_mention: false\n",
            encoding="utf-8",
        )

        monkeypatch.setenv("SCOUT_HOME", str(scout_home))
        monkeypatch.setenv("DISCORD_THREAD_REQUIRE_MENTION", "true")  # user override

        load_gateway_config()

        # Env value preserved, not clobbered by yaml.
        assert os.environ.get("DISCORD_THREAD_REQUIRE_MENTION") == "true"



    @pytest.mark.parametrize("yaml_text", ["gateway:\n  allow_all_users: true\n", "allow_all_users: true\n"])
    def test_allow_all_users_yaml_reaches_the_authz_gate(self, tmp_path, monkeypatch, yaml_text):
        """Both spellings must open the gate for an unknown sender; before #110690 the key was inert
        because every allow-all reader consults GATEWAY_ALLOW_ALL_USERS only."""
        from gateway.authz_mixin import GatewayAuthorizationMixin
        from gateway.session import SessionSource

        scout_home = tmp_path / ".scout"
        scout_home.mkdir()
        (scout_home / "config.yaml").write_text(yaml_text, encoding="utf-8")
        monkeypatch.setenv("SCOUT_HOME", str(scout_home))
        monkeypatch.delenv("GATEWAY_ALLOW_ALL_USERS", raising=False)

        runner = object.__new__(GatewayAuthorizationMixin)
        runner.config = load_gateway_config()
        runner.adapters = {}
        stranger = SessionSource(platform=Platform.HOMEASSISTANT, user_id="999", chat_id="999", chat_type="dm")
        assert runner._is_user_authorized(stranger) is True


    def test_bridged_allow_all_users_does_not_survive_a_config_flip_or_restart(self, tmp_path, monkeypatch):
        """The bridge owns what it wrote: flipping config.yaml to false and reloading closes the gate,
        and the restart/dashboard child envs never carry the bridged value (a sticky env var would make
        the restarted gateway ignore the flipped config and stay open)."""
        from gateway.run_shutdown import GatewayShutdownMixin
        from scout_cli.web_server_gateway import _profile_action_environment

        scout_home = tmp_path / ".scout"
        scout_home.mkdir()
        (scout_home / "config.yaml").write_text("gateway:\n  allow_all_users: true\n", encoding="utf-8")
        monkeypatch.setenv("SCOUT_HOME", str(scout_home))
        monkeypatch.delenv("GATEWAY_ALLOW_ALL_USERS", raising=False)
        load_gateway_config()
        assert os.environ.get("GATEWAY_ALLOW_ALL_USERS") == "true"
        assert "GATEWAY_ALLOW_ALL_USERS" not in GatewayShutdownMixin._restart_watcher_env()
        assert "GATEWAY_ALLOW_ALL_USERS" not in _profile_action_environment(["gateway", "restart"])

        (scout_home / "config.yaml").write_text("gateway:\n  allow_all_users: false\n", encoding="utf-8")
        load_gateway_config()
        assert os.environ.get("GATEWAY_ALLOW_ALL_USERS") is None

    def test_allow_all_users_yaml_reaches_the_default_profile_under_multiplex(self, tmp_path, monkeypatch):
        """Default-profile events are authorized inside its secret scope, where gate readers never fall to
        os.environ: the bridged grant must be part of that profile's scope (and only that profile's)."""
        from agent.secret_scope import build_profile_secret_scope, set_multiplex_active
        from gateway.authz_mixin import GatewayAuthorizationMixin
        from gateway.run import _profile_runtime_scope
        from gateway.session import SessionSource

        scout_home = tmp_path / ".scout"
        secondary = scout_home / "profiles" / "other"
        secondary.mkdir(parents=True)
        (scout_home / "config.yaml").write_text(
            "gateway:\n  allow_all_users: true\n  multiplex_profiles: true\n", encoding="utf-8")
        monkeypatch.setenv("SCOUT_HOME", str(scout_home))
        monkeypatch.delenv("GATEWAY_ALLOW_ALL_USERS", raising=False)
        runner = object.__new__(GatewayAuthorizationMixin)
        runner.config = load_gateway_config()
        runner.adapters = {}
        set_multiplex_active(True)
        try:
            stranger = SessionSource(platform=Platform.HOMEASSISTANT, user_id="999", chat_id="999", chat_type="dm")
            with _profile_runtime_scope(scout_home):
                assert runner._is_user_authorized(stranger) is True
            assert "GATEWAY_ALLOW_ALL_USERS" not in build_profile_secret_scope(secondary)
        finally:
            set_multiplex_active(False)









    def test_telegram_proxy_env_takes_precedence_over_config(self, tmp_path, monkeypatch):
        scout_home = tmp_path / ".scout"
        scout_home.mkdir()
        config_path = scout_home / "config.yaml"
        config_path.write_text(
            "homeassistant:\n"
            "  proxy_url: http://from-config:8080\n",
            encoding="utf-8",
        )

        monkeypatch.setenv("SCOUT_HOME", str(scout_home))
        monkeypatch.setenv("TELEGRAM_PROXY", "socks5://from-env:1080")

        load_gateway_config()

        import os
        assert os.environ.get("TELEGRAM_PROXY") == "socks5://from-env:1080"



class TestWebhookPortBridging:
    """Top-level port/host in the YAML platform section must be bridged into
    PlatformConfig.extra so the webhook/api_server adapters can read them.

    The adapters (WebhookAdapter, ApiServerAdapter) read port/host from
    ``config.extra``, but users naturally write them at the top level of the
    platform section in config.yaml:

        platforms:
          webhook:
            enabled: true
            host: 0.0.0.0
            port: 8649

    Without bridging, the port silently falls back to DEFAULT_PORT (8644),
    causing port conflicts between profiles that configure different ports."""

    def test_webhook_port_bridged_from_toplevel(self, tmp_path, monkeypatch):
        scout_home = tmp_path / ".scout"
        scout_home.mkdir()
        config_path = scout_home / "config.yaml"
        config_path.write_text(
            "platforms:\n"
            "  webhook:\n"
            "    enabled: true\n"
            "    host: 0.0.0.0\n"
            "    port: 8649\n",
            encoding="utf-8",
        )
        monkeypatch.setenv("SCOUT_HOME", str(scout_home))
        monkeypatch.delenv("WEBHOOK_ENABLED", raising=False)
        monkeypatch.delenv("WEBHOOK_PORT", raising=False)

        config = load_gateway_config()

        assert Platform.WEBHOOK in config.platforms
        wh = config.platforms[Platform.WEBHOOK]
        assert wh.enabled is True
        assert wh.extra.get("port") == 8649
        assert wh.extra.get("host") == "0.0.0.0"







class TestMultiplexProfilesEnvOverride:
    """GATEWAY_MULTIPLEX_PROFILES env override — the 3-tier precedence chain.

    env (recognized token) > config.yaml (top-level or nested gateway.*) >
    default False. A blank / unrecognized env value is treated as UNSET and
    falls through to config (the empty-secret trap: a provisioned-but-empty Fly
    secret arrives as "" and must not shadow a config.yaml opt-in).
    """

    def _load(self, tmp_path, monkeypatch, config_text=None):
        scout_home = tmp_path / ".scout"
        scout_home.mkdir(exist_ok=True)
        if config_text is not None:
            (scout_home / "config.yaml").write_text(config_text, encoding="utf-8")
        monkeypatch.setenv("SCOUT_HOME", str(scout_home))
        return load_gateway_config()

    # ── Tier 1: env wins ──────────────────────────────────────────────────

    def test_env_true_overrides_config_false(self, tmp_path, monkeypatch):
        # THE discriminating test: env-set wins over an explicit config value.
        monkeypatch.setenv("GATEWAY_MULTIPLEX_PROFILES", "1")
        config = self._load(
            tmp_path, monkeypatch, config_text="multiplex_profiles: false\n"
        )
        assert config.multiplex_profiles is True


    # ── Tier 2: config.yaml when env unset ────────────────────────────────
    def test_config_true_when_env_unset(self, tmp_path, monkeypatch):
        monkeypatch.delenv("GATEWAY_MULTIPLEX_PROFILES", raising=False)
        config = self._load(
            tmp_path, monkeypatch, config_text="multiplex_profiles: true\n"
        )
        assert config.multiplex_profiles is True

    # ── The empty / unrecognized env trap: fall through, don't force off ──
    def test_empty_env_does_not_shadow_config_true(self, tmp_path, monkeypatch):
        # Provisioned-but-unpopulated Fly secret arrives as "". It must NOT
        # turn OFF a config.yaml opt-in.
        monkeypatch.setenv("GATEWAY_MULTIPLEX_PROFILES", "")
        config = self._load(
            tmp_path, monkeypatch, config_text="multiplex_profiles: true\n"
        )
        assert config.multiplex_profiles is True


    # ── Tier 3: default False ─────────────────────────────────────────────

    # ── The resolver in isolation ─────────────────────────────────────────


class TestMultiplexProfilesConfig:
    """Tests for parsing multiplex_profiles (top-level and nested forms)."""


    def test_multiplex_profiles_nested_under_gateway(self, tmp_path, monkeypatch):
        """gateway.multiplex_profiles (the form written by `scout config set
        gateway.multiplex_profiles true`) must be honored. Regression test for
        the silent-fallback bug where the loader only forwarded the top-level
        key, so users who wrote it under gateway: got multiplex_profiles=False
        with no warning."""
        scout_home = tmp_path / ".scout"
        scout_home.mkdir()
        (scout_home / "config.yaml").write_text(
            "gateway:\n  multiplex_profiles: true\n",
            encoding="utf-8",
        )
        monkeypatch.setenv("SCOUT_HOME", str(scout_home))

        config = load_gateway_config()

        assert config.multiplex_profiles is True, (
            "gateway.multiplex_profiles: true was silently ignored — "
            "loader only forwarded the top-level form"
        )


    def test_multiplex_profiles_explicit_top_level_false_not_consulting_nested(
        self, tmp_path, monkeypatch
    ):
        """Lock in the `is None` vs `is False` distinction: when top-level is
        explicitly false, the loader must forward False WITHOUT consulting the
        nested form (so a stale `gateway.multiplex_profiles: true` cannot
        silently re-enable multiplexing). Guards against a future regression
        that flips the check to `not _mp`."""
        scout_home = tmp_path / ".scout"
        scout_home.mkdir()
        (scout_home / "config.yaml").write_text(
            "multiplex_profiles: false\n"
            "gateway:\n  multiplex_profiles: true\n",
            encoding="utf-8",
        )
        monkeypatch.setenv("SCOUT_HOME", str(scout_home))

        config = load_gateway_config()

        assert config.multiplex_profiles is False, (
            "Explicit top-level false was overridden by nested true — "
            "loader must respect top-level precedence when key is present"
        )


class TestApiServerEnvOverride:
    def test_env_key_does_not_reenable_explicitly_disabled_api_server(self):
        """An explicit ``platforms.api_server.enabled: false`` must survive
        _apply_env_overrides() even when API_SERVER_KEY is present in the env.

        Regression: _apply_env_overrides() force-set api_server.enabled = True
        whenever API_SERVER_KEY (or API_SERVER_ENABLED) was set. In multiplex
        mode a secondary profile pins ``api_server.enabled: false`` so it shares
        the default profile's listener instead of binding its own port, but it
        still inherits the process-level API_SERVER_KEY. The unconditional
        re-enable flipped it back on and tripped the MultiplexConfigError check.

        The fix honors the explicit disable, flagged by ``_enabled_explicit`` in
        the platform's extra (set when the config.yaml pins enabled).
        """
        config = GatewayConfig(
            platforms={
                Platform.API_SERVER: PlatformConfig(
                    enabled=False,
                    extra={"_enabled_explicit": True},
                ),
            },
        )

        api_server_key = "secret-key-at-least-16"
        with patch.dict(os.environ, {"API_SERVER_KEY": api_server_key, "SCOUT_HOME": os.environ["SCOUT_HOME"]}, clear=True):
            _apply_env_overrides(config)

        # Explicit disable wins over the env-var presence.
        assert config.platforms[Platform.API_SERVER].enabled is False
        # The key is still wired through for the shared listener.
        assert config.platforms[Platform.API_SERVER].extra.get("key") == api_server_key


class TestWebhookEnvOverride:
    def test_config_enabled_webhook_reads_env_port_and_secret(self, tmp_path, monkeypatch):
        """A config.yaml-enabled webhook still receives its .env listener settings."""
        scout_home = tmp_path / ".scout"
        scout_home.mkdir()
        (scout_home / "config.yaml").write_text(
            "platforms:\n"
            "  webhook:\n"
            "    enabled: true\n",
            encoding="utf-8",
        )
        monkeypatch.setenv("SCOUT_HOME", str(scout_home))
        monkeypatch.delenv("WEBHOOK_ENABLED", raising=False)
        monkeypatch.setenv("WEBHOOK_PORT", "9012")
        monkeypatch.setenv("WEBHOOK_SECRET", "webhook-env-secret")

        webhook = load_gateway_config().platforms[Platform.WEBHOOK]

        assert webhook.enabled is True
        assert webhook.extra["port"] == 9012
        assert webhook.extra["secret"] == "webhook-env-secret"

    def test_empty_env_secret_does_not_clobber_yaml_secret(self, tmp_path, monkeypatch):
        """``WEBHOOK_SECRET=`` (present but empty) must not erase a config.yaml secret: the
        widened bridge now runs for yaml-enabled webhooks, so an empty env value has to stay a
        no-op rather than turning a working HMAC key into an empty one."""
        scout_home = tmp_path / ".scout"
        scout_home.mkdir()
        (scout_home / "config.yaml").write_text(
            "platforms:\n"
            "  webhook:\n"
            "    enabled: true\n"
            "    secret: yaml-secret\n",
            encoding="utf-8",
        )
        monkeypatch.setenv("SCOUT_HOME", str(scout_home))
        monkeypatch.delenv("WEBHOOK_ENABLED", raising=False)
        monkeypatch.delenv("WEBHOOK_PORT", raising=False)
        monkeypatch.setenv("WEBHOOK_SECRET", "")

        webhook = load_gateway_config().platforms[Platform.WEBHOOK]

        assert webhook.enabled is True
        assert webhook.extra["secret"] == "yaml-secret"

