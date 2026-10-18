"""Actual adapter producers; only vendor transport and pacing clocks replaced."""
import json

import pytest


@pytest.fixture(params=[None, False, True, "override"])
def policy(request, monkeypatch, tmp_path):
    monkeypatch.setenv("SCOUT_HOME", str(tmp_path))
    value = request.param
    config: dict = {} if value is None else {"display": {"suppress_warning_notifications": value is True}}
    if value == "override":
        config["display"]["platforms"] = {p: {"suppress_warning_notifications": True} for p in ("slack", "signal")}
    (tmp_path / "config.yaml").write_text(json.dumps(config))
    return value in (True, "override")


