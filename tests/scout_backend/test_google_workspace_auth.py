"""One-click Google Workspace sign-in: the browser's redirect lands on Scout's loopback listener and
leaves the token the google-workspace skill reads — no URL copied back by hand."""

from __future__ import annotations

import json
import stat
import time
import urllib.request
from pathlib import Path
from urllib.parse import parse_qs, urlencode, urlsplit

import pytest

from scout_backend import google_workspace_auth as gws

SKILL_SETUP = Path(__file__).resolve().parents[2] / "skills/productivity/google-workspace/scripts/setup.py"


class _Resp:
    def __init__(self, status, body):
        self.status_code, self._body = status, body
        self.headers = {"content-type": "application/json"}

    def json(self):
        return self._body


@pytest.fixture
def google(monkeypatch, tmp_path):
    import httpx

    seen = {}

    def post(url, data=None, timeout=None):
        seen[url] = data
        return _Resp(200, {"access_token": "at", "refresh_token": "rt", "expires_in": 3600,
                           "scope": " ".join(gws.SCOPES)})

    monkeypatch.setattr(httpx, "post", post)
    monkeypatch.setattr(httpx, "get", lambda *a, **k: _Resp(200, {"emailAddress": "me@gmail.com"}))
    gws.save_client(tmp_path, "123-abc.apps.googleusercontent.com", "shh")
    return tmp_path, seen


def _browser_returns(auth_url: str, **override) -> str:
    query = parse_qs(urlsplit(auth_url).query)
    params = {"state": query["state"][0], "code": "4/code", "scope": query["scope"][0], **override}
    with urllib.request.urlopen(f"{query['redirect_uri'][0]}?{urlencode(params)}", timeout=10) as resp:
        return resp.read().decode()


def _settled(flow_id, home):
    deadline = time.time() + 5
    while (result := gws.poll_sign_in(flow_id, home))["status"] == "pending" and time.time() < deadline:
        time.sleep(0.05)
    return result


def test_browser_redirect_signs_in_and_leaves_the_skills_token(google):
    home, seen = google
    started = gws.start_sign_in(home)
    query = parse_qs(urlsplit(started["auth_url"]).query)
    assert query["redirect_uri"][0].startswith("http://127.0.0.1:") and query["access_type"] == ["offline"]

    assert "Signed in to Google" in _browser_returns(started["auth_url"])
    assert _settled(started["flow_id"], home)["status"] == "done"

    # PKCE: the exchange proves possession of the verifier behind the challenge it sent.
    assert seen[gws.TOKEN_URI]["code_verifier"] and seen[gws.TOKEN_URI]["redirect_uri"] == query["redirect_uri"][0]
    token = json.loads((home / "google_token.json").read_text())
    assert token["type"] == "authorized_user" and token["refresh_token"] == "rt"
    state = gws.status(home)
    assert state["signed_in"] and state["account"] == "me@gmail.com"
    assert all(service["granted"] for service in state["services"])

    # User profile is populated and USER.md created
    profile = gws.user_profile(home)
    assert profile["signed_in"] is True and profile["email"] == "me@gmail.com"
    assert (home / "memories" / "USER.md").exists()


def test_the_desktop_listener_can_relay_the_reply(google):
    """A backend on another machine can't receive the browser's redirect; the desktop app catches it
    on its own loopback port and relays code + state."""
    home, _seen = google
    started = gws.start_sign_in(home, "http://127.0.0.1:5555/callback")
    query = parse_qs(urlsplit(started["auth_url"]).query)
    assert query["redirect_uri"] == ["http://127.0.0.1:5555/callback"]

    result = gws.relay_callback(started["flow_id"], home, {"code": "4/code", "state": query["state"][0], "error": None})

    assert result["status"] == "done" and gws.status(home)["signed_in"]

def test_a_reply_for_another_attempt_is_refused(google):
    home, _seen = google
    started = gws.start_sign_in(home)

    _browser_returns(started["auth_url"], state="forged")

    assert _settled(started["flow_id"], home)["status"] == "error"
    assert not (home / "google_token.json").exists()


def test_env_client_configures_sign_in_without_a_saved_file(tmp_path, monkeypatch):
    """A client in .env is enough: the card must not ask the user to paste one."""
    monkeypatch.setenv("GOOGLE_WORKSPACE_CLIENT_ID", "123-abc.apps.googleusercontent.com")
    monkeypatch.setenv("GOOGLE_WORKSPACE_CLIENT_SECRET", "shh")

    client = gws.read_client(tmp_path)

    assert client["client_id"] == "123-abc.apps.googleusercontent.com"
    assert gws.status(tmp_path)["client_configured"] is True
    assert not (tmp_path / "google_client_secret.json").exists()


def test_a_saved_client_file_wins_over_env(tmp_path, monkeypatch):
    gws.save_client(tmp_path, "file.apps.googleusercontent.com", "file-secret")
    monkeypatch.setenv("GOOGLE_WORKSPACE_CLIENT_ID", "env.apps.googleusercontent.com")
    monkeypatch.setenv("GOOGLE_WORKSPACE_CLIENT_SECRET", "env-secret")

    assert gws.read_client(tmp_path)["client_id"] == "file.apps.googleusercontent.com"


def test_card_requests_what_the_skill_needs():
    """The skill checks its token against its own SCOPES; a sign-in from the card must satisfy it."""
    import importlib.util

    spec = importlib.util.spec_from_file_location("gws_skill_setup", SKILL_SETUP)
    skill = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(skill)
    assert skill.SCOPES and set(skill.SCOPES) == set(gws.SCOPES)


@pytest.mark.platforms("posix")
def test_credentials_are_readable_only_by_the_user(google):
    home, _seen = google
    started = gws.start_sign_in(home)
    _browser_returns(started["auth_url"])
    _settled(started["flow_id"], home)

    for name in ("google_client_secret.json", "google_token.json"):
        assert stat.S_IMODE((home / name).stat().st_mode) & 0o077 == 0, name
