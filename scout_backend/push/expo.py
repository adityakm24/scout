"""Expo's push service: one call reaches iPhones (via Apple) and Android phones (via Google).

https://docs.expo.dev/push-notifications/sending-notifications/ — POST up to 100 messages; each
gets a ticket, and a ``DeviceNotRegistered`` ticket means that token is gone for good.
"""

from __future__ import annotations

import logging
from typing import Any, Dict, List, Optional, Tuple

logger = logging.getLogger(__name__)

EXPO_PUSH_URL = "https://exp.host/--/api/v2/push/send"
_BATCH = 100


def _post(url: str, payload: Any) -> Dict[str, Any]:
    import httpx

    response = httpx.post(url, json=payload, timeout=15.0, headers={"accept": "application/json"})
    response.raise_for_status()
    return response.json()


def message(token: str, title: str, body: str, *, data: Optional[Dict[str, Any]] = None,
            channel: str = "scout-alerts", sound: bool = True) -> Dict[str, Any]:
    msg: Dict[str, Any] = {"to": token, "title": title, "body": body, "data": data or {},
                           "priority": "high", "channelId": channel}
    if sound:
        msg["sound"] = "default"
    return msg


def send(messages: List[Dict[str, Any]]) -> List[Tuple[Dict[str, Any], Dict[str, Any]]]:
    """``(message, ticket)`` pairs. A failed request yields an error ticket for its whole batch."""
    results: List[Tuple[Dict[str, Any], Dict[str, Any]]] = []
    for start in range(0, len(messages), _BATCH):
        batch = messages[start:start + _BATCH]
        try:
            tickets = _post(EXPO_PUSH_URL, batch).get("data") or []
        except Exception as exc:
            logger.warning("Expo push failed: %s", exc)
            tickets = [{"status": "error", "message": str(exc)}] * len(batch)
        results += list(zip(batch, tickets))
    return results


def gone_tokens(results: List[Tuple[Dict[str, Any], Dict[str, Any]]]) -> List[str]:
    """Tokens Expo says no longer reach a phone (app removed, permission revoked)."""
    return [msg["to"] for msg, ticket in results
            if ticket.get("status") == "error" and (ticket.get("details") or {}).get("error") == "DeviceNotRegistered"]
