#!/usr/bin/env python3
"""Where the user is now: the location of the device they are chatting from.

Round-trips through the gateway's blocking-prompt bridge like ``read_window_below``:
``location.read`` -> the Scout app (the phone shell's GPS, or the computer's location services)
-> its answer. With a destination it also estimates the drive there, so "order it to arrive when
I'm home" can be timed from the user's real position.

The drive estimate is local on purpose: no routing service sees the user's coordinates, and the
free ones assume empty roads, which in a city is further off than a calibrated estimate.
"""

import json
import logging
import math
import subprocess
import sys
import urllib.parse
import urllib.request
from pathlib import Path
from typing import Callable, Optional

from tools.registry import registry, tool_error

logger = logging.getLogger(__name__)

# Door-to-door city driving, peak-hour average (Bengaluru, Mumbai, Delhi sit around 18-22 km/h),
# and road distance over straight-line distance for a city grid.
CITY_DRIVE_KMH = 20.0
ROAD_DETOUR = 1.35
_APPLE_MAPS_BIN = Path(__file__).parent / "apple_maps_nav"


def apple_mapkit_drive_route(o_lat: float, o_lon: float, d_lat: float, d_lon: float) -> Optional[dict]:
    """Traffic-aware driving distance and ETA directly from native Apple Maps (MapKit MKDirections)."""
    if sys.platform != "darwin" or not _APPLE_MAPS_BIN.exists():
        return None
    try:
        proc = subprocess.run(
            [str(_APPLE_MAPS_BIN), str(o_lat), str(o_lon), str(d_lat), str(d_lon)],
            capture_output=True,
            text=True,
            timeout=6,
            check=False,
        )
        if proc.returncode == 0 and proc.stdout.strip():
            data = json.loads(proc.stdout.strip())
            return {
                "road_km_estimate": float(data["road_km"]),
                "drive_minutes_estimate": int(data["drive_minutes"]),
                "method": "Apple Maps (MapKit MKDirections with live traffic)",
            }
    except Exception as exc:
        logger.debug("Apple MapKit navigation query failed: %s", exc)
    return None


def reverse_geocode(lat: float, lon: float) -> Optional[str]:
    """Resolve latitude/longitude into a human-readable street/area address via OpenStreetMap."""
    try:
        url = f"https://nominatim.openstreetmap.org/reverse?lat={lat}&lon={lon}&format=json"
        req = urllib.request.Request(url, headers={"User-Agent": "ScoutAgent/1.0"})
        with urllib.request.urlopen(req, timeout=4) as resp:
            data = json.loads(resp.read().decode("utf-8"))
            if data and isinstance(data, dict):
                # Format friendly street + neighborhood/suburb + city
                addr = data.get("address") or {}
                parts = [
                    addr.get("road") or addr.get("pedestrian") or addr.get("suburb"),
                    addr.get("neighbourhood") or addr.get("residential"),
                    addr.get("city") or addr.get("town") or addr.get("county"),
                ]
                clean = [p for p in parts if p]
                if clean:
                    return ", ".join(clean)
                return data.get("display_name")
    except Exception as exc:
        logger.debug("Reverse geocoding failed for (%s, %s): %s", lat, lon, exc)
    return None


def _haversine_km(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
    rlat1, rlat2 = math.radians(lat1), math.radians(lat2)
    a = (math.sin(math.radians(lat2 - lat1) / 2) ** 2
         + math.cos(rlat1) * math.cos(rlat2) * math.sin(math.radians(lon2 - lon1) / 2) ** 2)
    return 6371.0 * 2 * math.asin(math.sqrt(a))


def osrm_drive_route(o_lat: float, o_lon: float, d_lat: float, d_lon: float) -> Optional[dict]:
    """Calculate true road route distance and driving duration via open road network (OSRM)."""
    try:
        url = f"https://router.project-osrm.org/route/v1/driving/{o_lon},{o_lat};{d_lon},{d_lat}?overview=false&steps=false"
        req = urllib.request.Request(url, headers={"User-Agent": "ScoutAgent/1.0"})
        with urllib.request.urlopen(req, timeout=4) as resp:
            data = json.loads(resp.read().decode("utf-8"))
            if data.get("code") == "Ok" and data.get("routes"):
                r = data["routes"][0]
                road_km = round(r["distance"] / 1000.0, 1)
                # OSRM assumes free flow speeds. Calibrate for city traffic:
                # If distance > 0, estimate urban city travel time around 20 km/h:
                city_drive_min = max(2, round(road_km / CITY_DRIVE_KMH * 60))
                return {
                    "road_km_estimate": road_km,
                    "drive_minutes_estimate": city_drive_min,
                    "osrm_duration_min": round(r["duration"] / 60.0, 1),
                    "method": "OpenStreetMap road network route (OSRM)",
                }
    except Exception as exc:
        logger.debug("OSRM route query failed: %s", exc)
    return None


def drive_estimate(lat: float, lon: float, to_lat: float, to_lon: float) -> dict:
    """Road distance and drive time, preferring native Apple Maps (MapKit) with live traffic, then OSRM, then Haversine."""
    straight = _haversine_km(lat, lon, to_lat, to_lon)
    
    # 1. Native Apple Maps MapKit MKDirections with real-time traffic
    apple = apple_mapkit_drive_route(lat, lon, to_lat, to_lon)
    if apple:
        return {
            "straight_line_km": round(straight, 1),
            **apple,
        }

    # 2. OpenStreetMap OSRM road network routing
    osrm = osrm_drive_route(lat, lon, to_lat, to_lon)
    if osrm:
        return {
            "straight_line_km": round(straight, 1),
            **osrm,
        }

    # 3. Geometric fallback
    road = straight * ROAD_DETOUR
    return {
        "straight_line_km": round(straight, 1),
        "road_km_estimate": round(road, 1),
        "drive_minutes_estimate": max(1, round(road / CITY_DRIVE_KMH * 60)),
        "method": (f"estimate: straight line x{ROAD_DETOUR} for roads at {CITY_DRIVE_KMH:g} km/h city "
                   "driving; no live traffic"),
    }


def device_location_tool(to_latitude: Optional[float] = None, to_longitude: Optional[float] = None,
                         to_place_name: Optional[str] = None,
                         callback: Optional[Callable] = None) -> str:
    if callback is None:
        return tool_error("device_location only works while the user chats from the Scout app (phone or desktop).")
    try:
        raw = callback()
    except Exception as exc:
        return tool_error(f"Could not read the device's location: {exc}")
    try:
        found = json.loads(raw) if isinstance(raw, str) and raw else raw
    except ValueError:
        found = None
    if not isinstance(found, dict) or found.get("error") or found.get("latitude") is None:
        reason = found.get("error") if isinstance(found, dict) else None
        return tool_error(
            f"The device did not share its location ({reason or 'no answer from the Scout app'}). "
            "Ask the user where they are, or to allow location access for Scout.")
    result = {
        "latitude": float(found["latitude"]),
        "longitude": float(found["longitude"]),
        "accuracy_m": found.get("accuracy"),
        "device": found.get("device") or "unknown",
    }
    address = reverse_geocode(result["latitude"], result["longitude"])
    if address:
        result["address"] = address
        result["street_name"] = address

    # Resolve destination from to_place_name if coordinates are not explicitly passed
    if (to_latitude is None or to_longitude is None) and to_place_name:
        try:
            from tools.commute_eta_sync_tool import resolve_saved_location
            saved = resolve_saved_location(to_place_name)
            if saved:
                to_latitude = saved["latitude"]
                to_longitude = saved["longitude"]
                result["destination_name"] = saved["name"]
        except Exception:
            pass

    if to_latitude is not None and to_longitude is not None:
        try:
            result["to"] = {"latitude": float(to_latitude), "longitude": float(to_longitude)}
            result["drive"] = drive_estimate(result["latitude"], result["longitude"],
                                             float(to_latitude), float(to_longitude))
        except (TypeError, ValueError):
            return tool_error("to_latitude and to_longitude must be numbers.")
    return json.dumps(result)


DEVICE_LOCATION_SCHEMA = {
    "name": "device_location",
    "description": (
        "Get the user's current live location from the device they are chatting on (phone GPS or computer location services). "
        "Returns {latitude, longitude, address, street_name, accuracy_m, device}. "
        "To calculate drive route and ETA, pass to_place_name (e.g. 'Condenat Work' or 'Home') or to_latitude/to_longitude: "
        "{latitude, longitude, address, street_name, accuracy_m, device, drive: {straight_line_km, road_km_estimate, drive_minutes_estimate, method}}. "
        "IMPORTANT: In your final response, always refer to locations by their name/street (e.g. 'Frazer Town, Bengaluru' or 'Condé Nast, St. Mark\\'s Road'), "
        "NEVER recite raw decimal coordinates to the user. State the road distance in kilometers and estimated drive time in minutes."
    ),
    "parameters": {
        "type": "object",
        "properties": {
            "to_place_name": {"type": "string", "description": "Name of destination place from saved locations (e.g. 'Condenat Work' or 'Home'). Coordinates will be resolved automatically."},
            "to_latitude": {"type": "number", "description": "Optional destination latitude coordinate."},
            "to_longitude": {"type": "number", "description": "Optional destination longitude coordinate."},
        },
    },
}


registry.register(
    name="device_location",
    toolset="desktop_ui",
    schema=DEVICE_LOCATION_SCHEMA,
    handler=lambda args, **kw: device_location_tool(
        to_latitude=args.get("to_latitude"),
        to_longitude=args.get("to_longitude"),
        to_place_name=args.get("to_place_name"),
        callback=kw.get("callback"),
    ),
    emoji="📍",
)
