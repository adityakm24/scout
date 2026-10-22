"""Zepto's Store-not-selected error names GPS; Scout must name select_saved_address instead.

A phone session that followed the vendor text used device_location, built a cart for wherever
the user was standing, then failed create_order with 'Cart is not deliverable'.
"""

from __future__ import annotations

import json
from types import SimpleNamespace

from tools import mcp_tool_handlers, mcp_tool_spending


def _err(text: str, server: str = "zepto") -> str:
    result = SimpleNamespace(
        isError=True,
        content=[SimpleNamespace(text=text, resource=None)],
        structuredContent=None,
    )
    return json.loads(mcp_tool_handlers._render_call_tool_result(result, server))["error"]


def test_store_not_selected_names_saved_address_tools():
    out = _err("Error: Store not selected. Please use get_location_serviceability or select_store first.")
    assert "Store not selected" in out
    assert "mcp__zepto__list_saved_addresses" in out
    assert "mcp__zepto__select_saved_address" in out
    assert "device_location" in out


def test_missing_address_and_undeliverable_cart_name_the_next_call():
    missing = _err(
        "Error: No delivery address set. Please call list_saved_addresses and select_saved_address first, "
        "or provide a userAddressId."
    )
    assert "mcp__zepto__select_saved_address" in missing
    assert "userAddressId on create_order is not enough" in missing

    blocked = _err("Error: Cart is not deliverable: Unknown reason")
    assert "different store" in blocked
    assert "update_cart" in blocked
    assert "Do not retry create_order" in blocked


def test_other_servers_keep_the_vendor_text():
    vendor = "Error: Store not selected. Please use get_location_serviceability or select_store first."
    assert mcp_tool_spending.annotate_merchant_error("shop", vendor) == vendor
    assert "select_saved_address" not in _err(vendor, server="shop")


def test_hint_is_not_appended_twice():
    once = mcp_tool_spending.annotate_merchant_error(
        "zepto", "Error: Cart is not deliverable: Unknown reason"
    )
    assert mcp_tool_spending.annotate_merchant_error("zepto", once) == once
