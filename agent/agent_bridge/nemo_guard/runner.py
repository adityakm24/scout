"""NeMo Guardrails rail for the agent bridge, run inside the guard sandbox.

Self-contained (it runs where Scout is not installed): reads ``{"message": str, "contract": {...}}``
on stdin and prints ``{"allowed": bool}``. The ``check_bridge_message`` action re-checks the
Browser Agent's answer against the task contract independently of the backend's own parser and
refuses natural language, unknown keys, off-allowlist URLs and injection signatures.
"""

import asyncio
import json
import os
import re
import sys
from urllib.parse import urlsplit

from nemoguardrails import LLMRails, RailsConfig

HERE = os.path.dirname(os.path.abspath(__file__))
REFUSED = "BRIDGE_REFUSED"

_INJECTION = re.compile(
    r"(ignore|disregard|forget|override|bypass)\s+(all\s+)?(previous|prior|above|earlier|system|safety)\s+"
    r"(instructions|prompts|rules)|<\s*/?\s*(system|instruction|developer|admin)\s*>|\[\s*(SYSTEM|INST)\s*\]|"
    r"\b(system\s+prompt|api[_ ]key|password|exfiltrate|send\s+(it|this|the)\s+to)\b|https?://|\{\{|\}\}",
    re.IGNORECASE,
)
_SHORT_TEXT = re.compile(r"^[\w .,:;!?'()&+/#%$€£-]{1,80}$", re.UNICODE)

_contract = {}


def _host_ok(url, domains):
    try:
        parts = urlsplit(url)
    except ValueError:
        return False
    host = (parts.hostname or "").lower()
    return parts.scheme in ("http", "https") and bool(host) and any(
        host == d or host.endswith("." + d) for d in domains)


def _value_ok(value, spec, domains):
    kind = spec.get("type")
    if value is None:
        return True
    if kind == "boolean":
        return isinstance(value, bool)
    if kind in ("number", "integer"):
        return not isinstance(value, bool) and isinstance(value, (int, float)) and abs(value) <= 10**15
    if kind == "enum":
        return value in spec.get("options", [])
    if kind == "url":
        return isinstance(value, str) and len(value) <= 2048 and _host_ok(value, domains)
    if isinstance(value, str) and kind in ("currency", "date", "datetime"):
        return len(value) <= 32 and not _INJECTION.search(value)
    if kind == "short_text":
        return isinstance(value, str) and bool(_SHORT_TEXT.match(value)) and not _INJECTION.search(value)
    return False


async def check_bridge_message(text: str = ""):
    c = _contract
    try:
        obj = json.loads(text)
    except (ValueError, TypeError):
        return False
    if not isinstance(obj, dict) or set(obj) - {"status", "reason", "result", "needs"}:
        return False
    if obj.get("status") not in c.get("statuses", []) or obj.get("reason") not in c.get("reasons", []):
        return False
    needs = obj.get("needs") or []
    if not isinstance(needs, list) or any(n not in c.get("placeholders", []) for n in needs):
        return False
    result = obj.get("result") or {}
    fields = c.get("fields", {})
    if not isinstance(result, dict) or set(result) - set(fields):
        return False
    domains = c.get("allowed_domains", [])
    return all(_value_ok(v, fields[k], domains) for k, v in result.items())


def main():
    request = json.loads(sys.stdin.read() or "{}")
    _contract.update(request.get("contract") or {})
    config = RailsConfig.from_path(HERE)
    rails = LLMRails(config)
    rails.register_action(check_bridge_message, "check_bridge_message")
    message = str(request.get("message") or "")
    result = asyncio.run(rails.generate_async(messages=[{"role": "user", "content": message}],
                                              options={"rails": ["input"]}))
    reply = result.response[0]["content"] if result.response else REFUSED
    print(json.dumps({"allowed": reply != REFUSED}))


if __name__ == "__main__":
    main()
