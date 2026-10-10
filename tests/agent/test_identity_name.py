"""The agent's user-chosen name reaches the model, and a rename reaches an open chat once.

The name lives in the profile's ``profile.yaml`` (``display_name``, written by
``profiles.configure``). A new session's system prompt states it; a session that is already
open keeps its byte-stable system prompt and instead gets a one-time note on the next message.
"""
from __future__ import annotations

from pathlib import Path
from types import SimpleNamespace

import pytest

import tui_gateway.server as server
from agent.identity import take_rename_note
from agent.system_prompt import _identity_parts


@pytest.fixture
def home(tmp_path, monkeypatch) -> Path:
    root = tmp_path / "scout_home"
    root.mkdir()
    (root / "SOUL.md").write_text("You are a helpful agent.", encoding="utf-8")
    monkeypatch.setenv("SCOUT_HOME", str(root))
    return root


def _rename(name: str) -> None:
    resp = server._methods["profiles.configure"](1, {"name": "default", "display_name": name})
    assert "error" not in resp, resp.get("error")
    assert resp["result"]["applied"]["display_name"] is True


def _agent() -> SimpleNamespace:
    return SimpleNamespace(load_soul_identity=True, skip_context_files=False, _cached_system_prompt=None)


def test_a_new_session_states_the_name_and_describe_reports_it(home):
    _rename("Charlie")

    parts, _ = _identity_parts(_agent(), None)

    assert any("Charlie" in part for part in parts)
    described = server._methods["profiles.describe"](1, {"name": "default"})["result"]
    assert described["display_name"] == "Charlie"


def test_an_open_session_hears_a_rename_once(home):
    _rename("Charlie")
    agent = _agent()
    _identity_parts(agent, None)
    agent._cached_system_prompt = "built"

    assert take_rename_note(agent) == ""

    _rename("Juniper")
    note = take_rename_note(agent)

    assert "Juniper" in note
    assert take_rename_note(agent) == ""
