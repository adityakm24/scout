"""The order card: a call that spends the user's money stops until they approve that exact order.

Catalog manifests name these tools (``spending:`` in optional-mcps/<name>/manifest.yaml — Zepto's
``create_*`` with ``confirmOrder: true``, Swiggy's ``checkout`` / ``place_food_order`` /
``book_table``). Before such a call reaches the server, the basket is read with the manifest's
read-only preview tool and shown to the user as an order card; only their "Approve & Pay" lets
the call through. Skills telling the model to confirm first were not enough: a small model sent
email the same way, unasked. The smart guardian never decides this, nothing is remembered between
orders, and an unattended run (cron, ``-q``) cannot place one, except an order the user approved
earlier for that moment (``mcp_tool_spending_holds``) whose basket is still the one they saw.
"""

from __future__ import annotations

import functools
import json
import logging
import re
from types import SimpleNamespace
from typing import Any, List, Optional

from tools.mcp_tool_common import _core
from tools.registry import tool_error

logger = logging.getLogger(__name__)

_NAME_KEYS = ("name", "title", "displayName", "productName", "itemName", "label")
_QTY_KEYS = ("quantity", "qty", "count")
_PRICE_KEYS = ("price", "finalPrice", "sellingPrice", "amount", "total", "itemTotal")
_TOTAL_KEYS = ("toPay", "grandTotal", "totalAmount", "total", "billTotal", "payable", "amount")
_ITEM_LIST_KEYS = ("items", "cartItems", "products", "lineItems")
# Vendor notes in tool text ("[Widget hint: ...]", "[System instruction: ...]") are for the model.
_BRACKET_NOTE = re.compile(r"^\s*\[[^\]]*\]\s*$")


@functools.lru_cache(maxsize=1)
def _catalog_spending() -> tuple:
    """``(by_name, by_url)`` catalog entries that declare spending tools. The catalog ships with the
    code, so one read per process."""
    from scout_backend.mcp_catalog import list_catalog

    by_name, by_url = {}, {}
    for entry in list_catalog():
        if entry.spending is None:
            continue
        by_name[entry.name] = entry
        if entry.transport.url:
            by_url[entry.transport.url.rstrip("/")] = entry
    return by_name, by_url


def _server_config(server_name: str) -> dict:
    from tools.mcp_tool_scope import _resolve_server_key

    key = _resolve_server_key(server_name)
    return getattr(_core._servers.get(key), "_config", None) or _core._lazy_server_configs.get(key) or {}


def spending_entry(server_name: str):
    """What governs *server_name*'s spending: its own ``mcp_servers.<name>.spending`` block, else the
    catalog entry of that name, else the catalog entry for the URL it connects to (a catalog server
    installed under another name is still that merchant)."""
    config = _server_config(server_name)
    if config.get("spending") is not None:
        from scout_backend.mcp_catalog import CatalogError, parse_spending

        try:
            spec = parse_spending(f"mcp_servers.{server_name}", config["spending"])
        except CatalogError as exc:
            logger.error("Order card: ignoring malformed spending block: %s", exc)
        else:
            return SimpleNamespace(name=server_name, description=server_name, spending=spec)
    by_name, by_url = _catalog_spending()
    return by_name.get(server_name) or by_url.get(str(config.get("url") or "").rstrip("/"))


def _is_zepto(server_name: str) -> bool:
    """True for the Zepto connector, including a catalog install under another config name."""
    if server_name == "zepto":
        return True
    entry = spending_entry(server_name)
    if entry is not None and getattr(entry, "name", "") == "zepto":
        return True
    return "mcp.zepto.co.in" in str((_server_config(server_name) or {}).get("url") or "")


def annotate_merchant_error(server_name: str, error: str) -> str:
    """Keep Zepto's error and name the call that actually unblocks an order.

    Zepto's own ``Store not selected`` text points at ``get_location_serviceability``, which
    a phone GPS reading will satisfy — and then the cart is for wherever the user is standing,
    not the saved address they named. The next step is always ``select_saved_address``.
    """
    if not error or not _is_zepto(server_name):
        return error
    from tools.mcp_tool_schema import mcp_prefixed_tool_name as _mcp

    listed = _mcp(server_name, "list_saved_addresses")
    select = _mcp(server_name, "select_saved_address")
    low = error.lower()
    if "store not selected" in low:
        hint = (
            f"Call `{listed}`, then `{select}` with the address the user named — that picks the "
            "store. Do not call get_location_serviceability with device_location GPS unless the "
            "user typed those coordinates."
        )
    elif "no delivery address" in low:
        hint = (
            f"Call `{select}` with that addressId before create_order. Passing userAddressId on "
            "create_order is not enough if the cart was built for another store."
        )
    elif "not deliverable" in low:
        hint = (
            f"The cart is for a different store than the delivery address. Call `{select}` for "
            "the address the user named, then update_cart with the same items at that store, "
            "then create_order. Do not retry create_order until view_cart shows those items."
        )
    else:
        return error
    if hint.lower() in low:
        return error
    return f"{error} {hint}"


def _merchant(entry) -> str:
    return entry.spending.merchant or entry.description.split(":", 1)[0].strip() or entry.name


def _first(mapping: dict, keys) -> Any:
    return next((mapping[k] for k in keys if mapping.get(k) not in (None, "")), None)


def _money(value: Any, unit: str) -> Optional[float]:
    if isinstance(value, dict):
        value = _first(value, ("value", "amount", "units"))
    if isinstance(value, str):
        value = re.sub(r"[^\d.]", "", value) or None
    try:
        amount = float(value)
    except (TypeError, ValueError):
        return None
    return amount / 100 if unit == "paise" else amount


def _items(structured: Any, unit: str) -> List[dict]:
    """Line items from a preview's structured content: the first list of dicts under a known key,
    searched one level down too (``{"cart": {"items": [...]}}``)."""
    if not isinstance(structured, dict):
        return []
    lists = [structured.get(k) for k in _ITEM_LIST_KEYS]
    lists += [v.get(k) for v in structured.values() if isinstance(v, dict) for k in _ITEM_LIST_KEYS]
    raw = next((lst for lst in lists if isinstance(lst, list) and lst and isinstance(lst[0], dict)), [])
    items = []
    for row in raw:
        name = _first(row, _NAME_KEYS)
        if not name:
            continue
        quantity = _first(row, _QTY_KEYS)
        items.append({"name": str(name), "quantity": int(quantity) if isinstance(quantity, (int, float)) else 1,
                      "price": _money(_first(row, _PRICE_KEYS), unit)})
    return items


def _total(structured: Any, items: List[dict], unit: str) -> tuple:
    """``(amount, is_estimate)``: the preview's own payable total when it has one, else the item sum."""
    if isinstance(structured, dict):
        for scope in (structured, *(v for v in structured.values() if isinstance(v, dict))):
            if (amount := _money(_first(scope, _TOTAL_KEYS), unit)) is not None and not isinstance(
                    _first(scope, _TOTAL_KEYS), list):
                return amount, False
    priced = [i["price"] * i["quantity"] for i in items if i["price"] is not None]
    return (round(sum(priced), 2), True) if priced and len(priced) == len(items) else (None, True)


def _humanize(key: str) -> str:
    words = re.sub(r"(?<=[a-z])(?=[A-Z])|_", " ", key).strip()
    return words[:1].upper() + words[1:].lower()


def _details(entry, tool_name: str, args: dict) -> List[dict]:
    """What the call itself says about the order, minus ids and the commit flag."""
    spec = entry.spending
    rows = [{"label": "Payment", "value": spec.tools[tool_name]}] if spec.tools.get(tool_name) else []
    for key, value in (args or {}).items():
        # Unset, zero and "no" say nothing about this order: a 0 rider tip is noise on the card.
        if key == spec.commit_flag or re.search(r"(?:^id|Id|_id|ID)$", key) or value in (None, "", [], {}, 0, False):
            continue
        if isinstance(value, (dict, list)):
            continue  # structured data reads as JSON on the card; the basket above already shows it
        if isinstance(value, bool):
            value = "Yes" if value else "No"
        rows.append({"label": _humanize(key), "value": str(value)})
    return rows


def _preview(entry, server_name: str, tool_timeout: float) -> tuple:
    """``(structured, text)`` from the manifest's read-only preview tool; ``(None, "")`` without one
    or when it fails (the card then says the basket could not be loaded)."""
    if not entry.spending.preview:
        return None, ""
    from tools.mcp_tool_handlers import _make_tool_handler

    try:
        raw = json.loads(_make_tool_handler(server_name, entry.spending.preview, tool_timeout)({}))
    except Exception as exc:  # a broken preview must not hide the order card; it shows "not loaded"
        logger.warning("Order card: preview %s/%s failed: %s", server_name, entry.spending.preview, exc)
        return None, ""
    if raw.get("error"):
        return None, ""
    text = raw.get("result") if isinstance(raw.get("result"), str) else ""
    structured = raw.get("structuredContent")
    if structured is None and text.lstrip().startswith("{"):
        try:  # servers without structured output return the same object as JSON text
            structured = json.loads(text)
        except ValueError:
            pass
    text = "\n".join(line for line in text.splitlines() if not _BRACKET_NOTE.match(line)).strip()
    return structured, text[:1500]


def order_summary(entry, server_name: str, tool_name: str, args: dict, tool_timeout: float) -> dict:
    """The order card's content: merchant, line items, total, payment and call details."""
    spec = entry.spending
    structured, text = _preview(entry, server_name, tool_timeout)
    items = _items(structured, spec.price_unit)
    total, estimate = _total(structured, items, spec.price_unit)
    return {
        "merchant": _merchant(entry), "server": server_name, "tool": tool_name, "label": spec.label,
        "items": items, "total": total, "total_is_estimate": estimate, "currency": "INR",
        "details": _details(entry, tool_name, args),
        # Only when the basket could not be itemised: the preview as the vendor wrote it.
        "preview_text": "" if items else text,
        "preview_loaded": bool(items or text) or not spec.preview,
    }


def _summary_text(summary: dict) -> str:
    """Plain rendering for surfaces without the card (CLI / TUI prompt, messaging approvals)."""
    lines = [f"{summary['merchant']}: {summary['label']}?"]
    for item in summary["items"]:
        price = f" — ₹{item['price']:g}" if item["price"] is not None else ""
        lines.append(f"  {item['quantity']} × {item['name']}{price}")
    if summary["total"] is not None:
        lines.append(f"  Total{' (items)' if summary['total_is_estimate'] else ''}: ₹{summary['total']:g}")
    lines += [f"  {row['label']}: {row['value']}" for row in summary["details"]]
    if summary["preview_text"]:
        lines.append(summary["preview_text"])
    return "\n".join(lines)


def spending_gate_check(server_name: str, tool_name: str, args: dict, tool_timeout: float) -> Optional[str]:
    """None to let the call through, else the tool error the model sees."""
    entry = spending_entry(server_name)
    if entry is None or tool_name not in entry.spending.tools:
        return None
    flag = entry.spending.commit_flag
    if flag and (args or {}).get(flag) is not True:
        return None  # the vendor's own preview: nothing is ordered
    merchant = _merchant(entry)

    from tools.approval import _unattended_contexts

    if _unattended_contexts():
        # Legacy holds from an older schedule_order flow remain valid only for the exact approved basket.
        from tools.mcp_tool_spending_holds import claim_hold

        hold, refused = claim_hold(server_name, tool_name, args,
                                   order_summary(entry, server_name, tool_name, args, tool_timeout))
        if hold is not None:
            logger.info("Order card: placing %s/%s on hold %s", server_name, tool_name, hold["id"])
            return None
        if refused:
            logger.info("Order card: hold for %s/%s no longer covers the order: %s", server_name, tool_name, refused)
            return tool_error(
                f"BLOCKED: the user approved this {merchant} order earlier, but {refused}. Nothing was ordered "
                f"or charged. Tell the user, and do not retry.")
        logger.info("Order card: refused %s/%s in an unattended run", server_name, tool_name)
        return tool_error(
            f"BLOCKED: placing a {merchant} order needs the user to approve it, and nobody is present in "
            f"this run to do that. Nothing was ordered or charged. Tell the user what is ready to order instead.")

    summary = order_summary(entry, server_name, tool_name, args, tool_timeout)
    try:
        from tools.approval_prompt import request_elicitation_consent

        answer = request_elicitation_consent(
            _summary_text(summary), f"{merchant} will place this order on the user's account.",
            surface=f"mcp-order/{server_name}", title=f"{merchant}: {summary['label']}?",
            payload_extra={"order": summary, "choices": ["once", "deny"]})
    except Exception as exc:
        logger.error("Order card: approval failed for %s/%s: %s", server_name, tool_name, exc, exc_info=True)
        answer = "decline"
    if answer == "accept":
        logger.info("Order card: user approved %s/%s", server_name, tool_name)
        return None
    logger.info("Order card: %s/%s not approved (%s)", server_name, tool_name, answer)
    return tool_error(
        f"The user did not approve this {merchant} order. Nothing was ordered or charged. Do not retry it "
        f"unless the user asks again; you may ask whether they want to change the basket.")
