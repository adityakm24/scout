"""The phone loads /app/ from this backend; that HTML must carry the live session token.

A pairing token kept on the phone 403s /api/ws after a backend restart, while public
/api/status still answers — quiet recovery then flickers Connecting ↔ handshake error.
"""

from __future__ import annotations

import json
import re

from fastapi import FastAPI
from starlette.testclient import TestClient

from scout_backend import web_server_dashboard as dash


def _client(tmp_path, monkeypatch, *, gated: bool):
    app_dist = tmp_path / "app_dist"
    app_dist.mkdir()
    (app_dist / "index.html").write_text(
        "<html><head></head><body>app</body></html>", encoding="utf-8"
    )
    (app_dist / "asset.js").write_text("/* hashed */", encoding="utf-8")
    monkeypatch.setattr(dash, "APP_DIST", app_dist)
    import scout_backend.web_server as ws

    web_dist = tmp_path / "web_dist"
    (web_dist / "assets").mkdir(parents=True)
    monkeypatch.setattr(ws, "WEB_DIST", web_dist)
    monkeypatch.delenv("SCOUT_SERVE_HEADLESS", raising=False)
    spa = FastAPI()
    spa.state.auth_required = gated
    dash.mount_spa(spa)
    return TestClient(spa), app_dist


def test_app_index_injects_live_session_token(tmp_path, monkeypatch):
    import scout_backend.web_server as ws

    monkeypatch.setattr(ws, "_SESSION_TOKEN", "phone-live-token")
    client, _dist = _client(tmp_path, monkeypatch, gated=False)

    for path in ("/app/", "/app/index.html"):
        resp = client.get(path)
        assert resp.status_code == 200
        assert "no-store" in resp.headers.get("cache-control", "")
        match = re.search(
            r"window\.__SCOUT_SESSION_TOKEN__\s*=\s*(\"(?:\\.|[^\"\\])*\")",
            resp.text,
        )
        assert match, resp.text
        assert json.loads(match.group(1)) == "phone-live-token"


def test_app_assets_are_not_rewritten(tmp_path, monkeypatch):
    client, _dist = _client(tmp_path, monkeypatch, gated=False)
    resp = client.get("/app/asset.js")
    assert resp.status_code == 200
    assert "__SCOUT_SESSION_TOKEN__" not in resp.text


def test_gated_app_index_does_not_inject_legacy_token(tmp_path, monkeypatch):
    client, _dist = _client(tmp_path, monkeypatch, gated=True)
    resp = client.get("/app/")
    assert resp.status_code == 200
    assert "__SCOUT_SESSION_TOKEN__" not in resp.text
