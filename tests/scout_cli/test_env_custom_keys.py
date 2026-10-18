"""GET /api/env surfaces arbitrary/custom .env keys (not just catalogued ones).

The dashboard Keys page previously rendered only keys present in a catalog
(``OPTIONAL_ENV_VARS`` or the provider catalog); any other key the user had set
in ``.env`` was invisible. This asserts the behavior contract that an
unrecognised on-disk key is surfaced as a ``custom`` row — set, redacted, and
password-masked — so the page can list and manage it, while a catalogued key is
NOT mislabelled custom.
"""

from fastapi.testclient import TestClient

from scout_cli.web_server import _SESSION_TOKEN, app

client = TestClient(app)
HEADERS = {"X-Scout-Session-Token": _SESSION_TOKEN}


