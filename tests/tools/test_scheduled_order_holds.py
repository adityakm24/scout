"""An order the user approved for later goes through unattended only as approved, and only once.

The spending gate refuses every purchase in an unattended run (cron); a schedule_order hold is the
one exception, and only while the basket and total are still what the user saw on the card.
"""

import json
import time
from types import SimpleNamespace

import pytest

from tools import mcp_tool_spending as spending
from tools import mcp_tool_spending_holds as holds

ENTRY = SimpleNamespace(
    name="zepto", description="Zepto: groceries",
    spending=SimpleNamespace(tools={"create_order": "Cash on delivery"}, commit_flag="confirmOrder",
                             preview="view_cart", price_unit="paise", label="Approve & Pay", merchant="Zepto"))
ARGS = {"userAddressId": "addr_home", "confirmOrder": True}
BASKET = {"items": [{"name": "Lay's Magic Masala", "quantity": 2, "price": 20.0},
                    {"name": "Red Bull 250ml", "quantity": 1, "price": 125.0}], "total": 165.0}


@pytest.fixture
def unattended(monkeypatch):
    """A cron run whose live basket is whatever the test sets in ``live``."""
    live = {"summary": dict(BASKET)}
    monkeypatch.setattr(spending, "spending_entry", lambda name: ENTRY)
    monkeypatch.setattr(spending, "order_summary", lambda *a, **k: live["summary"])
    monkeypatch.setattr("tools.approval._unattended_contexts", lambda: ["cron"])
    return live


def _gate(args=ARGS):
    return spending.spending_gate_check("zepto", "create_order", args, 5.0)


def _hold(minutes_from_now=0):
    return holds.create_hold("zepto", "create_order", ARGS, BASKET, time.time() + minutes_from_now * 60)


def test_unattended_order_needs_a_hold(unattended):
    assert "BLOCKED" in json.loads(_gate())["error"]


def test_a_hold_places_the_approved_order_once(unattended):
    _hold()
    assert _gate() is None
    # Spent: the same order again (a retry, a second job run) is refused.
    assert "BLOCKED" in json.loads(_gate())["error"]


def test_extra_falsy_arguments_do_not_change_the_order(unattended):
    _hold()
    assert _gate({**ARGS, "riderTip": 0}) is None


@pytest.mark.parametrize("change, reason", [
    ({"items": [{"name": "Lay's Magic Masala", "quantity": 3, "price": 20.0}], "total": 60.0}, "basket changed"),
    ({**BASKET, "total": 190.0}, "above"),
])
def test_a_changed_basket_or_higher_total_is_refused(unattended, change, reason):
    _hold()
    unattended["summary"] = change
    error = json.loads(_gate())["error"]
    assert "BLOCKED" in error and reason in error


def test_an_expired_hold_is_refused(unattended):
    _hold(minutes_from_now=-(holds.HOLD_GRACE_MINUTES + 1))
    assert "expired" in json.loads(_gate())["error"]


def test_a_hold_for_other_arguments_does_not_cover_this_call(unattended):
    _hold()
    assert "BLOCKED" in json.loads(_gate({**ARGS, "userAddressId": "addr_office"}))["error"]


@pytest.fixture
def scheduling(monkeypatch):
    """schedule_order in a chat, against a merchant whose order tool declares only userAddressId and
    confirmOrder, and which rejects an address it does not know."""
    asked, created = [], []
    monkeypatch.setattr(spending, "spending_entry", lambda name: ENTRY)
    card = {**BASKET, "merchant": "Zepto", "label": "Approve & Pay", "total_is_estimate": False,
            "details": [], "preview_text": ""}
    monkeypatch.setattr(spending, "order_summary", lambda *a, **k: dict(card))
    monkeypatch.setattr("tools.approval._unattended_contexts", lambda: [])
    monkeypatch.setattr(holds.registry, "get_schema", lambda name: {"parameters": {"properties": {
        "userAddressId": {}, "confirmOrder": {}, "riderTip": {}}}})

    def vendor(server, tool, timeout):
        def call(args):
            ok = args.get("userAddressId") == "addr_home" and "cartItems" not in args
            return json.dumps({"result": "Bill preview"} if ok else {"error": "Invalid userAddressId"})
        return call

    monkeypatch.setattr("tools.mcp_tool_handlers._make_tool_handler", vendor)
    monkeypatch.setattr("tools.approval_prompt.request_elicitation_consent",
                        lambda *a, **k: asked.append(k) or "accept")
    monkeypatch.setattr("tools.cronjob_tools.cronjob",
                        lambda **k: created.append(k) or json.dumps({"job": {"job_id": "job1"}}))
    return asked, created


def test_an_invented_address_is_refused_before_the_user_is_asked(scheduling):
    asked, created = scheduling
    error = json.loads(holds.schedule_order("zepto", "create_order", {"userAddressId": "frazer_town_home"},
                                            drive_minutes=40, delivery_minutes=11))["error"]
    assert "would not accept" in error and not asked and not created


def test_the_tool_times_the_order_and_drops_arguments_the_merchant_does_not_take(scheduling):
    asked, created = scheduling
    result = json.loads(holds.schedule_order(
        "zepto", "create_order", {"userAddressId": "addr_home", "cartItems": [{"productVariantId": "v1"}]},
        drive_minutes=40, delivery_minutes=11))
    assert result["in_minutes"] == 40 - 11 - holds.ARRIVAL_MARGIN_MINUTES
    assert json.loads(holds._load()[-1]["args"]) == {"confirmOrder": True, "userAddressId": "addr_home"}
    assert "cartItems" not in created[0]["prompt"]
