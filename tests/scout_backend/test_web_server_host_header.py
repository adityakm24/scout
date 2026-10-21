"""Tests for GHSA-ppp5-vxwm-4cf7 — Host-header validation.

DNS rebinding defence: a victim browser that has the dashboard open
could be tricked into fetching from an attacker-controlled hostname
that TTL-flips to 127.0.0.1. Same-origin / CORS checks won't help —
the browser now treats the attacker origin as same-origin. Validating
the Host header at the application layer rejects the attack.
"""

from __future__ import annotations

import sys
from pathlib import Path

import pytest

_repo = str(Path(__file__).resolve().parents[1])
if _repo not in sys.path:
    sys.path.insert(0, _repo)


class TestHostHeaderValidator:
    """Unit test the _is_accepted_host helper directly — cheaper and
    more thorough than spinning up the full FastAPI app."""



    def test_zero_zero_bind_accepts_anything(self):
        """0.0.0.0 means operator explicitly opted into all-interfaces
        (requires --insecure). No Host-layer defence is possible — rely
        on operator network controls."""
        from scout_backend.web_server import _is_accepted_host

        for host in ("10.0.0.5", "evil.example", "my-server.corp.net"):
            assert _is_accepted_host(host, "0.0.0.0")
            assert _is_accepted_host(host + ":9119", "0.0.0.0")

    def test_explicit_non_loopback_bind_requires_exact_match(self):
        """If the operator bound to a specific non-loopback hostname,
        the Host header must match exactly."""
        from scout_backend.web_server import _is_accepted_host

        assert _is_accepted_host("my-server.corp.net", "my-server.corp.net")
        assert _is_accepted_host("my-server.corp.net:9119", "my-server.corp.net")
        # Different host — reject
        assert not _is_accepted_host("evil.example", "my-server.corp.net")
        # Loopback — reject (we bound to a specific non-loopback name)
        assert not _is_accepted_host("localhost", "my-server.corp.net")


    def test_trusted_public_host_is_exact_match_only(self):
        """A declared proxy host is accepted without weakening rebinding checks."""
        from scout_backend.web_server import _is_accepted_host

        trusted = frozenset({"dashboard.example.test"})
        assert _is_accepted_host(
            "dashboard.example.test:9443", "127.0.0.1", trusted
        )
        assert not _is_accepted_host(
            "dashboard.example.test.evil.test", "127.0.0.1", trusted
        )
        assert not _is_accepted_host("evil.test", "127.0.0.1", trusted)

    def test_this_machines_tailnet_name_is_accepted_and_no_other(self, monkeypatch):
        """Tailscale serve presents the tailnet name; a lookalike name is still a rebinding host."""
        from scout_backend.web_server import _host_is_accepted

        monkeypatch.setattr("scout_backend.web_server._tailnet_hostname", lambda: "mac.tail1.ts.net")

        assert _host_is_accepted("mac.tail1.ts.net", "127.0.0.1")
        assert _host_is_accepted("mac.tail1.ts.net:443", "127.0.0.1")
        assert not _host_is_accepted("evil.ts.net", "127.0.0.1")
        assert not _host_is_accepted("mac.tail1.ts.net.evil.test", "127.0.0.1")

        monkeypatch.setattr("scout_backend.web_server._tailnet_hostname", lambda: "")
        assert not _host_is_accepted("mac.tail1.ts.net", "127.0.0.1")

    def test_malformed_host_authorities_fail_closed(self):
        """Ports, IPv6 brackets, and authority syntax must be unambiguous."""
        from scout_backend.web_server import _is_accepted_host

        trusted = frozenset({"dashboard.example.test"})
        for malformed in (
            "http://dashboard.example.test:9443",
            "dashboard.example.test:",
            "dashboard.example.test:notaport",
            "[::1].evil.test",
            "[::1]:notaport",
            "[localhost]",
        ):
            assert not _is_accepted_host(malformed, "127.0.0.1", trusted)


class TestHostHeaderMiddleware:
    """End-to-end test via the FastAPI app — verify the middleware
    rejects bad Host headers with 400."""

    def test_rebinding_request_rejected(self):
        from fastapi.testclient import TestClient
        from scout_backend.web_server import app

        # Simulate start_server having set the bound_host
        app.state.bound_host = "127.0.0.1"
        try:
            client = TestClient(app)
            # The TestClient sends Host: testserver by default — which is
            # NOT a loopback alias, so the middleware must reject it.
            resp = client.get(
                "/api/status",
                headers={"Host": "evil.example"},
            )
            assert resp.status_code == 400
        finally:
            # Clean up so other tests don't inherit the bound_host
            if hasattr(app.state, "bound_host"):
                del app.state.bound_host


    def test_trusted_public_host_request_accepted(self):
        """A loopback backend may accept its declared reverse-proxy host."""
        from fastapi.testclient import TestClient
        from scout_backend.web_server import app

        app.state.bound_host = "127.0.0.1"
        app.state.trusted_public_hosts = frozenset({"dashboard.example.test"})
        try:
            client = TestClient(app)
            resp = client.get(
                "/api/status",
                headers={"Host": "dashboard.example.test:9443"},
            )
            assert resp.status_code != 400
        finally:
            del app.state.bound_host
            del app.state.trusted_public_hosts

    def test_no_bound_host_skips_validation(self):
        """If app.state.bound_host isn't set (e.g. running under test
        infra without calling start_server), middleware must pass through
        rather than crash."""
        from fastapi.testclient import TestClient
        from scout_backend.web_server import app

        # Make sure bound_host isn't set
        if hasattr(app.state, "bound_host"):
            del app.state.bound_host

        client = TestClient(app)
        resp = client.get("/api/status")
        # Should get through to the status endpoint, not a 400
        assert resp.status_code != 400


