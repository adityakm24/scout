import json
import pytest
from tools.commute_eta_sync_tool import (
    start_commute_eta_sync,
    cancel_commute_eta_sync,
    get_commute_eta_sync_status,
    _storage_path,
)

def test_commute_eta_sync_lifecycle(tmp_path, monkeypatch):
    test_storage = tmp_path / "active_sync.json"
    monkeypatch.setattr("tools.commute_eta_sync_tool._storage_path", lambda: test_storage)

    # 1. Idle status
    idle = json.loads(get_commute_eta_sync_status())
    assert idle["active"] is False

    # 2. Start sync
    payload = {
        "merchant_provider": "Zepto",
        "action": "execute_auto_checkout",
        "cart_id": "cart_123",
        "delivery_address_id": "addr_home",
    }
    res_str = start_commute_eta_sync(
        destination_lat=12.9716,
        destination_lng=77.5946,
        target_eta_minutes=20,
        transport_mode="driving",
        action_payload=payload,
    )
    res = json.loads(res_str)
    assert res["success"] is True
    assert res["status"] == "tracking"
    assert res["details"]["destination"]["lat"] == 12.9716
    assert res["details"]["target_eta_minutes"] == 20

    # 3. Active status
    status = json.loads(get_commute_eta_sync_status())
    assert status["active"] is True
    assert status["action_payload"]["cart_id"] == "cart_123"

    # 4. Cancel sync
    cancel_res = json.loads(cancel_commute_eta_sync())
    assert cancel_res["success"] is True
    assert cancel_res["status"] == "cancelled"

    # 5. Idle again
    idle2 = json.loads(get_commute_eta_sync_tool_status := get_commute_eta_sync_status())
    assert idle2["active"] is False


def test_resolve_saved_location_avoids_false_matches(monkeypatch):
    from tools.commute_eta_sync_tool import resolve_saved_location

    fake_locs = {
        "home": {
            "name": "Home",
            "latitude": 12.9948,
            "longitude": 77.6168,
            "address": "Fraser Town, Bengaluru",
        },
        "work": {
            "name": "Work",
            "latitude": 12.9738,
            "longitude": 77.6019,
            "address": "Saint Mark's Road, Bangalore",
        },
    }
    monkeypatch.setattr("tools.commute_eta_sync_tool.get_saved_locations", lambda: fake_locs)

    # Specific destinations should NOT match 'work' or 'home'
    assert resolve_saved_location("work at NetApp hoodi") is None
    assert resolve_saved_location("NetApp hoodi") is None
    assert resolve_saved_location("Starbucks Indiranagar") is None

    # Standalone intent should match
    res_work = resolve_saved_location("work")
    assert res_work is not None
    assert res_work["name"] == "Work"

    res_office = resolve_saved_location("office")
    assert res_office is not None
    assert res_office["name"] == "Work"

    res_home = resolve_saved_location("home")
    assert res_home is not None
    assert res_home["name"] == "Home"


