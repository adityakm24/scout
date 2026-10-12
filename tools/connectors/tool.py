#!/usr/bin/env python3
"""Connection lifecycle tool for local MCP servers from the bundled catalog.

Removing a server remains a user-only decision.
"""

from typing import Any, Callable, Dict, Optional

from tools.connectors.catalog_tool import MANAGE_CATALOG_SCHEMA, manage_catalog
from tools.connectors import config as connector_config
from tools.connectors.mcp import run_mcp_operation
from tools.connectors.targets import MCP_ACTIONS, normalize_targets, validate_action
from tools.registry import registry, tool_error


def manage_connections(
    args: Dict[str, Any],
    *,
    mcp_backend: Optional[Any] = None,
    session_id: Optional[str] = None,
    tool_call_id: Optional[str] = None,
    connection_callback: Optional[Callable[[Dict[str, Any]], Optional[str]]] = None,
) -> str:
    action = str(args.get("action") or "").strip().lower()
    names, target_error = normalize_targets(args.get("connectors"))
    if target_error:
        return tool_error(target_error)
    action_error = validate_action(action, names)
    if action_error:
        return tool_error(action_error)
    return run_mcp_operation(
        names, action, backend=mcp_backend,
        connection_callback=connection_callback, session_id=session_id, tool_call_id=tool_call_id,
    )


MANAGE_CONNECTIONS_SCHEMA = {
    "name": "manage_connections",
    "description": (
        "Connect the user to apps through local MCP servers from the bundled catalog. 'install' "
        "adds a catalog entry, 'enable' re-enables a disabled configured server, 'authorize' runs "
        "its OAuth. Pass SEVERAL servers in one call. In the desktop app, the terminal UI and the "
        "interactive CLI the call shows the user an approval card and blocks until every server is "
        "connected, skipped, or the deadline passes. Where no card exists (a one-shot run, a "
        "scheduled job, a messaging platform) the target runs at once and the result says what "
        "happened, with a link for the USER to open when one is needed (never open it yourself). "
        "Never hand-edit mcp_servers config — always use this tool. After a skip or a timeout, do "
        "not re-ask on your own: continue without the app or ask in chat. A later request from the "
        "USER for that same app is not a re-ask — run it. A connected server's tools are named in "
        "the result and are callable at once through tool_describe/tool_call. This tool can NOT "
        "remove a server — that is deliberately user-only (`scout mcp remove`)."
    ),
    "parameters": {
        "type": "object",
        "properties": {
            "action": {"type": "string", "enum": list(MCP_ACTIONS)},
            "connectors": {
                "type": "array",
                "items": {"type": "string"},
                "description": "MCP server names (catalog entries for install, configured servers otherwise).",
            },
        },
        "required": ["action", "connectors"],
    },
}


registry.register(
    name="manage_connections",
    toolset="connections",
    schema=MANAGE_CONNECTIONS_SCHEMA,
    # Opt-in (``tools.connectors.enabled``): outside it the tool is not in the schema at all. Read
    # as a module attribute so tests patch ``config.connectors_available`` at one seam.
    handler=lambda args, **kw: manage_connections(args, session_id=kw.get("session_id")),
    check_fn=lambda: connector_config.connectors_available(),
    emoji="🔗",
)

# The setup profile's catalog install. Reachable only through the ``setup`` toolset, which the
# profile's role grants; registry dispatch has no card callback, so it answers with the CLI pointer.
registry.register(
    name="manage_catalog",
    toolset="setup",
    schema=MANAGE_CATALOG_SCHEMA,
    handler=lambda args, **kw: manage_catalog(args, session_id=kw.get("session_id")),
    emoji="🧩",
)
