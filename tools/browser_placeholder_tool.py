"""``browser_fill_placeholder``: the Browser Agent's only way to put the person's details in a page.

The agent names a placeholder the browse task granted (``USER_ADDRESS``); the value is resolved
from the vault, the person confirms sharing it with this site (once per task), and it is written
into the matching fields over the supervisor socket. The result carries counts, never values.
"""

from __future__ import annotations

import json
import secrets
from typing import Any, Dict, Optional

from tools.registry import registry

BROWSER_FILL_PLACEHOLDER_SCHEMA = {
    "name": "browser_fill_placeholder",
    "description": (
        "Fill the person's details or current location into the CURRENT page without seeing them. Name a "
        "placeholder (for example USER_LOCATION, USER_ADDRESS, USER_EMAIL, USER_PHONE or USER_FULL_NAME); "
        "Scout resolves the value on demand, enables browser geolocation when USER_LOCATION is used, and types "
        "the value into the matching or currently focused form field itself. You never receive the values. "
        "Never type personal details yourself and never type a {{PLACEHOLDER}} string into a field."
    ),
    "parameters": {
        "type": "object",
        "properties": {"placeholder": {"type": "string", "description": "Placeholder name (e.g. USER_LOCATION, USER_ADDRESS, USER_EMAIL)."}},
        "required": ["placeholder"],
    },
}


def _fail(error: str, error_type: str = "refused") -> str:
    return json.dumps({"success": False, "error_type": error_type, "error": error})


def _consented(scope, placeholder: str, host: str) -> bool:
    """The person approves sharing this detail with this site: a prompt outside the model loop."""
    from agent.agent_bridge.placeholders import describe
    from tools.approval_prompt import request_elicitation_consent

    key = f"{placeholder}@{host}"
    if key in scope.consents:
        return True
    what = describe(placeholder)
    answer = request_elicitation_consent(
        f"Share your {what} with {host}",
        f"Scout's browser wants to type your saved {what} into a form on {host}. The browsing agent never "
        "sees it. Approve only if you want this site to have it.",
        surface="browse-placeholder", title=f"Share your {what}?")
    if answer == "accept":
        scope.consents.add(key)
        return True
    return False


def browser_fill_placeholder(placeholder: str, task_id: Optional[str] = None) -> str:
    from agent.agent_bridge.browser_screen import BrowserScreen, ScreenUnavailable
    from agent.agent_bridge.protocol import PLACEHOLDERS
    from agent.agent_bridge.scope import scope_for
    from tools.bot_desktop import lease

    scope = scope_for(task_id)
    if scope is None:
        return _fail("Placeholders are filled only inside a browse task.")
    placeholder = str(placeholder or "").strip().strip("{}").upper()
    if placeholder not in PLACEHOLDERS:
        return _fail(f"Unknown placeholder. Use one of: {', '.join(PLACEHOLDERS)}.")

    if lease.human_holds():
        return _fail("The person has taken control of the browser. Wait, then try again.", "human_has_control")
    try:
        with BrowserScreen() as screen:
            return _fill(screen, scope, placeholder)
    except ScreenUnavailable as exc:
        return _fail(str(exc), "browser_unavailable")


def _fill_active_or_location_js(value: str, expected_origin: str, *, location_hint: bool = False) -> str:
    payload = json.dumps({"value": value, "origin": expected_origin, "locationHint": bool(location_hint)})
    return f"""(() => {{
      const cfg = {payload};
      if (location.origin !== cfg.origin) return JSON.stringify({{refused: "origin_changed", filled: 0}});
      const isEditable = (el) => {{
        if (!el || el.disabled || el.readOnly) return false;
        const tag = (el.tagName || "").toLowerCase();
        if (tag === "textarea") return true;
        if (tag !== "input") return false;
        const t = (el.type || "text").toLowerCase();
        return !["password", "hidden", "submit", "button", "reset", "checkbox", "radio", "file", "image"].includes(t);
      }};
      let target = isEditable(document.activeElement) ? document.activeElement : null;
      if (!target && cfg.locationHint) {{
        const re = /start(?:ing)?\\s*point|origin|choose\\s*starting|your\\s*location|current\\s*location|where\\s*from|depart/i;
        for (const el of document.querySelectorAll("input,textarea")) {{
          if (!isEditable(el)) continue;
          const r = el.getBoundingClientRect();
          if (r.width < 4 || r.height < 4) continue;
          const label = [el.getAttribute("aria-label"), el.placeholder, el.name, el.id, el.title].filter(Boolean).join(" ");
          if (re.test(label)) {{ target = el; break; }}
        }}
      }}
      if (!target) return JSON.stringify({{filled: 0}});
      target.focus();
      const proto = target.tagName.toLowerCase() === "textarea" ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
      const desc = Object.getOwnPropertyDescriptor(proto, "value");
      if (desc && desc.set) desc.set.call(target, cfg.value); else target.value = cfg.value;
      target.dispatchEvent(new Event("input", {{bubbles: true}}));
      target.dispatchEvent(new Event("change", {{bubbles: true}}));
      return JSON.stringify({{filled: 1}});
    }})()"""


def _fill(screen, scope, placeholder: str) -> str:
    """Inspect the page, resolve the value and write it, all over one DevTools session (the value
    travels in that socket, never in a process's argv)."""
    from agent.agent_bridge import placeholders as ph
    from agent.agent_bridge.protocol import url_host
    from agent.redact import register_vault_redaction_value
    from agent.vault_login_classifier import LoginControl, build_fill_js, build_inspection_js
    from tools.browser_vault_tool import _parse_json_result

    page_url = screen.url()
    host = url_host(page_url)
    if not host or not scope.allows_url(page_url):
        scope.record("browser_fill_placeholder", domain=host, target=placeholder, outcome="domain_not_allowed")
        return _fail("The current page is not on this task's allowed domains.", "domain_not_allowed")

    if placeholder == "USER_LOCATION":
        try:
            coords = scope.read_location()
        except PermissionError as exc:
            scope.record("browser_fill_placeholder", domain=host, target=placeholder, outcome="no_saved_value")
            return _fail(f"{exc} Finish with status blocked, reason needs_data, needs [\"USER_LOCATION\"].",
                         "no_saved_value")
        screen.set_geolocation(coords["latitude"], coords["longitude"], coords.get("accuracy", 20.0),
                               target_url=page_url)

    values = ph.resolve_values(placeholder, scope=scope)
    if not values:
        scope.record("browser_fill_placeholder", domain=host, target=placeholder, outcome="no_saved_value")
        return _fail("No saved value for that placeholder. Finish with status blocked, reason needs_data, "
                     f"needs [\"{placeholder}\"].", "no_saved_value")
    if placeholder != "USER_LOCATION" and not _consented(scope, placeholder, host):
        scope.record("browser_fill_placeholder", domain=host, target=placeholder, outcome="denied_by_user")
        return _fail("The person declined to share this. Do not retry; finish with status blocked, "
                     "reason denied_by_user.", "denied_by_user")

    nonce = secrets.token_hex(8)
    raw_controls = _parse_json_result(screen.evaluate(build_inspection_js(nonce)))
    if isinstance(raw_controls, str):
        raw_controls = _parse_json_result(raw_controls)
    if not isinstance(raw_controls, list):
        raw_controls = []

    wanted = ph.tokens_for(placeholder)
    best: Dict[str, Any] = {}
    for raw in raw_controls:
        if not isinstance(raw, dict):
            continue
        control = LoginControl.from_dict(raw)
        token = ph.classify(control)
        if token in wanted and wanted[token] in values and token not in best:
            best[token] = control

    origin = f"{page_url.split('://', 1)[0]}://{page_url.split('://', 1)[1].split('/', 1)[0]}"
    if not best:
        if len(values) == 1:
            sole_value = next(iter(values.values()))
            register_vault_redaction_value(sole_value)
            fallback = _parse_json_result(screen.evaluate(
                _fill_active_or_location_js(sole_value, origin, location_hint=(placeholder == "USER_LOCATION"))
            ))
            if isinstance(fallback, str):
                fallback = _parse_json_result(fallback)
            filled = int((fallback or {}).get("filled", 0)) if isinstance(fallback, dict) else 0
            if filled or placeholder == "USER_LOCATION":
                scope.record("browser_fill_placeholder", domain=host, target=placeholder, outcome="filled")
                return json.dumps({
                    "success": True,
                    "placeholder": placeholder,
                    "filled_fields": filled,
                    "fields": list(wanted) if filled else [],
                    **({"geolocation_enabled": True} if placeholder == "USER_LOCATION" else {}),
                })
        scope.record("browser_fill_placeholder", domain=host, target=placeholder, outcome="no_matching_field")
        return _fail("No form field on this page matches that placeholder.", "no_matching_field")

    fills = [{"index": c.index, "token": token, "value": values[wanted[token]]} for token, c in best.items()]
    for fill in fills:
        register_vault_redaction_value(fill["value"])
    parsed = _parse_json_result(screen.evaluate(build_fill_js(fills, expected_origin=origin, nonce=nonce)))
    if isinstance(parsed, str):
        parsed = _parse_json_result(parsed)
    if isinstance(parsed, dict) and parsed.get("refused") == "origin_changed":
        return _fail("The page changed site before the fill ran. Nothing was written.", "origin_changed")
    filled = int(parsed.get("filled", 0)) if isinstance(parsed, dict) else 0
    scope.record("browser_fill_placeholder", domain=host, target=placeholder,
                 outcome="filled" if filled else "fill_failed")
    return json.dumps({
        "success": bool(filled) or placeholder == "USER_LOCATION",
        "placeholder": placeholder,
        "filled_fields": filled,
        "fields": sorted(best),
        **({"geolocation_enabled": True} if placeholder == "USER_LOCATION" else {}),
    })


def _handle(args: Dict[str, Any], **kwargs) -> str:
    return browser_fill_placeholder(args.get("placeholder", ""), task_id=kwargs.get("task_id"))


def _check() -> bool:
    from agent.agent_bridge.sandboxes import SandboxUnavailable, openshell
    try:
        return bool(openshell())
    except SandboxUnavailable:
        return False


registry.register(
    name="browser_fill_placeholder",
    toolset="browser_agent",
    schema=BROWSER_FILL_PLACEHOLDER_SCHEMA,
    handler=_handle,
    check_fn=_check,
    emoji="🔒",
)
