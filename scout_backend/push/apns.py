"""Apple's push service, for the one thing only it can do: change the Live Activity on an iPhone's
lock screen while the Scout app is closed. Every other notification goes through Expo (expo.py).

Apple authenticates the sender with a short-lived ES256 token signed by the user's own APNs key
(Apple Developer → Keys), and speaks only HTTP/2 (the ``push`` extra). The ``content-state`` keys
are expo-live-activity's ``LiveActivityAttributes.ContentState``; a key it does not declare makes
the phone drop the update.
"""

from __future__ import annotations

import logging
import threading
import time
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Dict, Optional, Tuple

logger = logging.getLogger(__name__)

HOSTS = {"development": "https://api.sandbox.push.apple.com", "production": "https://api.push.apple.com"}
# Apple refuses a provider token older than an hour and throttles one refreshed within 20 minutes.
_TOKEN_LIFETIME = 50 * 60
# How long "Done" stays on the lock screen once Scout finishes.
DONE_LINGER_SECONDS = 10
# expo-live-activity's ActivityAttributes type; a pushed start must name it.
ATTRIBUTES_TYPE = "LiveActivityAttributes"
# A Live Activity Scout started by push is named after its chat, so the phone can tell which chat
# the activity's own update token belongs to (mobile/src/activity.ts).
ACTIVITY_NAME_PREFIX = "scout:"
# Matches the phone shell's colours (mobile/src/theme.ts) so a pushed activity looks like a local one.
_LOOK = {"backgroundColor": "#1a1d24", "deepLinkUrl": "scout://", "progressViewTint": "#0a84ff",
         "subtitleColor": "#a3a8b3", "titleColor": "#f2f3f5"}


@dataclass(frozen=True)
class Credentials:
    team_id: str
    key_id: str
    bundle_id: str
    environment: str
    key: str

    @property
    def topic(self) -> str:
        return f"{self.bundle_id}.push-type.liveactivity"

    @property
    def host(self) -> str:
        return HOSTS.get(self.environment, HOSTS["development"])


def key_path(home: Path) -> Path:
    return Path(home) / "push" / "apns-key.p8"


def credentials(home: Path, settings: Dict[str, Any]) -> Optional[Credentials]:
    """The configured APNs key, or None: without one the phone's own updates are all there is."""
    team_id, key_id = str(settings.get("team_id") or "").strip(), str(settings.get("key_id") or "").strip()
    if not (team_id and key_id):
        return None
    try:
        key = key_path(home).read_text(encoding="utf-8")
    except OSError:
        return None
    return Credentials(team_id, key_id, str(settings.get("bundle_id") or "com.spaceshipresearch.scout"),
                       str(settings.get("environment") or "development"), key)


_tokens: Dict[Tuple[str, str], Tuple[str, float]] = {}
_tokens_lock = threading.Lock()


def provider_token(creds: Credentials, now: Optional[float] = None) -> str:
    import jwt

    now = time.time() if now is None else now
    with _tokens_lock:
        cached = _tokens.get((creds.team_id, creds.key_id))
        if cached and now - cached[1] < _TOKEN_LIFETIME:
            return cached[0]
        token = jwt.encode({"iss": creds.team_id, "iat": int(now)}, creds.key, algorithm="ES256",
                           headers={"kid": creds.key_id})
        _tokens[(creds.team_id, creds.key_id)] = (token, now)
        return token


def content_state(line: str, chat_title: str) -> Dict[str, Any]:
    return {"title": line, "subtitle": chat_title}


def update_payload(line: str, chat_title: str, *, now: Optional[float] = None) -> Dict[str, Any]:
    return {"aps": {"timestamp": int(time.time() if now is None else now), "event": "update",
                    "content-state": content_state(line, chat_title)}}


def end_payload(line: str, chat_title: str, *, now: Optional[float] = None) -> Dict[str, Any]:
    now = time.time() if now is None else now
    return {"aps": {"timestamp": int(now), "event": "end", "content-state": content_state(line, chat_title),
                    "dismissal-date": int(now + DONE_LINGER_SECONDS)}}


def start_payload(session_id: str, line: str, chat_title: str, *, now: Optional[float] = None) -> Dict[str, Any]:
    """Starts the Live Activity on a phone whose app is closed (iOS 17.2+). Apple requires an alert
    with a pushed start; it is the banner that announces the activity."""
    return {"aps": {"timestamp": int(time.time() if now is None else now), "event": "start",
                    "content-state": content_state(line, chat_title),
                    "attributes-type": ATTRIBUTES_TYPE,
                    "attributes": {"name": f"{ACTIVITY_NAME_PREFIX}{session_id}", **_LOOK},
                    "alert": {"title": line, "body": chat_title}}}


_client = None
_client_lock = threading.Lock()


def _http2_client():
    global _client
    with _client_lock:
        if _client is None:
            from pm.extras import ensure_import

            ensure_import("push")
            import httpx

            _client = httpx.Client(http2=True, timeout=15.0)
        return _client


# Apple's answers that mean the token will never work again.
GONE_REASONS = frozenset({"BadDeviceToken", "Unregistered", "ExpiredToken"})


def send(creds: Credentials, device_token: str, payload: Dict[str, Any], *, priority: int = 10,
         client=None) -> Tuple[int, str]:
    """``(HTTP status, Apple's reason)``; 200 with an empty reason on success."""
    client = client or _http2_client()
    response = client.post(f"{creds.host}/3/device/{device_token}", json=payload, headers={
        "authorization": f"bearer {provider_token(creds)}",
        "apns-push-type": "liveactivity",
        "apns-topic": creds.topic,
        "apns-priority": str(priority),
    })
    if response.status_code == 200:
        return 200, ""
    try:
        reason = str(response.json().get("reason") or "")
    except ValueError:
        reason = ""
    if response.status_code == 403 and reason in {"ExpiredProviderToken", "InvalidProviderToken"}:
        with _tokens_lock:
            _tokens.pop((creds.team_id, creds.key_id), None)
    return response.status_code, reason
