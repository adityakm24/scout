"""Mouse-and-keyboard control of the Chromium in the browser sandbox, over its DevTools port.

The Browser Agent works the page like a person at a computer: it looks at a screenshot and
clicks, scrolls and types at coordinates (``tools/browser_computer_tool.py``). The person watches
the same page live, inside a browser frame the app draws (tabs, address bar) from these DevTools
calls, and can take control (``scout_backend/web_routers/browser_screen.py``). Both work on one shared
active tab, so they always see and act on the same thing; the agent's pointer is published for the
viewer to draw.
"""

from __future__ import annotations

import base64
import itertools
import json
import threading
import time
import urllib.request
from collections import deque
from typing import Any, Dict, List, Optional, Tuple

from agent.agent_bridge import sandboxes

VIEWPORT = (1280, 800)

# DevTools modifier bits.
_MODIFIERS = {"alt": 1, "option": 1, "ctrl": 2, "control": 2, "meta": 4, "cmd": 4, "command": 4, "super": 4,
              "shift": 8}
# key name -> (key, code, windowsVirtualKeyCode, text)
_KEYS: Dict[str, Tuple[str, str, int, str]] = {
    "enter": ("Enter", "Enter", 13, "\r"), "return": ("Enter", "Enter", 13, "\r"), "tab": ("Tab", "Tab", 9, "\t"),
    "escape": ("Escape", "Escape", 27, ""), "esc": ("Escape", "Escape", 27, ""),
    "backspace": ("Backspace", "Backspace", 8, ""), "delete": ("Delete", "Delete", 46, ""),
    "space": (" ", "Space", 32, " "), "home": ("Home", "Home", 36, ""), "end": ("End", "End", 35, ""),
    "pageup": ("PageUp", "PageUp", 33, ""), "pagedown": ("PageDown", "PageDown", 34, ""),
    "up": ("ArrowUp", "ArrowUp", 38, ""), "down": ("ArrowDown", "ArrowDown", 40, ""),
    "left": ("ArrowLeft", "ArrowLeft", 37, ""), "right": ("ArrowRight", "ArrowRight", 39, ""),
    "arrowup": ("ArrowUp", "ArrowUp", 38, ""), "arrowdown": ("ArrowDown", "ArrowDown", 40, ""),
    "arrowleft": ("ArrowLeft", "ArrowLeft", 37, ""), "arrowright": ("ArrowRight", "ArrowRight", 39, ""),
}


class ScreenUnavailable(RuntimeError):
    """The sandboxed browser is not running or did not answer."""


def cdp_base() -> str:
    return f"http://127.0.0.1:{sandboxes.BROWSER_CDP_PORT}"


_active_id: Optional[str] = None
# The agent's pointer as the viewer draws it: (sequence, x, y, kind) with kind "move" or "click".
pointer_feed: "deque[Tuple[int, int, int, str]]" = deque(maxlen=256)
_pointer = {"x": VIEWPORT[0] // 2, "y": VIEWPORT[1] // 2, "seq": 0}
_lock = threading.Lock()


def _json(path: str, method: str = "GET") -> Any:
    try:
        req = urllib.request.Request(f"{cdp_base()}{path}", method=method)
        with urllib.request.urlopen(req, timeout=5) as resp:
            body = resp.read()
    except (OSError, ValueError) as exc:
        raise ScreenUnavailable("the sandboxed browser is not running") from exc
    try:
        return json.loads(body) if body.strip().startswith((b"{", b"[")) else body.decode()
    except ValueError:
        return body.decode()


def tabs() -> List[Dict[str, Any]]:
    """Open tabs, oldest first, each with id, title and url."""
    pages = [t for t in _json("/json/list") if t.get("type") == "page" and t.get("webSocketDebuggerUrl")]
    return list(reversed(pages))


def active_page() -> Dict[str, Any]:
    """The tab the agent and the viewer share: the one last activated, else the newest."""
    global _active_id
    pages = tabs()
    if not pages:
        raise ScreenUnavailable("the sandboxed browser has no open tab")
    with _lock:
        page = next((t for t in pages if t["id"] == _active_id), pages[-1])
        _active_id = page["id"]
    return page


def activate_tab(tab_id: str) -> None:
    global _active_id
    _json(f"/json/activate/{tab_id}")
    with _lock:
        _active_id = tab_id


def new_tab(url: str = "about:blank") -> str:
    from urllib.parse import quote

    tab = _json(f"/json/new?{quote(url, safe=':/?&=#%')}", method="PUT")
    activate_tab(tab["id"])
    return tab["id"]


def close_tab(tab_id: str) -> None:
    global _active_id
    _json(f"/json/close/{tab_id}")
    with _lock:
        if _active_id == tab_id:
            _active_id = None
    if not tabs():
        new_tab()


def _publish_pointer(x: int, y: int, kind: str) -> None:
    with _lock:
        _pointer.update(x=x, y=y, seq=_pointer["seq"] + 1)
        pointer_feed.append((_pointer["seq"], x, y, kind))


def key_event(combo: str) -> Tuple[Dict[str, Any], str]:
    """DevTools key-event params for ``"ctrl+a"`` / ``"Enter"`` / ``"x"``, plus the text it types."""
    parts = [p for p in combo.replace(" ", "").split("+") if p]
    if not parts:
        raise ValueError("no key given")
    modifiers = 0
    for mod in parts[:-1]:
        if mod.lower() not in _MODIFIERS:
            raise ValueError(f"unknown modifier {mod!r}")
        modifiers |= _MODIFIERS[mod.lower()]
    name = parts[-1]
    if name.lower() in _KEYS:
        key, code, vk, text = _KEYS[name.lower()]
    elif len(name) == 1:
        key, vk, text = name, ord(name.upper()), name
        code = f"Key{name.upper()}" if name.isalpha() else (f"Digit{name}" if name.isdigit() else "")
    elif name.upper().startswith("F") and name[1:].isdigit():
        key, code, vk, text = name.upper(), name.upper(), 111 + int(name[1:]), ""
    else:
        raise ValueError(f"unknown key {name!r}")
    if modifiers & ~8:  # a chord types nothing
        text = ""
    return {"key": key, "code": code, "windowsVirtualKeyCode": vk, "modifiers": modifiers}, text


class BrowserScreen:
    """One DevTools session on the active tab. Use as a context manager."""

    def __init__(self) -> None:
        self._ids = itertools.count(1)
        self._ws = None

    def __enter__(self) -> "BrowserScreen":
        from websockets.sync.client import connect

        page = active_page()
        try:
            self._ws = connect(page["webSocketDebuggerUrl"], max_size=64 * 1024 * 1024, open_timeout=5)
        except OSError as exc:
            raise ScreenUnavailable(f"could not attach to the sandboxed browser: {exc}") from exc
        width, height = VIEWPORT
        self.call("Emulation.setDeviceMetricsOverride",
                  {"width": width, "height": height, "deviceScaleFactor": 1, "mobile": False})
        from agent.agent_bridge.scope import active_scope
        if (scope := active_scope()) is not None and scope.location is not None:
            try:
                self.set_geolocation(scope.location["latitude"], scope.location["longitude"],
                                     scope.location.get("accuracy", 20.0))
            except ScreenUnavailable:
                pass
        return self

    def __exit__(self, *exc: Any) -> None:
        if self._ws is not None:
            self._ws.close()

    def call(self, method: str, params: Optional[Dict[str, Any]] = None, timeout: float = 30) -> Dict[str, Any]:
        msg_id = next(self._ids)
        self._ws.send(json.dumps({"id": msg_id, "method": method, "params": params or {}}))
        while True:
            reply = json.loads(self._ws.recv(timeout=timeout))
            if reply.get("id") == msg_id:
                if "error" in reply:
                    raise ScreenUnavailable(f"{method}: {reply['error'].get('message', 'failed')}")
                return reply.get("result") or {}

    # -- reading -------------------------------------------------------------

    def screenshot(self) -> bytes:
        data = self.call("Page.captureScreenshot", {"format": "jpeg", "quality": 70})["data"]
        return base64.b64decode(data)

    def evaluate(self, expression: str) -> Any:
        result = self.call("Runtime.evaluate", {"expression": expression, "returnByValue": True, "awaitPromise": True})
        if result.get("exceptionDetails"):
            raise ScreenUnavailable("script failed in the page")
        return (result.get("result") or {}).get("value")

    def url(self) -> str:
        return str(self.evaluate("location.href") or "")

    # -- acting ---------------------------------------------------------------

    def navigate(self, url: str) -> None:
        self.call("Page.enable")
        from agent.agent_bridge.scope import active_scope
        if (scope := active_scope()) is not None and scope.location is not None:
            try:
                self.set_geolocation(scope.location["latitude"], scope.location["longitude"],
                                     scope.location.get("accuracy", 20.0), target_url=url)
            except ScreenUnavailable:
                pass
        self.call("Page.navigate", {"url": url})
        self.evaluate("new Promise(r => document.readyState === 'complete' ? r(1) : "
                      "addEventListener('load', () => r(1), {once: true}))")

    def set_geolocation(self, latitude: float, longitude: float, accuracy: float = 20.0,
                        *, target_url: str = "") -> None:
        from urllib.parse import urlsplit

        origins = {"https://www.google.com", "https://maps.google.com"}
        for candidate in (target_url,):
            parts = urlsplit(str(candidate or ""))
            if parts.scheme in ("http", "https") and parts.netloc:
                origins.add(f"{parts.scheme}://{parts.netloc}")
        try:
            parts = urlsplit(self.url())
            if parts.scheme in ("http", "https") and parts.netloc:
                origins.add(f"{parts.scheme}://{parts.netloc}")
        except ScreenUnavailable:
            pass
        for origin in origins:
            try:
                self.call("Browser.grantPermissions", {"permissions": ["geolocation"], "origin": origin})
            except ScreenUnavailable:
                pass
        self.call("Emulation.setGeolocationOverride", {
            "latitude": float(latitude),
            "longitude": float(longitude),
            "accuracy": float(accuracy or 20.0),
        })

    def mouse(self, kind: str, x: int, y: int, *, button: str = "none", clicks: int = 0,
              dx: float = 0, dy: float = 0) -> None:
        params: Dict[str, Any] = {"type": kind, "x": x, "y": y, "button": button, "clickCount": clicks}
        if kind == "mouseWheel":
            params.update(deltaX=dx, deltaY=dy)
        self.call("Input.dispatchMouseEvent", params)

    def glide(self, x: int, y: int, *, button: str = "none") -> None:
        """Move like a hand would: a short eased path the person can follow on the viewer."""
        x0, y0 = _pointer["x"], _pointer["y"]
        steps = max(1, min(20, int(((x - x0) ** 2 + (y - y0) ** 2) ** 0.5 / 30)))
        for i in range(1, steps + 1):
            t = i / steps
            t = t * t * (3 - 2 * t)
            px, py = round(x0 + (x - x0) * t), round(y0 + (y - y0) * t)
            self.mouse("mouseMoved", px, py, button=button)
            _publish_pointer(px, py, "move")
            time.sleep(0.016)

    def click(self, x: int, y: int, *, button: str = "left", clicks: int = 1) -> None:
        self.glide(x, y)
        _publish_pointer(x, y, "click")
        for n in range(1, clicks + 1):
            self.mouse("mousePressed", x, y, button=button, clicks=n)
            self.mouse("mouseReleased", x, y, button=button, clicks=n)

    def drag(self, x: int, y: int, to_x: int, to_y: int) -> None:
        self.glide(x, y)
        self.mouse("mousePressed", x, y, button="left", clicks=1)
        self.glide(to_x, to_y, button="left")
        self.mouse("mouseReleased", to_x, to_y, button="left", clicks=1)

    def scroll(self, x: int, y: int, dx: float, dy: float) -> None:
        self.glide(x, y)
        self.mouse("mouseWheel", x, y, dx=dx, dy=dy)

    def type_text(self, text: str) -> None:
        self.call("Input.insertText", {"text": text})

    def key(self, combo: str) -> None:
        params, text = key_event(combo)
        self.call("Input.dispatchKeyEvent", {"type": "keyDown" if text else "rawKeyDown", **params,
                                             **({"text": text} if text else {})})
        self.call("Input.dispatchKeyEvent", {"type": "keyUp", **params})
