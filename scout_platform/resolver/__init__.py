"""Resource resolution: where a tool or application is, and what state it is in."""

from scout_platform.resolver.base import Effort, Inspection, Probe, Probeable, Resolver
from scout_platform.resolver.core import (
    ABSENT,
    Candidate,
    CheckState,
    LookupContext,
    Observation,
    Resolution,
    locate_command,
)

__all__ = [
    "ABSENT", "Candidate", "CheckState", "Effort", "Inspection", "LookupContext",
    "Observation", "Probe", "Probeable", "Resolution", "Resolver", "locate_command",
]
