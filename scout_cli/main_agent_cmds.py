"""Agent-facing subcommand handlers: memory, acp, tools, insights, monitoring, skills (+trust).

Split out of ``scout_cli/main.py``. Names that still live in main (``PROJECT_ROOT``, ...)
are imported lazily inside the functions that use them (avoids an import cycle).
"""

from pm import install_hint
import sys


def _cmd_memory_status():
    from scout_cli.config import load_config
    from scout_constants import display_scout_home, get_scout_home
    mem = load_config().get("memory")
    mem = mem if isinstance(mem, dict) else {}
    print("\n  Memory: built-in")
    for key, label in (("memory_enabled", "Agent notes (MEMORY.md)"), ("user_profile_enabled", "User profile (USER.md)")):
        print(f"  {label}: {'on' if mem.get(key, True) else 'off'}")
    print(f"  Files: {display_scout_home()}/memories/")
    for name in ("MEMORY.md", "USER.md"):
        path = get_scout_home() / "memories" / name
        print(f"    {name}: {path.stat().st_size if path.exists() else 0} bytes")
    print()


def _cmd_memory_reset(args):
    from scout_constants import get_scout_home, display_scout_home
    mem_dir = get_scout_home() / "memories"
    target = getattr(args, "target", "all")
    files_to_reset = []
    if target in {"all", "memory"}:
        files_to_reset.append(("MEMORY.md", "agent notes"))
    if target in {"all", "user"}:
        files_to_reset.append(("USER.md", "user profile"))

    existing = [(f, desc) for f, desc in files_to_reset if (mem_dir / f).exists()]
    if not existing:
        print(f"\n  Nothing to reset — no memory files found in {display_scout_home()}/memories/\n")
        return

    print("\n  This will permanently erase the following memory files:")
    for f, desc in existing:
        size = (mem_dir / f).stat().st_size
        print(f"    ◆ {f} ({desc}) — {size:,} bytes")

    if not getattr(args, "yes", False):
        try:
            answer = input("\n  Type 'yes' to confirm: ").strip().lower()
        except (EOFError, KeyboardInterrupt):
            print("\n  Cancelled.\n")
            return
        if answer != "yes":
            print("  Cancelled.\n")
            return

    for f, desc in existing:
        (mem_dir / f).unlink()
        print(f"  ✓ Deleted {f} ({desc})")

    print("\n  Memory reset complete. New sessions will start with a blank slate.")
    print(f"  Files were in: {display_scout_home()}/memories/\n")


def cmd_memory(args):
    if getattr(args, "memory_command", None) == "reset":
        _cmd_memory_reset(args)
    else:
        _cmd_memory_status()


# (args attribute, acp flag) — forwarded in this order.
_ACP_FLAGS = (
    ("acp_version", "--version"),
    ("check", "--check"),
    ("setup", "--setup"),
    ("setup_browser", "--setup-browser"),
    ("assume_yes", "--yes"))




def cmd_tools(args):
    from scout_cli.main import _require_tty
    action = getattr(args, "tools_action", None)
    if action in {"list", "disable", "enable"}:
        from scout_cli.tools_config import tools_disable_enable_command
        tools_disable_enable_command(args)
    elif action == "post-setup":
        from scout_cli.tools_config import run_post_setup_command
        sys.exit(run_post_setup_command(args))
    else:
        _require_tty("tools")
        from scout_cli.tools_config import tools_command
        tools_command(args)




def _dict_or_empty(value) -> dict:
    return value if isinstance(value, dict) else {}




def cmd_skills(args):
    from scout_cli.main import _require_tty
    action = getattr(args, "skills_action", None)
    if action == "config":
        _require_tty("skills config")
        from scout_cli.skills_config import skills_command as skills_config_command
        skills_config_command(args)
    elif action in ("trust", "untrust"):
        _cmd_skills_trust(args)
    else:
        from scout_cli.skills_hub import skills_command
        skills_command(args)


def _cmd_skills_trust(args):
    """``scout skills trust|untrust [path]`` — manage ``skills.trusted_project_dirs``.

    With no path, operates on the project root enclosing the current directory
    (nearest ancestor with ``.git``).
    """
    from pathlib import Path
    from agent.skill_utils import (
        PROJECT_SKILLS_SUBDIRS,
        _candidate_project_skills_dirs,
        find_project_root,
        iter_skill_index_files)
    from scout_cli.config import load_config, save_config
    action = args.skills_action
    raw_path = getattr(args, "path", None)
    if raw_path:
        root = Path(raw_path).expanduser().resolve()
        if not root.is_dir():
            print(f"Not a directory: {root}")
            return
    else:
        root = find_project_root()
        if root is None:
            print(
                "Not inside a git checkout. Run from a project directory or "
                "pass the project root path explicitly.")
            return

    config = load_config()
    skills_cfg = config.setdefault("skills", {})
    trusted = skills_cfg.get("trusted_project_dirs") or []
    if not isinstance(trusted, list):
        trusted = [trusted]
    trusted = [str(t) for t in trusted]
    root_str = str(root)

    def _same(t: str) -> bool:
        return str(Path(t).expanduser().resolve()) == root_str

    if action == "untrust":
        kept = [t for t in trusted if not _same(t)]
        if len(kept) == len(trusted):
            print(f"{root} was not trusted.")
            return
        skills_cfg["trusted_project_dirs"] = kept
        save_config(config)
        print(f"Untrusted: {root}")
        print("Project skills from this repo will no longer load.")
        return

    if any(_same(t) for t in trusted):
        print(f"Already trusted: {root}")
    else:
        trusted.append(root_str)
        skills_cfg["trusted_project_dirs"] = trusted
        save_config(config)
        print(f"Trusted: {root}")

    # Show what this unlocks
    count = sum(
        sum(1 for _ in iter_skill_index_files(d, "SKILL.md"))
        for d in _candidate_project_skills_dirs(root))
    if count:
        print(
            f"{count} project skill(s) will load in sessions started inside "
            "this repo (they take precedence over same-named profile skills).")
    else:
        subdirs = " or ".join(PROJECT_SKILLS_SUBDIRS)
        print(f"No project skills found yet — add them under {subdirs}.")
