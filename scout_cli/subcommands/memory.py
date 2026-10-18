"""``scout memory`` subcommand parser."""

from __future__ import annotations

from typing import Callable

from scout_cli.subcommands._shared import add_yes_flag


def build_memory_parser(subparsers, *, cmd_memory: Callable) -> None:
    """Attach the ``memory`` subcommand to ``subparsers``."""
    memory_parser = subparsers.add_parser(
        "memory", help="Show or reset built-in memory",
        description="Scout keeps memory in MEMORY.md (agent notes) and USER.md (user profile).")
    memory_sub = memory_parser.add_subparsers(dest="memory_command")
    memory_sub.add_parser("status", help="Show built-in memory settings and file sizes")
    _reset_parser = memory_sub.add_parser(
        "reset", help="Erase all built-in memory (MEMORY.md and USER.md)")
    add_yes_flag(_reset_parser)
    _reset_parser.add_argument(
        "--target", choices=["all", "memory", "user"], default="all",
        help="Which store to reset: 'all' (default), 'memory', or 'user'")
    memory_parser.set_defaults(func=cmd_memory)
