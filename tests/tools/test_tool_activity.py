"""The live line says what the agent is doing in the user's words, and stays quiet for plumbing."""

from types import SimpleNamespace

from tools import tool_activity
from tools.tool_activity import activity_for_tool

ZEPTO = SimpleNamespace(spending=SimpleNamespace(tools={"create_order": "COD"}, commit_flag="confirmOrder"))


def test_the_scenario_reads_as_steps_a_person_follows(monkeypatch):
    monkeypatch.setattr("tools.mcp_tool_spending.spending_entry", lambda server: ZEPTO if server == "zepto" else None)
    steps = [
        ("device_location", {}),
        ("mcp__zepto__list_saved_addresses", {}),
        ("tool_call", {"calls": [{"name": "mcp__zepto__search_products", "arguments": {"query": "Red Bull"}}]}),
        ("mcp__zepto__update_cart", {"cartItems": []}),
        ("schedule_order", {"server": "zepto"}),
        ("mcp__zepto__create_order", {"confirmOrder": False}),
        ("mcp__zepto__create_order", {"confirmOrder": True}),
    ]
    assert [activity_for_tool(name, args) for name, args in steps] == [
        "Checking where you are", "Looking up your Zepto addresses", "Searching Zepto",
        "Updating your Zepto cart", "Scheduling your Zepto order", "Checking your Zepto bill",
        "Placing your Zepto order"]


def test_plumbing_leaves_the_line_alone():
    assert all(activity_for_tool(name, {}) is None for name in ("tool_search", "skill_view", "memory", ""))
    assert activity_for_tool("tool_call", {"calls": [{"name": "tool_describe"}]}) is None
    assert tool_activity._QUIET.isdisjoint(tool_activity._CORE)
