"""Driver-agnostic out-of-band notice carried by ``AIAgent.notice_callback`` / ``notice_clear_callback``."""

from dataclasses import dataclass
from typing import Optional


@dataclass
class AgentNotice:
    """Each driver (CLI, gateway, TUI/desktop) renders a notice its own way; ``key`` dedupes and clears it."""

    text: str
    level: str = "info"            # info | warn | error | success
    kind: str = "sticky"           # sticky | ttl
    ttl_ms: Optional[int] = None   # honored only when kind == "ttl"
    key: Optional[str] = None      # dedupe / fired-once-latch / clear key
    id: Optional[str] = None
