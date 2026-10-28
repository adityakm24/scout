"""Schedule a review reminder for an order the user wants later.

Scheduling never authorizes or places a purchase. At the selected time, Scout reminds the user in
the originating chat (or the app's Bot Chat) to review the order; the user must then request it and
approve the fresh order card. ``claim_hold`` remains for orders approved by older versions.
"""

from __future__ import annotations

import json
import logging
import threading
import time
import uuid
from datetime import timedelta
from typing import Any, Optional

from tools.registry import registry, tool_error

logger = logging.getLogger(__name__)

# How long an order approved by an older version remains valid after its planned time.
HOLD_GRACE_MINUTES = 45
_lock = threading.Lock()


def _holds_path():
    from scout_constants import get_scout_home

    return get_scout_home() / "orders" / "holds.json"


def _load() -> list:
    try:
        holds = json.loads(_holds_path().read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return []
    return holds if isinstance(holds, list) else []


def _save(holds: list) -> None:
    from utils import atomic_json_write

    path = _holds_path()
    path.parent.mkdir(parents=True, exist_ok=True)
    # Only the newest holds matter; old ones are a record, not state.
    atomic_json_write(path, holds[-50:], mode=0o600)


def _call_args(args: Optional[dict]) -> str:
    """Arguments as the order sees them: unset, zero and "no" values say nothing (a model may add
    ``riderTip: 0`` at placing time that it left out when scheduling)."""
    kept = {k: v for k, v in (args or {}).items() if v not in (None, "", 0, False, [], {})}
    return json.dumps(kept, sort_keys=True, ensure_ascii=False)


def _basket(items: list) -> list:
    return sorted([str(i.get("name", "")).strip().casefold(), int(i.get("quantity") or 1)] for i in items)


def create_hold(server: str, tool: str, args: dict, summary: dict, place_at_epoch: float) -> dict:
    hold = {
        "id": uuid.uuid4().hex[:10], "server": server, "tool": tool, "args": _call_args(args),
        "merchant": summary.get("merchant"), "basket": _basket(summary.get("items") or []),
        "max_total": summary.get("total"), "created_at": time.time(), "place_at": place_at_epoch,
        "expires_at": place_at_epoch + HOLD_GRACE_MINUTES * 60, "status": "held", "job_id": None,
    }
    with _lock:
        holds = _load()
        holds.append(hold)
        _save(holds)
    return hold


def attach_job(hold_id: str, job_id: str) -> None:
    with _lock:
        holds = _load()
        for hold in holds:
            if hold["id"] == hold_id:
                hold["job_id"] = job_id
        _save(holds)


def claim_hold(server: str, tool: str, args: dict, live: dict) -> tuple[Optional[dict], Optional[str]]:
    """``(hold, None)`` when a live hold covers this exact call and the basket as it is now — the
    hold is spent; ``(None, reason)`` when one was meant for it but no longer covers it; ``(None,
    None)`` when there is no hold for this call at all."""
    now, call = time.time(), _call_args(args)
    with _lock:
        holds = _load()
        candidates = [h for h in holds if h["status"] == "held" and h["server"] == server
                      and h["tool"] == tool and h["args"] == call]
        if not candidates:
            return None, None
        hold = candidates[-1]
        reason = None
        if now > hold["expires_at"]:
            reason = "the approval expired"
        elif _basket(live.get("items") or []) != hold["basket"]:
            reason = "the basket changed since the user approved it"
        elif hold["max_total"] is not None and (live.get("total") is None or live["total"] > hold["max_total"]):
            reason = (f"the total is now ₹{live.get('total'):g}, above the ₹{hold['max_total']:g} the user approved"
                      if live.get("total") is not None else "the total could not be read")
        hold["status"] = "refused" if reason else "placed"
        hold["settled_at"], hold["reason"] = now, reason
        _save(holds)
    return (None, reason) if reason else (hold, None)


# ── schedule_order ────────────────────────────────────────────────────────────────────────────


def _spending_servers() -> list:
    from tools.mcp_tool_common import _core
    from tools.mcp_tool_spending import spending_entry

    names = set(_core._servers) | set(_core._lazy_server_configs)
    return sorted(name for name in names if spending_entry(name) is not None)


def check_schedule_order_requirements() -> bool:
    """Only where a merchant that can take orders is connected, and a scheduler can run the job."""
    from tools.cronjob_tools import check_cronjob_requirements

    try:
        return bool(_spending_servers()) and check_cronjob_requirements()
    except Exception:
        return False


def _clock(when) -> str:
    return when.strftime("%-I:%M %p")


# Minutes between the order going in and the user arriving, so it is at the door first.
ARRIVAL_MARGIN_MINUTES = 3


def _whole_minutes(value: Any) -> Optional[int]:
    try:
        return None if value in (None, "") else round(float(value))
    except (TypeError, ValueError):
        return None


def _when_to_place(place_in_minutes: Any, drive_minutes: Any, delivery_minutes: Any) -> tuple:
    """``(minutes, None)`` or ``(None, error)``. With the drive and delivery times the tool does the
    arithmetic itself (a model's subtraction is the step most often wrong)."""
    drive, delivery = _whole_minutes(drive_minutes), _whole_minutes(delivery_minutes)
    if drive is not None:
        minutes = drive - (delivery if delivery is not None else 15) - ARRIVAL_MARGIN_MINUTES
        if minutes < 1:
            return None, (f"The delivery takes about as long as the trip ({drive} min), so it would arrive after "
                          "the user anyway: place the order now instead of scheduling it.")
        return minutes, None
    minutes = _whole_minutes(place_in_minutes)
    if minutes is None:
        return None, "Give drive_minutes (and delivery_minutes), or place_in_minutes."
    return minutes, None


def _known_arguments(server: str, tool: str, args: dict) -> dict:
    """Only the arguments the merchant's order tool declares: a model often adds the cart or other
    context to the call, which the merchant would reject at placing time with nobody there."""
    from tools.mcp_tool_schema import mcp_prefixed_tool_name

    schema = registry.get_schema(mcp_prefixed_tool_name(server, tool)) or {}
    declared = (schema.get("parameters") or schema.get("inputSchema") or {}).get("properties")
    return {k: v for k, v in args.items() if k in declared} if isinstance(declared, dict) and declared else args


def _vendor_dry_run(entry, server: str, tool: str, args: dict, tool_timeout: float) -> Optional[str]:
    """The merchant's own check of the order, without placing it (the commit flag off): a wrong
    address id or an unserviceable cart fails now, while the user is here, not at placing time."""
    flag = entry.spending.commit_flag
    if not flag:
        return None
    from tools.mcp_tool_handlers import _make_tool_handler

    try:
        raw = json.loads(_make_tool_handler(server, tool, tool_timeout)({**args, flag: False}))
    except Exception as exc:
        return f"the merchant could not check the order: {exc}"
    return str(raw["error"]) if isinstance(raw, dict) and raw.get("error") else None


def schedule_order(server: str, tool: str, arguments: Optional[dict], place_in_minutes: Any = None,
                   drive_minutes: Any = None, delivery_minutes: Any = None, tool_timeout: float = 60.0) -> str:
    from tools.mcp_tool_spending import _merchant, order_summary, spending_entry

    entry = spending_entry(server or "")
    if entry is None:
        return tool_error(f"'{server}' is not a merchant Scout can order from. Connected: "
                          f"{', '.join(_spending_servers()) or 'none'}.")
    if tool not in entry.spending.tools:
        return tool_error(f"{tool} does not place {server} orders; use one of: {', '.join(entry.spending.tools)}.")
    minutes, problem = _when_to_place(place_in_minutes, drive_minutes, delivery_minutes)
    if problem:
        return tool_error(problem)
    if not 1 <= minutes <= 24 * 60:
        return tool_error("The order must be placed between 1 minute and 24 hours from now.")

    from tools.approval import _unattended_contexts

    if _unattended_contexts():
        return tool_error("Scheduling an order needs the user to approve it, and nobody is present in this run.")

    args = _known_arguments(server, tool, dict(arguments or {}))
    if refused := _vendor_dry_run(entry, server, tool, args, tool_timeout):
        return tool_error(f"{_merchant(entry)} would not accept this order: {refused}. Fix it (for an address, use "
                          "the id from the merchant's saved addresses) and try again. Nothing was scheduled.")
    summary = order_summary(entry, server, tool, args, tool_timeout)
    if not summary["items"] and summary["total"] is None:
        return tool_error("The basket could not be read, so there is nothing to schedule. Build the cart first, "
                          f"then check it with {entry.spending.preview or 'the merchant'}.")

    import scout_time

    place_at = scout_time.now() + timedelta(minutes=minutes)
    merchant = _merchant(entry)
    schedule = place_at.replace(microsecond=0).isoformat()
    item_descriptions = [
        f"{item['quantity']} × {str(item['name'])[:80]}"
        for item in summary["items"][:4]
    ]
    if len(summary["items"]) > 4:
        item_descriptions.append(f"and {len(summary['items']) - 4} more")
    total = summary["total"]
    estimate = f" Estimated total: ₹{total:g}." if isinstance(total, (int, float)) else ""
    reminder_text = (
        f"It's time to review your {merchant} order"
        + (f": {', '.join(item_descriptions)}." if item_descriptions else ".")
        + estimate
        + " Nothing has been ordered or pre-authorized. Open Scout and ask to place it; "
        "a fresh approval card is required before any purchase."
    )
    from planner import reminders
    from tools.cronjob_job_args import _origin_from_env

    origin = _origin_from_env(schedule)
    scheduled = reminders.add_reminder(
        reminder_text,
        schedule,
        actor="agent",
        origin=origin,
        deliver="origin" if origin else None,
    )
    job_id = scheduled["reminder"]["id"]
    logger.info("Scheduled order review for %s/%s at %s (reminder %s)", server, tool, place_at, job_id)
    return json.dumps({
        "scheduled": True, "review_at": _clock(place_at), "in_minutes": minutes, "job_id": job_id,
        "total": summary["total"], "items": [f"{i['quantity']} × {i['name']}" for i in summary["items"]],
        "purchase_authorized": False,
        "note": "This schedules a review reminder only. Nothing will be ordered or charged; the user must "
                "request the order at that time and approve its fresh order card.",
    }, ensure_ascii=False)


SCHEDULE_ORDER_SCHEMA = {
    "name": "schedule_order",
    "description": (
        "Schedule a later order review instead of ordering now — use this, not the merchant's order tool, whenever the user "
        "wants it to arrive later or when they get home (\"so it's home when I am\"). First: the home "
        "address id and coordinates from the merchant's saved addresses (never invent an id), the user's "
        "drive time home from where they are now, the merchant's delivery time, and the cart built. Then "
        "pass drive_minutes and delivery_minutes (the tool works out when to review) and the order tool's "
        "own arguments, e.g. {userAddressId} — not the cart. This creates a reminder only, never a purchase "
        "or advance authorization. At that time, tell the user to request the order; rebuild/check the cart "
        "and show a fresh approval card before placing anything. Skill deliver-when-home has the routine. "
        "Returns {scheduled, review_at, total, items, purchase_authorized: false}."
    ),
    "parameters": {
        "type": "object",
        "properties": {
            "server": {"type": "string", "description": "The merchant's MCP server, e.g. zepto."},
            "tool": {"type": "string", "description": "Its order tool, e.g. create_order (cash on delivery)."},
            "arguments": {"type": "object", "description": "The order tool's own arguments, e.g. {userAddressId}."},
            "drive_minutes": {"type": "number", "description": "Minutes until the user is home."},
            "delivery_minutes": {"type": "number", "description": "The merchant's delivery time in minutes."},
            "place_in_minutes": {"type": "integer",
                                 "description": "Only without drive_minutes: minutes from now until the review reminder."},
        },
        "required": ["server", "tool"],
    },
}


registry.register(
    name="schedule_order",
    toolset="cronjob",
    schema=SCHEDULE_ORDER_SCHEMA,
    handler=lambda args, **kw: schedule_order(
        args.get("server", ""), args.get("tool", ""), args.get("arguments"), args.get("place_in_minutes"),
        args.get("drive_minutes"), args.get("delivery_minutes")),
    check_fn=check_schedule_order_requirements,
    emoji="🛒",
)
