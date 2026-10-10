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
import math
from typing import Callable, Optional

from tools.registry import registry, tool_error

# Door-to-door city driving, peak-hour average (Bengaluru, Mumbai, Delhi sit around 18-22 km/h),
# and road distance over straight-line distance for a city grid.
CITY_DRIVE_KMH = 20.0
ROAD_DETOUR = 1.35


def _haversine_km(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
    rlat1, rlat2 = math.radians(lat1), math.radians(lat2)
    a = (math.sin(math.radians(lat2 - lat1) / 2) ** 2
         + math.cos(rlat1) * math.cos(rlat2) * math.sin(math.radians(lon2 - lon1) / 2) ** 2)
    return 6371.0 * 2 * math.asin(math.sqrt(a))


def drive_estimate(lat: float, lon: float, to_lat: float, to_lon: float) -> dict:
    """Road distance and drive time from the straight line between two points."""
    straight = _haversine_km(lat, lon, to_lat, to_lon)
    road = straight * ROAD_DETOUR
    return {
        "straight_line_km": round(straight, 1),
        "road_km_estimate": round(road, 1),
        "drive_minutes_estimate": max(1, round(road / CITY_DRIVE_KMH * 60)),
        "method": (f"estimate: straight line x{ROAD_DETOUR} for roads at {CITY_DRIVE_KMH:g} km/h city "
                   "driving; no live traffic"),
    }


def device_location_tool(to_latitude: Optional[float] = None, to_longitude: Optional[float] = None,
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
        "The user's current location, from the device they are chatting on (phone GPS or the "
        "computer's location services). Pass to_latitude/to_longitude (e.g. their home address's "
        "coordinates) to also get a drive estimate there: {latitude, longitude, accuracy_m, device, "
        "drive: {road_km_estimate, drive_minutes_estimate, method}}. The drive time is an estimate "
        "without live traffic; say so if you quote it. The user may decline; then ask where they are."
    ),
    "parameters": {
        "type": "object",
        "properties": {
            "to_latitude": {"type": "number", "description": "Destination latitude for a drive estimate."},
            "to_longitude": {"type": "number", "description": "Destination longitude for a drive estimate."},
        },
    },
}


registry.register(
    name="device_location",
    toolset="desktop_ui",
    schema=DEVICE_LOCATION_SCHEMA,
    handler=lambda args, **kw: device_location_tool(
        args.get("to_latitude"), args.get("to_longitude"), callback=kw.get("callback")),
    emoji="📍",
)
