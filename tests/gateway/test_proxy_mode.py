"""Tests for gateway proxy mode — forwarding messages to a remote API server."""

import types
from unittest.mock import AsyncMock, MagicMock, patch

import pytest

from gateway.config import Platform, StreamingConfig
from gateway.platforms.base import resolve_proxy_url
from gateway.run import GatewayRunner
from gateway.session import SessionSource

def _make_runner(proxy_url=None):
    """Create a minimal GatewayRunner for proxy tests."""
    runner = object.__new__(GatewayRunner)
    runner.adapters = {}
    runner.config = MagicMock()
    runner.config.streaming = StreamingConfig()
    runner._running_agents = {}
    runner._session_run_generation = {}
    runner._session_model_overrides = {}
    runner._agent_cache = {}
    runner._agent_cache_lock = None
    return runner

def _make_source(platform=Platform.HOMEASSISTANT):
    return SessionSource(
        platform=platform,
        chat_id="!room:server.org",
        chat_name="Test Room",
        chat_type="group",
        user_id="@user:server.org",
        user_name="testuser",
        thread_id=None,
    )

class _FakeSSEResponse:
    """Simulates an aiohttp response with SSE streaming."""

    def __init__(self, status=200, sse_chunks=None, error_text=""):
        self.status = status
        self._sse_chunks = sse_chunks or []
        self._error_text = error_text
        self.content = self

    async def text(self):
        return self._error_text

    async def iter_any(self):
        for chunk in self._sse_chunks:
            if isinstance(chunk, str):
                chunk = chunk.encode("utf-8")
            yield chunk

    async def __aenter__(self):
        return self

    async def __aexit__(self, *args):
        pass

class _FakeSession:
    """Simulates an aiohttp.ClientSession with captured request args."""

    def __init__(self, response):
        self._response = response
        self.captured_url = None
        self.captured_json = None
        self.captured_headers = None

    def post(self, url, json=None, headers=None, **kwargs):
        self.captured_url = url
        self.captured_json = json
        self.captured_headers = headers
        return self._response

    async def __aenter__(self):
        return self

    async def __aexit__(self, *args):
        pass

def _patch_aiohttp(session):
    """Install the optional aiohttp boundary without requiring the extra."""
    module = types.SimpleNamespace(
        ClientSession=MagicMock(return_value=session),
        ClientTimeout=MagicMock(),
    )
    return patch.dict("sys.modules", {"aiohttp": module})


class _SelectiveScope(dict):
    """Bound scope that resolves GATEWAY_PROXY_URL but fails on the KEY read."""
    def get(self, name, default=None):
        if name == "GATEWAY_PROXY_URL":
            return "http://proxy.local:8642"
        if name == "GATEWAY_PROXY_KEY":
            raise RuntimeError("resolver boom")
        return dict.get(self, name, default)




class TestResolveProxyUrl:

    def test_no_proxy_bypasses_matching_host(self, monkeypatch):
        for key in ("HTTPS_PROXY", "HTTP_PROXY", "ALL_PROXY",
                    "https_proxy", "http_proxy", "all_proxy", "NO_PROXY", "no_proxy"):
            monkeypatch.delenv(key, raising=False)
        monkeypatch.setenv("HTTPS_PROXY", "http://proxy.example:8080")
        monkeypatch.setenv("NO_PROXY", "api.telegram.org")

        assert resolve_proxy_url(target_hosts="api.telegram.org") is None

    def test_no_proxy_bypasses_cidr_target(self, monkeypatch):
        for key in ("HTTPS_PROXY", "HTTP_PROXY", "ALL_PROXY",
                    "https_proxy", "http_proxy", "all_proxy", "NO_PROXY", "no_proxy"):
            monkeypatch.delenv(key, raising=False)
        monkeypatch.setenv("HTTPS_PROXY", "http://proxy.example:8080")
        monkeypatch.setenv("NO_PROXY", "149.154.160.0/20")

        assert resolve_proxy_url(target_hosts=["149.154.167.220"]) is None

@pytest.mark.platforms("macos")
class TestMacosProxyProbeCache:
    """``scutil --proxy`` is a ~11 ms fork and resolve_proxy_url runs it on the SEND path —
    per chunk of an outbound message and per media attachment."""

    SCUTIL_OUT = "<dictionary> {\n  HTTPEnable : 1\n  HTTPProxy : 10.0.0.1\n  HTTPPort : 3128\n}"

    @pytest.fixture(autouse=True)
    def _isolate(self):
        import gateway.platforms.base as base
        base.reset_macos_proxy_cache()
        yield
        base.reset_macos_proxy_cache()

    def _count_forks(self, monkeypatch):
        import gateway.platforms.base as base
        calls = []

        def fake(*a, **kw):
            calls.append(a)
            return self.SCUTIL_OUT
        monkeypatch.setattr(base.subprocess, "check_output", fake)
        return base, calls

    def test_repeated_probes_fork_scutil_once(self, monkeypatch):
        base, calls = self._count_forks(monkeypatch)
        results = [base._detect_macos_system_proxy() for _ in range(10)]
        assert len(calls) == 1, f"expected 1 scutil fork for 10 probes, got {len(calls)}"
        assert results == ["http://10.0.0.1:3128"] * 10

    def test_expired_ttl_re_reads(self, monkeypatch):
        base, calls = self._count_forks(monkeypatch)
        clock = {"t": 1000.0}
        monkeypatch.setattr(base.time, "monotonic", lambda: clock["t"])
        base._detect_macos_system_proxy()
        clock["t"] += base._MACOS_PROXY_TTL_SECONDS + 1
        base._detect_macos_system_proxy()
        assert len(calls) == 2




