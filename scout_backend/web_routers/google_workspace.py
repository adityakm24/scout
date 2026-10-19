"""Google Workspace account card: one OAuth sign-in that powers the google-workspace skill
(Gmail, Calendar, Drive, Docs, Sheets, Contacts). Logic lives in ``scout_backend.google_workspace_auth``."""

from __future__ import annotations

from typing import Optional

from fastapi import APIRouter, HTTPException

from scout_backend import google_workspace_auth as gws
from scout_backend.web_models import GoogleWorkspaceCallback, GoogleWorkspaceClient, GoogleWorkspaceSignIn
from scout_backend.web_routers._common import config_scoped_to_thread, destructive_profile
from scout_constants import get_scout_home

router = APIRouter()


def _bad_request(fn):
    def _run():
        try:
            return fn()
        except ValueError as exc:
            raise HTTPException(status_code=400, detail=str(exc)) from exc
    return _run


@router.get("/api/google-workspace")
async def google_workspace_status(profile: Optional[str] = None):
    return await config_scoped_to_thread(profile, lambda: gws.status(get_scout_home()))


@router.put("/api/google-workspace/client")
async def google_workspace_client(body: GoogleWorkspaceClient, profile: Optional[str] = None):
    profile = destructive_profile(profile, "PUT /api/google-workspace/client")

    def _save():
        gws.save_client(get_scout_home(), body.client_id, body.client_secret)
        return gws.status(get_scout_home())

    return await config_scoped_to_thread(profile, _bad_request(_save))


@router.post("/api/google-workspace/sign-in")
async def google_workspace_sign_in(body: Optional[GoogleWorkspaceSignIn] = None, profile: Optional[str] = None):
    profile = destructive_profile(profile, "POST /api/google-workspace/sign-in")
    redirect = body.client_redirect_uri if body else None
    return await config_scoped_to_thread(profile, _bad_request(lambda: gws.start_sign_in(get_scout_home(), redirect)))


@router.post("/api/google-workspace/sign-in/{flow_id}/callback")
async def google_workspace_sign_in_callback(flow_id: str, body: GoogleWorkspaceCallback,
                                            profile: Optional[str] = None):
    return await config_scoped_to_thread(
        profile, lambda: gws.relay_callback(flow_id, get_scout_home(), body.model_dump()))


@router.get("/api/google-workspace/sign-in/{flow_id}")
async def google_workspace_sign_in_poll(flow_id: str, profile: Optional[str] = None):
    return await config_scoped_to_thread(profile, lambda: gws.poll_sign_in(flow_id, get_scout_home()))


@router.delete("/api/google-workspace/sign-in/{flow_id}")
async def google_workspace_sign_in_cancel(flow_id: str, profile: Optional[str] = None):
    await config_scoped_to_thread(profile, lambda: gws.cancel_sign_in(flow_id, get_scout_home()))
    return {"ok": True}


@router.delete("/api/google-workspace")
async def google_workspace_sign_out(profile: Optional[str] = None):
    profile = destructive_profile(profile, "DELETE /api/google-workspace")

    def _out():
        gws.sign_out(get_scout_home())
        return gws.status(get_scout_home())

    return await config_scoped_to_thread(profile, _out)
