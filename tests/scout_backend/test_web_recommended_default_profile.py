"""``GET /api/model/recommended-default`` answers for the requested profile.

The route once returned before entering the profile scope, so ``?profile=b`` got the caches of
the profile that launched the dashboard, and an unknown profile answered 200 instead of the
scope's 404.
"""

import pytest

pytest.importorskip("fastapi")
from fastapi.testclient import TestClient  # noqa: E402


@pytest.fixture()
def client(_isolate_scout_home):
    from scout_backend import profiles as profiles_mod

    named = profiles_mod.get_profile_dir("named")
    named.mkdir(parents=True, exist_ok=True)
    (named / "config.yaml").write_text("model: {}\n", encoding="utf-8")

    from scout_backend.web_server import app, _SESSION_HEADER_NAME, _SESSION_TOKEN

    c = TestClient(app, raise_server_exceptions=False)
    c.headers[_SESSION_HEADER_NAME] = _SESSION_TOKEN
    return c


def test_recommendation_reads_the_requested_profile(client):
    launch = client.get("/api/model/recommended-default", params={"provider": "openrouter"})
    named = client.get("/api/model/recommended-default", params={"provider": "openrouter", "profile": "named"})
    unknown = client.get("/api/model/recommended-default",
                         params={"provider": "openrouter", "profile": "no-such-profile"})

    assert launch.status_code == named.status_code == 200
    assert launch.json()["provider"] == named.json()["provider"] == "openrouter"
    assert unknown.status_code == 404, unknown.text
    assert "no-such-profile" in unknown.json()["detail"]
