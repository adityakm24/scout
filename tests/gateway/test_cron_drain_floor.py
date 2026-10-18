"""Regression tests for #82161.

``restart_drain_timeout`` defaults to ``0``, and the drain applied that single
budget to every class of in-flight work. That default is deliberate for chat
turns — the user is told the gateway is restarting and the session is
pre-marked resume_pending, so interrupting one is cheap and recoverable — but
a cron run has neither property: it is written to jobs.json as a permanent
failure that nobody is waiting on, and a recurring job just skips to its next
schedule.

With the shared budget the drain short-circuited on ``timeout <= 0`` before
the wait loop, producing the reported log line: ``drain took 0.00s,
timed_out=True, cron_at_start=1, cron_now=1`` — it detected the job and killed
it anyway. Cron work now drains on its own floor (``cron_drain_timeout``),
clamped to the shutdown-watchdog leash so the extra wait can never eat the
post-drain cleanup window.
"""

import asyncio

import pytest

from gateway.restart import (
    CRON_DRAIN_CLEANUP_RESERVE_S,
    DEFAULT_GATEWAY_CRON_DRAIN_TIMEOUT,
    parse_cron_drain_timeout,
    resolve_cron_drain_budget,
    resolve_systemd_timeout_stop_sec,
)
from tests.gateway.restart_test_helpers import make_restart_runner


@pytest.fixture(autouse=True)
def _reset_cron_running_set():
    import cron.scheduler as sched

    sched._running_job_ids.clear()
    sched._interrupted_job_ids.clear()
    yield
    sched._running_job_ids.clear()
    sched._interrupted_job_ids.clear()




class TestParseCronDrainTimeout:
    def test_missing_and_blank_fall_back_to_default(self):
        assert parse_cron_drain_timeout(None) == DEFAULT_GATEWAY_CRON_DRAIN_TIMEOUT
        assert parse_cron_drain_timeout("") == DEFAULT_GATEWAY_CRON_DRAIN_TIMEOUT
        assert parse_cron_drain_timeout("   ") == DEFAULT_GATEWAY_CRON_DRAIN_TIMEOUT

    def test_zero_is_a_deliberate_opt_out_not_a_missing_value(self):
        assert parse_cron_drain_timeout(0) == 0.0
        assert parse_cron_drain_timeout("0") == 0.0

    def test_garbage_falls_back_and_negatives_clamp(self):
        assert parse_cron_drain_timeout("soon") == DEFAULT_GATEWAY_CRON_DRAIN_TIMEOUT
        assert parse_cron_drain_timeout(-5) == 0.0


class TestResolveCronDrainBudget:
    def test_extends_a_zero_drain_up_to_the_configured_floor(self):
        assert resolve_cron_drain_budget(
            0.0, 30.0, watchdog_delay=60.0, elapsed=1.0
        ) == 30.0

    def test_clamped_to_the_watchdog_leash_minus_cleanup_reserve(self):
        # Watchdog hard-exits at 60s; waiting 300s would guarantee a SIGKILL
        # mid-cleanup, leaving the job wedged at last_status=running.
        budget = resolve_cron_drain_budget(
            0.0, 300.0, watchdog_delay=60.0, elapsed=5.0
        )
        assert budget == pytest.approx(60.0 - 5.0 - CRON_DRAIN_CLEANUP_RESERVE_S)

    def test_never_shortens_an_explicitly_configured_drain_timeout(self):
        assert resolve_cron_drain_budget(
            120.0, 30.0, watchdog_delay=180.0, elapsed=0.0
        ) == 120.0

    def test_no_headroom_left_falls_back_to_the_drain_timeout(self):
        assert resolve_cron_drain_budget(
            0.0, 30.0, watchdog_delay=60.0, elapsed=59.0
        ) == 0.0

    def test_zero_floor_opts_out_entirely(self):
        assert resolve_cron_drain_budget(
            0.0, 0.0, watchdog_delay=60.0, elapsed=0.0
        ) == 0.0

    def test_non_numeric_inputs_degrade_instead_of_raising(self):
        assert resolve_cron_drain_budget(
            None, "30", watchdog_delay=60.0, elapsed=None
        ) == 30.0


class TestResolveSystemdTimeoutStopSec:
    """#94759: TimeoutStopSec must cover cron drain, not just chat drain."""


    def test_configured_drain_still_extends_the_deadline_directly(self):
        assert resolve_systemd_timeout_stop_sec(60.0, 30.0) == 90
        assert resolve_systemd_timeout_stop_sec(180.0, 30.0) == 210

    def test_larger_cron_floor_raises_timeout_stop_sec(self):
        # 60s cron + 10s reserve + 30s headroom = 100s
        assert resolve_systemd_timeout_stop_sec(0.0, 60.0) == 100

    def test_zero_cron_floor_is_an_opt_out_not_a_hidden_default(self):
        assert resolve_systemd_timeout_stop_sec(0.0, 0.0) == 60

    def test_cron_floor_never_shortens_a_long_drain(self):
        assert resolve_systemd_timeout_stop_sec(180.0, 30.0) == resolve_systemd_timeout_stop_sec(
            180.0, 0.0
        )

    def test_garbage_inputs_degrade_to_the_floor(self):
        assert resolve_systemd_timeout_stop_sec("soon", None) == 60
