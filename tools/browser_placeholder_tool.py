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
        "Fill the person's details into the CURRENT page without seeing them. Name a placeholder this task "
        "granted (for example USER_ADDRESS or USER_EMAIL); Scout finds the matching form fields and types the "
        "real values itself. You never receive the values. Never type personal details yourself and never type a "
        "{{PLACEHOLDER}} string into a field. If the task did not grant the placeholder you need, finish with "
        "status blocked, reason needs_data and list it in needs."
    ),
    "parameters": {
        "type": "object",
        "properties": {"placeholder": {"type": "string", "description": "A placeholder name the task granted."}},
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
    if placeholder not in scope.task.placeholders:
        scope.record("browser_fill_placeholder", target=placeholder, outcome="not_granted")
        return _fail("This task did not grant that placeholder. Finish with status blocked, reason needs_data, "
                     f"needs [\"{placeholder}\"].", "not_granted")

    if lease.human_holds():
        return _fail("The person has taken control of the browser. Wait, then try again.", "human_has_control")
    try:
        with BrowserScreen() as screen:
            return _fill(screen, scope, placeholder)
    except ScreenUnavailable as exc:
        return _fail(str(exc), "browser_unavailable")


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

    values = ph.resolve_values(placeholder)
    if not values:
        scope.record("browser_fill_placeholder", domain=host, target=placeholder, outcome="no_saved_value")
        return _fail("No saved value for that placeholder. Finish with status blocked, reason needs_data, "
                     f"needs [\"{placeholder}\"].", "no_saved_value")
    if not _consented(scope, placeholder, host):
        scope.record("browser_fill_placeholder", domain=host, target=placeholder, outcome="denied_by_user")
        return _fail("The person declined to share this. Do not retry; finish with status blocked, "
                     "reason denied_by_user.", "denied_by_user")

    nonce = secrets.token_hex(8)
    raw_controls = _parse_json_result(screen.evaluate(build_inspection_js(nonce)))
    if isinstance(raw_controls, str):
        raw_controls = _parse_json_result(raw_controls)
    if not isinstance(raw_controls, list):
        return _fail("Could not inspect the page's form fields.", "inspect_failed")

    wanted = ph.tokens_for(placeholder)
    best: Dict[str, Any] = {}
    for raw in raw_controls:
        if not isinstance(raw, dict):
            continue
        control = LoginControl.from_dict(raw)
        token = ph.classify(control)
        if token in wanted and wanted[token] in values and token not in best:
            best[token] = control
    if not best:
        scope.record("browser_fill_placeholder", domain=host, target=placeholder, outcome="no_matching_field")
        return _fail("No form field on this page matches that placeholder.", "no_matching_field")

    fills = [{"index": c.index, "token": token, "value": values[wanted[token]]} for token, c in best.items()]
    for fill in fills:
        register_vault_redaction_value(fill["value"])
    origin = f"{page_url.split('://', 1)[0]}://{page_url.split('://', 1)[1].split('/', 1)[0]}"
    parsed = _parse_json_result(screen.evaluate(build_fill_js(fills, expected_origin=origin, nonce=nonce)))
    if isinstance(parsed, str):
        parsed = _parse_json_result(parsed)
    if isinstance(parsed, dict) and parsed.get("refused") == "origin_changed":
        return _fail("The page changed site before the fill ran. Nothing was written.", "origin_changed")
    filled = int(parsed.get("filled", 0)) if isinstance(parsed, dict) else 0
    scope.record("browser_fill_placeholder", domain=host, target=placeholder,
                 outcome="filled" if filled else "fill_failed")
    return json.dumps({"success": bool(filled), "placeholder": placeholder, "filled_fields": filled,
                       "fields": sorted(best)})


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
