#!/usr/bin/env python3
"""Pre-check for the "New email check" job: new inbox mail since the previous check.

Runs the google-workspace skill's ``gmail watch`` for this script's profile (the script lives in
``<home>/scripts``). Its stdout is the job's context; the last line is the scheduler's
``{"wakeAgent": ...}`` gate, so a check that finds nothing costs no model call.
"""

import os
import subprocess
import sys
from pathlib import Path

home = Path(__file__).resolve().parents[1]
api = home / "skills" / "productivity" / "google-workspace" / "scripts" / "google_api.py"
if not api.is_file():
    print("The google-workspace skill is not installed for this profile.", file=sys.stderr)
    sys.exit(1)
result = subprocess.run([sys.executable, str(api), "gmail", "watch"],
                        env={**os.environ, "SCOUT_HOME": str(home)}, check=False)
sys.exit(result.returncode)
