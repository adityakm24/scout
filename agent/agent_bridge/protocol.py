"""The only messages that cross the bridge, and their deterministic validation.

A browse task (User Agent -> Browser Agent) names its goal, the domains it may visit, the
placeholders it may fill and the typed fields it wants back. The Browser Agent's answer is one
JSON object of enums and typed values; anything else is refused, never repaired.
"""

from __future__ import annotations

import json
import re
from dataclasses import dataclass, field
from datetime import date, datetime
from typing import Any, Dict, List, Optional, Tuple
from urllib.parse import urlsplit

# Profile values the Browser Agent may ask the proxy to type. It only ever sees these names.
PLACEHOLDERS = (
    "USER_FULL_NAME", "USER_FIRST_NAME", "USER_LAST_NAME", "USER_EMAIL", "USER_PHONE",
    "USER_ADDRESS", "USER_ADDRESS_LINE1", "USER_ADDRESS_LINE2", "USER_CITY", "USER_REGION",
    "USER_POSTAL_CODE", "USER_COUNTRY",
)
STATUSES = ("done", "blocked", "failed")
REASONS = (
    "ok", "not_found", "login_required", "captcha", "domain_not_allowed", "out_of_stock",
    "payment_required", "needs_data", "needs_approval", "denied_by_user", "timeout", "page_error",
    "policy_blocked", "other",
)
FIELD_TYPES = ("number", "integer", "boolean", "enum", "date", "datetime", "url", "currency", "short_text")

MAX_GOAL_CHARS = 600
MAX_DOMAINS = 10
MAX_FIELDS = 12
MAX_ENUM_OPTIONS = 20
SHORT_TEXT_MAX = 80
_NAME_RE = re.compile(r"^[a-z][a-z0-9_]{0,39}$")
_HOST_RE = re.compile(r"^(?=.{1,253}$)([a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$")
_CURRENCY_RE = re.compile(r"^[A-Z]{3}$")
_ENUM_OPTION_RE = re.compile(r"^[a-z0-9][a-z0-9_-]{0,39}$")
# Letters, digits, spaces and plain punctuation: enough for a product or flight name, too little
# for markup, links, code or a smuggled instruction block.
_SHORT_TEXT_RE = re.compile(r"^[\w .,:;!?'()&+/#%$€£-]{1," + str(SHORT_TEXT_MAX) + r"}$", re.UNICODE)
_PLACEHOLDER_TOKEN_RE = re.compile(r"\{\{([A-Z_]+)\}\}")


class BridgeError(ValueError):
    """A message that does not fit the protocol. Its text is written by code, never by an agent."""


@dataclass(frozen=True)
class ResultField:
    type: str
    options: Tuple[str, ...] = ()


@dataclass(frozen=True)
class BrowseTask:
    goal: str
    start_url: str
    allowed_domains: Tuple[str, ...]
    placeholders: Tuple[str, ...] = ()
    result_fields: Dict[str, ResultField] = field(default_factory=dict)


@dataclass(frozen=True)
class BrowseOutcome:
    status: str
    reason: str
    result: Dict[str, Any] = field(default_factory=dict)
    needs: Tuple[str, ...] = ()

    def as_dict(self) -> Dict[str, Any]:
        out: Dict[str, Any] = {"status": self.status, "reason": self.reason}
        if self.result:
            out["result"] = dict(self.result)
        if self.needs:
            out["needs"] = list(self.needs)
        return out


def host_allowed(host: str, allowed_domains: Tuple[str, ...]) -> bool:
    """*host* is an allowed domain or a subdomain of one."""
    host = (host or "").lower().rstrip(".")
    return any(host == d or host.endswith("." + d) for d in allowed_domains)


def url_host(url: str) -> str:
    try:
        parts = urlsplit(str(url))
    except ValueError:
        return ""
    if parts.scheme not in ("https", "http") or parts.username or parts.password:
        return ""
    return (parts.hostname or "").lower()


def parse_browse_task(raw: Dict[str, Any]) -> BrowseTask:
    """Validate the User Agent's ``browse_task`` arguments."""
    if not isinstance(raw, dict):
        raise BridgeError("browse_task arguments must be an object")
    goal = raw.get("goal")
    if not isinstance(goal, str) or not goal.strip() or len(goal) > MAX_GOAL_CHARS:
        raise BridgeError(f"goal must be 1-{MAX_GOAL_CHARS} characters")

    domains_raw = raw.get("allowed_domains")
    if not isinstance(domains_raw, list) or not 1 <= len(domains_raw) <= MAX_DOMAINS:
        raise BridgeError(f"allowed_domains must list 1-{MAX_DOMAINS} domains")
    domains = []
    for d in domains_raw:
        d = str(d).strip().lower().rstrip(".")
        if d.startswith("www."):
            d = d[4:]
        if not _HOST_RE.match(d):
            raise BridgeError(f"not a domain name: {d!r}")
        domains.append(d)
    domains_t = tuple(dict.fromkeys(domains))

    start_url = raw.get("start_url")
    host = url_host(start_url) if isinstance(start_url, str) else ""
    if not host or not start_url.startswith("https://") or not host_allowed(host, domains_t):
        raise BridgeError("start_url must be an https URL on one of allowed_domains")

    placeholders = raw.get("placeholders") or []
    if not isinstance(placeholders, list) or any(p not in PLACEHOLDERS for p in placeholders):
        raise BridgeError(f"placeholders must be names from: {', '.join(PLACEHOLDERS)}")

    fields_raw = raw.get("result_fields") or {}
    if not isinstance(fields_raw, dict) or len(fields_raw) > MAX_FIELDS:
        raise BridgeError(f"result_fields must be an object of at most {MAX_FIELDS} fields")
    fields: Dict[str, ResultField] = {}
    for name, spec in fields_raw.items():
        if not _NAME_RE.match(str(name)):
            raise BridgeError(f"result field name {name!r} must be lower_snake_case")
        ftype = spec.get("type") if isinstance(spec, dict) else spec
        if ftype not in FIELD_TYPES:
            raise BridgeError(f"result field {name!r} type must be one of: {', '.join(FIELD_TYPES)}")
        options: Tuple[str, ...] = ()
        if ftype == "enum":
            opts = spec.get("options") if isinstance(spec, dict) else None
            if (not isinstance(opts, list) or not 1 <= len(opts) <= MAX_ENUM_OPTIONS
                    or any(not isinstance(o, str) or not _ENUM_OPTION_RE.match(o) for o in opts)):
                raise BridgeError(f"enum field {name!r} needs 1-{MAX_ENUM_OPTIONS} lower-case options")
            options = tuple(opts)
        fields[str(name)] = ResultField(ftype, options)
    return BrowseTask(goal.strip(), start_url, domains_t, tuple(dict.fromkeys(placeholders)), fields)


def placeholders_in(text: str) -> List[str]:
    return _PLACEHOLDER_TOKEN_RE.findall(text or "")


def _parse_json_object(text: str) -> Dict[str, Any]:
    """The answer must be exactly one JSON object (a single ```json fence is tolerated)."""
    body = (text or "").strip()
    fence = re.fullmatch(r"```(?:json)?\s*(\{.*\})\s*```", body, re.DOTALL)
    if fence:
        body = fence.group(1)
    try:
        obj = json.loads(body)
    except (ValueError, TypeError) as exc:
        raise BridgeError("the Browser Agent's answer was not a JSON object") from exc
    if not isinstance(obj, dict):
        raise BridgeError("the Browser Agent's answer was not a JSON object")
    return obj


def _check_value(name: str, spec: ResultField, value: Any, task: BrowseTask) -> Any:
    bad = BridgeError(f"result field {name!r} is not a valid {spec.type}")
    if value is None:
        return None  # a field the agent could not find
    if spec.type == "boolean":
        if not isinstance(value, bool):
            raise bad
    elif spec.type == "integer":
        if isinstance(value, bool) or not isinstance(value, int) or abs(value) > 10**15:
            raise bad
    elif spec.type == "number":
        if isinstance(value, bool) or not isinstance(value, (int, float)) or value != value or abs(value) > 10**15:
            raise bad
    elif spec.type == "enum":
        if value not in spec.options:
            raise bad
    elif spec.type == "currency":
        if not isinstance(value, str) or not _CURRENCY_RE.match(value):
            raise bad
    elif spec.type == "date":
        try:
            date.fromisoformat(value)
        except (TypeError, ValueError):
            raise bad from None
        if len(value) != 10:
            raise bad
    elif spec.type == "datetime":
        try:
            datetime.fromisoformat(value)
        except (TypeError, ValueError):
            raise bad from None
        if len(value) > 32:
            raise bad
    elif spec.type == "url":
        host = url_host(value) if isinstance(value, str) else ""
        if not host or len(value) > 2048 or not host_allowed(host, task.allowed_domains):
            raise BridgeError(f"result field {name!r} is not a URL on an allowed domain")
    elif spec.type == "short_text":
        if not isinstance(value, str) or not _SHORT_TEXT_RE.match(value):
            raise bad
    return value


def parse_browse_outcome(text: str, task: BrowseTask) -> BrowseOutcome:
    """Validate the Browser Agent's final answer against *task*. Unknown keys are refused."""
    obj = _parse_json_object(text)
    extra = set(obj) - {"status", "reason", "result", "needs"}
    if extra:
        raise BridgeError(f"unexpected keys in the answer: {', '.join(sorted(extra))}")
    status, reason = obj.get("status"), obj.get("reason")
    if status not in STATUSES:
        raise BridgeError(f"status must be one of: {', '.join(STATUSES)}")
    if reason not in REASONS:
        raise BridgeError(f"reason must be one of: {', '.join(REASONS)}")

    needs_raw = obj.get("needs") or []
    if not isinstance(needs_raw, list) or any(n not in PLACEHOLDERS for n in needs_raw):
        raise BridgeError("needs must list placeholder names")
    needs = tuple(dict.fromkeys(needs_raw))

    result_raw = obj.get("result") or {}
    if not isinstance(result_raw, dict):
        raise BridgeError("result must be an object")
    unknown = set(result_raw) - set(task.result_fields)
    if unknown:
        raise BridgeError(f"result has fields the task did not ask for: {', '.join(sorted(unknown))}")
    result = {name: _check_value(name, task.result_fields[name], value, task)
              for name, value in result_raw.items()}
    return BrowseOutcome(status, reason, {k: v for k, v in result.items() if v is not None}, needs)


def outcome_schema_text(task: BrowseTask) -> str:
    """The answer contract shown to the Browser Agent (generated from the task, not by a model)."""
    fields = {name: (f"one of {list(f.options)}" if f.type == "enum" else f.type)
              for name, f in task.result_fields.items()}
    return json.dumps({
        "status": list(STATUSES), "reason": list(REASONS),
        "result": fields or {}, "needs": f"optional list of placeholder names from {list(PLACEHOLDERS)}",
    }, indent=1)


def blocked(reason: str, needs: Optional[List[str]] = None) -> BrowseOutcome:
    return BrowseOutcome("blocked", reason, {}, tuple(needs or ()))
