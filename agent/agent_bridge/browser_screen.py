"""Mouse-and-keyboard control of the Chromium in the browser sandbox, over its DevTools port.

The Browser Agent works the page like a person at a computer: it looks at a screenshot and
clicks, scrolls and types at coordinates (``tools/browser_computer_tool.py``). The person watches
the same page live and can take control (``scout_backend/web_routers/browser_screen.py``); both
drive the most recently opened tab, so they always see and act on the same thing.
"""

from __future__ import annotations

import base64
import itertools
import json
import urllib.request
from typing import Any, Dict, Optional, Tuple

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


def active_page() -> Dict[str, Any]:
    """The tab both the agent and the viewer work on: the most recently opened page."""
    try:
        with urllib.request.urlopen(f"{cdp_base()}/json/list", timeout=3) as resp:
            targets = json.loads(resp.read())
    except (OSError, ValueError) as exc:
        raise ScreenUnavailable("the sandboxed browser is not running") from exc
    pages = [t for t in targets if t.get("type") == "page" and t.get("webSocketDebuggerUrl")]
    if not pages:
        raise ScreenUnavailable("the sandboxed browser has no open page")
    return pages[0]


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
        data = self.call("Page.captureScreenshot", {"format": "png"})["data"]
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
        self.call("Page.navigate", {"url": url})
        self.evaluate("new Promise(r => document.readyState === 'complete' ? r(1) : "
                      "addEventListener('load', () => r(1), {once: true}))")

    def mouse(self, kind: str, x: int, y: int, *, button: str = "none", clicks: int = 0,
              dx: float = 0, dy: float = 0) -> None:
        params: Dict[str, Any] = {"type": kind, "x": x, "y": y, "button": button, "clickCount": clicks}
        if kind == "mouseWheel":
            params.update(deltaX=dx, deltaY=dy)
        self.call("Input.dispatchMouseEvent", params)

    def click(self, x: int, y: int, *, button: str = "left", clicks: int = 1) -> None:
        self.mouse("mouseMoved", x, y)
        for n in range(1, clicks + 1):
            self.mouse("mousePressed", x, y, button=button, clicks=n)
            self.mouse("mouseReleased", x, y, button=button, clicks=n)

    def drag(self, x: int, y: int, to_x: int, to_y: int) -> None:
        self.mouse("mouseMoved", x, y)
        self.mouse("mousePressed", x, y, button="left", clicks=1)
        steps = 8
        for i in range(1, steps + 1):
            self.mouse("mouseMoved", x + (to_x - x) * i // steps, y + (to_y - y) * i // steps, button="left")
        self.mouse("mouseReleased", to_x, to_y, button="left", clicks=1)

    def scroll(self, x: int, y: int, dx: float, dy: float) -> None:
        self.mouse("mouseWheel", x, y, dx=dx, dy=dy)

    def type_text(self, text: str) -> None:
        self.call("Input.insertText", {"text": text})

    def key(self, combo: str) -> None:
        params, text = key_event(combo)
        self.call("Input.dispatchKeyEvent", {"type": "keyDown" if text else "rawKeyDown", **params,
                                             **({"text": text} if text else {})})
        self.call("Input.dispatchKeyEvent", {"type": "keyUp", **params})
