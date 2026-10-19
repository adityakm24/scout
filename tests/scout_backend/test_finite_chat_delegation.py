"""Finite chat must consume parallel delegated results before the CLI exits."""

import http.server
import json
import os
from pathlib import Path
import subprocess
import sys
import threading
from types import SimpleNamespace
from typing import Any
from unittest.mock import MagicMock

import pytest

REPO_ROOT = Path(__file__).resolve().parents[2]




@pytest.mark.parametrize("query,image", [("Delegate a task", None), (None, "image.png")])
def test_tty_seeded_chat_keeps_background_delegation(monkeypatch, query, image):
    """A TTY -q (or image seed) still owns a later-turn completion consumer."""
    import cli
    import tools.delegate_tool as dt
    from gateway.session_context import reset_session_vars
    from run_agent import AIAgent
    from tests.tools.test_delegate import _make_mock_parent

    reset_session_vars()
    monkeypatch.delenv("SCOUT_SINGLE_QUERY_SESSION", raising=False)
    monkeypatch.delenv("SCOUT_KANBAN_TASK", raising=False)
    monkeypatch.setattr(cli.sys.stdin, "isatty", lambda: True)
    monkeypatch.setattr(cli.sys.stdout, "isatty", lambda: True)
    monkeypatch.setattr(cli, "_collect_query_images", lambda q, i: (q, [i] if i else []))
    parent = _make_mock_parent()
    parent.session_id = "interactive-parent"
    monkeypatch.setattr(dt, "_build_child_agent", lambda **kw: MagicMock())
    monkeypatch.setattr(dt, "_resolve_delegation_credentials", lambda *a, **kw: {
        "model": "test-model", "provider": "custom", "base_url": None, "api_key": None,
        "api_mode": None, "command": None, "args": None,
    })
    dispatched = []

    def dispatch(unit, unit_id, slot_key, routing):
        dispatched.append(unit)
        return {"status": "dispatched", "delegation_id": "interactive-delegation"}

    monkeypatch.setattr("tools.delegate_tool_dispatch._dispatch_unit", dispatch)
    seeded = SimpleNamespace(run=lambda: AIAgent._dispatch_delegate_task(
        parent, {"tasks": [{"goal": "independent task"}]},
    ))
    try:
        result = cli._run_single_query_mode(seeded, query, image, False, False)
        assert isinstance(result, str)
        payload = json.loads(result)
        assert payload["status"] == "dispatched"
        assert len(dispatched) == 1
        assert "SCOUT_SINGLE_QUERY_SESSION" not in os.environ
    finally:
        reset_session_vars()
