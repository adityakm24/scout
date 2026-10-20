"""The running browse tasks, keyed by the Browser Agent's task id, and the checks they impose.

The browser tools consult this before they navigate, after a redirect and before they act on a
page, so the domain allowlist is enforced by code whatever the Browser Agent's model decides.
The same record collects the action log the User Agent audits.
"""

from __future__ import annotations

import threading
import time
from contextlib import contextmanager
from dataclasses import dataclass, field
from typing import Any, Dict, Iterator, List, Optional, Set

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


_lock = threading.Lock()
_scopes: Dict[str, BrowseScope] = {}


def scope_for(task_id: Optional[str]) -> Optional[BrowseScope]:
    """The scope a browser session key belongs to (a hybrid ``::local`` key maps to its task)."""
    if not task_id:
        return None
    key = task_id[: -len(_LOCAL_SUFFIX)] if task_id.endswith(_LOCAL_SUFFIX) else task_id
    with _lock:
        return _scopes.get(key)


@contextmanager
def browse_scope(task: BrowseTask, task_id: str) -> Iterator[BrowseScope]:
    scope = BrowseScope(task, task_id)
    with _lock:
        _scopes[task_id] = scope
    try:
        yield scope
    finally:
        with _lock:
            _scopes.pop(task_id, None)


def navigation_error(task_id: Optional[str], url: str) -> Optional[str]:
    """Why *url* is off-limits for this browse task, or None (also None outside any browse task)."""
    scope = scope_for(task_id)
    if scope is None or scope.allows_url(url):
        return None
    scope.record("browser_navigate", domain=url_host(url), outcome="domain_not_allowed")
    return ("Blocked: that address is outside this task's allowed domains "
            f"({', '.join(scope.task.allowed_domains)}). Finish with status blocked, reason domain_not_allowed.")
