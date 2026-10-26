"""Advanced end-to-end telemetry and trace logger for Scout Agent.

Writes structured JSON-Lines to ``<scout_home>/logs/trace.jsonl`` AND emits readable
structured INFO lines to ``agent.log`` via the ``scout.trace`` logger so every user
interaction, device/client context, agent turn, LLM API request/response, tool call
(arguments, results, duration, errors), and server→client device request (GPS location,
clarify, approval) is recorded with high-precision timestamps.
"""

from __future__ import annotations

import datetime
import json
import logging
import os
import platform
import threading
import time
from pathlib import Path
from typing import Any, Dict, Optional

from scout_constants import get_scout_home

logger = logging.getLogger("scout.trace")

_write_lock = threading.Lock()
_MAX_TRACE_BYTES = 25 * 1024 * 1024  # 25 MB per trace.jsonl before rotating to trace.jsonl.1


def _iso_now() -> str:
    return datetime.datetime.now().astimezone().isoformat(timespec="milliseconds")


def _host_device_summary() -> Dict[str, Any]:
    return {
        "hostname": platform.node(),
        "os": platform.system(),
        "os_release": platform.release(),
        "machine": platform.machine(),
        "pid": os.getpid(),
    }


def _safe_json_value(val: Any, max_str: int = 8000) -> Any:
    """Recursively convert values into JSON-safe structures with bounded string lengths."""
    if val is None or isinstance(val, (bool, int, float)):
        return val
    if isinstance(val, str):
        if len(val) > max_str:
            return val[:max_str] + f"... [truncated {len(val) - max_str} chars]"
        return val
    if isinstance(val, dict):
        out = {}
        for k, v in list(val.items())[:100]:
            key_str = str(k)
            if any(sec in key_str.lower() for sec in ("api_key", "secret", "password", "authorization", "token")):
                if isinstance(v, str) and len(v) > 8:
                    out[key_str] = v[:4] + "***" + v[-4:]
                else:
                    out[key_str] = "***"
            else:
                out[key_str] = _safe_json_value(v, max_str=max_str)
        return out
    if isinstance(val, (list, tuple, set)):
        seq = list(val)
        return [_safe_json_value(x, max_str=max_str) for x in seq[:100]]
    try:
        text = str(val)
        return text[:max_str] + f"... [truncated {len(text) - max_str} chars]" if len(text) > max_str else text
    except Exception:
        return "<unrepresentable>"


def _trace_file_path() -> Path:
    log_dir = get_scout_home() / "logs"
    log_dir.mkdir(parents=True, exist_ok=True)
    return log_dir / "trace.jsonl"


def emit_trace(
    event_type: str,
    *,
    session_id: Optional[str] = None,
    ui_session_id: Optional[str] = None,
    turn_id: Optional[str] = None,
    device_info: Optional[Dict[str, Any]] = None,
    summary: Optional[str] = None,
    **payload: Any,
) -> None:
    """Write a structured trace event to ``~/.scout/logs/trace.jsonl`` and ``agent.log``."""
    try:
        now_ts = time.time()
        iso_ts = _iso_now()
        record: Dict[str, Any] = {
            "timestamp": iso_ts,
            "epoch_ms": int(now_ts * 1000),
            "event": event_type,
            "thread": threading.current_thread().name,
        }
        if session_id:
            record["session_id"] = str(session_id)
        if ui_session_id:
            record["ui_session_id"] = str(ui_session_id)
        if turn_id:
            record["turn_id"] = str(turn_id)
        if device_info:
            record["device_info"] = _safe_json_value(device_info, max_str=2000)
        record["host"] = _host_device_summary()
        if payload:
            record["data"] = _safe_json_value(payload)

        line = json.dumps(record, ensure_ascii=False, default=str)
        path = _trace_file_path()
        with _write_lock:
            if path.exists():
                try:
                    if path.stat().st_size >= _MAX_TRACE_BYTES:
                        backup = path.with_suffix(".jsonl.1")
                        path.replace(backup)
                except OSError:
                    pass
            with path.open("a", encoding="utf-8") as f:
                f.write(line + "\n")

        # Also log a concise, greppable line to agent.log
        log_msg = f"[TRACE:{event_type}]"
        if session_id:
            log_msg += f" session={session_id}"
        if ui_session_id:
            log_msg += f" ui_sid={ui_session_id}"
        if turn_id:
            log_msg += f" turn={turn_id}"
        if summary:
            log_msg += f" | {summary}"
        elif payload:
            compact = json.dumps(_safe_json_value(payload, max_str=600), ensure_ascii=False, default=str)
            log_msg += f" | {compact}"
        logger.info(log_msg)
    except Exception:
        pass
