"""Connector capabilities follow session grants, not process-wide credentials."""

import json

import pytest


@pytest.mark.parametrize("enabled,disabled,allowed", [
    ([], [], False),
    (["safe"], [], False),
    (["scout-webhook"], [], False),
    (["connections"], [], True),
    (["scout-cli"], ["connections"], False),
    (["safe"], ["connections"], False),
    (None, ["connections"], False),
    (None, [], True),
])
def test_connector_scope_controls_schema_and_execution(monkeypatch, enabled, disabled, allowed):
    import model_tools
    from tools.connectors import config
    from tools.registry import invalidate_check_fn_cache

    monkeypatch.setattr(config, "connectors_available", lambda *a, **k: True)
    invalidate_check_fn_cache()
    scope = {"enabled_toolsets": enabled, "disabled_toolsets": disabled}
    defs = model_tools.get_tool_definitions(**scope, quiet_mode=True, skip_tool_search_assembly=True)
    assert ("manage_connections" in {td["function"]["name"] for td in defs}) is allowed
    if enabled == []:
        assert model_tools.get_tool_definitions(**scope, quiet_mode=True) == []
    if not allowed:
        result = model_tools.handle_function_call(
            "manage_connections", {"action": "install", "connectors": ["notion"]}, **scope)
        assert "not available in this session" in json.dumps(json.loads(result))


def test_ordinary_platform_defaults_grant_connections_without_widening_webhook():
    from scout_cli.tools_config import _get_platform_tools
    from toolsets import resolve_toolset

    for platform in ("cli", "telegram"):
        enabled = _get_platform_tools({}, platform)
        assert "connections" in enabled
        assert "manage_connections" in {name for ts in enabled for name in resolve_toolset(ts)}
    assert "connections" not in _get_platform_tools({}, "webhook")
    for selection in ([], ["safe"], ["file"]):
        assert "connections" not in _get_platform_tools({"platform_toolsets": {"cli": selection}}, "cli")
