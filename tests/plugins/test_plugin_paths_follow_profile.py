"""Plugin data paths follow the active profile's SCOUT_HOME, including the ContextVar override.

Several plugins carried a ``~/.scout`` fallback (guarding an ImportError of ``scout_constants``
that cannot happen for a bundled plugin) or resolved the home at import time. Both are wrong on
Windows and under multiplex profile overrides. Every resolver below must land inside the override.
"""
from __future__ import annotations




def _a2a_conversation(home):
    from plugins.platforms.a2a import protocol
    return protocol._conv_path("peer-x")


def _mem0_qdrant(home):
    from plugins.memory.mem0._oss_providers import vector_default_config
    return vector_default_config("qdrant")["path"]


def _openviking_log(home):
    import plugins.memory.openviking as ov
    return ov.get_scout_home() / ov._OPENVIKING_SERVER_LOG_RELATIVE_PATH


