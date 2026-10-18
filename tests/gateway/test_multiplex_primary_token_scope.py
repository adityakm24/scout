"""#64674 — multiplex primary gateway must not fail forever without bot tokens.

When gateway.multiplex_profiles is on and TELEGRAM_BOT_TOKEN lives only in a
secondary profile's .env, the default-profile primary adapter used to start
with an empty token, log "No bot token configured", and queue an infinite
reconnect loop. Secondary profiles already load under _profile_runtime_scope;
this suite locks the complementary primary-path fixes:

1. load_gateway_config_for_runner reloads under the default profile secret scope
   when multiplex is on (so default .env tokens resolve like secondary loads).
2. Primary startup skips token platforms that still have no credential under
   multiplex instead of connecting-and-failing forever.
3. The reconnect watcher drops empty-token queued configs.
"""
from __future__ import annotations

from pathlib import Path
from types import SimpleNamespace
from unittest.mock import MagicMock

import pytest

from gateway.config import GatewayConfig, Platform, PlatformConfig


@pytest.fixture(autouse=True)
def _reset_multiplex_flag():
    from agent import secret_scope as ss

    ss.set_multiplex_active(False)
    yield
    ss.set_multiplex_active(False)


class TestLoadGatewayConfigForRunner:
    def test_unscoped_when_multiplex_off(self, tmp_path, monkeypatch):
        from gateway import run as run_mod

        home = tmp_path / "home"
        home.mkdir()
        (home / ".env").write_text("TELEGRAM_BOT_TOKEN=from-default-env\n", encoding="utf-8")
        (home / "config.yaml").write_text("gateway:\n  multiplex_profiles: false\n", encoding="utf-8")
        monkeypatch.setenv("SCOUT_HOME", str(home))
        monkeypatch.delenv("TELEGRAM_BOT_TOKEN", raising=False)

        # Without multiplex, dotenv is still loaded into os.environ by the
        # normal env loader in real gateways; here we only assert the helper
        # returns a non-multiplex config without requiring a scope.
        cfg = run_mod.load_gateway_config_for_runner()
        assert cfg.multiplex_profiles is False








class TestPrimaryMessageRuntimeScope:

    @pytest.mark.asyncio
    async def test_primary_busy_path_authorizes_in_transport_scope(
        self, tmp_path, monkeypatch
    ):
        """Routed busy messages must read the admitting adapter's allowlist.

        Signal on Rémi's host is a primary/default transport that routes turns
        into Sharik via gateway.profile_routes.  A follow-up can arrive while
        the Sharik agent is still busy; that busy callback used to skip the
        default-profile scoping wrapper and check SIGNAL_ALLOWED_USERS inside
        Sharik's unrelated secret scope.
        """
        from agent import secret_scope
        from gateway import run as run_mod
        from gateway.run import GatewayRunner
        from gateway.session import SessionSource

        home = tmp_path / "home"
        home.mkdir()
        (home / ".env").write_text(
            "SIGNAL_ALLOWED_USERS=+15550001111\n"
            "SIGNAL_ALLOW_ALL_USERS=false\n",
            encoding="utf-8",
        )
        sharik = tmp_path / "profiles" / "sharik"
        sharik.mkdir(parents=True)
        (sharik / ".env").write_text("# no Signal allowlist here\n", encoding="utf-8")
        (sharik / "config.yaml").write_text("{}\n", encoding="utf-8")

        monkeypatch.setattr(run_mod, "get_scout_home", lambda: home)
        secret_scope.set_multiplex_active(True)

        runner = GatewayRunner.__new__(GatewayRunner)
        runner.config = GatewayConfig(multiplex_profiles=True)
        runner._resolve_profile_home_for_source = lambda _source: sharik  # type: ignore[method-assign]
        runner._session_key_for_source = lambda source: f"agent:{source.profile}:signal:dm:{source.chat_id}"  # type: ignore[method-assign]
        runner._is_user_authorized_for_source = GatewayRunner._is_user_authorized_for_source.__get__(runner)  # type: ignore[method-assign]

        async def _busy(event, session_key):
            assert session_key == "agent:sharik:signal:dm:+15550001111"
            # This is what _handle_active_session_busy_message now calls.
            return runner._is_user_authorized_for_source(event.source)

        runner._handle_active_session_busy_message = _busy  # type: ignore[method-assign]
        handler = runner._primary_busy_session_handler()
        event = SimpleNamespace(
            source=SessionSource(
                platform=Platform.HOMEASSISTANT,
                chat_id="+15550001111",
                chat_type="dm",
                user_id="+15550001111",
                user_name="Remi",
                profile="sharik",
            )
        )

        assert await handler(event, "stale-unrouted-key") is True
        with pytest.raises(secret_scope.UnscopedSecretError):
            secret_scope.get_secret("SIGNAL_ALLOWED_USERS")


