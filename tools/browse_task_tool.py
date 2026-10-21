"""``browse_task``: the User Agent's only way to reach the web.

The User Agent holds the person's data and has no web tools. It hands a browse task to a fresh,
zero-data Browser Agent and gets back typed fields and a metadata log, never page text
(agent/agent_bridge/). Personal details travel as placeholder names, never as values.
"""

from __future__ import annotations

import json
import re
from typing import Any, Dict

from tools.registry import registry

BROWSE_TASK_SCHEMA = {
    "name": "browse_task",
    "description": (
        "Your ONLY way to reach the internet: the terminal, code and files have no web access. Use it for any page, "
        "search, price, booking or lookup on the web. It runs Scout's separate Browser Agent, which holds none of "
        "the person's data. You get back "
        "only a status, the typed result fields you ask for (numbers, yes/no, dates, fixed choices, short labels, "
        "links on the allowed domains) and a log of which sites it visited. You never get page text or summaries, "
        "so ask for the specific facts you need as fields. Write the goal without any personal details: if the "
        "site needs the person's name, email, phone or address, grant the placeholder (for example USER_ADDRESS) "
        "and the details are typed into the page without the Browser Agent seeing them, after the person "
        "approves. A result with reason needs_data lists placeholders to grant on a retry. If the result is "
        "blocked or failed, tell the person that plainly; never fill in prices, ratings or products from memory."
    ),
    "parameters": {
        "type": "object",
        "properties": {
            "goal": {"type": "string", "description": "What to do or find, in at most 600 characters. No personal details."},
            "start_url": {"type": "string", "description": "https URL to start from (e.g. https://www.amazon.com)."},
            "allowed_domains": {
                "type": "array", "items": {"type": "string"}, "maxItems": 10,
                "description": ("Optional: keep the Browser Agent on these domains (subdomains included). Leave it "
                                "out to let it browse any public site, as a person would."),
            },
            "placeholders": {
                "type": "array", "items": {"type": "string", "enum": [
                    "USER_FULL_NAME", "USER_FIRST_NAME", "USER_LAST_NAME", "USER_EMAIL", "USER_PHONE",
                    "USER_ADDRESS", "USER_ADDRESS_LINE1", "USER_ADDRESS_LINE2", "USER_CITY", "USER_REGION",
                    "USER_POSTAL_CODE", "USER_COUNTRY", "USER_LOCATION",
                ]},
                "description": ("Personal details or live device location (USER_LOCATION) the Browser Agent may "
                                "use on these domains."),
            },
            "result_fields": {
                "type": "object",
                "description": (
                    "The facts to bring back, as {name: {\"type\": T}} with T one of number, integer, boolean, "
                    "date, datetime, currency, url, short_text (one line, 160 characters), enum with "
                    "\"options\": [...], or list with \"items\": {sub-field: {\"type\": T}} for several rows "
                    "(up to 10, e.g. products). Links (url) may point anywhere unless allowed_domains is set. Example for comparing products: {\"products\": {\"type\": \"list\", "
                    "\"items\": {\"name\": {\"type\": \"short_text\"}, \"price\": {\"type\": \"number\"}, "
                    "\"currency\": {\"type\": \"currency\"}, \"rating\": {\"type\": \"number\"}, \"link\": "
                    "{\"type\": \"url\"}}}}. At most 12 fields, names in lower_snake_case."
                ),
                "additionalProperties": {"type": "object"},
            },
        },
        "required": ["goal", "start_url"],
    },
}

_EMAIL_RE = re.compile(r"[\w.+-]+@[\w-]+\.[\w.-]+")
_PHONE_RE = re.compile(r"\+?\d[\d\s().-]{7,}\d")
_DECIMAL_FLOAT_RE = re.compile(r"(?<!\d)-?\d+\.\d+(?!\.\d)")


def _personal_detail_in_goal(goal: str) -> bool:
    """A raw email, phone number or saved profile/address value in the goal would hand it to the
    Browser Agent's model; placeholders exist so it never has to."""
    scrubbed = _DECIMAL_FLOAT_RE.sub(" ", goal)
    if _EMAIL_RE.search(goal) or _PHONE_RE.search(scrubbed):
        return True
    from agent.agent_bridge.placeholders import resolve_values
    from agent.agent_bridge.protocol import PLACEHOLDERS

    lowered = goal.lower()
    try:
        values = {v for p in PLACEHOLDERS for v in resolve_values(p).values()}
    except Exception:
        values = set()
    return any(len(v) >= 3 and v.lower() in lowered for v in values)


def browse_task(args: Dict[str, Any], *, parent_agent: Any) -> str:
    from agent.agent_bridge.browser_agent import run_browse_task
    from agent.agent_bridge.protocol import BridgeError, parse_browse_task

    try:
        task = parse_browse_task(args)
    except BridgeError as exc:
        return json.dumps({"status": "failed", "reason": "other", "error": str(exc)})
    if _personal_detail_in_goal(task.goal):
        return json.dumps({"status": "failed", "reason": "other", "error": (
            "The goal contains a personal detail. Remove it and grant the matching placeholder instead "
            "(for example USER_EMAIL); the value is typed into the page without the Browser Agent seeing it.")})
    result = run_browse_task(parent_agent, task)
    if result.get("status") != "done":
        # Written by code: the User Agent must not fill the gap from its own knowledge.
        result["note"] = ("The browse task did not return results. Tell the person it did not work; do not "
                          "list products, prices or facts from memory as if they came from the web.")
    return json.dumps(result)


def _registry_handler(args: Dict[str, Any], **kwargs) -> str:
    parent = kwargs.get("parent_agent")
    if parent is None:
        return json.dumps({"status": "failed", "reason": "other", "error": "browse_task runs only inside an agent turn"})
    return browse_task(args, parent_agent=parent)


registry.register(
    name="browse_task",
    toolset="browse",
    schema=BROWSE_TASK_SCHEMA,
    handler=_registry_handler,
    emoji="🌐",
)
