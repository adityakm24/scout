"""Phone commute updates stay bound to the profile that started tracking."""

import asyncio

from scout_backend.web_routers import commute


def test_location_update_runs_inside_requested_profile(monkeypatch):
    seen = {}

    async def scoped(profile, fn):
        seen["profile"] = profile
        return fn()

    def update(sync_id, latitude, longitude):
        seen["update"] = (sync_id, latitude, longitude)
        return {"ok": True}

    monkeypatch.setattr(commute, "config_scoped_to_thread", scoped)
    monkeypatch.setattr("tools.commute_eta_sync_tool.update_commute_from_background_location", update)

    result = asyncio.run(commute.commute_location_update(
        commute.CommuteLocationUpdate(sync_id="sync-one", latitude=12.9, longitude=77.6),
        profile="work",
    ))

    assert result == {"ok": True}
    assert seen == {"profile": "work", "update": ("sync-one", 12.9, 77.6)}


def test_status_lookup_runs_inside_requested_profile(monkeypatch):
    active = {
        "sync_id": "sync-one",
        "status": "tracking",
        "destination": {"name": "Home"},
        "last_user_eta_minutes": 20,
        "last_checked_at": 1,
        "tracking_card_markdown": "```svg\n<svg></svg>\n```",
        "tracking_summary": "Commute status",
        "arrival_reminders": [],
    }
    seen = {}

    async def scoped(profile, fn):
        seen["profile"] = profile
        return fn()

    monkeypatch.setattr(commute, "config_scoped_to_thread", scoped)
    monkeypatch.setattr("tools.commute_eta_sync_tool._read_active_sync", lambda: active)

    result = asyncio.run(commute.commute_tracking("sync-one", profile="work"))

    assert seen["profile"] == "work"
    assert result["active"] is True
    assert result["tracking_summary"] == "Commute status"
