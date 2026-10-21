"""Pair the phone app: the link it scans (Settings → Phone on the desktop) and the private address it
reaches this backend at.

The phone loads Scout's screens from this backend (`/app/`, web_server_dashboard.py) and needs HTTPS
(iOS refuses plain HTTP to anything but the phone itself), so the address is Tailscale's: `tailscale
serve` puts the backend on the owner's tailnet at https://<machine>.<tailnet>.ts.net with a real
certificate, reachable from their phone anywhere and from nobody else.
"""

from __future__ import annotations

import asyncio
import json
import subprocess
from urllib.parse import quote

from fastapi import APIRouter, Request

from scout_backend.web_deps import _server
from scout_platform.resolver import locate_command

router = APIRouter()

# The Mac app ships its CLI inside the bundle; Homebrew and Linux packages put it on PATH.
_TAILSCALE_DIRS = ("/Applications/Tailscale.app/Contents/MacOS", "/opt/homebrew/bin", "/usr/local/bin")


def _tailscale() -> str | None:
    found = locate_command("tailscale", known_dirs=_TAILSCALE_DIRS).command
    if found:
        return found[0]
    mac_cli = locate_command("Tailscale", known_dirs=_TAILSCALE_DIRS[:1]).command
    return mac_cli[0] if mac_cli else None


def _run(*args: str) -> subprocess.CompletedProcess:
    return subprocess.run(args, capture_output=True, text=True, timeout=15)


def _port(request: Request) -> int:
    return int(getattr(request.app.state, "bound_port", None) or request.url.port or 9119)


def _tailnet_state(cli: str, port: int) -> dict:
    """Signed in? This machine's tailnet name? Is this backend already served over HTTPS?"""
    status = _run(cli, "status", "--json")
    if status.returncode != 0:
        return {"signed_in": False}
    info = json.loads(status.stdout or "{}")
    host = ((info.get("Self") or {}).get("DNSName") or "").rstrip(".")
    if info.get("BackendState") != "Running" or not host:
        return {"signed_in": False}
    serve = _run(cli, "serve", "status", "--json")
    served = serve.returncode == 0 and any(f"{h}:{port}" in serve.stdout for h in ("127.0.0.1", "localhost"))
    return {"signed_in": True, "host": host, "served": served}


def _pairing(request: Request) -> dict:
    cli = _tailscale()
    port = _port(request)
    if cli is None:
        return {"tailscale": "missing", "link": None}
    state = _tailnet_state(cli, port)
    if not state["signed_in"]:
        return {"tailscale": "signed_out", "link": None}
    if not state["served"]:
        return {"tailscale": "not_served", "host": state["host"], "link": None}
    token = _server()._SESSION_TOKEN
    return {"tailscale": "ready", "host": state["host"],
            "link": f"https://{state['host']}/app/?token={quote(token, safe='')}"}


@router.get("/api/phone/pairing")
async def phone_pairing(request: Request):
    return await asyncio.to_thread(_pairing, request)


@router.post("/api/phone/serve")
async def phone_serve(request: Request):
    """Put this backend on the tailnet over HTTPS (`tailscale serve --bg <port>`), then pair."""
    def _serve():
        cli = _tailscale()
        if cli is None:
            return {"tailscale": "missing", "link": None}
        result = _run(cli, "serve", "--bg", str(_port(request)))
        pairing = _pairing(request)
        if result.returncode != 0 and pairing["link"] is None:
            pairing["error"] = (result.stderr or result.stdout).strip()[-400:]
        return pairing

    return await asyncio.to_thread(_serve)
