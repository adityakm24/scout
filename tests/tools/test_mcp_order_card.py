"""A call that spends the user's money waits for them to approve that exact order.

The Zepto/Swiggy skills said "confirm before ordering", but nothing enforced it; a small model
already sent email unasked the same way. Spending tools (catalog ``spending:`` blocks, or one on
the server's own config) now stop at an order card built from the merchant's read-only basket.
"""
import json

import pytest

from tools import mcp_tool_handlers, mcp_tool_spending
from tools.mcp_tool_common import _core
from tools.mcp_tool_scope import _resolve_server_key

SHOP = {
    "url": "http://127.0.0.1:9/mcp",
    "spending": {"tools": {"create_order": "Cash on delivery"}, "commit_flag": "confirmOrder",
                 "preview": "view_cart", "price_unit": "paise", "merchant": "Test Shop"},
}
CART = {"items": [{"name": "Chips", "quantity": 2, "price": 2100}, {"name": "Milk", "quantity": 1, "price": 3000}]}
CART_REPLY = {"value": {"result": "cart", "structuredContent": CART}}


@pytest.fixture
def shop(monkeypatch):
    key = _resolve_server_key("shop")
    monkeypatch.setitem(_core._lazy_server_configs, key, SHOP)
    ran, asked = [], []

    real_make = mcp_tool_handlers._make_tool_handler

    def make(server_name, tool_name, timeout):
        if server_name != "shop":
            return real_make(server_name, tool_name, timeout)
        if tool_name == "view_cart":
            return lambda args, **_: json.dumps(CART_REPLY["value"])
        return real_make(server_name, tool_name, timeout)

    monkeypatch.setattr(mcp_tool_handlers, "_make_tool_handler", make)
    # The vendor server itself: reaching it means the order went through.
    monkeypatch.setattr(mcp_tool_handlers, "_acquire_call_server",
                        lambda name, timeout: (ran.append(name), (None, "reached the server"))[1])
    answer = {"value": "decline"}

    def consent(message, description, **kw):
        asked.append(kw.get("payload_extra"))
        return answer["value"]

    monkeypatch.setattr("tools.approval_prompt.request_elicitation_consent", consent)
    monkeypatch.setattr("tools.approval._unattended_contexts", lambda: [])
    return ran, asked, answer


def _place(args):
    return mcp_tool_handlers._make_tool_handler("shop", "create_order", 5)(args)


@pytest.mark.parametrize("reply", [
    {"result": "cart", "structuredContent": CART},
    {"result": json.dumps(CART)},  # a server without structured output sends the object as text
], ids=["structured", "json-text"])
def test_an_order_is_shown_and_only_placed_on_approval(shop, reply, monkeypatch):
    ran, asked, answer = shop
    monkeypatch.setitem(CART_REPLY, "value", reply)

    declined = _place({"confirmOrder": True, "riderTip": 10, "useCash": False, "userAddressId": "a1"})
    assert "did not approve" in declined and ran == []

    order = asked[0]["order"]
    assert [(i["name"], i["quantity"], i["price"]) for i in order["items"]] == [("Chips", 2, 21.0), ("Milk", 1, 30.0)]
    assert order["total"] == 72.0 and order["merchant"] == "Test Shop"
    assert {"label": "Payment", "value": "Cash on delivery"} in order["details"]
    assert [row["label"] for row in order["details"]] == ["Payment", "Rider tip"]  # no ids, flag or "No"
    assert asked[0]["choices"] == ["once", "deny"]

    answer["value"] = "accept"
    _place({"confirmOrder": True, "userAddressId": "a1"})
    assert ran == ["shop"]


@pytest.mark.parametrize("tool, args", [
    ("create_order", {"confirmOrder": False}),  # the merchant's own bill preview
    ("create_order", {}),
    ("search_products", {"query": "milk"}),
])
def test_previews_and_reads_never_ask(shop, tool, args):
    ran, asked, _ = shop
    mcp_tool_handlers._make_tool_handler("shop", tool, 5)(args)
    assert asked == [] and ran == ["shop"]


def test_an_unattended_run_cannot_order(shop, monkeypatch):
    ran, asked, _ = shop
    monkeypatch.setattr("tools.approval._unattended_contexts", lambda: ["cron"])
    assert "nobody is present" in _place({"confirmOrder": True}) and asked == [] and ran == []


def test_catalog_previews_are_never_themselves_spending_tools():
    """The card reads the basket with the preview tool; if that tool could spend, showing the card
    would place the order."""
    from scout_backend.mcp_catalog import list_catalog

    gated = [e for e in list_catalog() if e.spending]
    assert gated
    for entry in gated:
        assert entry.spending.preview not in entry.spending.tools, entry.name
