"""Listener address helpers shared by the api_server and webhook adapters.

Under ``gateway.multiplex_profiles`` the default profile owns the ONE HTTP listener (api_server, or
the webhook adapter's port); secondary profiles reach it through the ``/p/<profile>/`` mirrors those
adapters register themselves.
"""
from __future__ import annotations

from typing import Any

_WILDCARD_HOSTS = frozenset({"", "0.0.0.0", "::", "*"})


def is_wildcard_host(host: Any) -> bool:
    """True for the dual-stack default (None/"") and the per-family wildcards."""
    return host is None or str(host).strip() in _WILDCARD_HOSTS


def listener_base_url(host: Any, port: Any) -> str:
    """``http://host:port`` clients use to reach a listener bound on ``host`` (wildcards → loopback)."""
    host = "127.0.0.1" if is_wildcard_host(host) else str(host)
    if ":" in host and not host.startswith("["):
        host = f"[{host}]"
    return f"http://{host}:{port or 0}"
