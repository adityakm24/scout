"""Phones that asked to hear from Scout while its app is closed.

One JSON file per profile home (``<home>/push/devices.json``, owner-only: push tokens address the
user's phone). Callers pass the home explicitly: pushes are sent from a worker thread that does not
carry the profile scope of the turn that caused them.
"""

from __future__ import annotations

import json
import threading
import time
from pathlib import Path
from typing import Any, Dict, List, Optional

# A phone in the foreground refreshes its presence every minute; one that stops (killed, crashed,
# no network) counts as away after this, so it is not left silent forever.
FOREGROUND_TTL_SECONDS = 150
# A chat used on the phone stays "the phone's" for this long: its replies are pushed there.
WATCH_TTL_SECONDS = 24 * 3600

_lock = threading.Lock()


def path(home: Path) -> Path:
    return Path(home) / "push" / "devices.json"


def _load(home: Path) -> Dict[str, Dict[str, Any]]:
    try:
        data = json.loads(path(home).read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return {}
    return data if isinstance(data, dict) else {}


def _save(home: Path, devices: Dict[str, Dict[str, Any]]) -> None:
    from utils import atomic_json_write

    target = path(home)
    target.parent.mkdir(parents=True, exist_ok=True)
    atomic_json_write(target, devices, mode=0o600)


def _update(home: Path, device_id: str, change) -> Optional[Dict[str, Any]]:
    with _lock:
        devices = _load(home)
        device = devices.get(device_id)
        if device is None:
            return None
        change(device)
        device["updated_at"] = time.time()
        _save(home, devices)
        return device


def register(home: Path, device_id: str, *, platform: str, name: str = "", expo_token: Optional[str] = None,
             push_to_start_token: Optional[str] = None) -> Dict[str, Any]:
    if not device_id:
        raise ValueError("device_id is required")
    with _lock:
        devices = _load(home)
        device = devices.setdefault(device_id, {"id": device_id, "activities": {}, "watching": {}})
        if expo_token and expo_token != device.get("expo_token"):
            device.pop("push_ok", None)  # a new token has not been tried yet
        device.update({"platform": platform, "name": name or device.get("name") or platform,
                       "expo_token": expo_token or device.get("expo_token"),
                       "push_to_start_token": push_to_start_token or device.get("push_to_start_token"),
                       "updated_at": time.time()})
        _save(home, devices)
        return device


def forget(home: Path, device_id: str) -> bool:
    with _lock:
        devices = _load(home)
        removed = devices.pop(device_id, None) is not None
        if removed:
            _save(home, devices)
        return removed


def set_presence(home: Path, device_id: str, foreground: bool) -> Optional[Dict[str, Any]]:
    until = time.time() + FOREGROUND_TTL_SECONDS if foreground else 0

    return _update(home, device_id, lambda device: device.update({"foreground_until": until}))


def watch(home: Path, device_id: str, session_id: str) -> Optional[Dict[str, Any]]:
    """The user is looking at ``session_id`` on this phone: its replies are pushed there."""
    def change(device):
        now = time.time()
        watching = {sid: at for sid, at in (device.get("watching") or {}).items() if now - at < WATCH_TTL_SECONDS}
        watching[session_id] = now
        device["watching"] = watching

    return _update(home, device_id, change) if session_id else None


def set_activity_token(home: Path, device_id: str, session_id: str, token: Optional[str]) -> Optional[Dict[str, Any]]:
    """The Live Activity this phone shows for ``session_id`` (None: it ended)."""
    def change(device):
        activities = dict(device.get("activities") or {})
        if token:
            activities[session_id] = {"token": token, "at": time.time()}
        else:
            activities.pop(session_id, None)
        device["activities"] = activities

    return _update(home, device_id, change)


def drop_token(home: Path, token: str) -> None:
    """A push service said the token no longer reaches a phone."""
    with _lock:
        devices = _load(home)
        changed = False
        for device in devices.values():
            if device.get("expo_token") == token:
                device["expo_token"], changed = None, True
            if device.get("push_to_start_token") == token:
                device["push_to_start_token"], changed = None, True
            for sid, activity in list((device.get("activities") or {}).items()):
                if activity.get("token") == token:
                    device["activities"].pop(sid)
                    changed = True
        if changed:
            _save(home, devices)


def record_delivery(home: Path, token: str, ok: bool) -> None:
    """Whether the push service took the last notification for this token. The phone reads it
    (``delivers``) to stop doubling the server's notifications with its own."""
    with _lock:
        devices = _load(home)
        changed = False
        for device in devices.values():
            if device.get("expo_token") == token and device.get("push_ok") is not ok:
                device["push_ok"], changed = ok, True
        if changed:
            _save(home, devices)


def delivers(device: Optional[Dict[str, Any]]) -> Optional[bool]:
    """True once a notification reached the push service for this phone, False after it was
    refused (credentials missing, say), None before the first one."""
    return None if device is None else device.get("push_ok")


def all_devices(home: Path) -> List[Dict[str, Any]]:
    with _lock:
        return list(_load(home).values())


def is_away(device: Dict[str, Any], now: Optional[float] = None) -> bool:
    return (device.get("foreground_until") or 0) <= (time.time() if now is None else now)


def watches(device: Dict[str, Any], session_id: Optional[str], now: Optional[float] = None) -> bool:
    at = (device.get("watching") or {}).get(session_id or "")
    return at is not None and (time.time() if now is None else now) - at < WATCH_TTL_SECONDS
