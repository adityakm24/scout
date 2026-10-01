"""``scout google`` — the google-workspace skill's scripts behind a short, path-free command.

The skill used to have the agent assemble ``python $SCOUT_HOME/skills/.../google_api.py``; smaller
models rewrote that path (a long or unusual SCOUT_HOME made it worse) and reported the skill as not
installed. ``scout google gmail search "from:dbs"`` resolves the script itself: the profile's
installed copy first, then the bundled one.
"""

from __future__ import annotations

import argparse
import subprocess
import sys
from pathlib import Path
from typing import Optional

_SKILL = Path("productivity") / "google-workspace" / "scripts"


def _script(name: str) -> Optional[Path]:
    from scout_constants import get_bundled_skills_dir, get_scout_home
    bundled = get_bundled_skills_dir(Path(__file__).resolve().parents[2] / "skills")
    for root in (get_scout_home() / "skills", bundled):
        path = root / _SKILL / name
        if path.is_file():
            return path
    return None


def cmd_google(args: argparse.Namespace) -> None:
    rest = list(args.rest)
    # `setup …` reaches the OAuth helper; `status` is its quick check. Everything else is the API CLI.
    if rest[:1] == ["status"]:
        name, rest = "setup.py", ["--check"]
    elif rest[:1] == ["setup"]:
        name, rest = "setup.py", rest[1:]
    else:
        name = "google_api.py"
    script = _script(name)
    if script is None:
        print("The google-workspace skill is not installed for this profile. Run `scout skills reset google-workspace`.",
              file=sys.stderr)
        sys.exit(1)
    sys.exit(subprocess.run([sys.executable, str(script), *rest], check=False).returncode)


def build_google_parser(subparsers) -> None:
    """Attach the ``google`` subcommand to ``subparsers``."""
    parser = subparsers.add_parser(
        "google", help="Gmail, Calendar, Drive, Docs, Sheets and Contacts for the connected Google account",
        description="Run the google-workspace skill's commands. Examples: "
            "`scout google gmail search \"from:dbs\" --max 5`, `scout google gmail get MESSAGE_ID`, "
            "`scout google calendar list`, `scout google status`. "
            "`scout google gmail --help` lists a service's actions.")
    parser.add_argument("rest", nargs=argparse.REMAINDER, metavar="SERVICE ACTION ...")
    parser.set_defaults(func=cmd_google)
