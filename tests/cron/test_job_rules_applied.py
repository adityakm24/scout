"""A job's rules are applied to the finished report, not just asked for in the prompt.

A small model given "ignore transaction emails" still wrote "3 new emails — 2 are transaction alerts
(ignored)". The report is now checked item by item after the run: covered items go, the headline is
rewritten from what is left, and nothing left means [SILENT]. Only the model call is faked here.
"""
import json
from types import SimpleNamespace

import pytest

from cron.scheduler_rules import SILENT, apply_job_rules

RULES = ["ignore transaction emails"]
REPORT = (
    "3 new emails — 1 is a transaction alert (ignored).\n\n"
    "Needs a reply:\n- **Rahul**: free for lunch tomorrow?\n\n"
    "Bank:\n- **HDFC Bank**: debit of Rs 450 at a store.\n  Card ending 1234.\n\n"
    "FYI:\n- **Google Scholar**: 2 new citations."
)


@pytest.fixture
def model(monkeypatch):
    """Classifier: a line is covered when it names HDFC or says something was ignored.
    Headline rewrite: a quoted bold line, as small models write it."""
    calls = []

    def call_llm(*, task, messages, **_):
        calls.append(task)
        system, user = messages[0]["content"], messages[1]["content"]
        if "numbered line" in system:
            items = [line for line in user.split("Items:\n", 1)[1].splitlines() if line.strip()]
            answer = json.dumps({"items": [
                {"item": int(line.split(".", 1)[0]), "rule": RULES[0] if "HDFC" in line or "ignored" in line else None}
                for line in items]})
        else:
            answer = '**"Lunch question and new citations"**'
        return SimpleNamespace(choices=[SimpleNamespace(message=SimpleNamespace(content=answer))])

    monkeypatch.setattr("agent.auxiliary_client.call_llm", call_llm)
    return calls


def test_items_a_rule_covers_are_removed_without_a_trace(model):
    out = apply_job_rules(RULES, REPORT)

    assert "HDFC" not in out and "1234" not in out and "transaction" not in out
    assert "Bank:" not in out  # its only item went, so the heading goes too
    assert "**Rahul**" in out and "**Google Scholar**" in out and "Needs a reply:" in out
    assert out.splitlines()[0] == "Lunch question and new citations"


@pytest.mark.parametrize("report", [
    "2 new emails.\n- **HDFC Bank**: debit of Rs 450.\n- **HDFC Bank**: credit of Rs 90.",
    "1 new email: HDFC Bank debited Rs 450.",
], ids=["every-item", "one-line"])
def test_nothing_left_after_the_rules_means_silence(model, report):
    assert apply_job_rules(RULES, report) == SILENT


def test_a_report_the_rules_do_not_touch_is_delivered_as_written(model):
    report = "1 new email.\n- **Rahul**: free for lunch tomorrow?"
    assert apply_job_rules(RULES, report) == report
    assert model == ["monitor"]  # one classifier call, no headline rewrite


def test_a_failed_check_delivers_the_report_unchanged(monkeypatch):
    def broken(**_):
        raise TimeoutError("Request timed out.")

    monkeypatch.setattr("agent.auxiliary_client.call_llm", broken)
    assert apply_job_rules(RULES, REPORT) == REPORT


def test_a_headline_that_mentions_what_was_left_out_is_rewritten(model):
    out = apply_job_rules(RULES, "2 new emails, 1 transaction alert ignored.\n\n- **Rahul**: lunch?\n- **Priya**: photos.")

    assert out == "Lunch question and new citations\n\n- **Rahul**: lunch?\n- **Priya**: photos."
