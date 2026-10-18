"""Cold-start WebSocket dials race IPv6/IPv4 (#114265).

``websockets.connect`` forwards unknown kwargs to ``loop.create_connection``, whose
``happy_eyeballs_delay`` defaults to ``None`` (serial walk over getaddrinfo results). On a
network with an advertised-but-blackholed IPv6 route every AAAA record burns the full
connect timeout before IPv4 answers — the same stall class the bootstrap racer closes for
sync connects. Each Scout ``websockets.connect`` call site must pass the RFC 8305 delay.
"""

from __future__ import annotations


import pytest

pytest.importorskip("websockets")

EXPECTED_DELAY = 0.25


class _Recorder:
    def __init__(self):
        self.kwargs = None

    async def __call__(self, *_args, **kwargs):
        self.kwargs = kwargs
        raise ConnectionRefusedError("recorded")


