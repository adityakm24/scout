"""A served secondary's api_server/webhook are MIRRORS of the default's listener (``/p/<profile>/...``),
never adapters of their own, so the multiplexer record has no ``<profile>:api_server`` entry. Every
status reader used to fall through to ``pending_restart``: the Desktop Messaging card and Command
Center read "Restart needed" forever for a platform that was answering. The mirror must project as the
default's live state plus the URL the client has to call; ``/api/status?profile=`` names the profiles a
restart of the shared gateway would blip.
"""

from __future__ import annotations

import json
import os

import pytest


@pytest.fixture
def served_root(tmp_path, monkeypatch):
    root = tmp_path / "scout"
    (root / "profiles" / "alpha").mkdir(parents=True)
    (root / "config.yaml").write_text("gateway: {multiplex_profiles: true}\n", encoding="utf-8")
    (root / "gateway.pid").write_text(json.dumps({"pid": os.getpid(), "scout_home": str(root)}), encoding="utf-8")
    (root / "gateway_state.json").write_text(json.dumps({
        "pid": os.getpid(), "scout_home": str(root), "gateway_state": "running",
        "served_profiles": ["default", "alpha", "beta"],
        "platforms": {
            "api_server": {"state": "connected", "listener_base": "http://127.0.0.1:45719"},
            "webhook": {"state": "fatal", "error_code": "port_in_use"},
            "alpha:telegram": {"state": "connected"},
        }}), encoding="utf-8")
    monkeypatch.setenv("SCOUT_HOME", str(root))
    monkeypatch.delenv("GATEWAY_MULTIPLEX_PROFILES", raising=False)
    import scout_constants
    import gateway.status as status
    # Liveness is a verified identity; this pytest process passes as the default gateway only by
    # wearing a gateway command line.
    monkeypatch.setattr(status, "_read_process_cmdline", lambda pid: "scout gateway run")
    monkeypatch.setattr(scout_constants, "_default_scout_root_memo", None)
    return root




def test_served_profile_projects_the_default_listener_mirrors_with_their_url(served_root):
    from gateway.status import profile_platforms_from_multiplexer, resolve_gateway_liveness
    alpha = served_root / "profiles" / "alpha"
    live = resolve_gateway_liveness(profile_dir=alpha, health_probe=None, use_cache=False)
    plats = profile_platforms_from_multiplexer(live.runtime, "alpha")
    # The mirror inherits the default's live state and points at the profile's own prefix.
    assert plats["api_server"]["state"] == "connected"
    assert plats["api_server"]["ingress_url"] == "http://127.0.0.1:45719/p/alpha/v1"
    # A dead default listener is dead for the profile too — never "connected" by fiat.
    assert "webhook" not in plats
    assert plats["telegram"] == {"state": "connected"}
    # The default profile keeps its own un-prefixed entries; nothing is mirrored onto it.
    assert "ingress_url" not in profile_platforms_from_multiplexer(live.runtime, "default").get("api_server", {})


def test_default_profile_keeps_its_flat_adapters_when_rekeyed(served_root):
    """The default's own adapters are the record's FLAT keys (only secondaries get the
    ``<profile>:`` prefix), so re-keying the multiplexer record for ``default`` must keep them:
    ``/api/status`` used to report ``gateway_platforms: {}`` for the default profile under
    ``gateway.multiplex_profiles`` while its adapters were connected and delivering (#123088).
    A STANDALONE record (``served_profiles: []``, flat keys only) reaches the same re-key through
    the multiplexer rung and must come back unchanged too (#123869)."""
    from gateway.status import profile_platforms_from_multiplexer, resolve_gateway_liveness
    standalone = {"gateway_state": "running", "served_profiles": [],
                  "platforms": {"feishu": {"state": "connected"}}}
    assert profile_platforms_from_multiplexer(standalone, "default") == {"feishu": {"state": "connected"}}
    alpha = served_root / "profiles" / "alpha"
    live = resolve_gateway_liveness(profile_dir=alpha, health_probe=None, use_cache=False)
    plats = profile_platforms_from_multiplexer(live.runtime, "default")
    # The default's un-prefixed entries survive the re-key, exactly as a standalone gateway for
    # "default" would have written them — a live api_server and its own fatal webhook.
    assert plats["api_server"]["state"] == "connected"
    assert "listener_base" in plats["api_server"]  # the listener's own entry, never a mirror
    assert plats["webhook"]["state"] == "fatal"
    # Nothing is mirrored onto the default and no secondary's entry leaks in.
    assert all("ingress_url" not in entry for entry in plats.values() if isinstance(entry, dict))
    assert "telegram" not in plats  # that entry belongs to alpha








