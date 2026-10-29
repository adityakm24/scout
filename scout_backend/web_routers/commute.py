"""Profile-scoped phone location updates for active commute tracking."""

from typing import Optional

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field

from scout_backend.web_routers._common import config_scoped_to_thread

router = APIRouter()


class CommuteLocationUpdate(BaseModel):
    sync_id: str = Field(min_length=1, max_length=80)
    latitude: float = Field(ge=-90, le=90)
    longitude: float = Field(ge=-180, le=180)


def _active_tracking(sync_id: str):
    from tools.commute_eta_sync_tool import _read_active_sync

    active = _read_active_sync()
    if not active or active.get("sync_id") != sync_id:
        raise HTTPException(status_code=404, detail="This commute tracking session is no longer active.")
    return {
        "active": active.get("status") == "tracking",
        "sync_id": sync_id,
        "status": active.get("status"),
        "destination": active.get("destination"),
        "last_user_eta_minutes": active.get("last_user_eta_minutes"),
        "last_checked_at": active.get("last_checked_at"),
        "tracking_card_markdown": active.get("tracking_card_markdown"),
        "tracking_summary": active.get("tracking_summary"),
        "arrival_reminders": [
            {
                "id": item.get("id"),
                "minutes_before": item.get("minutes_before"),
                "reminder_text": item.get("reminder_text"),
            }
            for item in active.get("arrival_reminders", [])
        ],
    }


@router.get("/api/commute/tracking/{sync_id}")
async def commute_tracking(sync_id: str, profile: Optional[str] = None):
    return await config_scoped_to_thread(profile, lambda: _active_tracking(sync_id))


@router.post("/api/commute/location")
async def commute_location_update(body: CommuteLocationUpdate, profile: Optional[str] = None):
    from tools.commute_eta_sync_tool import update_commute_from_background_location

    try:
        return await config_scoped_to_thread(
            profile,
            lambda: update_commute_from_background_location(
                body.sync_id, body.latitude, body.longitude
            ),
        )
    except ValueError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except RuntimeError as exc:
        raise HTTPException(status_code=503, detail=str(exc)) from exc
