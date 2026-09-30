"""planner.* RPC: the Dashboard's view of the store the agent's planner tool edits.

Results are validated against the wire contract (``SCOUT_TEST_ISOLATION=1`` turns a mismatch
into ``ContractViolation``), and a rejected request is a user-facing ``success: false``.
"""

from __future__ import annotations

import pytest

import tui_gateway.server as server


@pytest.fixture(autouse=True)
def _home(tmp_path, monkeypatch):
    home = tmp_path / ".scout"
    home.mkdir()
    monkeypatch.setenv("SCOUT_HOME", str(home))
    return home


def _call(method, params):
    resp = server._methods[method](1, params)
    assert "error" not in resp, resp.get("error")
    return resp["result"]


def test_dashboard_edits_round_trip_and_the_agent_sees_them():
    from tools.planner_tool import planner_tool
    import json

    added = _call("planner.todos", {"action": "add", "title": "Book dentist", "due": "2026-10-20"})
    assert added["success"] and added["item"]["created_by"] == "user"

    updated = _call("planner.todos", {"action": "update", "id": added["item"]["id"], "status": "done", "due": ""})
    assert updated["item"]["status"] == "done"
    assert updated["item"]["due"] is None  # "" clears; absent leaves unchanged

    agent_view = json.loads(planner_tool({"action": "todo_list"}))
    assert [i["status"] for i in agent_view["items"]] == ["done"]

    listed = _call("planner.reminders", {"action": "add", "text": "Water plants", "when": "every day at 9am"})
    assert listed["success"] and listed["reminder"]["recurring"] is True
    assert [r["text"] for r in listed["reminders"]] == ["Water plants"]


def test_a_rejected_request_is_a_user_facing_error_not_an_rpc_failure():
    result = _call("planner.todos", {"action": "update", "id": "t_missing", "title": "x"})
    assert result["success"] is False and "t_missing" in result["error"]

    result = _call("planner.reminders", {"action": "add", "text": "x", "when": "whenever"})
    assert result["success"] is False and result["error"]
