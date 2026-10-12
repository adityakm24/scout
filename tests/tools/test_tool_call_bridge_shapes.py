"""Behavior tests for the tool_call bridge's batch shapes: one entry per call, string envelopes
parse like arrays, and a multi-entry batch stays a sequential barrier."""

import json

import pytest

from agent.tool_dispatch_helpers import _peel_bridge_call
from tools.tool_search import resolve_underlying_call
from tools.tool_search_validation import normalize_tool_call_entries


def test_resolve_multi_local_batch_echoes_first_entry_as_the_retry_shape():
    # The correction restates the valid single-entry shape with the caller's OWN first
    # entry (a 9B model re-sent the identical two-entry array when told only the rule).
    first = {"name": "some_local_tool", "arguments": {"query": "alpha", "limit": 20}}
    name, args, err = resolve_underlying_call({"calls": [first, {"name": "another_local", "arguments": {}}]})
    assert name is None
    assert "you sent 2" in err
    retry = err.split("Retry with only: ", 1)[1].split(" then issue", 1)[0]
    assert json.loads(retry) == {"calls": [first]}


def test_resolve_unknown_name_points_at_tool_search_not_direct_call():
    # An unregistered name (typically a deferred MCP tool cited by its bare suffix) must
    # NOT be told "call it directly" — that is the opposite of the required correction.
    from tools.registry import registry

    name, args, err = resolve_underlying_call({"name": "not_a_real_tool", "arguments": {}})
    assert name is None
    assert "not a known tool name" in err and "call it directly" not in err.lower()
    registry.register(name="mcp__mempalace__mempalace_search", toolset="mcp-mempalace",
                      handler=lambda a, **kw: "{}",
                      schema={"name": "mcp__mempalace__mempalace_search", "description": "x",
                              "parameters": {"type": "object", "properties": {}}})
    _, _, err = resolve_underlying_call({"name": "mempalace_search", "arguments": {}})
    registry.deregister("mcp__mempalace__mempalace_search")
    assert "Did you mean 'mcp__mempalace__mempalace_search'?" in err
    _, _, err = resolve_underlying_call({"name": "read_file", "arguments": {}})
    assert "directly-listed tool" in err and "not a known tool" not in err


def test_normalize_parses_string_envelope_batch():
    """#114484: a model-emitted JSON-string batch envelope parses like the array form."""
    calls = [{"name": "session_search", "arguments": {"query": "x"}}]
    entries, err = normalize_tool_call_entries({"calls": json.dumps(calls)})
    assert err is None
    assert entries == calls


def test_normalize_parses_string_envelope_single_dict():
    """#114484: a stringified single dict normalizes to a batch of one."""
    entries, err = normalize_tool_call_entries(
        {"calls": json.dumps({"name": "session_search", "arguments": {"query": "x"}})}
    )
    assert err is None
    assert entries == [{"name": "session_search", "arguments": {"query": "x"}}]


@pytest.mark.parametrize(
    "bad,expected_fragment",
    [
        ({}, "requires 'calls'"),
        ({"calls": []}, "non-empty array"),
        ({"calls": [{"arguments": {}}]}, "requires a 'name'"),
        ({"calls": [{"name": "tool_search"}]}, "itself a bridge tool"),
        ({"calls": [{"name": "x", "arguments": "not json {"}]}, "not valid JSON"),
        ({"calls": [{"name": "x", "arguments": 42}]}, "must be an object"),
        ({"calls": "nope"}, "not valid JSON"),
        ({"calls": json.dumps({"query": "x"})}, "requires a 'name'"),
    ],
)
def test_normalize_rejects_malformed_batches(bad, expected_fragment):
    entries, err = normalize_tool_call_entries(bad)
    assert entries == []
    assert expected_fragment in (err or "")


def test_peel_keeps_local_batches_as_sequential_barrier():
    all_local = {"calls": [
        {"name": "write_file", "arguments": {"path": "x"}},
        {"name": "read_file", "arguments": {"path": "x"}},
    ]}
    name, _ = _peel_bridge_call("tool_call", all_local)
    assert name == "tool_call"
