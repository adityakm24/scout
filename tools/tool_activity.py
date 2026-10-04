"""What the agent is doing, in the user's words: one present-tense line per tool call ("Checking
where you are", "Placing your Zepto order").

It feeds the live surfaces — the phone's Live Activity or ongoing notification, and the chat
header — and travels on the ``tool.start`` event. ``None`` for plumbing (finding a tool, reading
its own instructions, notes to itself), so the line keeps naming the work the user asked for.
"""

from __future__ import annotations

from typing import Any, Callable, Dict, Optional

from tools.mcp_tool_schema import MCP_TOOL_NAME_PREFIX
from tools.tool_labels import app_title, label_for_tool_name

_QUIET = frozenset({
    "tool_search", "tool_describe", "skill_view", "skills_list", "todo", "todo_list", "memory",
    "session_search", "clarify", "text_to_speech",
})


def _merchant(args: Dict[str, Any]) -> str:
    return app_title(str(args.get("server") or "")) or "the"


_CORE: Dict[str, Callable[[Dict[str, Any]], str]] = {
    "device_location": lambda a: "Checking where you are",
    "schedule_order": lambda a: f"Scheduling your {_merchant(a)} order",
    "web_search": lambda a: "Searching the web",
    "web_extract": lambda a: "Reading a web page",
    "terminal": lambda a: "Running a task on your computer",
    "execute_code": lambda a: "Running a task on your computer",
    "read_file": lambda a: "Looking through files",
    "search_files": lambda a: "Looking through files",
    "list_files": lambda a: "Looking through files",
    "write_file": lambda a: "Editing files",
    "patch": lambda a: "Editing files",
    "cronjob_manage": lambda a: "Scheduling a task",
    "send_message": lambda a: "Sending a message",
    "delegate_task": lambda a: "Working on parts of this in parallel",
    "image_generate": lambda a: "Making an image",
    "vision_analyze": lambda a: "Looking at an image",
}


def _mcp_activity(server: str, tool: str, args: Dict[str, Any]) -> str:
    app, name = app_title(server), tool.lower()
    from tools.mcp_tool_spending import spending_entry

    entry = spending_entry(server)
    if entry is not None and tool in entry.spending.tools:
        flag = entry.spending.commit_flag
        return f"Placing your {app} order" if not flag or args.get(flag) is True else f"Checking your {app} bill"
    if "cart" in name:
        return f"Checking your {app} cart" if name.startswith(("view", "get")) else f"Updating your {app} cart"
    if "search" in name:
        return f"Searching {app}"
    if "address" in name:
        return f"Looking up your {app} addresses"
    if any(word in name for word in ("serviceab", "eta", "delivery_time", "store")):
        return f"Checking {app} delivery time"
    if "order" in name:
        return f"Checking your {app} order"
    if "payment" in name:
        return f"Checking {app} payment options"
    label = label_for_tool_name(MCP_TOOL_NAME_PREFIX + f"{server}__{tool}")
    return label.text if label is not None else app


def activity_for_tool(name: str, args: Any) -> Optional[str]:
    """The line for one tool call, or ``None`` when it is plumbing."""
    args = args if isinstance(args, dict) else {}
    if name == "tool_call":
        calls = args.get("calls") if isinstance(args.get("calls"), list) else [args]
        first = calls[0] if calls and isinstance(calls[0], dict) else {}
        return activity_for_tool(str(first.get("name") or ""), first.get("arguments"))
    if not name or name in _QUIET:
        return None
    if name in _CORE:
        return _CORE[name](args)
    if name.startswith("browser_"):
        return "Using the browser"
    if name.startswith(MCP_TOOL_NAME_PREFIX):
        server, _, tool = name[len(MCP_TOOL_NAME_PREFIX):].partition("__")
        if tool:
            return _mcp_activity(server, tool, args)
    label = label_for_tool_name(name, args)
    return label.text if label is not None and label.kind != "tool" else None
