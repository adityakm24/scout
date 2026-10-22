"""Pair the phone app: the link it scans (Settings → Phone on the desktop) and the private address it
reaches this backend at.

The phone loads Scout's screens from this backend (`/app/`, web_server_dashboard.py) and needs HTTPS
(iOS refuses plain HTTP to anything but the phone itself), so the address is Tailscale's: `tailscale
serve --tls-terminated-tcp 443` puts the backend on the owner's tailnet at
https://<machine>.<tailnet>.ts.net with a real certificate, reachable from their phone anywhere and
from nobody else. HTTPS reverse-proxy Serve advertises HTTP/2 and drops WebSocket CONNECT (Tailscale
#20882), so the phone's live socket never opens; TLS-terminated TCP keeps HTTP/1.1.
"""

from __future__ import annotations

import asyncio
import json
import subprocess
import threading
import time
from urllib.parse import quote

from fastapi import APIRouter, Request

from scout_backend.web_deps import _server
from scout_platform.resolver import locate_command

router = APIRouter()

# The Mac app ships its CLI inside the bundle; Homebrew and Linux packages put it on PATH.
_TAILSCALE_DIRS = ("/Applications/Tailscale.app/Contents/MacOS", "/opt/homebrew/bin", "/usr/local/bin")
# `serve` prints this and then waits for the tailnet switch. The wait is not part of the request.
_ENABLE_URL = "https://login.tailscale.com/"
_SERVE_WAIT_S = 12


def _tailscale() -> str | None:
    found = locate_command("tailscale", known_dirs=_TAILSCALE_DIRS).command
    if found:
        return found[0]
    mac_cli = locate_command("Tailscale", known_dirs=_TAILSCALE_DIRS[:1]).command
    return mac_cli[0] if mac_cli else None


# This machine's MagicDNS name. `tailscale serve` forwards that name in Host while the
# backend stays bound to loopback; the host check needs the exact name, not every ts.net host.
_TAILNET_HOST: tuple[float, str] | None = None
_TAILNET_TTL_S = 30.0


def tailnet_hostname() -> str:
    global _TAILNET_HOST
    now = time.monotonic()
    if _TAILNET_HOST is not None and now - _TAILNET_HOST[0] < _TAILNET_TTL_S:
        return _TAILNET_HOST[1]
    name = ""
    cli = _tailscale()
    if cli:
        status = _run(cli, "status", "--json")
        if status.returncode == 0:
            try:
                info = json.loads(status.stdout or "{}")
            except json.JSONDecodeError:
                info = None
            if isinstance(info, dict) and info.get("BackendState") == "Running":
                name = str((info.get("Self") or {}).get("DNSName") or "").rstrip(".").lower()
    _TAILNET_HOST = (now, name)
    return name


def _run(*args: str) -> subprocess.CompletedProcess:
    try:
        return subprocess.run(args, capture_output=True, text=True, timeout=15, stdin=subprocess.DEVNULL)
    except subprocess.TimeoutExpired as exc:
        # status/serve can sit on a prompt. A hung CLI is a failed check, not a 500.
        return subprocess.CompletedProcess(args, 1, _text(exc.stdout) + _text(exc.stderr), "")


def _text(value: str | bytes | None) -> str:
    if not value:
        return ""
    return value.decode("utf-8", "replace") if isinstance(value, bytes) else value


def _serve_args(cli: str, port: int) -> tuple[str, ...]:
    """TLS-terminated TCP to this backend: HTTPS on the tailnet, HTTP/1.1 to loopback.

    `tailscale serve <port>` is an HTTP/2 reverse proxy. iOS WKWebView then uses RFC 8441
    WebSocket CONNECT, which Serve does not bridge, and the phone sits on
    "WebSocket error before open".
    """
    return (cli, "serve", "--bg", "--yes", "--tls-terminated-tcp", "443", f"tcp://127.0.0.1:{port}")


def _serve(cli: str, port: int) -> subprocess.CompletedProcess:
    """Publish this port. Return as soon as Tailscale says Serve is off, instead of
    waiting out the prompt it leaves open until someone enables it in the admin console.
    """
    args = _serve_args(cli, port)
    proc = subprocess.Popen(args, stdout=subprocess.PIPE, stderr=subprocess.STDOUT, stdin=subprocess.DEVNULL, text=True)
    chunks: list[str] = []
    lock = threading.Lock()

    def _read() -> None:
        if proc.stdout is None:
            return
        for line in proc.stdout:
            with lock:
                chunks.append(line)

    def _joined() -> str:
        with lock:
            return "".join(chunks)

    reader = threading.Thread(target=_read, daemon=True)
    reader.start()
    deadline = time.monotonic() + _SERVE_WAIT_S

    def _finish(code: int) -> subprocess.CompletedProcess:
        reader.join(timeout=1)
        text = _joined().strip()
        return subprocess.CompletedProcess(args, code, text or "Tailscale did not publish an address.", "")

    while time.monotonic() < deadline:
        code = proc.poll()
        if code is not None:
            return _finish(code)
        text = _joined()
        if "not enabled" in text.lower() or _ENABLE_URL in text:
            _stop(proc)
            return _finish(1)
        time.sleep(0.1)
    _stop(proc)
    return _finish(1)


def _stop(proc: subprocess.Popen) -> None:
    if proc.poll() is None:
        try:
            proc.kill()
        except ProcessLookupError:
            pass
    proc.wait(timeout=2)


def _serve_failure(text: str) -> dict:
    """The sentence and, when Tailscale printed one, the page that turns Serve on."""
    url = next((word.strip(".,)") for word in text.split() if word.strip(".,)").startswith(_ENABLE_URL)), None)
    if url:
        return {
            "enable_url": url,
            "error": f"Tailscale Serve is off for this network. Turn it on, then try again: {url}",
        }
    cleaned = " ".join(text.split())
    return {"error": (cleaned or "Tailscale did not publish an address.")[-400:]}


def _port(request: Request) -> int:
    return int(getattr(request.app.state, "bound_port", None) or request.url.port or 9119)


def _tailnet_state(cli: str, port: int) -> dict:
    """Signed in? This machine's tailnet name? Is this backend already served over HTTPS?"""
    status = _run(cli, "status", "--json")
    if status.returncode != 0:
        return {"signed_in": False}
    try:
        info = json.loads(status.stdout or "{}")
    except json.JSONDecodeError:
        return {"signed_in": False}
    if not isinstance(info, dict):
        return {"signed_in": False}
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
    """Put this backend on the tailnet over HTTPS (`tailscale serve --tls-terminated-tcp 443`), then pair."""
    def _publish():
        cli = _tailscale()
        if cli is None:
            return {"tailscale": "missing", "link": None}
        result = _serve(cli, _port(request))
        pairing = _pairing(request)
        if result.returncode != 0 and pairing["link"] is None:
            pairing.update(_serve_failure(result.stdout or result.stderr or ""))
        return pairing

    return await asyncio.to_thread(_publish)
