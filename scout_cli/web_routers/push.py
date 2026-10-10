"""A paired phone registers for notifications and reports whether its Scout app is on screen
(scout_cli/push/). The phone sends these from its native shell (mobile/src/push.ts), with the same
session token as its page."""

from __future__ import annotations

from typing import Optional

from fastapi import APIRouter, HTTPException

from scout_cli.push import devices
from scout_cli.web_models import PushDevice, PushLiveActivity, PushPresence
from scout_cli.web_routers._common import config_scoped_to_thread
from scout_constants import get_scout_home

router = APIRouter()


def _known(device):
    if device is None:
        raise HTTPException(status_code=404, detail="This phone is not registered; register it first.")
    # The phone stops doubling the server's notifications with its own once they get through.
    return {"ok": True, "delivers": devices.delivers(device)}


@router.post("/api/push/devices")
async def push_register(body: PushDevice, profile: Optional[str] = None):
    def _register():
        return _known(devices.register(get_scout_home(), body.device_id, platform=body.platform, name=body.name,
                                       expo_token=body.expo_token, push_to_start_token=body.push_to_start_token))

    return await config_scoped_to_thread(profile, _register)


@router.delete("/api/push/devices/{device_id}")
async def push_forget(device_id: str, profile: Optional[str] = None):
    return await config_scoped_to_thread(profile, lambda: {"ok": devices.forget(get_scout_home(), device_id)})


@router.post("/api/push/devices/{device_id}/presence")
async def push_presence(device_id: str, body: PushPresence, profile: Optional[str] = None):
    def _presence():
        home = get_scout_home()
        device = devices.set_presence(home, device_id, body.foreground)
        if device is not None and body.watching:
            devices.watch(home, device_id, body.watching)
        return _known(device)

    return await config_scoped_to_thread(profile, _presence)


@router.post("/api/push/devices/{device_id}/live-activity")
async def push_live_activity(device_id: str, body: PushLiveActivity, profile: Optional[str] = None):
    return await config_scoped_to_thread(
        profile, lambda: _known(devices.set_activity_token(get_scout_home(), device_id, body.session_id, body.token)))
