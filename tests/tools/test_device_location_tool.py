"""device_location relays the app's answer and estimates the drive to a destination."""

import json

from tools.device_location_tool import device_location_tool, drive_estimate

OFFICE = (12.9530, 77.6421)  # Domlur, Bengaluru
HOME = (12.9988, 77.6141)    # Frazer Town, ~6 km away


def test_drive_estimate_grows_with_distance_and_is_never_zero():
    near = drive_estimate(*HOME, HOME[0] + 0.001, HOME[1])
    far = drive_estimate(*OFFICE, *HOME)
    assert near["drive_minutes_estimate"] >= 1
    assert far["road_km_estimate"] > far["straight_line_km"] > 0
    assert far["drive_minutes_estimate"] > near["drive_minutes_estimate"]


def test_location_with_a_destination_carries_the_drive():
    answer = json.dumps({"latitude": OFFICE[0], "longitude": OFFICE[1], "accuracy": 20, "device": "phone"})
    result = json.loads(device_location_tool(*HOME, callback=lambda: answer))
    assert (result["latitude"], result["device"]) == (OFFICE[0], "phone")
    assert result["drive"]["drive_minutes_estimate"] == drive_estimate(*OFFICE, *HOME)["drive_minutes_estimate"]


def test_a_refusal_or_no_app_is_an_error_the_agent_can_relay():
    refused = json.loads(device_location_tool(callback=lambda: json.dumps({"error": "Location access was not allowed."})))
    assert "not allowed" in refused["error"]
    assert "error" in json.loads(device_location_tool(callback=lambda: ""))
    assert "Scout app" in json.loads(device_location_tool(callback=None))["error"]
