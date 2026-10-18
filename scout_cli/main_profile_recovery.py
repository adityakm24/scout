"""Which commands may run in the default home when the sticky ``active_profile`` is gone.

``_apply_profile_override`` fails closed when ``active_profile`` names a deleted profile:
running an ordinary command in the default profile would read or write the wrong profile's
state. The commands here are the way out of that state, so they must still reach their handler.
"""

from __future__ import annotations





def is_stale_profile_recovery_command(argv: list[str]) -> bool:
    """``profile list`` or ``profile use default``."""
    from scout_cli._parser import command_argv

    command = command_argv(argv)
    if command[:2] == ["profile", "list"]:
        return True
    if command[:2] == ["profile", "use"]:
        return len(command) > 2 and command[2].casefold() == "default"
    return False
