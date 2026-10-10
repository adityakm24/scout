"""The planner is ONE list shared by the user and the agent, per profile.

Contracts: an edit made by one side is what the other side reads next (nothing is cached across
calls); a reminder is delivered verbatim without ever constructing an agent; and each profile
home owns its own list (A→B→A).
"""

from __future__ import annotations

import json

import pytest


@pytest.fixture
def home(tmp_path, monkeypatch):
    home = tmp_path / ".scout"
    home.mkdir()
    monkeypatch.setenv("SCOUT_HOME", str(home))
    monkeypatch.setenv("SCOUT_RUNTIME_DIR", str(tmp_path / "no-pm-store"))
    monkeypatch.setenv("SCOUT_MODEL", "test-model")
    return home


def _agent(action: str, **args):
    from tools.planner_tool import planner_tool

    result = json.loads(planner_tool({"action": action, **args}))
    assert result["success"], result
    return result


def test_user_and_agent_edits_are_each_visible_to_the_other(home):
    from planner import todos

    added = _agent("todo_add", title="Renew passport", due="2026-11-01", priority="high")["item"]

    # The user ticks it off in the Dashboard; the agent's very next read reflects it.
    todos.update_todo(added["id"], status="done", actor="user")
    seen_by_agent = {i["id"]: i for i in _agent("todo_list")["items"]}[added["id"]]
    assert seen_by_agent["status"] == "done"
    assert seen_by_agent["created_by"] == "agent"
    assert seen_by_agent["updated_by"] == "user"

    # And the agent's edit is what the user's view lists.
    _agent("todo_reopen", id=added["id"])
    assert todos.list_todos()["items"][0]["status"] == "open"
    assert todos.list_todos()["items"][0]["completed_at"] is None


def test_a_reminder_is_delivered_verbatim_without_an_agent_run(home, monkeypatch):
    import run_agent
    from cron.jobs import get_job
    from cron.scheduler import run_job

    class _NoAgent:
        def __init__(self, *a, **k):
            raise AssertionError("a reminder must not construct an agent")

    monkeypatch.setattr(run_agent, "AIAgent", _NoAgent)
    reminder = _agent("reminder_add", text="Call mom", when="in 30m")["reminder"]

    success, _doc, delivered, error = run_job(get_job(reminder["id"]))

    assert success and error is None
    assert "Call mom" in delivered
    assert reminder["created_by"] == "agent"


def test_each_profile_home_owns_its_own_list(tmp_path, monkeypatch, home):
    from planner import reminders, todos

    other = tmp_path / "profiles" / "work"
    other.mkdir(parents=True)

    todos.add_todo("Home errand")
    reminders.add_reminder("Home reminder", "in 1h")
    monkeypatch.setenv("SCOUT_HOME", str(other))
    assert todos.list_todos()["items"] == []
    assert reminders.list_reminders()["reminders"] == []
    todos.add_todo("Work task")

    monkeypatch.setenv("SCOUT_HOME", str(home))
    assert [i["title"] for i in todos.list_todos()["items"]] == ["Home errand"]
    assert [r["text"] for r in reminders.list_reminders()["reminders"]] == ["Home reminder"]


@pytest.mark.parametrize("scheduler_up", [True, False])
def test_the_agent_is_told_when_nothing_will_deliver_a_reminder(home, monkeypatch, scheduler_up):
    import scout_cli.cron

    monkeypatch.setattr(scout_cli.cron, "_builtin_gateway_liveness", lambda: scheduler_up)

    result = _agent("reminder_add", text="Stretch", when="in 30m")

    assert result["reminders"][0]["text"] == "Stretch"
    assert ("warning" in result) is (not scheduler_up)
