"""Regression tests for the machine-dashboard multi-profile unification.

The dashboard is ONE machine-level management surface: config, env, MCP,
model, and chat-PTY endpoints accept an optional ``profile`` so the global
profile switcher can target any profile's SCOUT_HOME. These tests pin:
reads/writes land in the REQUESTED profile, the dashboard's own profile
stays untouched, and the chat PTY env is scoped via SCOUT_HOME.
"""
import json
from pathlib import Path

import pytest
import scout_yaml as yaml
import gateway.status as _gw_status
import scout_cli.config as _cfg_mod
import scout_cli.web_server_chat as _web_server_chat
import scout_cli.web_server_gateway as _web_server_gateway


@pytest.fixture
def isolated_profiles(tmp_path, monkeypatch, _isolate_scout_home):
    """Isolated default home + one named profile, each with config + .env."""
    from scout_constants import get_scout_home
    from scout_cli import profiles

    default_home = get_scout_home()
    profiles_root = default_home / "profiles"
    worker_home = profiles_root / "worker_beta"
    for home in (default_home, worker_home):
        home.mkdir(parents=True, exist_ok=True)
        (home / "config.yaml").write_text("{}\n", encoding="utf-8")
    (worker_home / ".env").write_text("", encoding="utf-8")

    monkeypatch.setattr(profiles, "_get_default_scout_home", lambda: default_home)
    monkeypatch.setattr(profiles, "_get_profiles_root", lambda: profiles_root)
    return {"default": default_home, "worker_beta": worker_home}


@pytest.fixture
def client(monkeypatch, isolated_profiles):
    try:
        from starlette.testclient import TestClient
    except ImportError:
        pytest.skip("fastapi/starlette not installed")

    import scout_state
    from scout_constants import get_scout_home
    from scout_cli.web_server import app, _SESSION_HEADER_NAME, _SESSION_TOKEN

    monkeypatch.setattr(scout_state, "DEFAULT_DB_PATH", get_scout_home() / "state.db")
    c = TestClient(app)
    c.headers[_SESSION_HEADER_NAME] = _SESSION_TOKEN
    return c


def _cfg(home):
    return yaml.safe_load((home / "config.yaml").read_text()) or {}


def _write_jobs(home, jobs):
    cron_dir = home / "cron"
    cron_dir.mkdir(parents=True, exist_ok=True)
    (cron_dir / "jobs.json").write_text(json.dumps(jobs), encoding="utf-8")


class TestProfileScopedConfig:


    def test_config_query_param_equivalent_to_body(self, client, isolated_profiles):
        """The SPA's fetchJSON injects ?profile= — must scope like body.profile."""
        resp = client.put(
            "/api/config?profile=worker_beta",
            json={"config": {"timezone": "Pluto/Far"}},
        )
        assert resp.status_code == 200
        assert _cfg(isolated_profiles["worker_beta"]).get("timezone") == "Pluto/Far"
        assert _cfg(isolated_profiles["default"]).get("timezone") != "Pluto/Far"

    def test_unknown_profile_404(self, client, isolated_profiles):
        resp = client.get("/api/config", params={"profile": "ghost"})
        assert resp.status_code == 404


class TestProfileScopedEnv:
    def test_env_set_lands_in_target_profile_only(self, client, isolated_profiles):
        resp = client.put(
            "/api/env",
            json={"key": "FAL_KEY", "value": "test-fal-123", "profile": "worker_beta"},
        )
        assert resp.status_code == 200
        worker_env = (isolated_profiles["worker_beta"] / ".env").read_text()
        assert "test-fal-123" in worker_env
        default_env_path = isolated_profiles["default"] / ".env"
        if default_env_path.exists():
            assert "test-fal-123" not in default_env_path.read_text()


    def test_env_delete_scoped(self, client, isolated_profiles):
        (isolated_profiles["worker_beta"] / ".env").write_text(
            "FAL_KEY=doomed\n", encoding="utf-8"
        )
        resp = client.request(
            "DELETE",
            "/api/env",
            json={"key": "FAL_KEY", "profile": "worker_beta"},
        )
        assert resp.status_code == 200
        assert "doomed" not in (isolated_profiles["worker_beta"] / ".env").read_text()


class TestProfileScopedMcp:

    def test_mcp_bearer_secret_is_profile_scoped(self, client, isolated_profiles):
        secret = "worker-only-secret"
        response = client.post(
            "/api/mcp/servers",
            params={"profile": "worker_beta"},
            json={
                "name": "profile-bearer",
                "url": "https://example.com/mcp",
                "auth": "header",
                "bearer_token": secret,
            },
        )

        assert response.status_code == 200
        worker_cfg = _cfg(isolated_profiles["worker_beta"])
        assert worker_cfg["mcp_servers"]["profile-bearer"]["headers"] == {
            "Authorization": "Bearer ${MCP_PROFILE_BEARER_API_KEY}",
        }
        assert secret in (isolated_profiles["worker_beta"] / ".env").read_text()
        assert not (isolated_profiles["default"] / ".env").exists()
        assert "profile-bearer" not in _cfg(isolated_profiles["default"]).get(
            "mcp_servers", {}
        )

    def test_mcp_test_oauth_server_without_token_is_not_ok(
        self, client, isolated_profiles, monkeypatch
    ):
        """An `auth: oauth` server that serves tools/list anonymously must not
        false-green: a successful probe with no token on disk reports needs-auth."""
        import scout_cli.mcp_config as mcp_config

        (isolated_profiles["worker_beta"] / "config.yaml").write_text(
            "mcp_servers:\n  oauth-srv:\n    url: http://x/sse\n    auth: oauth\n",
            encoding="utf-8",
        )
        monkeypatch.setattr(
            mcp_config,
            "_probe_single_server",
            lambda name, config, connect_timeout=30, details=None: [("tool-a", "desc")],
        )
        monkeypatch.setattr(mcp_config, "_oauth_tokens_present", lambda name: False)

        resp = client.post(
            "/api/mcp/servers/oauth-srv/test", params={"profile": "worker_beta"}
        )
        assert resp.status_code == 200
        body = resp.json()
        assert body["ok"] is False
        assert "oauth" in body["error"].lower()

        # With a token present, the same probe is genuinely authenticated.
        monkeypatch.setattr(mcp_config, "_oauth_tokens_present", lambda name: True)
        resp = client.post(
            "/api/mcp/servers/oauth-srv/test", params={"profile": "worker_beta"}
        )
        assert resp.json()["ok"] is True

    def test_mcp_test_reports_optional_schema_chars(
        self, client, isolated_profiles, monkeypatch
    ):
        """The probe's per-tool `schema_chars` (details out-param) surfaces as an
        ADDITIVE per-tool field on the wire; tools without a size stay bare so
        older/partial probes degrade to 'no estimate' in the renderer."""
        import scout_cli.mcp_config as mcp_config

        (isolated_profiles["worker_beta"] / "config.yaml").write_text(
            "mcp_servers:\n  sized-srv:\n    url: http://x/mcp\n",
            encoding="utf-8",
        )

        def fake_probe(name, config, connect_timeout=30, details=None):
            if details is not None:
                details["schema_chars"] = {"tool-a": 420}
            return [("tool-a", "desc-a"), ("tool-b", "desc-b")]

        monkeypatch.setattr(mcp_config, "_probe_single_server", fake_probe)

        resp = client.post(
            "/api/mcp/servers/sized-srv/test", params={"profile": "worker_beta"}
        )
        assert resp.status_code == 200
        body = resp.json()
        assert body["ok"] is True
        tools = {t["name"]: t for t in body["tools"]}
        assert tools["tool-a"]["schema_chars"] == 420
        # No size for tool-b → the key is simply absent (additive-optional).
        assert "schema_chars" not in tools["tool-b"]


    def test_mcp_test_resolves_profile_secret_source_scope(
        self, client, isolated_profiles, monkeypatch
    ):
        """The probe's `${VAR}` interpolation must resolve from the REQUESTED
        profile's secret scope, not the dashboard process's os.environ: a
        secondary profile whose credential comes from an external secret source
        (Bitwarden/1Password) never has it in the shared process env, so the
        probe used to send the literal placeholder — or the default profile's
        value of the same name — and the server answered 400 (#109901)."""
        import scout_cli.env_loader as env_loader
        import scout_cli.mcp_config as mcp_config

        worker_home = isolated_profiles["worker_beta"]
        (worker_home / "config.yaml").write_text(
            "mcp_servers:\n  bw-srv:\n    url: http://x/mcp\n"
            "    headers:\n      Authorization: Bearer ${GITHUB_PERSONAL_ACCESS_TOKEN}\n",
            encoding="utf-8",
        )
        # The shared dashboard process carries the DEFAULT profile's value of the
        # same env name — the probe must not use it.
        monkeypatch.setenv("GITHUB_PERSONAL_ACCESS_TOKEN", "default-profile-token")

        def _worker_sources(scout_home):
            if Path(scout_home).resolve() == worker_home.resolve():
                return {"GITHUB_PERSONAL_ACCESS_TOKEN": "bw-worker-token"}
            return {}

        monkeypatch.setattr(env_loader, "get_secret_source_values", _worker_sources)

        resolved_headers = {}

        def fake_probe(name, config, connect_timeout=30, details=None):
            resolved = mcp_config._resolve_mcp_server_config(config)
            resolved_headers.update(resolved.get("headers", {}))
            return [("tool-a", "desc")]

        monkeypatch.setattr(mcp_config, "_probe_single_server", fake_probe)

        resp = client.post("/api/mcp/servers/bw-srv/test", params={"profile": "worker_beta"})

        assert resp.status_code == 200
        assert resp.json()["ok"] is True
        assert resolved_headers["Authorization"] == "Bearer bw-worker-token"

    def test_mcp_list_expands_url_ref_from_profile_secret_scope(
        self, client, isolated_profiles, monkeypatch
    ):
        """Same class for the read endpoint: a ``${VAR}`` in a secondary profile's server
        ``url`` must expand from THAT profile's secret scope, never the dashboard process env."""
        import scout_cli.env_loader as env_loader

        worker_home = isolated_profiles["worker_beta"]
        (worker_home / "config.yaml").write_text(
            "mcp_servers:\n  bw-srv:\n    url: ${MCP_GH_URL}\n", encoding="utf-8"
        )
        monkeypatch.setenv("MCP_GH_URL", "http://default-profile/mcp")
        monkeypatch.setattr(
            env_loader, "get_secret_source_values",
            lambda scout_home: {"MCP_GH_URL": "http://worker/mcp"}
            if Path(scout_home).resolve() == worker_home.resolve() else {},
        )

        resp = client.get("/api/mcp/servers", params={"profile": "worker_beta"})
        assert resp.status_code == 200
        assert [s["url"] for s in resp.json()["servers"]] == ["http://worker/mcp"]


class TestProfileScopedModel:
    @pytest.fixture(autouse=True)
    def _accept_any_model(self, monkeypatch):
        """These tests pin WHICH profile the write lands in, not catalog validation: the main
        slot now routes through ``switch_model`` (needs credentials + a listed model), so echo the
        request back as an accepted route."""
        from scout_cli.model_switch import ModelSwitchResult

        def _switch(*, raw_input, explicit_provider, **_kw):
            return ModelSwitchResult(success=True, new_model=raw_input, target_provider=explicit_provider)

        monkeypatch.setattr("scout_cli.model_switch.switch_model", _switch)

    def test_model_set_main_scoped(self, client, isolated_profiles):
        resp = client.post(
            "/api/model/set",
            json={
                "scope": "main",
                "provider": "openrouter",
                "model": "test/model-1",
                "confirm_expensive_model": True,
                "profile": "worker_beta",
            },
        )
        assert resp.status_code == 200
        worker_cfg = _cfg(isolated_profiles["worker_beta"])
        model_cfg = worker_cfg.get("model", {})
        assert isinstance(model_cfg, dict)
        assert model_cfg.get("provider") == "openrouter"
        default_model = _cfg(isolated_profiles["default"]).get("model", {})
        if isinstance(default_model, dict):
            assert default_model.get("default") != "test/model-1"

    def test_profile_create_validates_against_the_dashboard_home_and_writes_the_new_profile(
        self, client, isolated_profiles, monkeypatch
    ):
        """The create dialog's picker read THIS dashboard's catalog; the new profile is empty
        (no providers:, no .env), so validating there rejected every non-env provider and
        create silently returned model_set: false. Validation must see the dashboard home's
        config; the write must still land in the new profile only."""
        import scout_cli.profiles as profiles_mod
        from scout_constants import get_scout_home

        monkeypatch.setattr(profiles_mod, "create_wrapper_script", lambda name: None)
        (isolated_profiles["default"] / "config.yaml").write_text(
            "providers:\n  mybox:\n    base_url: http://box:8000/v1\n    key_env: MYBOX_KEY\n", encoding="utf-8")
        seen: dict = {}

        def _switch(*, raw_input, explicit_provider, user_providers, **_kw):
            from scout_cli.model_switch import ModelSwitchResult
            seen["user_providers"] = user_providers
            seen["home"] = get_scout_home()
            if explicit_provider not in user_providers:
                return ModelSwitchResult(success=False, error_message=f"Unknown provider '{explicit_provider}'.")
            return ModelSwitchResult(success=True, new_model=raw_input, target_provider=explicit_provider)

        monkeypatch.setattr("scout_cli.model_switch.switch_model", _switch)
        resp = client.post("/api/profiles", json={"name": "newbie", "provider": "mybox", "model": "qwen3"})
        assert resp.status_code == 200 and resp.json()["model_set"] is True
        assert "mybox" in seen["user_providers"] and seen["home"] == isolated_profiles["default"]
        new_home = isolated_profiles["default"] / "profiles" / "newbie"
        assert _cfg(new_home)["model"]["provider"] == "mybox" and _cfg(new_home)["model"]["default"] == "qwen3"
        assert "model" not in _cfg(isolated_profiles["default"])
        # A genuine rejection is reported with its reason, not a silent model_set: false.
        resp = client.post("/api/profiles", json={"name": "newbie2", "provider": "nobox", "model": "qwen3"})
        assert resp.status_code == 200 and resp.json()["model_set"] is False
        assert "Unknown provider 'nobox'" in resp.json()["model_error"]



    def test_model_info_unknown_profile_404(self, client, isolated_profiles):
        """Regression: the broad except used to convert the 404 into a 200
        with empty model info ("no model set" — silently wrong)."""
        resp = client.get("/api/model/info", params={"profile": "ghost"})
        assert resp.status_code == 404


class TestProfileScopedPostSetup:
    def test_post_setup_spawns_with_profile_flag(
        self, client, isolated_profiles, monkeypatch
    ):
        """Post-setup runs in a -p scoped subprocess so hooks that read
        config / write per-profile state see the same SCOUT_HOME the rest
        of the drawer's writes targeted."""

        calls = []

        class _FakeProc:
            pid = 777

        monkeypatch.setattr(
            _web_server_gateway,
            "_spawn_scout_action",
            lambda subcommand, name: calls.append(list(subcommand)) or _FakeProc(),
        )
        monkeypatch.setattr(
            "scout_cli.tools_config.valid_post_setup_keys",
            lambda: {"agent_browser"},
        )
        resp = client.post(
            "/api/tools/toolsets/browser/post-setup",
            json={"key": "agent_browser", "profile": "worker_beta"},
        )
        assert resp.status_code == 200
        assert calls == [
            ["-p", "worker_beta", "tools", "post-setup", "agent_browser"]
        ]



class TestProfileScopedGateway:

    def test_status_reads_requested_profile_home(
        self, client, isolated_profiles, monkeypatch
    ):
        import scout_cli.web_server as web_server
        from scout_constants import get_scout_home

        seen_homes = []

        def fake_get_running_pid(*args, **kwargs):
            # /api/status?profile= now passes pid_path= explicitly (the TTL
            # cache would otherwise serve another profile's PID) — accept it.
            seen_homes.append(str(get_scout_home()))
            return None

        monkeypatch.setattr(_cfg_mod, "check_config_version", lambda: (1, 1))
        # get_status probes via the TTL-cached wrapper (PR #53511 salvage);
        # patch the cached name so the fake still intercepts the probe.
        monkeypatch.setattr(_gw_status, "get_running_pid_cached", fake_get_running_pid)
        monkeypatch.setattr(
            _gw_status,
            "read_runtime_status",
            lambda *a, **k: {"gateway_state": "startup_failed", "platforms": {}},
        )
        monkeypatch.setattr(web_server, "_GATEWAY_HEALTH_URL", None)

        resp = client.get("/api/status", params={"profile": "worker_beta"})

        assert resp.status_code == 200
        assert seen_homes[0] == str(isolated_profiles["worker_beta"])
        assert resp.json()["scout_home"] == str(isolated_profiles["worker_beta"])


    def test_status_keeps_fatal_platforms_on_startup_failed(
        self, client, isolated_profiles, monkeypatch
    ):
        """startup_failed keeps FATAL per-profile entries — they're the diagnosis.

        A multiplex gateway that dies at startup persists per-profile fatal
        entries (``alpha:telegram`` etc.). The dead-gateway platform clear must
        not erase them: exit_reason alone can't say which profile failed how.
        Non-fatal leftovers (e.g. a platform that connected before the crash)
        are still dropped — only fatals survive.
        """
        import scout_cli.web_server as web_server

        runtime = {
            "pid": 4242,
            "gateway_state": "startup_failed",
            "desired_state": "running",
            "platforms": {
                "telegram": {"state": "fatal", "error_code": "telegram_auth_error"},
                "alpha:telegram": {"state": "fatal", "error_code": "credential_collision"},
                "beta:discord": {"state": "connected"},
            },
            "exit_reason": "telegram: token rejected",
            "updated_at": "2026-06-17T00:00:00+00:00",
        }
        monkeypatch.setattr(_cfg_mod, "check_config_version", lambda: (1, 1))
        monkeypatch.setattr(
            _gw_status, "get_running_pid_cached", lambda *a, **k: None
        )
        monkeypatch.setattr(_gw_status, "read_runtime_status", lambda *a, **k: runtime)
        # Bare platform keys are checked against the configured set (fail
        # closed) — mirror a host that actually has telegram configured.
        monkeypatch.setattr(
            _web_server_gateway, "_load_configured_gateway_platforms", lambda: {"telegram"}
        )
        monkeypatch.setattr(web_server, "_GATEWAY_HEALTH_URL", None)

        resp = client.get("/api/status", params={"profile": "worker_beta"})

        assert resp.status_code == 200
        data = resp.json()
        assert data["gateway_running"] is False
        assert data["gateway_state"] == "startup_failed"
        assert data["gateway_exit_reason"] == "telegram: token rejected"
        # Fatal entries (root and namespaced) survive; the stale non-fatal is dropped.
        assert set(data["gateway_platforms"]) == {"telegram", "alpha:telegram"}
        assert data["gateway_platforms"]["alpha:telegram"]["error_code"] == "credential_collision"

    def test_status_hides_historical_startup_failure_after_operator_stop(
        self, client, isolated_profiles, monkeypatch
    ):
        """A durable stop intent takes precedence over an old startup failure."""
        import scout_cli.web_server as web_server

        runtime = {
            "pid": 4242,
            "gateway_state": "startup_failed",
            "desired_state": "stopped",
            "platforms": {"telegram": {"state": "fatal"}},
            "exit_reason": "telegram: token rejected",
            "updated_at": "2026-06-17T00:00:00+00:00",
        }
        monkeypatch.setattr(_cfg_mod, "check_config_version", lambda: (1, 1))
        monkeypatch.setattr(
            _gw_status, "get_running_pid_cached", lambda *a, **k: None
        )
        monkeypatch.setattr(_gw_status, "read_runtime_status", lambda *a, **k: runtime)
        monkeypatch.setattr(web_server, "_GATEWAY_HEALTH_URL", None)

        resp = client.get("/api/status", params={"profile": "worker_beta"})

        assert resp.status_code == 200
        data = resp.json()
        assert data["gateway_running"] is False
        assert data["gateway_state"] == "stopped"
        assert data["gateway_exit_reason"] is None
        assert data["gateway_platforms"] == {}

    def test_status_clears_platforms_on_clean_stop(
        self, client, isolated_profiles, monkeypatch
    ):
        """A cleanly stopped gateway still reports no platforms (stale-noise rule)."""
        import scout_cli.web_server as web_server

        runtime = {
            "pid": 4242,
            "gateway_state": "stopped",
            "platforms": {"telegram": {"state": "connected"}},
            "exit_reason": None,
            "updated_at": "2026-06-17T00:00:00+00:00",
        }
        monkeypatch.setattr(_cfg_mod, "check_config_version", lambda: (1, 1))
        monkeypatch.setattr(
            _gw_status, "get_running_pid_cached", lambda *a, **k: None
        )
        monkeypatch.setattr(_gw_status, "read_runtime_status", lambda *a, **k: runtime)
        monkeypatch.setattr(web_server, "_GATEWAY_HEALTH_URL", None)

        resp = client.get("/api/status", params={"profile": "worker_beta"})

        assert resp.status_code == 200
        data = resp.json()
        assert data["gateway_state"] == "stopped"
        assert data["gateway_platforms"] == {}




class TestProfileScopedAudio:
    """Audio endpoints must honor ``profile`` like the rest of the dashboard.

    Historically /api/audio/transcribe|speak|elevenlabs/voices took no profile
    and always resolved the dashboard's own config/.env, so a non-default
    profile's TTS/STT settings were silently ignored (#53441 #45506 #66012
    #64057).
    """

    def test_transcribe_runs_inside_target_profile_home(
        self, client, isolated_profiles, monkeypatch
    ):
        import base64

        import tools.voice_mode as voice_mode

        seen = {}

        def _fake_transcribe(path):
            from scout_constants import get_scout_home

            seen["home"] = str(get_scout_home())
            return {"success": True, "transcript": "hi", "provider": "fake"}

        monkeypatch.setattr(voice_mode, "transcribe_recording", _fake_transcribe)
        payload = base64.b64encode(b"\x00fakeaudio").decode("ascii")
        resp = client.post(
            "/api/audio/transcribe?profile=worker_beta",
            json={"data_url": f"data:audio/webm;base64,{payload}"},
        )
        assert resp.status_code == 200
        assert resp.json()["transcript"] == "hi"
        assert seen["home"] == str(isolated_profiles["worker_beta"])

    def test_audio_endpoints_unknown_profile_404(self, client, isolated_profiles):
        resp = client.get("/api/audio/elevenlabs/voices?profile=ghost")
        assert resp.status_code == 404
        resp = client.post("/api/audio/speak?profile=ghost", json={"text": "x"})
        assert resp.status_code == 404
