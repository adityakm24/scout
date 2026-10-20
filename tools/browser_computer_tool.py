"""``browser_computer``: the Browser Agent uses its browser like a person at a computer.

It sees a screenshot and acts at pixel coordinates (click, drag, scroll, type, keys), plus
``navigate`` for the address bar. The page runs in the browser sandbox and is shown live to the
person, who can take control at any time; while they hold it every action is refused (they may
be typing a password). Each action re-checks the browse task's domain allowlist.
"""

from __future__ import annotations

import base64
import json
import time
from typing import Any, Dict, Optional

from tools.registry import registry

_ACTIONS = ("screenshot", "navigate", "click", "double_click", "right_click", "move", "drag", "scroll", "type", "key",
            "wait")

BROWSER_COMPUTER_SCHEMA = {
    "name": "browser_computer",
    "description": (
        "Use the web browser like a person: look at a screenshot and act at pixel coordinates on a 1280x800 "
        "screen. Actions: screenshot; navigate (url); click, double_click, right_click, move (x, y); drag (x, y, "
        "to_x, to_y); scroll (x, y, direction up/down/left/right, amount); type (text, into whatever has focus: "
        "click the field first); key (keys, e.g. Enter, Tab, ctrl+a); wait (seconds). Every action returns a new "
        "screenshot, so check it before the next step. The person may be watching and can take over; if an "
        "action says they have control, wait and try again later."
    ),
    "parameters": {
        "type": "object",
        "properties": {
            "action": {"type": "string", "enum": list(_ACTIONS)},
            "url": {"type": "string"},
            "x": {"type": "integer"}, "y": {"type": "integer"},
            "to_x": {"type": "integer"}, "to_y": {"type": "integer"},
            "direction": {"type": "string", "enum": ["up", "down", "left", "right"]},
            "amount": {"type": "integer", "description": "scroll steps (default 3)"},
            "text": {"type": "string"},
            "keys": {"type": "string"},
            "seconds": {"type": "number"},
        },
        "required": ["action"],
    },
}


def _fail(error: str) -> str:
    return json.dumps({"success": False, "error": error})


def _coords(args: Dict[str, Any], *names: str) -> list:
    from agent.agent_bridge.browser_screen import VIEWPORT

    values = []
    for name in names:
        value = args.get(name)
        if not isinstance(value, int) or isinstance(value, bool):
            raise ValueError(f"{name} must be an integer pixel coordinate")
        limit = VIEWPORT[0] if name.endswith("x") else VIEWPORT[1]
        if not 0 <= value < limit:
            raise ValueError(f"{name}={value} is off the {VIEWPORT[0]}x{VIEWPORT[1]} screen")
        values.append(value)
    return values


def _act(screen, action: str, args: Dict[str, Any]) -> str:
    """Perform one action; returns a short description for the log (never typed text)."""
    if action == "navigate":
        screen.navigate(str(args.get("url") or ""))
        return "navigate"
    if action in ("click", "double_click", "right_click"):
        x, y = _coords(args, "x", "y")
        screen.click(x, y, button="right" if action == "right_click" else "left", clicks=2 if action == "double_click" else 1)
        return f"{x},{y}"
    if action == "move":
        x, y = _coords(args, "x", "y")
        screen.mouse("mouseMoved", x, y)
        return f"{x},{y}"
    if action == "drag":
        x, y, to_x, to_y = _coords(args, "x", "y", "to_x", "to_y")
        screen.drag(x, y, to_x, to_y)
        return f"{x},{y}->{to_x},{to_y}"
    if action == "scroll":
        x, y = _coords(args, "x", "y") if "x" in args else (640, 400)
        step = 120 * max(1, min(int(args.get("amount") or 3), 20))
        dx, dy = {"up": (0, -step), "down": (0, step), "left": (-step, 0), "right": (step, 0)}[
            str(args.get("direction") or "down")]
        screen.scroll(x, y, dx, dy)
        return str(args.get("direction") or "down")
    if action == "type":
        screen.type_text(str(args.get("text") or ""))
        return f"{len(str(args.get('text') or ''))} chars"
    if action == "key":
        screen.key(str(args.get("keys") or ""))
        return str(args.get("keys") or "")[:20]
    if action == "wait":
        time.sleep(max(0.0, min(float(args.get("seconds") or 1), 10.0)))
    return ""


def browser_computer(args: Dict[str, Any], task_id: Optional[str] = None) -> Any:
    from agent.agent_bridge.browser_screen import BrowserScreen, ScreenUnavailable
    from agent.agent_bridge.protocol import url_host
    from agent.agent_bridge.scope import navigation_error, scope_for
    from tools.bot_desktop import lease

    action = str(args.get("action") or "")
    if action not in _ACTIONS:
        return _fail(f"action must be one of: {', '.join(_ACTIONS)}")
    scope = scope_for(task_id)
    if scope is None:
        return _fail("The browser is used only inside a browse task.")
    if lease.human_holds():
        return _fail("The person has taken control of the browser. Use action wait, then try again.")
    if action == "navigate" and (error := navigation_error(task_id, str(args.get("url") or ""))) is not None:
        return _fail(error)
    try:
        with BrowserScreen() as screen:
            target = _act(screen, action, args)
            time.sleep(0.4)  # let the page react before the screenshot
            url = screen.url()
            if url not in ("", "about:blank") and (error := navigation_error(task_id, url)) is not None:
                screen.navigate("about:blank")
                return _fail(error)
            png = screen.screenshot()
    except ValueError as exc:
        return _fail(str(exc))
    except ScreenUnavailable as exc:
        return _fail(str(exc))
    scope.record(f"browser_computer.{action}", domain=url_host(url), target=target if action != "type" else "")
    summary = json.dumps({"success": True, "action": action, "url": url})
    return {
        "_multimodal": True,
        "content": [{"type": "text", "text": summary},
                    {"type": "image_url", "image_url": {"url": "data:image/png;base64," + base64.b64encode(png).decode()}}],
        "text_summary": summary,
    }


def _check() -> bool:
    from agent.agent_bridge.sandboxes import SandboxUnavailable, openshell
    try:
        return bool(openshell())
    except SandboxUnavailable:
        return False


registry.register(
    name="browser_computer",
    toolset="browser_agent",
    schema=BROWSER_COMPUTER_SCHEMA,
    handler=lambda args, **kw: browser_computer(args, task_id=kw.get("task_id")),
    check_fn=_check,
    emoji="🖱️",
)
