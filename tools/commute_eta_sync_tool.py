#!/usr/bin/env python3
"""Commute ETA-Sync Tools: Dual-Timeline Spatial Orchestration & Saved Locations.

Manages arrival-timed actions (deliveries, home automation, notifications) by synchronizing
user travel time (native on-device MapKit/GPS tracking) with live dynamic merchant/service ETAs,
and provides persistent named location storage (Home, Work, Gym, etc.) with automatic address geocoding.
"""

import json
import logging
import math
import time
import urllib.parse
import urllib.request
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple

from scout_constants import get_scout_home
from tools.registry import registry, tool_error

logger = logging.getLogger(__name__)

# Road detour multiplier and urban velocity baseline (km/h) for fallback estimations
ROAD_DETOUR = 1.35
CITY_DRIVE_KMH = 20.0
CITY_TWO_WHEELER_KMH = 25.0
WALKING_KMH = 4.5


def _storage_path() -> Path:
    sync_dir = get_scout_home() / "commute_sync"
    sync_dir.mkdir(parents=True, exist_ok=True)
    return sync_dir / "active_sync.json"


def _locations_path() -> Path:
    loc_dir = get_scout_home() / "locations"
    loc_dir.mkdir(parents=True, exist_ok=True)
    return loc_dir / "saved_locations.json"


CODE_ALPHABET_ = "23456789CFGHJMPQRVWX"


def _decode_plus_code(code: str, ref_lat: float = 12.97, ref_lng: float = 77.59) -> Optional[Tuple[float, float]]:
    """Decode a Google Plus Code (e.g. 'XJV8+WPW' or full 10-char code) to lat, lng."""
    code = code.strip().upper()
    if "+" not in code:
        return None
    plus_idx = code.index("+")
    if plus_idx < 8:
        lat_val = ref_lat + 90.0
        lng_val = ref_lng + 180.0
        d1 = int(lat_val / 20.0)
        lat_rem = lat_val - d1 * 20.0
        d2 = int(lng_val / 20.0)
        lng_rem = lng_val - d2 * 20.0
        d3 = int(lat_rem)
        d4 = int(lng_rem)
        prefix = f"{CODE_ALPHABET_[d1]}{CODE_ALPHABET_[d2]}{CODE_ALPHABET_[d3]}{CODE_ALPHABET_[d4]}"
        full_code = prefix + code
    else:
        full_code = code

    clean = full_code.replace("+", "")
    lat = -90.0
    lng = -180.0
    lat_res = 20.0
    lng_res = 20.0
    for i in range(0, min(len(clean), 10), 2):
        if clean[i] not in CODE_ALPHABET_ or clean[i+1] not in CODE_ALPHABET_:
            return None
        lat += CODE_ALPHABET_.index(clean[i]) * lat_res
        lng += CODE_ALPHABET_.index(clean[i+1]) * lng_res
        lat_res /= 20.0
        lng_res /= 20.0

    center_lat = lat + (lat_res * 20.0) / 2.0
    center_lng = lng + (lng_res * 20.0) / 2.0
    return round(center_lat, 6), round(center_lng, 6)


def geocode_address(query: str) -> Tuple[Optional[float], Optional[float], Optional[str]]:
    """Free geocoder with Google Plus Code resolution and progressive street/area fallback."""
    import re
    if not query or not query.strip():
        return None, None, None

    # 1. Check for embedded Plus Codes (e.g. XJV8+WPW)
    plus_match = re.search(r'\b([2-9CFGHJMPQRVWX]{4,8}\+[2-9CFGHJMPQRVWX]{2,4})\b', query, re.I)
    if plus_match:
        coords = _decode_plus_code(plus_match.group(1))
        if coords:
            return coords[0], coords[1], query.strip()

    # 2. Progressive fallback candidates (strip building/apartment names that OSM map doesn't index)
    parts = [p.strip() for p in query.split(",") if p.strip()]
    clean_parts = [p for p in parts if not re.match(r'^[2-9CFGHJMPQRVWX]{4,8}\+[2-9CFGHJMPQRVWX]{2,4}$', p, re.I)]

    candidates = [query.strip()]
    if clean_parts and clean_parts != parts:
        candidates.append(", ".join(clean_parts))
    for i in range(1, len(clean_parts)):
        sub = ", ".join(clean_parts[i:])
        if sub not in candidates:
            candidates.append(sub)

    for attempt in candidates:
        try:
            url = f"https://nominatim.openstreetmap.org/search?q={urllib.parse.quote(attempt)}&format=json&limit=1"
            req = urllib.request.Request(url, headers={"User-Agent": "ScoutAgent/1.0"})
            with urllib.request.urlopen(req, timeout=5) as resp:
                data = json.loads(resp.read().decode("utf-8"))
                if data and isinstance(data, list) and len(data) > 0:
                    item = data[0]
                    return float(item["lat"]), float(item["lon"]), item.get("display_name", "") or attempt
        except Exception:
            continue

    return None, None, None


def get_saved_locations() -> Dict[str, Dict[str, Any]]:
    path = _locations_path()
    if not path.exists():
        return {}
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except Exception as exc:
        logger.warning("Could not read saved locations: %s", exc)
        return {}


def _save_location_record(name: str, latitude: float, longitude: float, address: str = "") -> Dict[str, Any]:
    key = name.strip().lower()
    locs = get_saved_locations()
    record = {
        "name": name.strip(),
        "latitude": round(float(latitude), 6),
        "longitude": round(float(longitude), 6),
        "address": address.strip(),
        "updated_at": time.time(),
    }
    locs[key] = record
    _locations_path().write_text(json.dumps(locs, indent=2, ensure_ascii=False), encoding="utf-8")

    # Also record in user memories/USER.md so the LLM system prompt is naturally aware across turns
    try:
        from tools.memory_tool_store import MemoryStore
        mem_dir = get_scout_home() / "memories"
        mem_dir.mkdir(parents=True, exist_ok=True)
        user_md = mem_dir / "USER.md"
        entries = MemoryStore._read_file(user_md) if user_md.exists() else []
        prefix = f"- {name.strip()} Location:"
        entries = [e for e in entries if not e.strip().startswith(prefix)]
        loc_str = f"{prefix} {record['latitude']}, {record['longitude']}"
        if address:
            loc_str += f" ({address.strip()})"
        entries.append(loc_str)
        MemoryStore._write_file(user_md, entries)
    except Exception as exc:
        logger.debug("Could not sync location to USER.md: %s", exc)

    return record


def resolve_saved_location(target: str) -> Optional[Dict[str, Any]]:
    """Resolve a location by name ('home', 'work', etc.) or return None."""
    if not target:
        return None
    key = target.strip().lower()
    locs = get_saved_locations()
    if key in locs:
        return locs[key]
    for loc_key, val in locs.items():
        if key in loc_key or loc_key in key:
            return val
    return None


def _read_active_sync() -> Optional[Dict[str, Any]]:
    path = _storage_path()
    if not path.exists():
        return None
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except Exception as exc:
        logger.warning("Could not read active commute sync: %s", exc)
        return None


def _write_active_sync(data: Optional[Dict[str, Any]]) -> None:
    path = _storage_path()
    if data is None:
        if path.exists():
            path.unlink(missing_ok=True)
        return
    path.write_text(json.dumps(data, indent=2, ensure_ascii=False), encoding="utf-8")


def set_saved_location(
    name: str,
    address: Optional[str] = None,
    latitude: Optional[float] = None,
    longitude: Optional[float] = None,
) -> str:
    """Save a named location (e.g. 'Home', 'Work', 'Gym') using either a street/place address or coordinates."""
    if not name or not name.strip():
        return tool_error("name is required (e.g. 'Home' or 'Work').")

    lat, lng = latitude, longitude
    resolved_addr = address or ""

    # If coordinates are missing but address is provided, automatically geocode it
    if (lat is None or lng is None) and address:
        geo_lat, geo_lng, display = geocode_address(address)
        if geo_lat is not None and geo_lng is not None:
            lat, lng = geo_lat, geo_lng
            if not resolved_addr or len(resolved_addr) < 15:
                resolved_addr = display or address
        else:
            return tool_error(f"Could not automatically locate '{address}'. Please provide more details or check the address.")

    if lat is None or lng is None:
        return tool_error("Please provide an address (e.g. '100 Feet Road, Indiranagar, Bangalore') or latitude/longitude coordinates.")

    try:
        lat = float(lat)
        lng = float(lng)
    except (TypeError, ValueError):
        return tool_error("latitude and longitude must be valid decimal coordinates.")

    record = _save_location_record(name, lat, lng, resolved_addr)
    return json.dumps({
        "success": True,
        "message": f"Saved {record['name']} location at {record['address'] or f'({record['latitude']}, {record['longitude']})'}.",
        "location": record,
    })


def list_saved_locations() -> str:
    """List all saved locations (Home, Work, etc.) with coordinates and addresses."""
    locs = get_saved_locations()
    return json.dumps({
        "success": True,
        "count": len(locs),
        "locations": list(locs.values()),
    })


def start_commute_eta_sync(
    destination_lat: Optional[float] = None,
    destination_lng: Optional[float] = None,
    destination_name: Optional[str] = None,
    destination_address: Optional[str] = None,
    target_eta_minutes: int = 15,
    transport_mode: str = "driving",
    action_payload: Optional[Dict[str, Any]] = None,
) -> str:
    """Initialize the dual-timeline commute ETA tracking engine."""
    resolved_name = None

    # 1. Check destination_address first
    if (destination_lat is None or destination_lng is None) and destination_address:
        geo_lat, geo_lng, _ = geocode_address(destination_address)
        if geo_lat is not None and geo_lng is not None:
            destination_lat, destination_lng = geo_lat, geo_lng
            resolved_name = destination_address

    # 2. Check saved location name (e.g. 'Home')
    if (destination_lat is None or destination_lng is None) and destination_name:
        saved = resolve_saved_location(destination_name)
        if saved:
            destination_lat = saved["latitude"]
            destination_lng = saved["longitude"]
            resolved_name = saved["name"]

    # 3. Default fallback to saved 'home' location
    if destination_lat is None or destination_lng is None:
        home_saved = resolve_saved_location("home")
        if home_saved:
            destination_lat = home_saved["latitude"]
            destination_lng = home_saved["longitude"]
            resolved_name = home_saved["name"]

    try:
        dest_lat = float(destination_lat)
        dest_lng = float(destination_lng)
    except (TypeError, ValueError):
        return tool_error(
            "Could not determine destination coordinates. Provide an address, destination_name, or save a 'Home' location first."
        )

    try:
        eta_min = int(target_eta_minutes)
    except (TypeError, ValueError):
        eta_min = 15

    mode = (transport_mode or "driving").lower()
    if mode not in ("driving", "drive", "two_wheeler", "walking"):
        mode = "driving"

    payload = action_payload if isinstance(action_payload, dict) else {}
    sync_id = f"sync_{int(time.time())}"

    record = {
        "sync_id": sync_id,
        "status": "tracking",
        "created_at": time.time(),
        "destination": {"lat": dest_lat, "lng": dest_lng, "name": resolved_name or destination_name or "Destination"},
        "target_eta_minutes": eta_min,
        "transport_mode": mode,
        "action_payload": payload,
        "last_checked_at": None,
        "last_user_eta_minutes": None,
    }

    _write_active_sync(record)

    merchant = payload.get("merchant_provider") or payload.get("provider") or "Service"
    action = payload.get("action") or "Action"
    dest_display = f"{record['destination']['name']} ({dest_lat:.4f}, {dest_lng:.4f})"

    return json.dumps({
        "success": True,
        "sync_id": sync_id,
        "status": "tracking",
        "message": f"Commute ETA-Sync initialized for {merchant} ({action}). Tracking user convergence toward {dest_display} with initial {eta_min}m target ETA.",
        "details": record,
    })


def cancel_commute_eta_sync() -> str:
    """Halt active commute tracking and cancel any pending arrival-timed trigger."""
    active = _read_active_sync()
    if not active:
        return json.dumps({
            "success": True,
            "status": "idle",
            "message": "No active commute ETA-sync session was running.",
        })

    _write_active_sync(None)
    sync_id = active.get("sync_id", "unknown")
    return json.dumps({
        "success": True,
        "sync_id": sync_id,
        "status": "cancelled",
        "message": f"Commute ETA-Sync session '{sync_id}' has been cancelled.",
    })


def get_commute_eta_sync_status() -> str:
    """Query the status of the active commute ETA sync session."""
    active = _read_active_sync()
    if not active:
        return json.dumps({"active": False, "status": "idle", "message": "No commute sync is currently active."})
    return json.dumps({"active": True, **active})


SET_SAVED_LOCATION_SCHEMA = {
    "name": "set_saved_location",
    "description": (
        "Store a user named location (e.g. 'Home', 'Work', 'Gym') using either a street/place address or coordinates. "
        "If an address is provided, it is automatically geocoded."
    ),
    "parameters": {
        "type": "object",
        "properties": {
            "name": {"type": "string", "description": "Name or label for the place (e.g. 'Home', 'Work')."},
            "address": {"type": "string", "description": "Street address, landmark, or area (e.g. '100 Feet Road, Indiranagar, Bangalore')."},
            "latitude": {"type": "number", "description": "Optional decimal latitude coordinate if already known."},
            "longitude": {"type": "number", "description": "Optional decimal longitude coordinate if already known."},
        },
        "required": ["name"],
    },
}

LIST_SAVED_LOCATIONS_SCHEMA = {
    "name": "list_saved_locations",
    "description": "List all saved user locations (Home, Work, etc.) with coordinates and addresses.",
    "parameters": {
        "type": "object",
        "properties": {},
    },
}

START_COMMUTE_ETA_SYNC_SCHEMA = {
    "name": "start_commute_eta_sync",
    "description": (
        "Initialize the on-device commute ETA synchronization engine. Synchronizes user travel ETA "
        "toward destination (or saved 'Home'/'Work') with the dynamic service/delivery ETA in target_eta_minutes, "
        "firing the requested action or prompt when the user enters the arrival convergence window."
    ),
    "parameters": {
        "type": "object",
        "properties": {
            "destination_name": {
                "type": "string",
                "description": "Name of a saved location (e.g. 'Home' or 'Work'). If passed, coordinates are resolved automatically.",
            },
            "destination_address": {
                "type": "string",
                "description": "Street or place address of the destination (geocoded automatically).",
            },
            "destination_lat": {
                "type": "number",
                "description": "Latitude coordinate of the final arrival destination.",
            },
            "destination_lng": {
                "type": "number",
                "description": "Longitude coordinate of the final arrival destination.",
            },
            "target_eta_minutes": {
                "type": "integer",
                "description": "Initial delivery timeline or preparation duration guess (e.g. 10 or 15 for Zepto/Zomato).",
            },
            "transport_mode": {
                "type": "string",
                "enum": ["driving", "two_wheeler", "walking"],
                "description": "User commute vehicle type (defaults to driving).",
            },
            "action_payload": {
                "type": "object",
                "description": "Structured payload describing the action (e.g. merchant, cart, order details) to trigger on arrival convergence.",
            },
        },
    },
}

CANCEL_COMMUTE_ETA_SYNC_SCHEMA = {
    "name": "cancel_commute_eta_sync",
    "description": "Cancel and halt the currently active commute ETA tracking session.",
    "parameters": {
        "type": "object",
        "properties": {},
    },
}

GET_COMMUTE_ETA_SYNC_STATUS_SCHEMA = {
    "name": "get_commute_eta_sync_status",
    "description": "Inspect the status and parameters of the currently running commute ETA-sync session.",
    "parameters": {
        "type": "object",
        "properties": {},
    },
}

registry.register(
    name="set_saved_location",
    toolset="commute",
    schema=SET_SAVED_LOCATION_SCHEMA,
    handler=lambda args, **kw: set_saved_location(
        name=args.get("name"),
        address=args.get("address"),
        latitude=args.get("latitude"),
        longitude=args.get("longitude"),
    ),
    emoji="📍",
)

registry.register(
    name="list_saved_locations",
    toolset="commute",
    schema=LIST_SAVED_LOCATIONS_SCHEMA,
    handler=lambda args, **kw: list_saved_locations(),
    emoji="🗺️",
)

registry.register(
    name="start_commute_eta_sync",
    toolset="commute",
    schema=START_COMMUTE_ETA_SYNC_SCHEMA,
    handler=lambda args, **kw: start_commute_eta_sync(
        destination_lat=args.get("destination_lat"),
        destination_lng=args.get("destination_lng"),
        destination_name=args.get("destination_name"),
        destination_address=args.get("destination_address"),
        target_eta_minutes=args.get("target_eta_minutes", 15),
        transport_mode=args.get("transport_mode", "driving"),
        action_payload=args.get("action_payload"),
    ),
    emoji="🚗",
)

registry.register(
    name="cancel_commute_eta_sync",
    toolset="commute",
    schema=CANCEL_COMMUTE_ETA_SYNC_SCHEMA,
    handler=lambda args, **kw: cancel_commute_eta_sync(),
    emoji="🛑",
)

registry.register(
    name="get_commute_eta_sync_status",
    toolset="commute",
    schema=GET_COMMUTE_ETA_SYNC_STATUS_SCHEMA,
    handler=lambda args, **kw: get_commute_eta_sync_status(),
    emoji="📍",
)
