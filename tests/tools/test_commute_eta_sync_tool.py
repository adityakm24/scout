import json
import pytest
from tools.commute_eta_sync_tool import (
    start_commute_eta_sync,
    cancel_commute_eta_sync,
    get_commute_eta_sync_status,
    set_commute_arrival_reminder,
    update_commute_from_background_location,
    _storage_path,
    _tracking_fields,
    _normalize_legacy_tracking,
    _write_active_sync,
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


def test_tracking_fields_keep_svg_out_of_summary():
    fields = _tracking_fields(
        "Harmony Little Nest",
        25,
        15,
        10,
        5.2,
        has_target_eta=True,
        origin_address="Sindhi Colony, Bengaluru",
    )
    assert fields["tracking_card_markdown"].startswith("```svg")
    assert "```svg" not in fields["tracking_summary"]
    assert "Sindhi Colony" in fields["tracking_summary"]
    assert fields["order_timing_advice"] == fields["tracking_summary"]


def test_normalize_legacy_tracking_splits_combined_field():
    legacy = {
        "order_timing_advice": "```svg\n<svg></svg>\n```\n\n🟢 **Commute Tracking Active**\n• **Destination:** Home",
    }
    _normalize_legacy_tracking(legacy)
    assert legacy["tracking_card_markdown"].startswith("```svg")
    assert "Destination" in legacy["tracking_summary"]
    assert "```svg" not in legacy["order_timing_advice"]


def test_start_sync_stores_split_tracking_fields(tmp_path, monkeypatch):
    test_storage = tmp_path / "active_sync.json"
    monkeypatch.setattr("tools.commute_eta_sync_tool._storage_path", lambda: test_storage)

    res = json.loads(
        start_commute_eta_sync(
            destination_lat=12.9716,
            destination_lng=77.5946,
            target_eta_minutes=20,
            action_payload={"merchant_provider": "Zepto"},
        )
    )
    assert res["tracking_card_markdown"].startswith("```svg")
    assert "```svg" not in res["tracking_summary"]
    assert res["details"]["tracking_summary"] == res["tracking_summary"]


def test_background_location_triggers_each_arrival_threshold_once(tmp_path, monkeypatch):
    test_storage = tmp_path / "active_sync.json"
    monkeypatch.setattr("tools.commute_eta_sync_tool._storage_path", lambda: test_storage)
    monkeypatch.setattr("tools.cronjob_job_args._origin_from_env", lambda *_args, **_kwargs: None)
    active = {
        "sync_id": "sync-test",
        "status": "tracking",
        "created_at": 1,
        "last_checked_at": 1,
        "last_user_eta_minutes": 40,
        "destination": {"name": "Home", "lat": 12.9, "lng": 77.6},
        "target_eta_minutes": None,
        "arrival_reminders": [],
    }
    _write_active_sync(active)
    assert json.loads(set_commute_arrival_reminder(15, "Call before arriving"))["success"]
    assert json.loads(set_commute_arrival_reminder(5, "Get ready to park"))["success"]

    route_etas = iter([12, 4, 2])

    def fake_location_tool(*, to_latitude, to_longitude, callback):
        assert json.loads(callback()) == {"latitude": 12.8, "longitude": 77.5}
        assert (to_latitude, to_longitude) == (12.9, 77.6)
        eta = next(route_etas)
        return json.dumps({
            "address": "Current location",
            "device": "iPhone",
            "drive": {"drive_minutes_estimate": eta, "road_km_estimate": 3.2},
        })

    monkeypatch.setattr("tools.device_location_tool.device_location_tool", fake_location_tool)
    delivered = []
    monkeypatch.setattr(
        "planner.reminders.add_reminder",
        lambda text, when, **kwargs: delivered.append((text, when, kwargs))
        or {"reminder": {"id": f"job-{len(delivered)}"}},
    )

    first = update_commute_from_background_location("sync-test", 12.8, 77.5)
    second = update_commute_from_background_location("sync-test", 12.8, 77.5)
    third = update_commute_from_background_location("sync-test", 12.8, 77.5)

    assert [item[0] for item in delivered] == ["Call before arriving", "Get ready to park"]
    assert all(item[1] == "in 1m" and item[2]["deliver"] == "bot-chat" for item in delivered)
    assert len(first["triggered_reminders"]) == 1
    assert len(second["triggered_reminders"]) == 1
    assert third["triggered_reminders"] == []
