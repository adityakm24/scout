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
SCALAR_TYPES = ("number", "integer", "boolean", "enum", "date", "datetime", "url", "currency", "short_text")
# ``list``: up to MAX_LIST_ITEMS rows, each an object of scalar sub-fields (a few products, flights, slots).
FIELD_TYPES = (*SCALAR_TYPES, "list")

MAX_GOAL_CHARS = 600
MAX_DOMAINS = 10
MAX_FIELDS = 12
MAX_ENUM_OPTIONS = 20
SHORT_TEXT_MAX = 160
MAX_LIST_ITEMS = 10
MAX_LIST_SUBFIELDS = 8
_NAME_RE = re.compile(r"^[a-z][a-z0-9_]{0,39}$")
_HOST_RE = re.compile(r"^(?=.{1,253}$)([a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$")
_CURRENCY_RE = re.compile(r"^[A-Z]{3}( -?\d+(\.\d+)?)?$")
_CURRENCY_SYMBOLS = {"$": "USD", "US$": "USD", "€": "EUR", "£": "GBP", "₹": "INR", "Rs": "INR", "Rs.": "INR",
                     "¥": "JPY", "₩": "KRW", "A$": "AUD", "C$": "CAD"}
_ENUM_OPTION_RE = re.compile(r"^[a-z0-9][a-z0-9_-]{0,39}$")
# Short text is one line of ordinary prose (a product name, a feature, a seat): no markup, links,
# code, template braces or line breaks, so it cannot carry an instruction block or an exfil URL.
_SHORT_TEXT_FORBIDDEN = re.compile(r"[<>{}`\\\x00-\x1f\x7f]|https?://|www\.", re.IGNORECASE)
_PLACEHOLDER_TOKEN_RE = re.compile(r"\{\{([A-Z_]+)\}\}")


class BridgeError(ValueError):
    """A message that does not fit the protocol. Its text is written by code, never by an agent."""


@dataclass(frozen=True)
class ResultField:
    type: str
    options: Tuple[str, ...] = ()
    items: Dict[str, "ResultField"] = field(default_factory=dict)  # sub-fields of a ``list``


def short_text_ok(value: Any) -> bool:
    return (isinstance(value, str) and 1 <= len(value.strip()) and len(value) <= SHORT_TEXT_MAX
            and not _SHORT_TEXT_FORBIDDEN.search(value))


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
    """*host* is an allowed domain or a subdomain of one. No list means the whole public web (the
    egress proxy keeps the browser off private networks either way)."""
    host = (host or "").lower().rstrip(".")
    if not host:
        return False
    return not allowed_domains or any(host == d or host.endswith("." + d) for d in allowed_domains)


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

    domains_raw = raw.get("allowed_domains") or []
    if not isinstance(domains_raw, list) or len(domains_raw) > MAX_DOMAINS:
        raise BridgeError(f"allowed_domains must list at most {MAX_DOMAINS} domains (or be left out)")
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
        raise BridgeError("start_url must be an https URL" + (" on one of allowed_domains" if domains_t else ""))

    placeholders = raw.get("placeholders") or []
    if not isinstance(placeholders, list) or any(p not in PLACEHOLDERS for p in placeholders):
        raise BridgeError(f"placeholders must be names from: {', '.join(PLACEHOLDERS)}")

    fields_raw = raw.get("result_fields") or {}
    if not isinstance(fields_raw, dict) or len(fields_raw) > MAX_FIELDS:
        raise BridgeError(f"result_fields must be an object of at most {MAX_FIELDS} fields")
    fields = {str(name): _parse_field(str(name), spec, FIELD_TYPES) for name, spec in fields_raw.items()}
    return BrowseTask(goal.strip(), start_url, domains_t, tuple(dict.fromkeys(placeholders)), fields)


_FIELD_HELP = ('{"price": {"type": "number"}, "products": {"type": "list", "items": {"name": {"type": '
               '"short_text"}, "price": {"type": "number"}, "rating": {"type": "number"}, "link": {"type": "url"}}}}')


def _parse_field(name: str, spec: Any, allowed: Tuple[str, ...]) -> ResultField:
    if not _NAME_RE.match(name):
        raise BridgeError(f"result field name {name!r} must be lower_snake_case")
    ftype = spec.get("type") if isinstance(spec, dict) else spec
    if ftype not in allowed:
        raise BridgeError(f"result field {name!r} type must be one of: {', '.join(allowed)}. "
                          f"Example result_fields: {_FIELD_HELP}")
    if ftype == "enum":
        opts = spec.get("options") if isinstance(spec, dict) else None
        if (not isinstance(opts, list) or not 1 <= len(opts) <= MAX_ENUM_OPTIONS
                or any(not isinstance(o, str) or not _ENUM_OPTION_RE.match(o) for o in opts)):
            raise BridgeError(f"enum field {name!r} needs 1-{MAX_ENUM_OPTIONS} lower-case options")
        return ResultField(ftype, tuple(opts))
    if ftype == "list":
        items = spec.get("items") if isinstance(spec, dict) else None
        if not isinstance(items, dict) or not 1 <= len(items) <= MAX_LIST_SUBFIELDS:
            raise BridgeError(f"list field {name!r} needs \"items\": 1-{MAX_LIST_SUBFIELDS} sub-fields. "
                              f"Example: {_FIELD_HELP}")
        return ResultField(ftype, (), {str(k): _parse_field(str(k), v, SCALAR_TYPES) for k, v in items.items()})
    return ResultField(ftype)


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


def answer_json(text: str) -> str:
    """The answer's JSON object, re-serialized (a ```json fence and whitespace dropped): exactly what
    the NeMo Guardrails rail re-checks, independently of ``parse_browse_outcome``."""
    return json.dumps(_parse_json_object(text), ensure_ascii=False)


_NUMBER_RE = re.compile(r"-?\d[\d,]*(?:\.\d+)?|-?\.\d+")


def _as_number(value: Any) -> Optional[float]:
    """A number, or the first number in a short string as a page shows it ("$29.99", "₹2,499",
    "4.5 out of 5 stars"); None otherwise. Conversion is done here, by code, not by the model."""
    if isinstance(value, bool):
        return None
    if isinstance(value, (int, float)):
        return None if value != value else value
    if isinstance(value, str) and len(value) <= 40 and (m := _NUMBER_RE.search(value)):
        number = float(m.group().replace(",", ""))
        return int(number) if number.is_integer() and "." not in m.group() else number
    return None


def _clean_short_text(value: Any) -> Any:
    """Whitespace collapsed and clipped to the limit. Markup and links are not scrubbed: a value
    carrying them is dropped by ``short_text_ok``, so injected text is never laundered clean."""
    if not isinstance(value, (str, int, float)) or isinstance(value, bool):
        return value
    text = " ".join(str(value).split())
    return text if len(text) <= SHORT_TEXT_MAX else text[:SHORT_TEXT_MAX - 1].rstrip() + "…"


def _clean_currency(value: Any) -> Any:
    """An ISO code ("USD"), or a price as a page prints it ("$29.99", "₹2,499") as "INR 2499"."""
    if not isinstance(value, str):
        return value
    text = value.strip()
    code = next((c for sym, c in sorted(_CURRENCY_SYMBOLS.items(), key=lambda kv: -len(kv[0]))
                 if text.startswith(sym)), None)
    code = code or (m.group().upper() if (m := re.search(r"\b[A-Za-z]{3}\b", text)) else None)
    amount = _as_number(text)
    if amount is None:
        return _CURRENCY_SYMBOLS.get(text, text.upper())
    return f"{code or 'USD'} {amount}"


def _check_value(name: str, spec: ResultField, value: Any, task: BrowseTask) -> Any:
    """The value in canonical form, or None when even cleaned it does not fit: one bad value is
    dropped (never passed through raw) rather than sinking the whole answer."""
    if value is None:
        return None  # a field the agent could not find
    if spec.type == "boolean":
        return value if isinstance(value, bool) else None
    if spec.type in ("integer", "number"):
        value = _as_number(value)
        if value is None or abs(value) > 10**15:
            return None
        return int(round(value)) if spec.type == "integer" else value
    if spec.type == "enum":
        if isinstance(value, str) and value not in spec.options:
            value = next((o for o in spec.options if o.lower() == value.strip().lower().replace(" ", "_")), None)
        return value if value in spec.options else None
    if spec.type == "currency":
        value = _clean_currency(value)
        return value if isinstance(value, str) and _CURRENCY_RE.match(value) else None
    if spec.type == "date":
        try:
            date.fromisoformat(value)
        except (TypeError, ValueError):
            return None
        return value if len(value) == 10 else None
    if spec.type == "datetime":
        try:
            datetime.fromisoformat(value)
        except (TypeError, ValueError):
            return None
        return value if len(value) <= 32 else None
    if spec.type == "url":
        host = url_host(value) if isinstance(value, str) else ""
        return value if host and len(value) <= 2048 and host_allowed(host, task.allowed_domains) else None
    if spec.type == "short_text":
        value = _clean_short_text(value)
        return value if short_text_ok(value) else None
    if spec.type == "list":
        if not isinstance(value, list):
            return None
        rows = []
        for row in value:
            if not isinstance(row, dict):
                continue
            checked = {k: _check_value(f"{name}.{k}", spec.items[k], v, task)
                       for k, v in row.items() if k in spec.items}
            if row := {k: v for k, v in checked.items() if v is not None}:
                rows.append(row)
            if len(rows) == MAX_LIST_ITEMS:
                break
        return rows or None
    return None


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
    # Fields the task did not ask for are ignored; they never cross.
    result = {name: _check_value(name, task.result_fields[name], value, task)
              for name, value in result_raw.items() if name in task.result_fields}
    return BrowseOutcome(status, reason, {k: v for k, v in result.items() if v is not None}, needs)


def outcome_schema_text(task: BrowseTask) -> str:
    """The answer contract shown to the Browser Agent (generated from the task, not by a model)."""
    def describe(f: ResultField) -> Any:
        if f.type == "enum":
            return f"one of {list(f.options)}"
        if f.type == "list":
            return [{k: describe(v) for k, v in f.items.items()}, f"... up to {MAX_LIST_ITEMS} items"]
        return f.type

    fields = {name: describe(f) for name, f in task.result_fields.items()}
    return json.dumps({
        "status": list(STATUSES), "reason": list(REASONS),
        "result": fields or {}, "needs": f"optional list of placeholder names from {list(PLACEHOLDERS)}",
    }, indent=1)


def blocked(reason: str, needs: Optional[List[str]] = None) -> BrowseOutcome:
    return BrowseOutcome("blocked", reason, {}, tuple(needs or ()))
