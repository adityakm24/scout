"""Connection operations for local MCP servers and catalog installs.

Only the names below are cross-package surface; imports beyond it need a design decision.
Siblings: ``contract`` (states, actors, transition table), ``operation`` (the record),
``live`` (open operation per session), ``run`` (the lifecycle loop), ``mcp`` / ``catalog``
(per-kind hooks), ``targets``, ``config`` (the opt-in gate).
"""

from tools.connectors.config import connectors_available
from tools.connectors.tool import MANAGE_CONNECTIONS_SCHEMA, manage_connections

__all__ = [
    "MANAGE_CONNECTIONS_SCHEMA",
    "connectors_available",
    "manage_connections",
]
