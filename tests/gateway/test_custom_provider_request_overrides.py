"""Regression tests for gateway preservation of provider-derived request_overrides.

Named custom providers can return request_overrides (for example
``extra_body.text.verbosity`` for OpenAI Responses). The gateway must preserve
those overrides on the runtime path and merge fast-mode overrides on top rather
than replacing them with an empty dict.
"""

from __future__ import annotations

import asyncio
import sys
import threading
import types
from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock, patch

import pytest

import gateway.run as gateway_run
from gateway.config import Platform
from gateway.session import SessionSource


class _CapturingAgent:
    last_init = None

    def __init__(self, *args, **kwargs):
        type(self).last_init = dict(kwargs)
        self.tools = []
        self.request_overrides = dict(kwargs.get("request_overrides") or {})

    def run_conversation(self, user_message: str, conversation_history=None, task_id=None):
        return {
            "final_response": "ok",
            "messages": [],
            "api_calls": 1,
        }


def _install_fake_agent(monkeypatch):
    fake_run_agent = types.ModuleType("run_agent")
    fake_run_agent.AIAgent = _CapturingAgent
    monkeypatch.setitem(sys.modules, "run_agent", fake_run_agent)


def _make_runner():
    runner = object.__new__(gateway_run.GatewayRunner)
    runner.adapters = {}
    runner.session_store = None
    runner.config = None
    runner._voice_mode = {}
    runner._ephemeral_system_prompt = ""
    runner._prefill_messages = []
    runner._reasoning_config = None
    runner._show_reasoning = False
    runner._provider_routing = {}
    runner._fallback_model = None
    runner._service_tier = None
    runner._running_agents = {}
    runner._running_agents_ts = {}
    runner._background_tasks = set()
    runner._session_db = None
    runner._session_model_overrides = {}
    runner._session_reasoning_overrides = {}
    runner._pending_model_notes = {}
    runner._pending_approvals = {}
    runner._agent_cache = {}
    runner._agent_cache_lock = threading.Lock()
    runner._get_or_create_gateway_honcho = lambda session_key: (None, None)
    runner.hooks = MagicMock()
    runner.hooks.emit = AsyncMock()
    runner.hooks.loaded_hooks = []
    return runner


def _make_source() -> SessionSource:
    return SessionSource(
        platform=Platform.HOMEASSISTANT,
        chat_id="ou_test",
        chat_type="dm",
        user_id="user-1",
        user_name="tester",
    )


def test_resolve_runtime_agent_kwargs_preserves_request_overrides(monkeypatch):
    monkeypatch.setattr(
        "scout_backend.runtime_provider.resolve_runtime_provider",
        lambda **_kw: {
            "api_key": "***",
            "base_url": "https://example.test/v1",
            "provider": "custom",
            "api_mode": "codex_responses",
            "command": None,
            "args": [],
            "credential_pool": None,
            "request_overrides": {
                "extra_body": {"text": {"verbosity": "low"}},
            },
        },
    )

    result = gateway_run._resolve_runtime_agent_kwargs()

    assert result["request_overrides"] == {
        "extra_body": {"text": {"verbosity": "low"}},
    }


def test_turn_route_preserves_provider_request_overrides_without_fast_mode():
    runner = _make_runner()
    runner._service_tier = None
    runtime_kwargs = {
        "api_key": "***",
        "base_url": "https://example.test/v1",
        "provider": "custom",
        "api_mode": "codex_responses",
        "command": None,
        "args": [],
        "credential_pool": None,
        "request_overrides": {
            "extra_body": {"text": {"verbosity": "low"}},
        },
    }

    route = gateway_run.GatewayRunner._resolve_turn_agent_config(
        runner,
        "hi",
        "gpt-5.4",
        runtime_kwargs,
    )

    assert route["request_overrides"] == {
        "extra_body": {"text": {"verbosity": "low"}},
    }


def test_turn_route_merges_fast_mode_with_provider_request_overrides():
    runner = _make_runner()
    runner._service_tier = "priority"
    runtime_kwargs = {
        "api_key": "***",
        "base_url": "https://example.test/v1",
        "provider": "custom",
        "api_mode": "codex_responses",
        "command": None,
        "args": [],
        "credential_pool": None,
        "request_overrides": {
            "extra_body": {"text": {"verbosity": "low"}},
        },
    }

    with patch(
        "scout_backend.models.resolve_fast_mode_overrides",
        return_value={"service_tier": "priority"},
    ):
        route = gateway_run.GatewayRunner._resolve_turn_agent_config(
            runner,
            "hi",
            "gpt-5.4",
            runtime_kwargs,
        )

    assert route["request_overrides"] == {
        "extra_body": {"text": {"verbosity": "low"}},
        "service_tier": "priority",
    }



