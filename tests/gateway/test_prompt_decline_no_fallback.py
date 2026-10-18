"""P5(b) at the CALLER: a connector egress decline must not fall back.

The adapter-level tests prove the decline REACHES the caller. These prove the
caller ACTS on it. Review round 1 blocker B-3: `_approval_send_outcome` had
only sent/failed/ambiguous, so a decline collapsed into `failed` — which is
precisely the cue to run the plain-text fallback into the chat the connector
had just refused. The adapter fix improved the error STRING while the
user-visible behaviour stayed identical to base.

These tests drive the real `gateway.run` classifier and the real
`tools.slash_confirm` registry; only the SendResult (the connector's answer)
is constructed.
"""

from __future__ import annotations

import concurrent.futures
from types import SimpleNamespace

import pytest

DECLINE_ERROR = (
    "discord egress declined: target is not an approved destination for this connection"
)
LANE_ERROR = "relay prompt op unavailable"


def _future(result):
    fut: concurrent.futures.Future = concurrent.futures.Future()
    fut.set_result(result)
    return fut


def _result(*, success: bool, error: str | None = None):
    return SimpleNamespace(success=success, error=error, message_id=None)


# ── the classifier ──────────────────────────────────────────────────────────




def test_genuine_lane_failure_still_falls_back():
    """The guard must not swallow real failures: those still re-ask."""
    from gateway.run import _approval_send_outcome

    outcome = _approval_send_outcome(
        _future(_result(success=False, error=LANE_ERROR)), timeout=5
    )
    assert outcome == "failed"


def test_success_and_timeout_verdicts_unchanged():
    """No collateral change to the two settled verdicts."""
    from gateway.run import _approval_send_outcome

    assert (
        _approval_send_outcome(_future(_result(success=True)), timeout=5) == "sent"
    )

    pending: concurrent.futures.Future = concurrent.futures.Future()
    assert _approval_send_outcome(pending, timeout=0.05) == "ambiguous"




def test_non_decline_error_text_is_not_laundered_into_declined():
    """Fail-closed the other way: only the real contract yields `declined`.

    Without this, a permissive marker check would silence genuine failures —
    turning a lane outage into a silent no-fallback.
    """
    from gateway.run import _approval_send_outcome

    for error in (
        "connection reset by peer",
        "declined",  # bare word, not the marker sentence
        "egress declined",  # no colon: not the uniform marker
    ):
        assert (
            _approval_send_outcome(
                _future(_result(success=False, error=error)), timeout=5
            )
            == "failed"
        ), error


# ── the STRUCTURED response, not the rendered string ────────────────────────
#
# Round-2 review: I fixed the text-marker path and tested only the text-marker
# path. The adapter preserves the connector's own dict in `raw_response`, and
# classifying the error STRING instead loses two contracts.




