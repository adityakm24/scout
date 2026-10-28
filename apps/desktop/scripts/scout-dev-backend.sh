#!/usr/bin/env bash
# Dev backend for Scout.app + phone (127.0.0.1:9119). Keeps one session token on disk so
# restarts do not force re-pairing unless you delete dashboard-session.token.
set -euo pipefail

# When installed under ~/.scout-dev/bin, relative ROOT would be wrong — pin the checkout.
ROOT="${SCOUT_REPO:-/Users/adityakrishnanmohan/Documents/Projects/Scout}"
PY="${SCOUT_PYTHON:-$HOME/.scout/tools/python-3.14.7+20260901-darwin-arm64/bin/python3.14}"
VENV_SITE="${SCOUT_VENV_SITE:-$HOME/.scout/installs/0312d4c56cf1ed9b/environments/3555b23a915940128e86d00ab408d91c/venv/lib/python3.14/site-packages}"

export SCOUT_HOME="${SCOUT_HOME:-$HOME/.scout-dev}"
export SCOUT_WEB_DIST="${SCOUT_WEB_DIST:-$ROOT/apps/desktop/dist}"
export PYTHONPATH="${ROOT}:${VENV_SITE}${PYTHONPATH:+:$PYTHONPATH}"

TOKEN_FILE="$SCOUT_HOME/dashboard-session.token"
if [[ ! -s "$TOKEN_FILE" ]]; then
  TOKEN_FILE="$TOKEN_FILE" "$PY" -c 'import os, pathlib, secrets; p=pathlib.Path(os.environ["TOKEN_FILE"]); p.parent.mkdir(parents=True, exist_ok=True); p.write_text(secrets.token_urlsafe(32)); p.chmod(0o600)'
fi
export SCOUT_DASHBOARD_SESSION_TOKEN
SCOUT_DASHBOARD_SESSION_TOKEN="$(<"$TOKEN_FILE")"

exec "$PY" -m scout_backend.server_entry --host "${SCOUT_BACKEND_HOST:-127.0.0.1}" --port "${SCOUT_BACKEND_PORT:-9119}"
