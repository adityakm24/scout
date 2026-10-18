"""Gateway-independent draining of restart-safe cron deliveries."""

from contextlib import contextmanager
from types import SimpleNamespace

import cron.scheduler as scheduler
from cron import scheduler_preflight as sched_preflight
import gateway.run as gateway_run


class _OneTickStopEvent:
    def __init__(self):
        self.waited = False

    def is_set(self):
        return self.waited

    def wait(self, timeout=None):
        self.waited = True
        return True


def test_gateway_housekeeping_drains_cron_delivery_with_live_adapters(monkeypatch):
    adapters = {"discord": object()}
    loop = object()
    calls = []
    monkeypatch.setattr(
        scheduler,
        "drain_delivery_queue",
        lambda live_adapters, live_loop: calls.append((live_adapters, live_loop)),
        raising=False,
    )

    gateway_run._start_gateway_housekeeping(
        _OneTickStopEvent(), adapters=adapters, loop=loop, interval=0
    )

    assert calls == [(adapters, loop)]


def test_gateway_housekeeping_drains_cron_delivery_without_connected_adapters(monkeypatch):
    adapters = {}
    loop = object()
    calls = []
    monkeypatch.setattr(
        scheduler,
        "drain_delivery_queue",
        lambda live_adapters, live_loop: calls.append((live_adapters, live_loop)),
        raising=False,
    )

    gateway_run._start_gateway_housekeeping(
        _OneTickStopEvent(), adapters=adapters, loop=loop, interval=0
    )

    assert calls == [(adapters, loop)]








def test_a_queued_worker_delivery_is_drained_before_the_next_housekeeping_tick(tmp_path, monkeypatch):
    """Regression for #117307: the worker's send waited for the 60 s tick. With the queue
    file watched between ticks it is drained within seconds of the enqueue."""
    import threading
    import time

    from cron import delivery_queue

    monkeypatch.setattr(delivery_queue, "DELIVERY_DB", tmp_path / "deliveries.db")
    drained = threading.Event()
    drains = []

    def record_drain(live_adapters, live_loop):
        drains.append(time.monotonic())
        drained.set()

    monkeypatch.setattr(scheduler, "drain_delivery_queue", record_drain)
    stop = threading.Event()
    thread = threading.Thread(
        target=gateway_run._start_gateway_housekeeping,
        args=(stop,), kwargs={"adapters": {"slack": object()}, "loop": object(), "interval": 60},
        daemon=True)
    thread.start()
    try:
        assert drained.wait(5.0), "the tick's own drain did not run"
        drained.clear()
        queued_at = time.monotonic()
        delivery_queue.enqueue("exec-117307", {"id": "job", "name": "reminder"}, "hello")
        assert drained.wait(5.0), "the queued delivery waited for the next tick"
        assert drains[-1] - queued_at < 5.0
    finally:
        stop.set()
        thread.join(timeout=5.0)
    assert not thread.is_alive()


def test_the_watch_settles_after_the_drain_wrote_its_outcome(tmp_path, monkeypatch):
    """The drain's own status write wakes exactly one more (empty) pass; a stable queue
    never wakes it again, so the housekeeping thread does not spin on its own writes."""
    from cron import delivery_queue
    from gateway.run_delivery_queue_watch import DeliveryQueueWatch

    monkeypatch.setattr(delivery_queue, "DELIVERY_DB", tmp_path / "deliveries.db")
    passes = []
    watch = DeliveryQueueWatch(
        lambda: [None],
        lambda: passes.append(delivery_queue.drain(lambda job, content, for_failure: None)))
    assert watch.changed() is False, "no queue file, nothing to wake on"

    delivery_queue.enqueue("exec-1", {"id": "job"}, "hello")
    assert watch.changed() is True
    watch.drain()
    assert passes == [1]
    status = delivery_queue.get_status("exec-1")
    assert status is not None and status["status"] == "delivered"

    assert watch.changed() is True, "the delivered status was written to the queue"
    watch.drain()
    assert passes == [1, 0]
    assert watch.changed() is False, "an empty pass writes nothing"
    assert watch.changed() is False

    # Hosts whose SQLite runs the queue in WAL mode write to the -wal file first.
    (tmp_path / "deliveries.db-wal").write_bytes(b"frame")
    assert watch.changed() is True
