"""The Browser Agent's screen in the apps: watch it live, take control, hand it back.

``GET /api/browser-screen`` reports whether the sandboxed browser is up and who holds control.
``POST /api/browser-screen/observe`` mints a viewer id and a single-use 30 s ticket for
``/api/browser-screen/ws``, which streams the active tab as JPEG frames (DevTools screencast) plus
the tabs, address and the agent's pointer for the browser frame the app draws, and accepts the
viewer's mouse, keyboard and frame controls (address bar, back/forward, tabs) ONLY while that
viewer holds the lease
(``tools/bot_desktop/lease.py``, the same lease the agent's tools refuse to act under).
``POST /api/browser-screen/lease`` takes or hands back control.
"""

from __future__ import annotations

import asyncio
import json
import urllib.parse
import logging
import secrets
import threading
from typing import Any, Dict, Optional

from fastapi import APIRouter, HTTPException, WebSocket, WebSocketDisconnect
from pydantic import BaseModel

from scout_backend.web_server_chat import _ws_request_is_allowed

_log = logging.getLogger(__name__)
router = APIRouter()

_CLOSE_BAD_TICKET = 4401
_CLOSE_NOT_ALLOWED = 4403
_CLOSE_ASLEEP = 4001
_PAGE_POLL_S = 1.5
_minted: set[str] = set()
_minted_lock = threading.Lock()


class LeaseRequest(BaseModel):
    viewer_id: str
    take: bool


def _running() -> bool:
    from agent.agent_bridge import egress_proxy
    from agent.agent_bridge.browser_screen import ScreenUnavailable, active_page
    from agent.agent_bridge.sandboxes import SandboxUnavailable
    try:
        active_page()
    except ScreenUnavailable:
        return False
    try:
        # The sandboxed browser is online only through this backend's proxy; a browser that outlived
        # an earlier backend would otherwise show "no internet" to the person who takes control.
        egress_proxy.ensure_running()
    except SandboxUnavailable:
        return False
    return True


def _status() -> Dict[str, Any]:
    from tools.bot_desktop import lease
    return {"running": _running(), "lease": lease.public_view(lease.get())}


@router.get("/api/browser-screen")
async def browser_screen_status() -> Dict[str, Any]:
    return await asyncio.to_thread(_status)


@router.post("/api/browser-screen/observe")
async def browser_screen_observe() -> Dict[str, Any]:
    from scout_backend.dashboard_auth.ws_tickets import mint_ticket
    if not await asyncio.to_thread(_running):
        raise HTTPException(status_code=409, detail="The browser is asleep")
    viewer_id = secrets.token_urlsafe(16)
    with _minted_lock:
        _minted.add(viewer_id)
    ticket = mint_ticket(user_id=f"browser-screen:{viewer_id}", provider="browser-screen",
                         extra={"viewer_id": viewer_id})
    return {"ticket": ticket, "path": "/api/browser-screen/ws", "viewer_id": viewer_id, **await asyncio.to_thread(_status)}


@router.post("/api/browser-screen/lease")
async def browser_screen_lease(body: LeaseRequest) -> Dict[str, Any]:
    """Take control (the agent's browser actions are refused until it is handed back) or hand it back.
    Only an id this server minted may hold the lease, so a made-up id cannot evict a person."""
    from tools.bot_desktop import lease
    with _minted_lock:
        known = body.viewer_id in _minted
    if not known:
        raise HTTPException(status_code=403, detail="unknown viewer; call /api/browser-screen/observe first")
    held = await asyncio.to_thread(lease.acquire if body.take else lease.release, body.viewer_id)
    return {"lease": lease.public_view(held)}


def _browser_command(msg: Dict[str, Any]) -> bool:
    """The frame's own controls (address bar, back/forward, tabs) for the viewer in control.
    Returns True when *msg* was one. Off-limits addresses are refused by the egress proxy."""
    from agent.agent_bridge import browser_screen as bs
    from agent.agent_bridge.protocol import url_host

    kind = msg.get("type")
    if kind == "new_tab":
        bs.new_tab()
    elif kind == "activate_tab":
        bs.activate_tab(str(msg.get("id") or ""))
    elif kind == "close_tab":
        bs.close_tab(str(msg.get("id") or ""))
    elif kind in ("navigate", "back", "forward", "reload"):
        with bs.BrowserScreen() as page:
            if kind == "navigate":
                url = str(msg.get("url") or "").strip()
                if url and "://" not in url:
                    url = (f"https://{url}" if "." in url and " " not in url
                           else "https://duckduckgo.com/?q=" + urllib.parse.quote(url))
                if url_host(url):
                    page.call("Page.navigate", {"url": url})
            elif kind == "reload":
                page.call("Page.reload")
            else:
                page.evaluate(f"history.{kind}()")
    else:
        return False
    return True


def _input_commands(msg: Dict[str, Any]) -> list:
    """The DevTools commands one viewer input message stands for (unknown kinds map to none)."""
    kind = msg.get("type")
    x, y = int(msg.get("x") or 0), int(msg.get("y") or 0)
    modifiers = int(msg.get("modifiers") or 0)
    if kind in ("mouseMoved", "mousePressed", "mouseReleased"):
        return [("Input.dispatchMouseEvent", {"type": kind, "x": x, "y": y, "modifiers": modifiers,
                                              "button": str(msg.get("button") or "none"),
                                              "clickCount": int(msg.get("clickCount") or 0)})]
    if kind == "wheel":
        return [("Input.dispatchMouseEvent", {"type": "mouseWheel", "x": x, "y": y, "modifiers": modifiers,
                                              "deltaX": float(msg.get("deltaX") or 0),
                                              "deltaY": float(msg.get("deltaY") or 0)})]
    if kind in ("keyDown", "keyUp"):
        params = {"type": kind, "key": str(msg.get("key") or ""), "code": str(msg.get("code") or ""),
                  "modifiers": modifiers, "windowsVirtualKeyCode": int(msg.get("keyCode") or 0)}
        text = str(msg.get("text") or "")
        if kind == "keyDown":
            if text and not modifiers & ~8:
                params["text"] = text
            else:
                params["type"] = "rawKeyDown"
        return [("Input.dispatchKeyEvent", params)]
    return []


async def _stream(ws: WebSocket, viewer_id: str) -> None:
    """Relay the active tab's screencast to the viewer and the holder's input back, following the
    active tab when the agent opens or switches to another."""
    from websockets.asyncio.client import connect

    from agent.agent_bridge.browser_screen import ScreenUnavailable, VIEWPORT, active_page
    from tools.bot_desktop import lease

    while True:
        try:
            page = await asyncio.to_thread(active_page)
        except ScreenUnavailable:
            await ws.close(code=_CLOSE_ASLEEP, reason="the browser is asleep")
            return
        async with connect(page["webSocketDebuggerUrl"], max_size=64 * 1024 * 1024) as cdp:
            ids = iter(range(1, 1 << 30))

            async def send(method: str, params: Optional[Dict[str, Any]] = None) -> None:
                await cdp.send(json.dumps({"id": next(ids), "method": method, "params": params or {}}))

            await send("Page.startScreencast", {"format": "jpeg", "quality": 60, "maxWidth": VIEWPORT[0],
                                                "maxHeight": VIEWPORT[1], "everyNthFrame": 1})

            async def frames() -> None:
                async for raw in cdp:
                    msg = json.loads(raw)
                    if msg.get("method") == "Page.screencastFrame":
                        p = msg["params"]
                        await send("Page.screencastFrameAck", {"sessionId": p["sessionId"]})
                        meta = p.get("metadata") or {}
                        await ws.send_text(json.dumps({"type": "frame", "data": p["data"],
                                                       "width": meta.get("deviceWidth"),
                                                       "height": meta.get("deviceHeight")}))

            async def inputs() -> None:
                while True:
                    msg = json.loads(await ws.receive_text())
                    if not lease.viewer_may_send_input(viewer_id):
                        continue  # watchers only watch; the lease is the gate, not the UI
                    if msg.get("type") == "insertText":
                        await send("Input.insertText", {"text": str(msg.get("text") or "")[:2000]})
                    elif await asyncio.to_thread(_browser_command, msg):
                        continue
                    for method, params in _input_commands(msg):
                        await send(method, params)

            async def frame_state() -> None:
                """Tabs, the address bar and the agent's pointer, for the frame the app draws."""
                from agent.agent_bridge import browser_screen as bs
                last_tabs, last_seq = None, 0
                while True:
                    try:
                        open_tabs = await asyncio.to_thread(bs.tabs)
                    except ScreenUnavailable:
                        return
                    state = [{"id": t["id"], "title": t.get("title", ""), "url": t.get("url", ""),
                              "active": t["id"] == page["id"]} for t in open_tabs]
                    if state != last_tabs:
                        await ws.send_text(json.dumps({"type": "tabs", "tabs": state}))
                        last_tabs = state
                    moves = [m for m in list(bs.pointer_feed) if m[0] > last_seq]
                    for seq, x, y, kind in moves[-12:]:
                        await ws.send_text(json.dumps({"type": "cursor", "x": x, "y": y, "kind": kind}))
                    if moves:
                        last_seq = moves[-1][0]
                    await asyncio.sleep(0.05)

            async def tab_changed() -> None:
                while True:
                    await asyncio.sleep(_PAGE_POLL_S)
                    try:
                        current = await asyncio.to_thread(active_page)
                    except ScreenUnavailable:
                        return
                    if current["id"] != page["id"]:
                        return

            tasks = [asyncio.create_task(c()) for c in (frames, inputs, tab_changed, frame_state)]
            done, pending = await asyncio.wait(tasks, return_when=asyncio.FIRST_COMPLETED)
            for task in pending:
                task.cancel()
            if tasks[1] in done:  # the viewer went away
                return
            for task in done:
                if task.exception() is not None and not isinstance(task.exception(), WebSocketDisconnect):
                    _log.debug("browser screen stream ended: %s", task.exception())


@router.websocket("/api/browser-screen/ws")
async def browser_screen_ws(ws: WebSocket) -> None:
    from scout_backend.dashboard_auth.ws_tickets import TicketInvalid, consume_ticket
    if not _ws_request_is_allowed(ws):
        await ws.close(code=_CLOSE_NOT_ALLOWED)
        return
    await ws.accept()
    try:
        info = consume_ticket(ws.query_params.get("ticket", ""))
    except TicketInvalid:
        info = {}
    if info.get("provider") != "browser-screen" or not info.get("viewer_id"):
        await ws.close(code=_CLOSE_BAD_TICKET, reason="ticket missing, expired or used")
        return
    try:
        await _stream(ws, str(info["viewer_id"]))
    except WebSocketDisconnect:
        pass
