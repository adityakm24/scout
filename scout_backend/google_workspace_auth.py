"""One-click Google Workspace sign-in for the Connectors page.

The google-workspace skill reads ``google_client_secret.json`` and ``google_token.json`` from the
profile's home. Its own setup asks the user to copy a dead ``localhost:1`` URL back into the chat;
this module runs the same OAuth (PKCE, offline access, every Workspace scope) with a loopback
listener instead, so the browser's redirect lands here and the card simply turns connected. The
token it writes is the authorized-user JSON the skill's scripts load, so either path signs in both.
"""

from __future__ import annotations

import base64
import hashlib
import html
import json
import os
import secrets
import threading
import time
from http.server import BaseHTTPRequestHandler, HTTPServer
from pathlib import Path
from typing import Any, Dict, List, Optional
from urllib.parse import parse_qs, urlencode, urlsplit

AUTH_URI = "https://accounts.google.com/o/oauth2/auth"
TOKEN_URI = "https://oauth2.googleapis.com/token"
REVOKE_URI = "https://oauth2.googleapis.com/revoke"

# (id, scopes) per service the card lists; the union is what the skill's setup.py requests.
SERVICES: tuple = (
    ("gmail", ("https://www.googleapis.com/auth/gmail.readonly", "https://www.googleapis.com/auth/gmail.send",
               "https://www.googleapis.com/auth/gmail.modify")),
    ("calendar", ("https://www.googleapis.com/auth/calendar",)),
    ("drive", ("https://www.googleapis.com/auth/drive",)),
    ("docs", ("https://www.googleapis.com/auth/documents",)),
    ("sheets", ("https://www.googleapis.com/auth/spreadsheets",)),
    ("contacts", ("https://www.googleapis.com/auth/contacts.readonly",)),
)
SCOPES: List[str] = [scope for _id, scopes in SERVICES for scope in scopes]

_FLOW_TTL_SECONDS = 600
_flows: Dict[str, "_Flow"] = {}
_flows_lock = threading.Lock()


def _client_path(home: Path) -> Path:
    return home / "google_client_secret.json"


def _token_path(home: Path) -> Path:
    return home / "google_token.json"


def _write_private(path: Path, payload: dict) -> None:
    fd = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600)
    if hasattr(os, "fchmod"):  # POSIX: an existing file keeps its old mode through O_CREAT
        os.fchmod(fd, 0o600)
    with os.fdopen(fd, "w", encoding="utf-8") as handle:
        json.dump(payload, handle, indent=2)


def _read_json(path: Path) -> dict:
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return {}


def _env_client() -> Optional[dict]:
    """The Desktop OAuth client from the profile ``.env``, when both values are set."""
    client_id = os.environ.get("GOOGLE_WORKSPACE_CLIENT_ID", "").strip()
    client_secret = os.environ.get("GOOGLE_WORKSPACE_CLIENT_SECRET", "").strip()
    if not client_id.endswith(".apps.googleusercontent.com") or not client_secret:
        return None
    return {"client_id": client_id, "client_secret": client_secret, "token_uri": TOKEN_URI}


def read_client(home: Path) -> Optional[dict]:
    """``{client_id, client_secret, token_uri}`` from the stored OAuth client, or the ``.env`` pair."""
    raw = _read_json(_client_path(home))
    client = raw.get("installed") or raw.get("web") or {}
    if client.get("client_id") and client.get("client_secret"):
        return {"client_id": client["client_id"], "client_secret": client["client_secret"],
                "token_uri": client.get("token_uri") or TOKEN_URI}
    return _env_client()


def save_client(home: Path, client_id: str, client_secret: str) -> None:
    """Store a Desktop OAuth client the way Google's downloaded JSON is shaped."""
    client_id, client_secret = client_id.strip(), client_secret.strip()
    if not client_id.endswith(".apps.googleusercontent.com") or not client_secret:
        raise ValueError("Paste the Client ID (ends in .apps.googleusercontent.com) and its Client secret")
    _write_private(_client_path(home), {"installed": {
        "client_id": client_id, "client_secret": client_secret, "auth_uri": AUTH_URI, "token_uri": TOKEN_URI,
        "redirect_uris": ["http://localhost"]}})


def status(home: Path) -> Dict[str, Any]:
    """What the card shows: whether a client is set up, who is signed in, which services were granted."""
    token = _read_json(_token_path(home))
    raw_scopes = token.get("scopes") or token.get("scope") or []
    granted = set(raw_scopes.split() if isinstance(raw_scopes, str) else raw_scopes)
    signed_in = bool(token.get("refresh_token") or token.get("token"))
    return {
        "client_configured": read_client(home) is not None,
        "signed_in": signed_in,
        "account": token.get("account") or None,
        "services": [{"id": sid, "granted": signed_in and all(s in granted for s in scopes)}
                     for sid, scopes in SERVICES],
    }


def _account_email(access_token: str) -> Optional[str]:
    """The signed-in address, read through Gmail (no extra identity scope is requested)."""
    import httpx
    try:
        resp = httpx.get("https://gmail.googleapis.com/gmail/v1/users/me/profile",
                         headers={"Authorization": f"Bearer {access_token}"}, timeout=15)
        return resp.json().get("emailAddress") if resp.status_code == 200 else None
    except httpx.HTTPError:
        return None


def _token_payload(client: dict, grant: dict) -> dict:
    """The authorized-user JSON ``google.oauth2.credentials.Credentials`` (and the skill) loads."""
    expiry = time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime(time.time() + int(grant.get("expires_in") or 3600)))
    return {"type": "authorized_user", "token": grant["access_token"], "refresh_token": grant.get("refresh_token"),
            "token_uri": client["token_uri"], "client_id": client["client_id"],
            "client_secret": client["client_secret"], "scopes": (grant.get("scope") or " ".join(SCOPES)).split(),
            "expiry": expiry, "account": _account_email(grant["access_token"]) or ""}


class _Flow:
    """One sign-in attempt. The browser's redirect reaches it one of two ways: the desktop app's own
    loopback listener relays it (``client_redirect_uri`` — works when the backend is another
    machine), or this backend binds one (CLI, dashboard, older desktops)."""

    def __init__(self, home: Path, client: dict, client_redirect_uri: Optional[str] = None) -> None:
        self.id = secrets.token_urlsafe(16)
        self.home, self.client = home, client
        self.state = secrets.token_urlsafe(24)
        self.verifier = secrets.token_urlsafe(64)
        self.status, self.error = "pending", None
        self.created = time.time()
        if client_redirect_uri is None:
            self.httpd: Optional[HTTPServer] = HTTPServer(("127.0.0.1", 0), self._handler())
            self.redirect_uri = f"http://127.0.0.1:{self.httpd.server_address[1]}/"
        else:
            from tools.connectors.mcp_oauth import _validate_client_redirect_uri
            self.httpd, self.redirect_uri = None, _validate_client_redirect_uri(client_redirect_uri)

    def auth_url(self) -> str:
        challenge = base64.urlsafe_b64encode(hashlib.sha256(self.verifier.encode()).digest()).rstrip(b"=").decode()
        return AUTH_URI + "?" + urlencode({
            "response_type": "code", "client_id": self.client["client_id"], "redirect_uri": self.redirect_uri,
            "scope": " ".join(SCOPES), "state": self.state, "code_challenge": challenge,
            "code_challenge_method": "S256", "access_type": "offline", "prompt": "consent"})

    def complete(self, query: Dict[str, List[str]]) -> None:
        """Record the outcome of the browser's reply for the poller (and whoever relayed it)."""
        if self.status != "pending":
            return
        try:
            self.finish(query)
            self.status = "done"
        except Exception as exc:  # the reason is shown on the card and in the browser tab
            self.status, self.error = "error", str(exc)

    def finish(self, query: Dict[str, List[str]]) -> None:
        """Exchange the code the browser brought back."""
        import httpx
        if (query.get("state") or [""])[0] != self.state:
            raise ValueError("The sign-in reply did not match this attempt. Start again from Scout.")
        if query.get("error"):
            raise ValueError("Google sign-in was cancelled." if query["error"][0] == "access_denied"
                             else f"Google refused the sign-in: {query['error'][0]}")
        code = (query.get("code") or [""])[0]
        resp = httpx.post(self.client["token_uri"], timeout=30, data={
            "grant_type": "authorization_code", "code": code, "redirect_uri": self.redirect_uri,
            "client_id": self.client["client_id"], "client_secret": self.client["client_secret"],
            "code_verifier": self.verifier})
        grant = resp.json() if resp.headers.get("content-type", "").startswith("application/json") else {}
        if resp.status_code != 200 or "access_token" not in grant:
            raise ValueError(f"Google did not issue a token: {grant.get('error_description') or grant.get('error') or resp.status_code}")
        _write_private(_token_path(self.home), _token_payload(self.client, grant))

    def _handler(self):
        flow = self

        class Handler(BaseHTTPRequestHandler):
            def do_GET(self):  # noqa: N802 - http.server API
                query = parse_qs(urlsplit(self.path).query)
                if not query.get("state"):
                    self.send_response(404)
                    self.end_headers()
                    return
                flow.complete(query)
                title, body = (("Signed in to Google", "Scout can use your Google Workspace now. You can close this tab.")
                               if flow.status == "done" else ("Sign-in didn't finish", flow.error or ""))
                page = (f"<!doctype html><meta charset=utf-8><title>{html.escape(title)}</title>"
                        "<body style='font:16px system-ui;display:grid;place-items:center;height:90vh;margin:0'>"
                        f"<div style='text-align:center'><h2>{html.escape(title)}</h2>"
                        f"<p>{html.escape(body)}</p></div>")
                self.send_response(200)
                self.send_header("Content-Type", "text/html; charset=utf-8")
                self.end_headers()
                self.wfile.write(page.encode())

            def log_message(self, *_args):  # keep request lines out of the server log
                pass

        return Handler

    def serve(self) -> None:
        self.httpd.timeout = 1
        while self.status == "pending" and time.time() - self.created < _FLOW_TTL_SECONDS:
            self.httpd.handle_request()
        if self.status == "pending":
            self.status, self.error = "error", "Sign-in timed out. Start again from Scout."
        self.httpd.server_close()


def start_sign_in(home: Path, client_redirect_uri: Optional[str] = None) -> Dict[str, str]:
    """Begin a sign-in and return ``{flow_id, auth_url}`` for the browser. Without
    ``client_redirect_uri`` this backend listens for the redirect itself."""
    client = read_client(home)
    if client is None:
        raise ValueError("Add your Google OAuth client first")
    with _flows_lock:
        for fid in [fid for fid, f in _flows.items() if time.time() - f.created > _FLOW_TTL_SECONDS * 2]:
            _flows.pop(fid)
        flow = _Flow(home, client, client_redirect_uri)
        _flows[flow.id] = flow
    if flow.httpd is not None:
        threading.Thread(target=flow.serve, daemon=True, name="google-workspace-signin").start()
    return {"flow_id": flow.id, "auth_url": flow.auth_url()}


def _flow(flow_id: str, home: Path) -> Optional[_Flow]:
    with _flows_lock:
        flow = _flows.get(flow_id)
    return flow if flow is not None and flow.home == home else None


def relay_callback(flow_id: str, home: Path, query: Dict[str, Optional[str]]) -> Dict[str, Any]:
    """The desktop's listener caught the redirect; finish the attempt with what it carried."""
    flow = _flow(flow_id, home)
    if flow is None:
        return {"status": "error", "error": "This sign-in attempt has expired. Start again."}
    flow.complete({key: [value] for key, value in query.items() if value})
    return {"status": flow.status, "error": flow.error}


def poll_sign_in(flow_id: str, home: Path) -> Dict[str, Any]:
    flow = _flow(flow_id, home)
    if flow is None:
        return {"status": "error", "error": "This sign-in attempt has expired. Start again."}
    if flow.status == "pending" and time.time() - flow.created > _FLOW_TTL_SECONDS:
        flow.status, flow.error = "error", "Sign-in timed out. Start again from Scout."
    return {"status": flow.status, "error": flow.error}


def cancel_sign_in(flow_id: str, home: Path) -> None:
    flow = _flow(flow_id, home)
    if flow is not None and flow.status == "pending":
        flow.status, flow.error = "error", "Sign-in cancelled."


def sign_out(home: Path) -> None:
    """Revoke the grant at Google (best effort: an offline revoke still forgets it here)."""
    import httpx
    token = _read_json(_token_path(home))
    secret = token.get("refresh_token") or token.get("token")
    if secret:
        try:
            httpx.post(REVOKE_URI, data={"token": secret}, timeout=15)
        except httpx.HTTPError:
            pass
    _token_path(home).unlink(missing_ok=True)
