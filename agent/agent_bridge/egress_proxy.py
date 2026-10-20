"""The browser sandbox's only way out: a SOCKS5 proxy in the backend that reaches the public web.

Chromium in ``scout-browser`` may connect to nothing but this proxy (OpenShell policy), so every
page and every image, script and stylesheet a page pulls in goes through here. Any public site
loads as it would on a normal computer; what is refused is everything that is not the public
internet (loopback, private and link-local networks, cloud metadata, carrier NAT, OpenShell's own
mapping range), checked against the address actually dialled, after DNS. Each host contacted is
recorded for the browse task's audit log.
"""

from __future__ import annotations

import asyncio
import ipaddress
import logging
import socket
import threading
from collections import deque
from typing import Deque, Optional, Tuple

logger = logging.getLogger(__name__)

PORT = 18766
_ALLOWED_PORTS = frozenset({80, 443, 8080, 8443})
_EXTRA_BLOCKED = [ipaddress.ip_network(n) for n in ("100.64.0.0/10", "198.18.0.0/15", "192.0.0.0/24")]

recent_hosts: Deque[str] = deque(maxlen=500)
_started = threading.Event()
_start_lock = threading.Lock()


def public_address(ip: str) -> bool:
    addr = ipaddress.ip_address(ip)
    if isinstance(addr, ipaddress.IPv6Address) and addr.ipv4_mapped:
        addr = addr.ipv4_mapped
    if (addr.is_private or addr.is_loopback or addr.is_link_local or addr.is_multicast or addr.is_reserved
            or addr.is_unspecified):
        return False
    return not any(addr in net for net in _EXTRA_BLOCKED)


async def _dial(host: str, port: int) -> Tuple[asyncio.StreamReader, asyncio.StreamWriter]:
    """Connect to the first PUBLIC address of *host* (never trust a name: resolve, then check)."""
    if port not in _ALLOWED_PORTS:
        raise PermissionError(f"port {port} is not allowed")
    loop = asyncio.get_running_loop()
    infos = await loop.getaddrinfo(host, port, type=socket.SOCK_STREAM)
    for family, _, _, _, sockaddr in infos:
        if public_address(sockaddr[0]):
            return await asyncio.wait_for(asyncio.open_connection(sockaddr[0], port, family=family), 15)
    raise PermissionError(f"{host} does not resolve to a public address")


async def _pipe(reader: asyncio.StreamReader, writer: asyncio.StreamWriter) -> None:
    try:
        while data := await reader.read(65536):
            writer.write(data)
            await writer.drain()
    except (ConnectionError, asyncio.CancelledError):
        pass
    finally:
        writer.close()


async def _handle(client_r: asyncio.StreamReader, client_w: asyncio.StreamWriter) -> None:
    """One SOCKS5 CONNECT (RFC 1928, no auth). SOCKS rather than an HTTP proxy: OpenShell inspects
    anything that looks like HTTP on the way out, and Chrome sends the hostname so DNS happens
    here, where the public-address check runs."""
    upstream_w: Optional[asyncio.StreamWriter] = None
    reply = b"\x05\x01\x00\x01\x00\x00\x00\x00\x00\x00"  # general failure
    try:
        version, nmethods = await asyncio.wait_for(client_r.readexactly(2), 30)
        await client_r.readexactly(nmethods)
        if version != 5:
            raise ValueError("not SOCKS5")
        client_w.write(b"\x05\x00")
        _, cmd, _, atyp = await client_r.readexactly(4)
        if atyp == 1:
            host = socket.inet_ntop(socket.AF_INET, await client_r.readexactly(4))
        elif atyp == 4:
            host = socket.inet_ntop(socket.AF_INET6, await client_r.readexactly(16))
        elif atyp == 3:
            host = (await client_r.readexactly((await client_r.readexactly(1))[0])).decode("idna")
        else:
            raise ValueError("bad address type")
        port = int.from_bytes(await client_r.readexactly(2), "big")
        if cmd != 1:
            reply = b"\x05\x07\x00\x01\x00\x00\x00\x00\x00\x00"  # command not supported
            raise ValueError("only CONNECT")
        try:
            upstream_r, upstream_w = await _dial(host, port)
        except PermissionError:
            reply = b"\x05\x02\x00\x01\x00\x00\x00\x00\x00\x00"  # not allowed by ruleset
            raise
        recent_hosts.append(host.lower())
        client_w.write(b"\x05\x00\x00\x01\x00\x00\x00\x00\x00\x00")
        await client_w.drain()
        await asyncio.gather(_pipe(client_r, upstream_w), _pipe(upstream_r, client_w))
        return
    except PermissionError as exc:
        logger.info("egress proxy refused: %s", exc)
    except (OSError, ValueError, asyncio.TimeoutError, asyncio.IncompleteReadError):
        pass
    try:
        client_w.write(reply)
        await client_w.drain()
    except OSError:
        pass
    finally:
        for w in (client_w, upstream_w):
            if w is not None:
                w.close()


def _serve() -> None:
    async def main() -> None:
        server = await asyncio.start_server(_handle, "127.0.0.1", PORT)
        _started.set()
        async with server:
            await server.serve_forever()

    try:
        asyncio.run(main())
    except OSError as exc:
        logger.warning("egress proxy could not start on %s: %s", PORT, exc)


def ensure_running() -> None:
    """Start the proxy once per backend process (idempotent)."""
    with _start_lock:
        if _started.is_set():
            return
        threading.Thread(target=_serve, name="scout-egress-proxy", daemon=True).start()
    if not _started.wait(5):
        from agent.agent_bridge.sandboxes import SandboxUnavailable
        raise SandboxUnavailable("the browser's egress proxy did not start")
