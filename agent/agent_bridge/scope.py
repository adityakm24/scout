"""The running browse tasks, keyed by the Browser Agent's task id, and the checks they impose.

The browser tools consult this before they navigate, after a redirect and before they act on a
page, so the domain allowlist is enforced by code whatever the Browser Agent's model decides.
The same record collects the action log the User Agent audits.
"""

from __future__ import annotations

import contextvars
import json
import threading
import time
from contextlib import contextmanager
from dataclasses import dataclass, field
from typing import Any, Callable, Dict, Iterator, List, Optional, Set

from agent.agent_bridge.protocol import BrowseTask, host_allowed, url_host

_LOCAL_SUFFIX = "::local"
_MAX_LOG = 200


@dataclass
class BrowseScope:
    task: BrowseTask
    task_id: str
    actions: List[Dict[str, Any]] = field(default_factory=list)
    domains: List[str] = field(default_factory=list)
    consents: Set[str] = field(default_factory=set)  # "PLACEHOLDER@host" the person approved
    started: float = field(default_factory=time.monotonic)
    location_callback: Optional[Callable[[], Any]] = None
    location: Optional[Dict[str, float]] = None
    on_location: Optional[Callable[[Dict[str, float]], None]] = None

    def allows_url(self, url: str) -> bool:
        host = url_host(url)
        return bool(host) and host_allowed(host, self.task.allowed_domains)

    def record(self, tool: str, *, domain: str = "", target: str = "", outcome: str = "ok") -> None:
        """Metadata only: tool, domain, element ref and outcome. Never page text or typed text."""
        if len(self.actions) >= _MAX_LOG:
            return
        entry = {"step": len(self.actions) + 1, "tool": tool, "outcome": outcome}
        if domain:
            entry["domain"] = domain
            if domain not in self.domains:
                self.domains.append(domain)
        if target:
            entry["target"] = target[:40]
        self.actions.append(entry)

    def read_location(self) -> Dict[str, float]:
        """Return ``{latitude, longitude, accuracy}`` from the user's device, reading on demand."""
        if self.location is not None:
            return self.location
        if self.location_callback is None:
            raise PermissionError("Location is only available in the Scout app.")
        raw = self.location_callback()
        data = json.loads(raw) if isinstance(raw, str) and raw.strip() else (raw if isinstance(raw, dict) else {})
        if not isinstance(data, dict) or data.get("error"):
            raise PermissionError(str((data or {}).get("error") or "Location access was not allowed."))
        if "latitude" not in data or "longitude" not in data:
            raise PermissionError("The device did not return coordinates.")
        coords = {
            "latitude": float(data["latitude"]),
            "longitude": float(data["longitude"]),
            "accuracy": float(data["accuracy"]) if isinstance(data.get("accuracy"), (int, float)) else 20.0,
        }
        self.location = coords
        if self.on_location is not None:
            self.on_location(coords)
        return coords


_lock = threading.Lock()
_scopes: Dict[str, BrowseScope] = {}
_current_scope_id: contextvars.ContextVar[Optional[str]] = contextvars.ContextVar("_current_scope_id", default=None)


def scope_for(task_id: Optional[str]) -> Optional[BrowseScope]:
    """The scope a browser session key belongs to (a hybrid ``::local`` key maps to its task)."""
    if not task_id:
        return None
    key = task_id[: -len(_LOCAL_SUFFIX)] if task_id.endswith(_LOCAL_SUFFIX) else task_id
    with _lock:
        return _scopes.get(key)


def active_scope() -> Optional[BrowseScope]:
    """The currently executing browse scope in this context (or the sole active scope)."""
    if (current := _current_scope_id.get()) is not None and (scope := scope_for(current)) is not None:
        return scope
    with _lock:
        return next(iter(_scopes.values()), None) if len(_scopes) == 1 else None


@contextmanager
def browse_scope(
    task: BrowseTask,
    task_id: str,
    *,
    location_callback: Optional[Callable[[], Any]] = None,
    location: Optional[Dict[str, float]] = None,
    on_location: Optional[Callable[[Dict[str, float]], None]] = None,
) -> Iterator[BrowseScope]:
    scope = BrowseScope(
        task,
        task_id,
        location_callback=location_callback,
        location=dict(location) if isinstance(location, dict) else None,
        on_location=on_location,
    )
    token = _current_scope_id.set(task_id)
    with _lock:
        _scopes[task_id] = scope
    try:
        yield scope
    finally:
        _current_scope_id.reset(token)
        with _lock:
            _scopes.pop(task_id, None)


def navigation_error(task_id: Optional[str], url: str) -> Optional[str]:
    """Why *url* is off-limits for this browse task, or None (also None outside any browse task)."""
    scope = scope_for(task_id)
    if scope is None or scope.allows_url(url):
        return None
    scope.record("browser_navigate", domain=url_host(url), outcome="domain_not_allowed")
    if not scope.task.allowed_domains:
        return "Blocked: only http(s) addresses on the public web can be opened."
    return ("Blocked: that address is outside this task's allowed domains "
            f"({', '.join(scope.task.allowed_domains)}). Finish with status blocked, reason domain_not_allowed.")
