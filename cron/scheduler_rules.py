"""A job's standing rules ("ignore transaction emails"), applied to its report before anyone sees it.

The rules already ride in the job's prompt (``scheduler_prompt._rules_section``), but a small model
writing a whole report still leaks what a rule excludes ("3 new emails, 2 are transaction alerts
(ignored)"). So after the run the report is split into items, one classifier call says which items a
rule covers, those items are dropped in code, and the headline is rewritten from what is left. Nothing
left means ``[SILENT]``. Any failure here delivers the report unchanged: a rule must never cost the
user a message they wanted.
"""

from __future__ import annotations

import json
import logging
import re
from typing import List, Optional, Tuple

logger = logging.getLogger(__name__)

SILENT = "[SILENT]"
# The classifier slot: small model, structured output, many calls (config: auxiliary.monitor).
_TASK = "monitor"
_BULLET = re.compile(r"^\s*(?:[-*+]|\d+[.)])\s+")

_CLASSIFY_PROMPT = (
    "The user set standing rules about what they do not want to hear about. For EACH numbered line, "
    "say which rule (by its text) tells you to leave it out, or null if no rule does. A rule covers "
    "only what it names; a rule like \"only X\" leaves out everything that is not X. A line that "
    "mentions or counts something a rule leaves out (\"2 alerts ignored\") is covered too. Answer "
    "as JSON: "
    '{"items": [{"item": 1, "rule": "<rule text>" or null}, ...]} with one entry per line.'
)
_HEADLINE_PROMPT = (
    "Write the first line of this report: a one-line headline, under 12 words, saying what the report "
    "contains. Mention nothing that is not in it. Reply with the headline only."
)


def _split(report: str) -> Tuple[str, List[List[str]]]:
    """``(headline, blocks)``: a block is one item (a top-level line plus its indented continuation)
    or a blank spacer line."""
    lines = report.strip().splitlines()
    blocks: List[List[str]] = []
    for line in lines[1:]:
        if line.strip() and line[:1].isspace() and blocks and blocks[-1][0].strip():
            blocks[-1].append(line)
        else:
            blocks.append([line])
    return lines[0], blocks


def _item_text(block: List[str]) -> str:
    return " ".join(_BULLET.sub("", line).strip() for line in block)


def _ask(messages: list, *, max_tokens: int, json_mode: bool) -> str:
    from agent.auxiliary_client import call_llm

    response = call_llm(
        task=_TASK, messages=messages, max_tokens=max_tokens, temperature=0,
        extra_body={"response_format": {"type": "json_object"}} if json_mode else None,
        reasoning_config={"enabled": False},
    )
    return (response.choices[0].message.content or "").strip()


def _covered(items: List[str], rules: List[str]) -> set:
    """1-based numbers of the items a rule covers."""
    numbered = "\n".join(f"{i}. {text}" for i, text in enumerate(items, 1))
    raw = _ask([
        {"role": "system", "content": _CLASSIFY_PROMPT},
        {"role": "user", "content": "Rules:\n" + "\n".join(f"- {r}" for r in rules) + f"\n\nItems:\n{numbered}"},
    ], max_tokens=60 + 30 * len(items), json_mode=True)
    match = re.search(r"\{.*\}", raw, re.DOTALL)
    entries = json.loads(match.group(0) if match else raw).get("items")
    if not isinstance(entries, list):
        raise ValueError(f"classifier answer has no items list: {raw[:200]!r}")
    return {e["item"] for e in entries
            if isinstance(e, dict) and e.get("rule") and isinstance(e.get("item"), int)}


def _orphan_heading(blocks: List[List[str]], index: int) -> bool:
    """A "Needs a reply:" style line whose items were all dropped."""
    if _BULLET.match(blocks[index][0]) or not blocks[index][0].rstrip().endswith(":"):
        return False
    following = next((b for b in blocks[index + 1:] if b[0].strip()), None)
    return following is None or not _BULLET.match(following[0])


def _headline(body: str, fallback: str) -> str:
    try:
        line = _ask([{"role": "system", "content": _HEADLINE_PROMPT}, {"role": "user", "content": body}],
                    max_tokens=40, json_mode=False)
        line = next((ln.strip() for ln in line.splitlines() if ln.strip()), "")
        # Models dress a lone line up as a quote or a bold title: **"Lunch plans await."**
        line = re.sub(r'^[*_#\s"“”\']+|[*_\s"“”\']+$', "", line)
        return line or fallback
    except Exception as exc:
        logger.warning("Job rules: headline rewrite failed, using the first item: %s", exc)
        return fallback


def apply_job_rules(rules: List[str], report: str) -> str:
    """*report* with everything *rules* exclude taken out; ``[SILENT]`` when nothing is left. The
    headline is checked too: one that mentions excluded things is rewritten from what is left."""
    rules = [r.strip() for r in rules or [] if isinstance(r, str) and r.strip()]
    if not rules or not report.strip():
        return report
    headline, blocks = _split(report)
    item_blocks = [i for i, b in enumerate(blocks) if b[0].strip()]
    # Line 1 is the headline; lines 2.. are the items. A one-line report is its headline alone.
    lines = [headline] + [_item_text(blocks[i]) for i in item_blocks]
    try:
        covered = _covered(lines, rules)
    except Exception as exc:
        logger.warning("Job rules: could not check the report against the rules; delivering it as is: %s", exc)
        return report
    dropped = {item_blocks[n - 2] for n in covered if 2 <= n <= len(lines)}
    if not item_blocks:
        return SILENT if 1 in covered else report
    if len(dropped) == len(item_blocks):
        logger.info("Job rules: every item was covered by a rule; the run stays silent")
        return SILENT
    if not covered:
        return report

    kept = [b for i, b in enumerate(blocks) if i not in dropped]
    kept = [b for i, b in enumerate(kept) if not _orphan_heading(kept, i)]
    body = re.sub(r"\n{3,}", "\n\n", "\n".join(line for b in kept for line in b)).strip()
    logger.info("Job rules: removed %d of %d items%s", len(dropped), len(item_blocks),
                " and rewrote the headline" if 1 in covered or dropped else "")
    first_item = _item_text(next(b for b in kept if b[0].strip()))
    return f"{_headline(body, first_item)}\n\n{body}"
