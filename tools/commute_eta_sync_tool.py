#!/usr/bin/env python3
"""Commute ETA-Sync Tools: Dual-Timeline Spatial Orchestration & Saved Locations.

Manages arrival-timed actions (deliveries, home automation, notifications) by synchronizing
user travel time (native on-device MapKit/GPS tracking) with live dynamic merchant/service ETAs,
and provides persistent named location storage (Home, Work, Gym, etc.) with automatic address geocoding.
"""

import difflib
import json
import logging
import math
import re
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


_GEOCODE_CACHE: Dict[str, Tuple[Optional[float], Optional[float], Optional[str]]] = {}


def geocode_address(query: str) -> Tuple[Optional[float], Optional[float], Optional[str]]:
    """Free geocoder with Google Plus Code resolution and progressive street/area fallback."""
    import re
    if not query or not query.strip():
        return None, None, None

    cache_key = query.strip().lower()
    if cache_key in _GEOCODE_CACHE:
        return _GEOCODE_CACHE[cache_key]

    # 1. Check for embedded Plus Codes (e.g. XJV8+WPW)
    plus_match = re.search(r'\b([2-9CFGHJMPQRVWX]{4,8}\+[2-9CFGHJMPQRVWX]{2,4})\b', query, re.I)
    if plus_match:
        coords = _decode_plus_code(plus_match.group(1))
        if coords:
            res = (coords[0], coords[1], query.strip())
            _GEOCODE_CACHE[cache_key] = res
            return res

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
                    res = (float(item["lat"]), float(item["lon"]), item.get("display_name", "") or attempt)
                    _GEOCODE_CACHE[cache_key] = res
                    return res
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
    """Resolve a location by saved name ('home', 'work', etc.) or return None."""
    if not target:
        return None
    import unicodedata

    def _normalize(text: str) -> str:
        return "".join(c for c in unicodedata.normalize("NFD", text.lower()) if unicodedata.category(c) != "Mn")

    # If user passed a phrase like 'work at NetApp hoodi' or 'office at Whitefield',
    # they are naming a specific place, not a saved label like 'work' or 'home'.
    m = re.match(r"^(?:my\s+)?(?:work|office|workplace)\s+(?:at|in|near)\s+(.+)$", target.strip(), re.IGNORECASE)
    if m:
        return None

    cleaned = target.strip()
    key = cleaned.lower()
    key_norm = _normalize(cleaned)

    locs = get_saved_locations()
    if not locs:
        return None

    # 1. Exact match on saved location key or name
    for loc_key, val in locs.items():
        name_lower = (val.get("name") or "").lower()
        if key in (loc_key, name_lower) or key_norm in (_normalize(loc_key), _normalize(name_lower)):
            return val

    # 2. Standalone keywords / aliases (only when target itself is just 'work', 'office', 'home')
    synonyms = {
        "office": ["work", "office"],
        "workplace": ["work"],
        "work": ["work"],
        "house": ["home"],
        "home": ["home"],
    }
    if key in synonyms:
        for cand in synonyms[key]:
            for loc_key, val in locs.items():
                if cand in loc_key or cand in (val.get("name") or "").lower():
                    return val

    # 3. Normalized name equality
    for loc_key, val in locs.items():
        name_norm = _normalize(val.get("name") or "")
        loc_norm = _normalize(loc_key)
        if key_norm in (name_norm, loc_norm):
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


def _render_tracking_svg(
    dest_title: str,
    drive_min: Optional[int],
    zepto_min: Optional[int] = None,
    wait_min: Optional[int] = None,
    km_estimate: Optional[float] = None,
) -> str:
    """Generate a lightweight, animated inline SVG tracking card (<1900 chars) for Scout Desktop."""
    drive_str = f"~{drive_min}m" if drive_min is not None else "--"
    short_dest = dest_title.split(",")[0].strip()
    if len(short_dest) > 22:
        short_dest = short_dest[:20] + "…"

    if zepto_min is not None and zepto_min > 0:
        zepto_str = f"~{zepto_min}m"
        order_str = f"in ~{wait_min}m" if (wait_min is not None and wait_min > 0) else ("NOW" if wait_min is not None else "--")
        pills_svg = (
            f'<rect width="60" height="24" rx="4" fill="#1e293b"/>'
            f'<text x="30" y="10" fill="#94a3b8" font-size="7" text-anchor="middle">DRIVE</text>'
            f'<text x="30" y="20" fill="#38bdf8" font-size="9" font-weight="bold" text-anchor="middle">{drive_str}</text>'
            f'<rect x="64" width="60" height="24" rx="4" fill="#1e293b"/>'
            f'<text x="94" y="10" fill="#94a3b8" font-size="7" text-anchor="middle">ZEPTO</text>'
            f'<text x="94" y="20" fill="#c084fc" font-size="9" font-weight="bold" text-anchor="middle">{zepto_str}</text>'
            f'<rect x="128" width="68" height="24" rx="4" fill="#1e293b" stroke="#f59e0b" stroke-width="0.8"/>'
            f'<text x="162" y="10" fill="#f59e0b" font-size="7" text-anchor="middle">ORDER IN</text>'
            f'<text x="162" y="20" fill="#fbbf24" font-size="9" font-weight="bold" text-anchor="middle">{order_str}</text>'
        )
    else:
        km_str = f"{km_estimate}km" if km_estimate else "--"
        pills_svg = (
            f'<rect width="68" height="24" rx="4" fill="#1e293b"/>'
            f'<text x="34" y="10" fill="#94a3b8" font-size="7" text-anchor="middle">LIVE DRIVE</text>'
            f'<text x="34" y="20" fill="#38bdf8" font-size="9" font-weight="bold" text-anchor="middle">{drive_str}</text>'
            f'<rect x="72" width="64" height="24" rx="4" fill="#1e293b"/>'
            f'<text x="104" y="10" fill="#94a3b8" font-size="7" text-anchor="middle">DISTANCE</text>'
            f'<text x="104" y="20" fill="#34d399" font-size="9" font-weight="bold" text-anchor="middle">{km_str}</text>'
            f'<rect x="140" width="56" height="24" rx="4" fill="#1e293b"/>'
            f'<text x="168" y="10" fill="#94a3b8" font-size="7" text-anchor="middle">TRAFFIC</text>'
            f'<text x="168" y="20" fill="#facc15" font-size="9" font-weight="bold" text-anchor="middle">LIVE</text>'
        )

    return (
        f"```svg\n"
        f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 480 74" width="100%" height="74" style="background:#0f172a;border:1px solid #1e293b;border-radius:8px;font-family:sans-serif">'
        f'<g transform="translate(16,20)">'
        f'<circle r="10" fill="#10b981" opacity="0.2"><animate attributeName="r" values="5;12;5" dur="2s" repeatCount="indefinite"/><animate attributeName="opacity" values="0.5;0;0.5" dur="2s" repeatCount="indefinite"/></circle>'
        f'<circle r="4" fill="#10b981"/>'
        f'</g>'
        f'<text x="32" y="17" fill="#10b981" font-size="10" font-weight="bold">TRACKING ACTIVE</text>'
        f'<text x="32" y="29" fill="#94a3b8" font-size="9">{short_dest}</text>'
        f'<g transform="translate(260,8)">{pills_svg}</g>'
        f'<g transform="translate(16,52)">'
        f'<line x2="448" stroke="#334155" stroke-width="2" stroke-dasharray="4 4"/>'
        f'<circle r="3" fill="#64748b"/>'
        f'<circle cx="448" r="3.5" fill="#10b981"/>'
        f'<text x="448" y="12" fill="#10b981" font-size="7" text-anchor="end">{short_dest}</text>'
        f'<circle r="4" fill="#38bdf8"><animate attributeName="cx" values="0;448;0" dur="5s" repeatCount="indefinite"/></circle>'
        f'</g>'
        f'</svg>\n'
        f"```"
    )


def _tracking_summary_text(
    dest_title: str,
    user_eta_min: Optional[int],
    eta_min: Optional[int],
    wait_min: Optional[int],
    km: Optional[float],
    *,
    live_update: bool = False,
    has_target_eta: bool = False,
    origin_address: Optional[str] = None,
) -> str:
    """Plain markdown status for commute tracking (no SVG fence)."""
    km_str = f" ({km} km)" if km else ""
    head = "🟢 **Commute Tracking Active**"
    if live_update:
        head += " (Live Update)"

    loc_line = ""
    if origin_address:
        loc_line = f"• **Your location:** {origin_address}\n"

    if has_target_eta and user_eta_min is not None and eta_min is not None:
        if wait_min is not None and wait_min > 1:
            return (
                f"{head}\n"
                f"{loc_line}"
                f"• **Destination:** {dest_title}\n"
                f"• **Live Drive Time:** ~{user_eta_min} minutes{km_str} via Apple Maps live traffic\n"
                f"• **Delivery ETA:** ~{eta_min} minutes\n"
                f"• **Optimal Order Window:** Order in ~{wait_min} minutes (when you are {eta_min} minutes away so you arrive together)\n\n"
                f"Call `get_commute_eta_sync_status` while you move — live GPS refreshes on each check."
            )
        if wait_min is not None and wait_min >= -2:
            return (
                f"{head}\n"
                f"{loc_line}"
                f"• **Destination:** {dest_title}\n"
                f"• **Live Drive Time:** ~{user_eta_min} minutes{km_str} via Apple Maps live traffic\n"
                f"• **Delivery ETA:** ~{eta_min} minutes\n"
                f"• **Optimal Order Window:** Place the order **RIGHT NOW** so both you and your delivery arrive together!"
            )
        late = abs(wait_min) if wait_min is not None else 0
        return (
            f"{head}\n"
            f"{loc_line}"
            f"• **Destination:** {dest_title}\n"
            f"• **Live Drive Time:** ~{user_eta_min} minutes{km_str}\n"
            f"• **Delivery ETA:** ~{eta_min} minutes\n"
            f"• **Status:** You will arrive ~{late} minutes before delivery — place the order immediately!"
        )
    if has_target_eta:
        return (
            f"{head}\n"
            f"{loc_line}"
            f"• **Destination:** {dest_title}\n"
            f"• **Delivery ETA:** ~{eta_min} minutes\n"
            f"• **Status:** Commute convergence monitoring initialized. Live Apple Maps drive time updates on each status check."
        )
    if user_eta_min is not None:
        return (
            f"{head}\n"
            f"{loc_line}"
            f"• **Destination:** {dest_title}\n"
            f"• **Live Drive Time:** ~{user_eta_min} minutes{km_str} via Apple Maps live traffic\n"
            f"• **Status:** Live commute tracking active. Monitoring your convergence toward {dest_title}."
        )
    return (
        f"{head}\n"
        f"{loc_line}"
        f"• **Destination:** {dest_title}\n"
        f"• **Status:** Commute tracking initialized. Live Apple Maps drive time updates on each status check."
    )


def _tracking_fields(
    dest_title: str,
    user_eta_min: Optional[int],
    eta_min: Optional[int],
    wait_min: Optional[int],
    km: Optional[float],
    *,
    live_update: bool = False,
    has_target_eta: bool = False,
    origin_address: Optional[str] = None,
) -> dict[str, Optional[str]]:
    """Split SVG card from prose so the chat UI renders one card, not a duplicated fence."""
    summary = _tracking_summary_text(
        dest_title,
        user_eta_min,
        eta_min,
        wait_min,
        km,
        live_update=live_update,
        has_target_eta=has_target_eta,
        origin_address=origin_address,
    )
    return {
        "tracking_card_markdown": _render_tracking_svg(dest_title, user_eta_min, eta_min, wait_min, km_estimate=km),
        "tracking_summary": summary,
        "order_timing_advice": summary,
    }


def _normalize_legacy_tracking(record: dict) -> None:
    """Older sessions stored SVG + markdown in one field; split for clients and the model."""
    if record.get("tracking_card_markdown") and record.get("tracking_summary"):
        record["order_timing_advice"] = record["tracking_summary"]
        return
    advice = record.get("order_timing_advice") or ""
    if not advice.startswith("```svg"):
        return
    split_at = advice.find("\n\n")
    if split_at == -1:
        return
    record["tracking_card_markdown"] = advice[:split_at].strip()
    record["tracking_summary"] = advice[split_at + 2 :].strip()
    record["order_timing_advice"] = record["tracking_summary"]


def start_commute_eta_sync(
    destination_lat: Optional[float] = None,
    destination_lng: Optional[float] = None,
    destination_name: Optional[str] = None,
    destination_address: Optional[str] = None,
    target_eta_minutes: Optional[int] = None,
    transport_mode: str = "driving",
    action_payload: Optional[Dict[str, Any]] = None,
    location_callback: Optional[Any] = None,
) -> str:
    """Initialize the dual-timeline commute ETA tracking engine."""
    resolved_name = None

    # 1. Check saved location name first (or fuzzy match on destination_address)
    if (destination_lat is None or destination_lng is None) and (destination_name or destination_address):
        saved = resolve_saved_location(destination_name or destination_address)
        if saved:
            destination_lat = saved["latitude"]
            destination_lng = saved["longitude"]
            resolved_name = saved.get("address") or saved["name"]

    # 2. Check destination_address via geocoding if still unresolved
    if (destination_lat is None or destination_lng is None) and destination_address:
        geo_lat, geo_lng, geo_disp = geocode_address(destination_address)
        if geo_lat is not None and geo_lng is not None:
            destination_lat, destination_lng = geo_lat, geo_lng
            resolved_name = geo_disp or destination_address

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

    live_route_info = None
    user_eta_min = None
    if callable(location_callback):
        try:
            from tools.device_location_tool import device_location_tool
            loc_raw = device_location_tool(
                to_latitude=dest_lat,
                to_longitude=dest_lng,
                callback=location_callback,
            )
            loc_data = json.loads(loc_raw) if isinstance(loc_raw, str) else loc_raw
            if isinstance(loc_data, dict) and isinstance(loc_data.get("drive"), dict):
                live_route_info = {
                    "origin_address": loc_data.get("address"),
                    "device": loc_data.get("device"),
                    **loc_data["drive"],
                }
                user_eta_min = loc_data["drive"].get("drive_minutes_estimate")
        except Exception:
            pass

    if user_eta_min is None:
        prev_sync = _read_active_sync()
        if prev_sync and prev_sync.get("last_user_eta_minutes"):
            user_eta_min = prev_sync["last_user_eta_minutes"]
            live_route_info = prev_sync.get("live_route")

    has_target_eta = (target_eta_minutes is not None and int(target_eta_minutes) > 0)
    eta_min = int(target_eta_minutes) if has_target_eta else None
    dest_title = resolved_name or destination_name or "your destination"
    km = live_route_info.get("road_km_estimate") if live_route_info else None
    wait_min = (user_eta_min - eta_min) if (user_eta_min is not None and eta_min is not None) else None
    origin_address = live_route_info.get("origin_address") if live_route_info else None
    tracking = _tracking_fields(
        dest_title,
        user_eta_min,
        eta_min,
        wait_min,
        km,
        has_target_eta=has_target_eta,
        origin_address=origin_address,
    )
    order_timing_advice = tracking["tracking_summary"]

    record = {
        "sync_id": sync_id,
        "status": "tracking",
        "created_at": time.time(),
        "destination": {"lat": dest_lat, "lng": dest_lng, "name": resolved_name or destination_name or "Destination"},
        "target_eta_minutes": eta_min,
        "transport_mode": mode,
        "action_payload": payload,
        "last_checked_at": time.time() if user_eta_min is not None else None,
        "last_user_eta_minutes": user_eta_min,
        "live_route": live_route_info,
        **tracking,
    }

    _write_active_sync(record)

    merchant = payload.get("merchant_provider") or payload.get("provider") or "Service"
    action = payload.get("action") or "Action"
    dest_display = f"{record['destination']['name']}"

    return json.dumps({
        "success": True,
        "sync_id": sync_id,
        "status": "tracking",
        "message": order_timing_advice or f"Commute ETA-Sync initialized for {merchant} ({action}). Tracking user convergence toward {dest_display} with initial {eta_min}m target ETA.",
        "tracking_card_markdown": tracking.get("tracking_card_markdown"),
        "tracking_summary": tracking.get("tracking_summary"),
        "origin_address": origin_address,
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


def get_commute_eta_sync_status(location_callback: Optional[Any] = None) -> str:
    """Query the live status of the active commute ETA sync session and recalculate live route ETA."""
    active = _read_active_sync()
    if not active:
        return json.dumps({"active": False, "status": "idle", "message": "No commute sync is currently active."})

    dest = active.get("destination") or {}
    dest_lat = dest.get("lat")
    dest_lng = dest.get("lng")
    dest_name = dest.get("name") or "Destination"
    raw_target = active.get("target_eta_minutes")
    has_target_eta = (raw_target is not None and int(raw_target) > 0)
    eta_min = int(raw_target) if has_target_eta else None

    # Refresh live GPS & Apple Maps route ETA if device location callback is available
    if callable(location_callback) and dest_lat is not None and dest_lng is not None:
        try:
            from tools.device_location_tool import device_location_tool
            loc_raw = device_location_tool(
                to_latitude=float(dest_lat),
                to_longitude=float(dest_lng),
                callback=location_callback,
            )
            loc_data = json.loads(loc_raw) if isinstance(loc_raw, str) else loc_raw
            if isinstance(loc_data, dict) and isinstance(loc_data.get("drive"), dict):
                live_route_info = {
                    "origin_address": loc_data.get("address"),
                    "device": loc_data.get("device"),
                    **loc_data["drive"],
                }
                user_eta_min = loc_data["drive"].get("drive_minutes_estimate")
                active["last_checked_at"] = time.time()
                active["last_user_eta_minutes"] = user_eta_min
                active["live_route"] = live_route_info
                if user_eta_min is not None:
                    km = live_route_info.get("road_km_estimate") if live_route_info else None
                    wait_min = (user_eta_min - eta_min) if has_target_eta and eta_min is not None else None
                    origin = live_route_info.get("origin_address") if live_route_info else None
                    active.update(
                        _tracking_fields(
                            dest_name,
                            user_eta_min,
                            eta_min,
                            wait_min,
                            km,
                            live_update=True,
                            has_target_eta=has_target_eta and eta_min is not None,
                            origin_address=origin,
                        )
                    )
                _write_active_sync(active)
        except Exception:
            pass

    _normalize_legacy_tracking(active)

    if not active.get("tracking_card_markdown"):
        last_eta = active.get("last_user_eta_minutes")
        target_eta = active.get("target_eta_minutes")
        has_t = (target_eta is not None and int(target_eta) > 0)
        t_min = int(target_eta) if has_t else None
        wait_m = (last_eta - t_min) if last_eta is not None and t_min is not None else None
        live_rt = active.get("live_route") or {}
        km_val = live_rt.get("road_km_estimate")
        active.update(
            _tracking_fields(
                dest_name,
                last_eta,
                t_min,
                wait_m,
                km_val,
                live_update=True,
                has_target_eta=has_t and last_eta is not None and t_min is not None,
                origin_address=live_rt.get("origin_address"),
            )
        )
        _write_active_sync(active)

    elapsed_min = round((time.time() - float(active.get("created_at") or time.time())) / 60.0, 1)
    live_rt = active.get("live_route") or {}
    return json.dumps({
        "active": True,
        "elapsed_minutes": elapsed_min,
        "tracking_card_markdown": active.get("tracking_card_markdown"),
        "tracking_summary": active.get("tracking_summary") or active.get("order_timing_advice"),
        "origin_address": live_rt.get("origin_address"),
        "last_checked_at": active.get("last_checked_at"),
        **active,
    })


def set_commute_arrival_reminder(
    minutes_before: int,
    reminder_text: str,
) -> str:
    """Schedule a reminder to fire X minutes before reaching the destination during commute tracking."""
    from planner import reminders
    from tools.cronjob_job_args import _origin_from_env

    active = _read_active_sync()
    if not active or active.get("status") != "tracking":
        return json.dumps({
            "success": False,
            "error": "No active commute tracking session found. Start commute tracking first.",
        })

    dest = active.get("destination") or {}
    dest_name = dest.get("name") or "your destination"
    last_eta = active.get("last_user_eta_minutes")
    if last_eta is None:
        last_eta = 30

    last_checked = float(active.get("last_checked_at") or active.get("created_at") or time.time())
    elapsed = (time.time() - last_checked) / 60.0
    remaining_drive = max(0.0, float(last_eta) - elapsed)

    lead_min = int(minutes_before)
    if remaining_drive <= lead_min:
        # User is already within the arrival threshold or has already arrived!
        when_str = "in 1m"
        added = reminders.add_reminder(reminder_text, when_str, actor="agent", origin=_origin_from_env(when_str))
        return json.dumps({
            "success": True,
            "immediate": True,
            "remaining_drive_minutes": round(remaining_drive, 1),
            "message": f"You are already within {lead_min} minutes of {dest_name} (only ~{int(round(remaining_drive))}m away)! Alerting now: '{reminder_text}'.",
            "reminder": added.get("reminder"),
        })

    fire_in = max(1, int(round(remaining_drive - lead_min)))
    when_str = f"in {fire_in}m"
    added = reminders.add_reminder(reminder_text, when_str, actor="agent", origin=_origin_from_env(when_str))
    return json.dumps({
        "success": True,
        "scheduled": True,
        "fires_in_minutes": fire_in,
        "lead_minutes": lead_min,
        "destination": dest_name,
        "remaining_drive_minutes": round(remaining_drive, 1),
        "message": f"Scheduled reminder to fire in {fire_in} minutes ({lead_min} minutes before reaching {dest_name}): '{reminder_text}'.",
        "reminder": added.get("reminder"),
    })


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
        "When the user explicitly asks to track/monitor their ETA or commute, call this after the destination is known; "
        "the app shows its tracking summary as a chat card. Tracking refreshes only when get_commute_eta_sync_status "
        "is called, so do not promise continuous background polling. Also initialize commute ETA synchronization or "
        "calculate when to place a delivery order (e.g. Zepto, Swiggy, Zomato) "
        "so that the delivery arrives right when the user reaches their destination. "
        "Synchronizes user travel ETA toward destination (e.g. 'Condenat Work', 'Home', or any address) with the dynamic service/delivery ETA "
        "in target_eta_minutes (for Zepto, first check mcp__zepto__get_location_serviceability for the destination coordinates and get the live ETA, "
        "AND call device_location(to_place_name=...) to get the user's live Apple Maps driving ETA)."
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
    "description": (
        "Refresh and inspect the active commute ETA-sync session. Calling this requests a fresh device location/route ETA; "
        "there is no silent background poll while the app is idle."
    ),
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
        target_eta_minutes=args.get("target_eta_minutes"),
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

SET_COMMUTE_ARRIVAL_REMINDER_SCHEMA = {
    "name": "set_commute_arrival_reminder",
    "description": (
        "Schedule a reminder that fires X minutes before arriving at the commute destination "
        "(e.g. '5 mins before reaching NetApp, remind me to eat pasta'). "
        "Calculates the exact fire time based on live drive time minus minutes_before. "
        "If the user is already within X minutes of arrival or has reached, alerts immediately."
    ),
    "parameters": {
        "type": "object",
        "properties": {
            "minutes_before": {
                "type": "integer",
                "description": "How many minutes before reaching the destination the reminder should fire (e.g. 5 for '5 mins before reaching').",
            },
            "reminder_text": {
                "type": "string",
                "description": "The reminder notification text delivered to the user.",
            },
        },
        "required": ["minutes_before", "reminder_text"],
    },
}

registry.register(
    name="set_commute_arrival_reminder",
    toolset="commute",
    schema=SET_COMMUTE_ARRIVAL_REMINDER_SCHEMA,
    handler=lambda args, **kw: set_commute_arrival_reminder(
        minutes_before=args.get("minutes_before", 5),
        reminder_text=args.get("reminder_text", ""),
    ),
    emoji="⏰",
)
