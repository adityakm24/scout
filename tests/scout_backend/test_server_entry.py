"""`scout-server` starts the backend the apps connect to: it serves the dashboard and owns cron."""

import os
import sys


def test_server_entry_serves_the_dashboard_as_the_app_owned_backend(monkeypatch):
    from scout_backend import server_entry

    monkeypatch.delenv("SCOUT_DESKTOP", raising=False)
    seen = {}
    monkeypatch.setattr(server_entry, "_start_gateway", lambda: None)
    monkeypatch.setattr("scout_backend.main.main", lambda: seen.update(
        desktop=os.environ.get("SCOUT_DESKTOP"),
        token=os.environ.get("SCOUT_DASHBOARD_SESSION_TOKEN"),
        argv=list(sys.argv)))

    server_entry.main(["--port", "9555"])

    assert seen["desktop"] == "1" and seen["token"]
    assert seen["argv"][1:3] == ["dashboard", "--no-open"]
    assert "9555" in seen["argv"]
