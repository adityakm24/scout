"""Phase 3: secondary-profile adapter registry + same-token conflict detection."""
import logging
import asyncio
import threading
import time
import types
from contextlib import contextmanager
from pathlib import Path
from unittest.mock import AsyncMock, MagicMock

import pytest

import gateway.run as gateway_run
from gateway.config import GatewayConfig, Platform, PlatformConfig
from gateway.platforms.helpers import MessageDeduplicator
from gateway.run import GatewayRunner
from gateway.status import flush_runtime_status


class _FakeAdapter:
    def __init__(self, token=None, config=None):
        self.token = token
        self.config = config


class TestCredentialFingerprint:
    def test_none_without_token(self):
        assert GatewayRunner._adapter_credential_fingerprint(_FakeAdapter()) is None



    def test_reads_feishu_app_id(self):
        """Feishu/Lark authenticates via app_id/app_secret, not a token.

        Without _app_id in the fingerprint attribute list, every Feishu
        adapter in a multiplexed gateway returns None here and the
        same-credential conflict check is silently skipped — N profiles
        spawn WebSocket clients against the same app, which evict each
        other in a 1000 bye loop until all go offline.
        """
        class _FeishuAdapter:
            def __init__(self):
                self._app_id = "cli_a1b2c3"
                self._app_secret = "top-secret"

        fp1 = GatewayRunner._adapter_credential_fingerprint(_FeishuAdapter())
        fp2 = GatewayRunner._adapter_credential_fingerprint(_FeishuAdapter())

        assert fp1 is not None
        assert fp1 == fp2  # same app -> same fingerprint -> conflict detected
        assert "cli_a1b2c3" not in fp1  # log-safe, never the raw credential

    def test_distinct_feishu_app_ids_distinct_fp(self):
        class _FeishuAdapter:
            def __init__(self, app_id):
                self._app_id = app_id
                self._app_secret = "s"

        fp_a = GatewayRunner._adapter_credential_fingerprint(_FeishuAdapter("app-A"))
        fp_b = GatewayRunner._adapter_credential_fingerprint(_FeishuAdapter("app-B"))

        assert fp_a is not None and fp_b is not None
        assert fp_a != fp_b

    @pytest.mark.parametrize("attr", ["_client_id", "_bot_id"])
    def test_reads_app_style_ids_teams_wecom(self, attr):
        """Teams (_client_id) and WeCom (_bot_id) are the same class as Feishu:
        id/secret pairs, no token — cloned profiles must collide."""
        a = types.SimpleNamespace(**{attr: "app-1"})
        b = types.SimpleNamespace(**{attr: "app-1"})
        c = types.SimpleNamespace(**{attr: "app-2"})
        fp = GatewayRunner._adapter_credential_fingerprint
        assert fp(a) is not None and fp(a) == fp(b)
        assert fp(a) != fp(c)
        assert "app-1" not in fp(a)

    def test_reads_config_token(self):
        """Adapters like Discord store token on `config`, not on self.

        Without the config-token fallback, every Discord adapter in a
        multiplexed gateway returns None here and the same-token conflict
        check is silently skipped — N adapters start polling the same bot
        token and race on every inbound message.
        """
        class _Config:
            token = "discord-bot-token"
        class _ConfigBackedAdapter:
            config = _Config()
        fp = GatewayRunner._adapter_credential_fingerprint(_ConfigBackedAdapter())
        assert fp is not None
        assert "discord-bot-token" not in fp
        assert len(fp) == 16

    def test_distinct_config_tokens_distinct_fp(self):
        class _CfgA:
            token = "tok-A"
        class _CfgB:
            token = "tok-B"
        class _A:
            config = _CfgA()
        class _B:
            config = _CfgB()
        a = GatewayRunner._adapter_credential_fingerprint(_A())
        b = GatewayRunner._adapter_credential_fingerprint(_B())
        assert a is not None and b is not None
        assert a != b


class TestProfileMessageHandler:
    @pytest.mark.asyncio
    async def test_stamps_profile_on_unstamped_source(self):
        runner = GatewayRunner.__new__(GatewayRunner)
        seen = {}

        async def _fake_handle(event):
            seen["profile"] = event.source.profile
            return "ok"

        runner._handle_message = _fake_handle
        handler = runner._make_profile_message_handler("coder")

        class _Src:
            profile = None

        class _Evt:
            source = _Src()

        result = await handler(_Evt())
        assert result == "ok"
        assert seen["profile"] == "coder"


class TestProfileRuntimeStatus:
    def test_base_adapter_uses_namespaced_platform_key(self, monkeypatch):
        from gateway.platforms.base import BasePlatformAdapter

        class _ConcreteAdapter(BasePlatformAdapter):
            async def connect(self):
                return True

            async def disconnect(self):
                return None

            async def send(self, *_args, **_kwargs):
                return None

            async def get_chat_info(self, *_args, **_kwargs):
                return None

        adapter = _ConcreteAdapter.__new__(_ConcreteAdapter)
        adapter.platform = Platform.HOMEASSISTANT
        adapter._runtime_status_platform_key = "reviewer:discord"
        writes = []
        monkeypatch.setattr(
            "gateway.status.publish_runtime_status",
            lambda **kwargs: writes.append(kwargs),
        )

        adapter._write_runtime_status_safe("fatal", platform_state="fatal")

        assert writes == [
            {"platform": "reviewer:discord", "platform_state": "fatal"}
        ]


class _SecondaryRecoveryAdapter:
    platform = Platform.HOMEASSISTANT

    def __init__(self, *, retryable=True):
        self.fatal_error_retryable = retryable
        self.fatal_error_code = "transport_stale" if retryable else "auth_failed"
        self.fatal_error_message = "Gateway transport stale"
        self.connected = False
        self.disconnected = False
        self._dedup = MessageDeduplicator()

    async def disconnect(self):
        self.disconnected = True

    def set_message_handler(self, handler):
        self.message_handler = handler

    def set_fatal_error_handler(self, handler):
        self.fatal_error_handler = handler

    def set_session_store(self, store):
        self.session_store = store

    def set_busy_session_handler(self, handler):
        self.busy_session_handler = handler

    def set_topic_recovery_fn(self, handler):
        self.topic_recovery_fn = handler

    def set_authorization_check(self, handler):
        self.authorization_check = handler

    def set_platform_event_handler(self, handler):
        self.platform_event_handler = handler


def _secondary_recovery_runner(*, running=True):
    runner = GatewayRunner.__new__(GatewayRunner)
    runner.config = GatewayConfig(multiplex_profiles=True)
    runner._running = running
    runner._profile_adapters = {}
    runner._profile_failed_platforms = {}
    runner._background_tasks = set()
    runner.session_store = object()
    runner._handle_active_session_busy_message = object()
    runner._recover_telegram_topic_thread_id = object()
    runner._busy_text_mode = "queue"
    runner._make_adapter_auth_check = lambda platform, profile_name=None: object()
    runner._adapter_disconnect_timeout_secs = lambda: 0
    runner._sync_voice_mode_state_to_adapter = lambda adapter: None
    runner._redeliver_failed_obligations_for_platform = AsyncMock(return_value=0)
    return runner


def _install_secondary_reconnect_context(
    monkeypatch, runner, adapter, scoped_homes=None, hydration_flags=None
):
    @contextmanager
    def fake_scope(profile_home, *, hydrate_secrets=True):
        if scoped_homes is not None:
            scoped_homes.append(Path(profile_home))
        if hydration_flags is not None:
            hydration_flags.append(hydrate_secrets)
        yield

    monkeypatch.setattr(gateway_run, "_profile_runtime_scope", fake_scope)
    monkeypatch.setattr(
        "scout_backend.profiles.get_profile_dir", lambda name: Path("/profiles") / name
    )
    monkeypatch.setattr(
        "gateway.config.load_gateway_config",
        lambda: GatewayConfig(
            multiplex_profiles=True,
            platforms={
                Platform.HOMEASSISTANT: PlatformConfig(
                    enabled=True, token="profile-token"
                )
            },
        ),
    )
    monkeypatch.setattr(runner, "_create_adapter", lambda platform, config: adapter)


class TestSecondaryProfileFatalRecovery:


    @pytest.mark.asyncio
    async def test_retryable_secondary_fatal_reconnects_with_its_profile_scope(
        self, monkeypatch
    ):
        runner = _secondary_recovery_runner()
        stale = _SecondaryRecoveryAdapter()
        replacement = _SecondaryRecoveryAdapter()
        runner._profile_adapters["reviewer"] = {Platform.HOMEASSISTANT: stale}
        scoped_homes: list[Path] = []
        _install_secondary_reconnect_context(
            monkeypatch, runner, replacement, scoped_homes
        )

        async def connect(adapter, platform, *, is_reconnect=False):
            assert adapter is replacement
            assert platform is Platform.HOMEASSISTANT
            assert is_reconnect is True
            replacement.connected = True
            return True

        monkeypatch.setattr(runner, "_connect_adapter_with_timeout", connect)
        redelivery_homes = []

        async def redeliver(platform, *, profile=None):
            from scout_constants import get_scout_home

            redelivery_homes.append(Path(get_scout_home()))
            return 0

        runner._redeliver_failed_obligations_for_platform.side_effect = redeliver
        await runner._handle_profile_adapter_fatal_error(
            "reviewer", Platform.HOMEASSISTANT, stale
        )

        assert stale.disconnected is True
        assert Platform.HOMEASSISTANT not in runner._profile_adapters["reviewer"]
        tasks = list(runner._background_tasks)
        assert len(tasks) == 1
        await tasks[0]
        assert runner._profile_adapters["reviewer"][Platform.HOMEASSISTANT] is replacement
        runner._redeliver_failed_obligations_for_platform.assert_awaited_once_with(
            Platform.HOMEASSISTANT, profile="reviewer"
        )
        assert scoped_homes
        assert all(path == Path("/profiles/reviewer") for path in scoped_homes)
        assert redelivery_homes
        assert all(path != Path("/profiles/reviewer") for path in redelivery_homes)


    @pytest.mark.asyncio
    async def test_secondary_reconnect_keeps_inbound_dedup(self, monkeypatch):
        """A secondary profile's rebuilt adapter still drops an inbound ID the stale one admitted."""
        runner = _secondary_recovery_runner()
        stale, replacement = _SecondaryRecoveryAdapter(), _SecondaryRecoveryAdapter()
        runner._profile_adapters["reviewer"] = {Platform.HOMEASSISTANT: stale}
        _install_secondary_reconnect_context(monkeypatch, runner, replacement)
        monkeypatch.setattr(runner, "_connect_adapter_with_timeout", AsyncMock(return_value=True))
        assert stale._dedup.is_duplicate("m1") is False

        await runner._handle_profile_adapter_fatal_error("reviewer", Platform.HOMEASSISTANT, stale)
        await asyncio.gather(*runner._background_tasks)

        assert runner._profile_adapters["reviewer"][Platform.HOMEASSISTANT] is replacement
        assert replacement._dedup.is_duplicate("m1") is True
        assert replacement._dedup.is_duplicate("m2") is False

    @pytest.mark.asyncio
    @pytest.mark.parametrize("connect_result", [True, False], ids=["success", "failure"])
    async def test_secondary_reconnect_does_not_publish_after_shutdown(
        self, monkeypatch, connect_result
    ):
        runner = _secondary_recovery_runner()
        runner._profile_failed_platforms["reviewer"] = {}
        replacement = _SecondaryRecoveryAdapter()
        _install_secondary_reconnect_context(monkeypatch, runner, replacement)
        connect_started = asyncio.Event()
        release_connect = asyncio.Event()

        async def connect(adapter, platform, *, is_reconnect=False):
            connect_started.set()
            await release_connect.wait()
            return connect_result

        monkeypatch.setattr(runner, "_connect_adapter_with_timeout", connect)
        task = asyncio.create_task(
            runner._run_secondary_profile_reconnect("reviewer", Platform.HOMEASSISTANT)
        )
        runner._profile_failed_platforms["reviewer"][Platform.HOMEASSISTANT] = task
        await connect_started.wait()
        runner._running = False
        release_connect.set()
        await asyncio.wait_for(task, timeout=0.2)

        assert runner._profile_adapters == {}
        assert replacement.disconnected is True
        assert runner._profile_failed_platforms == {}


class TestSecondaryStartupFailureRecovery:
    """Cold-start connect failures must reach the same reconnect slot as
    mid-run fatals — one unlucky connect window must not kill the platform
    for the life of the process."""



    @pytest.mark.asyncio
    async def test_non_retryable_initial_failure_does_not_schedule(
        self, monkeypatch
    ):
        runner = _secondary_recovery_runner()
        failed = _SecondaryRecoveryAdapter(retryable=False)
        _install_secondary_reconnect_context(
            monkeypatch, runner, _SecondaryRecoveryAdapter()
        )
        monkeypatch.setattr(runner, "_create_adapter", lambda platform, config: failed)

        async def fail_initial_connect(adapter, platform):
            return False

        monkeypatch.setattr(
            runner, "_connect_initial_adapter_with_timeout", fail_initial_connect
        )

        connected = await runner._start_one_profile_adapters(
            "reviewer", "/tmp/reviewer", {}
        )

        assert connected == 0
        assert failed.disconnected is True
        assert runner._background_tasks == set()
        assert runner._profile_failed_platforms == {}


    @pytest.mark.asyncio
    async def test_handoff_failure_is_logged_not_raised(self, monkeypatch, caplog):
        """If the scheduler raises at bridge handoff, the parked task must not
        die as an unretrieved-task exception — the failure surfaces in the log."""
        runner = _secondary_recovery_runner()
        failed = _SecondaryRecoveryAdapter()
        _install_secondary_reconnect_context(
            monkeypatch, runner, _SecondaryRecoveryAdapter()
        )
        monkeypatch.setattr(runner, "_create_adapter", lambda platform, config: failed)

        async def fail_initial_connect(adapter, platform):
            return False

        monkeypatch.setattr(
            runner, "_connect_initial_adapter_with_timeout", fail_initial_connect
        )

        def explode_at_handoff(profile_name, platform, adapter):
            raise RuntimeError("scheduler exploded during handoff")

        monkeypatch.setattr(
            runner, "_schedule_secondary_profile_reconnect", explode_at_handoff
        )

        with caplog.at_level(logging.ERROR, logger="gateway.run"):
            connected = await runner._start_one_profile_adapters(
                "reviewer", "/tmp/reviewer", {}
            )
            bridge = list(runner._background_tasks)
            assert len(bridge) == 1
            # Awaiting completes cleanly: the guard swallows the handoff
            # failure instead of letting it escape as an unretrieved-task
            # exception at GC time.
            await asyncio.wait_for(bridge[0], timeout=0.5)

        assert connected == 0
        assert failed.disconnected is True
        assert any(
            record.levelno == logging.ERROR
            and "secondary-startup-reconnect handoff failed" in record.getMessage()
            for record in caplog.records
        )
        # Nothing was scheduled and no slot leaked behind the failed handoff.
        assert Platform.HOMEASSISTANT not in runner._profile_adapters.get("reviewer", {})
        assert runner._profile_failed_platforms == {}


class TestSecondaryProfileConfigHandling:
    """Secondary config errors degrade only when the profile is safe to skip."""






    @pytest.mark.asyncio
    async def test_multiplexer_skips_bad_profile_and_continues(self, monkeypatch, caplog):
        from pathlib import Path
        from gateway.config import GatewayConfig

        runner = GatewayRunner.__new__(GatewayRunner)
        runner.config = GatewayConfig(multiplex_profiles=True)
        runner.adapters = {}
        runner._profile_adapters = {}
        runner.pairing_stores = {
            "default": MagicMock(),
            "bad": MagicMock(),
            "good": MagicMock(),
        }
        runner.pairing_store = runner.pairing_stores["default"]

        async def fake_start_one(profile_name, profile_home, claimed):
            if profile_name == "bad":
                raise RuntimeError("bad profile blew up at startup")
            runner._profile_adapters[profile_name] = {}
            return 2

        def fake_profiles_to_serve(multiplex, **kw):
            assert multiplex is True
            return [
                ("default", Path("/tmp/default")),
                ("bad", Path("/tmp/bad")),
                ("good", Path("/tmp/good")),
            ]

        monkeypatch.setattr(
            "scout_backend.profiles.profiles_to_serve",
            fake_profiles_to_serve,
        )
        monkeypatch.setattr(
            "scout_backend.profiles.get_active_profile_name",
            lambda: "default",
        )
        monkeypatch.setattr(runner, "_start_one_profile_adapters", fake_start_one)
        status = {}
        monkeypatch.setattr(
            "gateway.status.publish_runtime_status",
            lambda **kwargs: status.update(kwargs),
        )

        caplog.set_level(logging.WARNING, logger="gateway.run")
        connected = await runner._start_secondary_profile_adapters()

        assert connected == 2
        assert status["served_profiles"] == ["default", "bad", "good"]
        assert "good" in runner._profile_adapters
        assert "bad" not in runner._profile_adapters
        assert "Failed to start adapters for profile 'bad'" in caplog.text

    @pytest.mark.asyncio
    async def test_single_profile_start_clears_inherited_served_profiles(self, monkeypatch, tmp_path):
        """Runtime-status publication re-stamps the previous writer's record in place, so a multiplexer's
        ``served_profiles`` survived into a later single-profile run and every `scout -p X` surface
        kept treating X as served (exit 78 on start, "running via multiplexer" on status)."""
        import json
        from gateway.status import read_runtime_status

        monkeypatch.setenv("SCOUT_HOME", str(tmp_path))
        (tmp_path / "gateway_state.json").write_text(json.dumps(
            {"pid": 1, "gateway_state": "stopped", "served_profiles": ["default", "coder"]}))
        runner = GatewayRunner.__new__(GatewayRunner)
        runner.config = GatewayConfig(multiplex_profiles=False)

        assert await runner._start_secondary_profile_adapters() == 0
        flush_runtime_status()
        assert read_runtime_status(tmp_path / "gateway_state.json")["served_profiles"] == []

    @pytest.mark.asyncio
    async def test_multiplexer_propagates_security_config_error(self, monkeypatch):
        from pathlib import Path
        from gateway.config import GatewayConfig
        from gateway.run import MultiplexConfigError

        runner = GatewayRunner.__new__(GatewayRunner)
        runner.config = GatewayConfig(multiplex_profiles=True)
        runner.adapters = {}
        runner._profile_adapters = {}

        async def fake_start_one(profile_name, profile_home, claimed):
            raise MultiplexConfigError(
                f"Profile '{profile_name}' enables open policy without allow-all opt-in"
            )

        monkeypatch.setattr(
            "scout_backend.profiles.profiles_to_serve",
            lambda multiplex, **kw: [
                ("default", Path("/tmp/default")),
                ("unsafe", Path("/tmp/unsafe")),
            ],
        )
        monkeypatch.setattr(
            "scout_backend.profiles.get_active_profile_name",
            lambda: "default",
        )
        monkeypatch.setattr(runner, "_start_one_profile_adapters", fake_start_one)

        with pytest.raises(MultiplexConfigError, match="open policy"):
            await runner._start_secondary_profile_adapters()




    @pytest.mark.asyncio
    async def test_secondary_profile_adapter_start_skips_whatsapp(self, monkeypatch):
        """WhatsApp is shared process-level ingress like Relay: the bridge is
        one authenticated session tied to a single phone number, so a
        credential-less secondary profile must be skipped (not stall startup
        in a connect/retry loop) while its other platforms start normally."""
        runner = _secondary_recovery_runner()
        direct = _SecondaryRecoveryAdapter()
        _install_secondary_reconnect_context(monkeypatch, runner, direct)
        monkeypatch.setattr(
            "gateway.config.load_gateway_config",
            lambda: GatewayConfig(
                multiplex_profiles=True,
                platforms={
                    Platform.HOMEASSISTANT: PlatformConfig(enabled=True),
                    Platform.HOMEASSISTANT: PlatformConfig(enabled=True, token="profile-token"),
                },
            ),
        )
        factory_calls = []

        def _create_adapter(platform, config):
            factory_calls.append(platform)
            return direct

        async def _connect(adapter, platform):
            return True

        monkeypatch.setattr(runner, "_create_adapter", _create_adapter)
        monkeypatch.setattr(runner, "_connect_initial_adapter_with_timeout", _connect)

        connected = await runner._start_one_profile_adapters("clientbot", "/tmp/x", {})

        assert connected == 1
        assert factory_calls == [Platform.HOMEASSISTANT]
        assert runner._profile_adapters["clientbot"] == {Platform.HOMEASSISTANT: direct}


class TestSecondaryProfileHookRegistration:
    """A secondary profile's own `hooks:` block must register on ITS
    plugin manager, not just the root/default profile's (#92672).

    Startup only calls agent.shell_hooks/outbound_webhooks
    register_from_config() once, against the root config, before any
    profile scope exists. Without a matching call inside
    _start_one_profile_adapters, a secondary profile's config.yaml
    `hooks:` block (shell hooks and outbound webhooks) never registers.
    """

    @pytest.mark.asyncio
    async def test_registers_shell_hooks_and_webhooks_for_secondary_profile(
        self, monkeypatch
    ):
        runner = _secondary_recovery_runner()
        config = GatewayConfig(multiplex_profiles=True, platforms={})
        monkeypatch.setattr("gateway.config.load_gateway_config", lambda: config)

        profile_cfg = {
            "hooks": {
                "pre_tool_call": [
                    {"matcher": "write_file", "command": "~/.scout/deny.sh"}
                ],
                "outbound": [
                    {"url": "http://127.0.0.1:9000/hook", "events": ["on_session_end"]}
                ],
            }
        }
        monkeypatch.setattr("scout_backend.config.load_config", lambda: profile_cfg)

        seen = []
        monkeypatch.setattr(
            "agent.shell_hooks.register_from_config",
            lambda cfg, **kwargs: seen.append(("shell", cfg)) or [],
        )
        monkeypatch.setattr(
            "agent.outbound_webhooks.register_from_config",
            lambda cfg: seen.append(("homeassistant", cfg)) or [],
        )

        await runner._start_one_profile_adapters("second", "/tmp/second", {})

        assert ("shell", profile_cfg) in seen
        assert ("homeassistant", profile_cfg) in seen


class TestFeishuPortBindingConditional:
    """Feishu websocket mode does NOT bind a port; only webhook mode does (#52563)."""

    @pytest.mark.asyncio
    async def test_feishu_websocket_mode_not_rejected(self, monkeypatch):
        """Feishu in websocket mode (the default) should NOT raise MultiplexConfigError."""
        from gateway.run import MultiplexConfigError
        from gateway.config import GatewayConfig, Platform, PlatformConfig

        runner = GatewayRunner.__new__(GatewayRunner)
        runner.config = GatewayConfig(multiplex_profiles=True)
        runner._profile_adapters = {}

        reviewer_cfg = GatewayConfig(multiplex_profiles=True)
        reviewer_cfg.platforms = {
            Platform.HOMEASSISTANT: PlatformConfig(
                enabled=True,
                extra={"app_id": "cli_xxx", "app_secret": "sec", "connection_mode": "websocket"},
            ),
        }
        monkeypatch.setattr("gateway.config.load_gateway_config", lambda: reviewer_cfg)
        monkeypatch.setattr(runner, "_create_adapter", lambda p, c: None)

        connected = await runner._start_one_profile_adapters("reviewer", "/tmp/x", {})
        assert connected == 0  # no error, just nothing connected


class TestSecondarySkipsCredentiallessPlatforms:
    """#84079 — multiplex must not build adapters for platforms a profile
    has no credential for.

    The shared config.yaml enables a platform once; under multiplex every
    secondary profile reloads it inside its own secret scope, so a profile
    whose scope lacks the platform credential resolves ``enabled=True`` with
    an empty token. Constructing an adapter anyway treats every profile as
    configured for the platform — one inbound message fans out across all of
    them. These tests lock the credential gate on the secondary startup path
    (the primary path got the same gate in #64674; the reconnect path shares
    the helper). Also reported independently in #72313.
    """

    def _make_runner(self, monkeypatch, profile_cfg):
        runner = GatewayRunner.__new__(GatewayRunner)
        runner.config = GatewayConfig(multiplex_profiles=True)
        runner._profile_adapters = {}
        runner.adapters = {}
        created = []

        def fake_create(platform, platform_config):
            created.append((platform, platform_config))
            return _FakeAdapter(token=platform_config.token or None)

        monkeypatch.setattr("gateway.config.load_gateway_config", lambda: profile_cfg)
        monkeypatch.setattr(runner, "_create_adapter", fake_create)
        monkeypatch.setattr(runner, "_configure_profile_adapter", lambda *a, **k: None)
        monkeypatch.setattr(
            runner,
            "_connect_initial_adapter_with_timeout",
            AsyncMock(return_value=True),
        )
        return runner, created


    @pytest.mark.asyncio
    async def test_profile_with_own_credential_still_connects(self, monkeypatch, tmp_path):
        """A profile that defines its own credential keeps its adapter."""
        from gateway.config import GatewayConfig, Platform, PlatformConfig

        profile_cfg = GatewayConfig(multiplex_profiles=True)
        profile_cfg.platforms = {
            Platform.HOMEASSISTANT: PlatformConfig(enabled=True, token="slack-token-b"),
        }
        runner, created = self._make_runner(monkeypatch, profile_cfg)

        connected = await runner._start_one_profile_adapters("profile-b", tmp_path, {})

        assert connected == 1
        assert created == [(Platform.HOMEASSISTANT, profile_cfg.platforms[Platform.HOMEASSISTANT])]
        assert Platform.HOMEASSISTANT in runner._profile_adapters["profile-b"]
