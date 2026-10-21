"""Settings → Phone: the pairing link exists only once the phone can actually reach this backend."""

import json
import subprocess
from types import SimpleNamespace

from scout_backend.web_routers import phone


def _request(port=9119):
    return SimpleNamespace(app=SimpleNamespace(state=SimpleNamespace(bound_port=port)), url=SimpleNamespace(port=port))


def _tailnet(monkeypatch, *, running=True, served_port=None):
    def run(*args):
        if args[1:3] == ("status", "--json"):
            out = {"BackendState": "Running" if running else "NeedsLogin", "Self": {"DNSName": "mac.tail1.ts.net."}}
            return subprocess.CompletedProcess(args, 0, json.dumps(out), "")
        proxy = {"Web": {"mac.tail1.ts.net:443": {"Handlers": {"/": {"Proxy": f"http://127.0.0.1:{served_port}"}}}}}
        return subprocess.CompletedProcess(args, 0, json.dumps(proxy if served_port else {}), "")

    monkeypatch.setattr(phone, "_tailscale", lambda: "/usr/bin/tailscale")
    monkeypatch.setattr(phone, "_run", run)
    monkeypatch.setattr(phone, "_server", lambda: SimpleNamespace(_SESSION_TOKEN="tok/en+"))


def test_the_link_is_the_tailnet_https_address_of_this_backend(monkeypatch):
    _tailnet(monkeypatch, served_port=9119)

    out = phone._pairing(_request())

    assert out["tailscale"] == "ready"
    assert out["link"] == "https://mac.tail1.ts.net/app/?token=tok%2Fen%2B"


def test_no_link_until_the_phone_can_reach_this_backend(monkeypatch):
    for kwargs, state in (({"served_port": 8000}, "not_served"), ({"running": False}, "signed_out")):
        _tailnet(monkeypatch, **kwargs)
        out = phone._pairing(_request())
        assert (out["tailscale"], out["link"]) == (state, None)

    monkeypatch.setattr(phone, "_tailscale", lambda: None)
    assert phone._pairing(_request()) == {"tailscale": "missing", "link": None}
