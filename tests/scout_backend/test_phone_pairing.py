"""Settings → Phone: the pairing link exists only once the phone can actually reach this backend."""

import asyncio
import json
import stat
import subprocess
import sys
import time
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


def test_serve_forwards_tls_terminated_tcp_so_phone_websockets_work():
    assert phone._serve_args("/usr/bin/tailscale", 9119) == (
        "/usr/bin/tailscale",
        "serve",
        "--bg",
        "--yes",
        "--tls-terminated-tcp",
        "443",
        "tcp://127.0.0.1:9119",
    )


def test_tls_terminated_tcp_forward_is_already_served(monkeypatch):
    def run(*args):
        if args[1:3] == ("status", "--json"):
            out = {"BackendState": "Running", "Self": {"DNSName": "mac.tail1.ts.net."}}
            return subprocess.CompletedProcess(args, 0, json.dumps(out), "")
        forward = {"TCP": {"443": {"TCPForward": "127.0.0.1:9119", "TerminateTLS": "mac.tail1.ts.net"}}}
        return subprocess.CompletedProcess(args, 0, json.dumps(forward), "")

    monkeypatch.setattr(phone, "_tailscale", lambda: "/usr/bin/tailscale")
    monkeypatch.setattr(phone, "_run", run)
    monkeypatch.setattr(phone, "_server", lambda: SimpleNamespace(_SESSION_TOKEN="tok/en+"))

    out = phone._pairing(_request())

    assert out["tailscale"] == "ready"
    assert out["link"] == "https://mac.tail1.ts.net/app/?token=tok%2Fen%2B"


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


def test_the_tailnet_name_is_this_machines_magicdns_name(monkeypatch):
    phone._TAILNET_HOST = None

    def run(*args):
        if args[1:3] == ("status", "--json"):
            out = {"BackendState": "Running", "Self": {"DNSName": "Mac.Tail1.ts.net."}}
            return subprocess.CompletedProcess(args, 0, json.dumps(out), "")
        return subprocess.CompletedProcess(args, 1, "", "")

    monkeypatch.setattr(phone, "_tailscale", lambda: "/usr/bin/tailscale")
    monkeypatch.setattr(phone, "_run", run)

    assert phone.tailnet_hostname() == "mac.tail1.ts.net"


def test_a_hung_tailscale_check_is_a_failed_check(monkeypatch):
    def hung(*_args, **_kwargs):
        raise subprocess.TimeoutExpired(["tailscale"], 15, output=None)

    monkeypatch.setattr(phone.subprocess, "run", hung)

    assert phone._run("tailscale", "status", "--json").returncode == 1


def test_serve_waits_for_the_tailnet_switch_to_be_turned_on(tmp_path):
    """The CLI prints the enable page and then blocks. The request must come back with that page."""
    script = tmp_path / "tailscale"
    script.write_text(
        f"#!{sys.executable}\nimport time\n"
        "print('Serve is not enabled on your tailnet.', flush=True)\n"
        "print('https://login.tailscale.com/f/serve?node=abc', flush=True)\n"
        "time.sleep(30)\n"
    )
    script.chmod(script.stat().st_mode | stat.S_IEXEC)
    started = time.monotonic()

    result = phone._serve(str(script), 9119)

    assert time.monotonic() - started < 3
    assert result.returncode != 0
    assert phone._serve_failure(result.stdout) == {
        "enable_url": "https://login.tailscale.com/f/serve?node=abc",
        "error": "Tailscale Serve is off for this network. Turn it on, then try again: "
        "https://login.tailscale.com/f/serve?node=abc",
    }


def test_turning_serve_on_is_reported_on_the_pairing(monkeypatch):
    _tailnet(monkeypatch)
    monkeypatch.setattr(
        phone,
        "_serve",
        lambda _cli, _port: subprocess.CompletedProcess(
            ["tailscale"], 1, "https://login.tailscale.com/f/serve?node=abc", ""
        ),
    )

    out = asyncio.run(phone.phone_serve(_request()))

    assert out["tailscale"] == "not_served"
    assert out["link"] is None
    assert out["enable_url"] == "https://login.tailscale.com/f/serve?node=abc"
