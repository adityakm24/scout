"""Map commit authors to GitHub logins for release notes."""
from __future__ import annotations

import re


def resolve_author(name: str, email: str) -> str:
    """A git author as a GitHub @mention when the email is GitHub's noreply form, else the git name."""
    noreply = re.match(r"(?:\d+\+)?(.+)@users\.noreply\.github\.com", email)
    return f"@{noreply.group(1)}" if noreply else name
