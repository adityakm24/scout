"""The NeMo Guardrails check every Browser Agent answer passes before the User Agent sees it.

It runs ``nemo_guard/runner.py`` in the guard sandbox (NeMo Guardrails needs Python <= 3.13 and
is kept out of both agents' processes). The rail is deterministic: no model, only the
``check_bridge_message`` action. There is no fallback: if the guard cannot answer, the message
is refused.
"""

from __future__ import annotations

import json

from agent.agent_bridge.protocol import PLACEHOLDERS, REASONS, STATUSES, BrowseTask


class GuardUnavailable(RuntimeError):
    """The guard sandbox could not run the rail; the bridge refuses the message."""


def contract(task: BrowseTask) -> dict:
    return {
        "statuses": list(STATUSES), "reasons": list(REASONS), "placeholders": list(PLACEHOLDERS),
        "allowed_domains": list(task.allowed_domains),
        "fields": {name: {"type": f.type, "options": list(f.options)} for name, f in task.result_fields.items()},
    }


def allows(message: str, task: BrowseTask) -> bool:
    from agent.agent_bridge import sandboxes

    try:
        sandboxes.ensure_guard_sandbox()
        proc = sandboxes.exec_in(
            sandboxes.GUARD_SANDBOX, ["python3", sandboxes.GUARD_RUNNER],
            stdin=json.dumps({"message": message, "contract": contract(task)}), timeout=60,
        )
    except sandboxes.SandboxUnavailable as exc:
        raise GuardUnavailable(str(exc)) from exc
    if proc.returncode != 0:
        raise GuardUnavailable(f"guard rail exited {proc.returncode}: {proc.stderr.strip()[:300]}")
    try:
        verdict = json.loads(proc.stdout.strip().splitlines()[-1])
    except (ValueError, IndexError) as exc:
        raise GuardUnavailable("guard rail returned no verdict") from exc
    return verdict.get("allowed") is True
