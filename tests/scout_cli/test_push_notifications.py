"""A paired phone whose Scout app is closed hears what it would have seen on screen
(scout_cli/push/): replies in chats it follows, approvals from any chat, results of tasks Scout ran
on its own, and the Live Activity on the lock screen. A phone with the app open is left to the page.

The phone's own calls (scout_cli/web_routers/push.py) set each scenario up, and the events come
through the real chat-server and scheduler hooks; only the two push services are replaced.
"""

import threading
from types import SimpleNamespace

import jwt
import pytest
from cryptography.hazmat.primitives import serialization
from cryptography.hazmat.primitives.asymmetric import ec

from scout_cli import web_server
from scout_cli.push import apns, devices, expo, notifier
from scout_constants import get_scout_home
from tui_gateway import server

pytest.importorskip("starlette.testclient")
from starlette.testclient import TestClient  # noqa: E402

# expo-live-activity's LiveActivityAttributes.ContentState: a key outside it makes iOS drop the update.
CONTENT_STATE_KEYS = {"title", "subtitle", "timerEndDateInMilliseconds", "progress", "imageName",
                      "dynamicIslandImageName"}


@pytest.fixture
def phone(monkeypatch):
    monkeypatch.setattr(web_server.app.state, "auth_required", False, raising=False)
    client = TestClient(web_server.app)
    client.headers[web_server._SESSION_HEADER_NAME] = web_server._SESSION_TOKEN

    def setup(device_id, platform, *, expo_token=None, push_to_start=None, watching=None, on_screen=False):
        assert client.post("/api/push/devices", json={
            "device_id": device_id, "platform": platform, "expo_token": expo_token,
            "push_to_start_token": push_to_start}).status_code == 200
        if watching:
            assert client.post(f"/api/push/devices/{device_id}/presence",
                               json={"foreground": True, "watching": watching}).status_code == 200
        assert client.post(f"/api/push/devices/{device_id}/presence", json={"foreground": on_screen}).status_code == 200

    setup.client = client
    return setup


@pytest.fixture
def expo_outbox(monkeypatch):
    sent = []

    refusals = {"tok-removed": "DeviceNotRegistered", "tok-no-keys": "InvalidCredentials"}

    def post(_url, batch):
        sent.extend(batch)
        return {"data": [{"status": "error", "details": {"error": refusals[msg["to"]]}} if msg["to"] in refusals
                         else {"status": "ok", "id": "ticket"} for msg in batch]}

    monkeypatch.setattr(expo, "_post", post)
    return sent


def _by_phone(outbox):
    seen = {}
    for msg in outbox:
        seen.setdefault(msg["to"], []).append((msg["title"], msg["body"], msg["data"]))
    return seen


def test_closed_app_hears_followed_replies_and_every_approval(phone, expo_outbox, monkeypatch):
    phone("iphone", "ios", expo_token="tok-iphone", watching="chat-1")
    phone("pixel", "android", expo_token="tok-pixel", watching="chat-1", on_screen=True)
    phone("ipad", "ios", expo_token="tok-ipad")
    phone("old-phone", "android", expo_token="tok-removed")
    phone("unsigned-build", "ios", expo_token="tok-no-keys")
    monkeypatch.setattr(server, "write_json", lambda frame: True)
    monkeypatch.setitem(server._sessions, "runtime-1", {
        "session_key": "chat-1", "pending_title": "Dinner plan", "history_lock": threading.Lock()})

    server._emit("message.complete", "runtime-1",
                 {"text": "**Ordered** from [Zepto](https://www.zeptonow.com), arriving 7:41", "status": "complete"})
    server._push_server_request("approval", "runtime-1", {
        "request_id": "r1", "order": {"merchant": "Zepto", "total": 412, "items": [{"name": "Lays", "quantity": 2}]}})
    notifier._queue.join()

    approval = ("Approve your Zepto order", "₹412 · 2 × Lays", {"sessionId": "chat-1"})
    assert _by_phone(expo_outbox) == {
        "tok-iphone": [("Dinner plan", "Ordered from Zepto, arriving 7:41", {"sessionId": "chat-1"}), approval],
        "tok-ipad": [approval],
        "tok-removed": [approval],
        "tok-no-keys": [approval],
    }
    # Expo said that token no longer reaches a phone: it is not tried again.
    assert {d["id"]: d["expo_token"] for d in devices.all_devices(get_scout_home())}["old-phone"] is None
    # Each phone learns whether the server's notifications reach it, so it posts its own only if not.
    delivers = {device: phone.client.post(f"/api/push/devices/{device}/presence", json={"foreground": False}).json()
                ["delivers"] for device in ("iphone", "unsigned-build")}
    assert delivers == {"iphone": True, "unsigned-build": False}


def test_lock_screen_follows_the_turn_through_apple_with_a_signed_token(phone, monkeypatch):
    key = ec.generate_private_key(ec.SECP256R1())
    home = get_scout_home()
    (home / "push").mkdir(parents=True, exist_ok=True)
    apns.key_path(home).write_bytes(key.private_bytes(
        serialization.Encoding.PEM, serialization.PrivateFormat.PKCS8, serialization.NoEncryption()))
    (home / "config.yaml").write_text("push:\n  apns:\n    team_id: TEAM123456\n    key_id: KEY1234567\n")
    posts = []
    apple = SimpleNamespace(post=lambda url, json, headers: posts.append((url, json, headers))
                            or SimpleNamespace(status_code=200))
    monkeypatch.setattr(apns, "_http2_client", lambda: apple)
    phone("iphone", "ios", watching="chat-2")
    assert phone.client.post("/api/push/devices/iphone/live-activity",
                             json={"session_id": "chat-2", "token": "activity-1"}).status_code == 200
    phone("closed-iphone", "ios", push_to_start="start-1", watching="chat-3")

    notifier.activity("chat-2", "Checking where you are", "Snacks")
    notifier.activity("chat-2", "Checking where you are", "Snacks")
    notifier.activity("chat-3", "Searching Zepto", "Party")
    notifier.finished("chat-2", "Ordered", "Snacks")
    notifier._queue.join()

    assert [(url.rsplit("/", 1)[1], body["aps"]["event"]) for url, body, _ in posts] == [
        ("activity-1", "update"), ("start-1", "start"), ("activity-1", "end")]
    for url, body, headers in posts:
        assert url.startswith(f"{apns.HOSTS['development']}/3/device/")
        assert headers["apns-push-type"] == "liveactivity"
        assert headers["apns-topic"] == "com.spaceshipresearch.scout.push-type.liveactivity"
        assert set(body["aps"]["content-state"]) <= CONTENT_STATE_KEYS
        token = headers["authorization"].removeprefix("bearer ")
        assert jwt.get_unverified_header(token)["kid"] == "KEY1234567"
        assert jwt.decode(token, key.public_key(), algorithms=["ES256"])["iss"] == "TEAM123456"
    started = posts[1][1]["aps"]
    assert (started["attributes-type"], started["attributes"]["name"]) == ("LiveActivityAttributes", "scout:chat-3")
    ended = posts[2][1]["aps"]
    assert ended["content-state"]["title"] == "Done" and ended["dismissal-date"] > ended["timestamp"]


def test_a_task_that_reports_only_in_the_app_reaches_a_closed_phone(phone, expo_outbox):
    from cron.scheduler_delivery import _deliver_result

    phone("iphone", "ios", expo_token="tok-iphone")

    _deliver_result({"id": "job-1", "name": "Zepto order at 18:42", "deliver": "local"},
                    "Placed: **2 × Lays**, arriving 19:05")
    notifier._queue.join()

    assert _by_phone(expo_outbox) == {
        "tok-iphone": [("Zepto order at 18:42", "Placed: 2 × Lays, arriving 19:05", {"jobId": "job-1"})]}
