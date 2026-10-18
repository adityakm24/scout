"""``i18n.languages`` lists bundled + pack languages; ``i18n.catalog`` returns the pack/overlay layer per
surface and nothing bundled; both answer for the requested profile's home."""

from __future__ import annotations

import scout_yaml as yaml
import pytest

from agent import i18n, i18n_layers


@pytest.fixture
def clean_layers():
    i18n_layers._reset_registry_for_tests()
    i18n.reset_language_cache()
    yield
    i18n_layers._reset_registry_for_tests()
    i18n.reset_language_cache()


def _call(server, method, params):
    return server.handle_request({"jsonrpc": "2.0", "id": 3, "method": method, "params": params})




def test_catalog_answers_for_the_requested_profile_home(tmp_path, monkeypatch, clean_layers):
    """Two on-disk homes; only the named profile overlays de. The method must read that home's overlay
    and leave the launch home's (empty) view intact."""
    import tui_gateway.server as server

    launch, named = tmp_path / "launch", tmp_path / "profiles" / "named"
    (launch / "locales").mkdir(parents=True)
    (named / "locales").mkdir(parents=True)
    (named / "locales" / "de.yaml").write_text(yaml.safe_dump({"approval": {"denied": "Nur named"}}), encoding="utf-8")
    monkeypatch.setenv("SCOUT_HOME", str(launch))
    monkeypatch.setattr(server, "_scout_home", launch)
    monkeypatch.setattr(server, "_profile_home", lambda name: str(named) if name == "named" else None)
    i18n.reset_language_cache()

    assert _call(server, "i18n.catalog", {"lang": "de", "profile": "named"})["result"]["messages"] == {"approval.denied": "Nur named"}
    assert _call(server, "i18n.catalog", {"lang": "de"})["result"]["messages"] == {}
