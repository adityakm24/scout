"""Plugin data paths follow the active profile's SCOUT_HOME, including the ContextVar override.

Several plugins carried a ``~/.scout`` fallback (guarding an ImportError of ``scout_constants``
that cannot happen for a bundled plugin) or resolved the home at import time. Both are wrong on
Windows and under multiplex profile overrides. Every resolver below must land inside the override.
"""
from __future__ import annotations


def _a2a_conversation(home):
    from plugins.platforms.a2a import protocol
    return protocol._conv_path("peer-x")


