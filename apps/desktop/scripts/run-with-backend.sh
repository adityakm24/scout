#!/usr/bin/env bash
# Start the hosted backend (127.0.0.1:9119) and Scout.app together for local dev.
# The packaged desktop app does not spawn the backend — this script keeps both up.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../../.." && pwd)"
cd "$ROOT"
# shellcheck disable=SC1091
source ./activate

export SCOUT_HOME="${SCOUT_HOME:-$HOME/.scout-dev}"
export SCOUT_WEB_DIST="${SCOUT_WEB_DIST:-$ROOT/apps/desktop/dist}"

if [[ ! -d "$SCOUT_WEB_DIST" ]]; then
  echo "Missing renderer build at SCOUT_WEB_DIST=$SCOUT_WEB_DIST — run: cd apps/desktop && npm run build" >&2
  exit 1
fi

PORT="${SCOUT_BACKEND_PORT:-9119}"
HOST="${SCOUT_BACKEND_HOST:-127.0.0.1}"
LOG="${SCOUT_BACKEND_LOG:-/tmp/scout-${PORT}.log}"

BACKEND_SCRIPT="$ROOT/apps/desktop/scripts/scout-dev-backend.sh"
if lsof -nP -iTCP:"$PORT" -sTCP:LISTEN >/dev/null 2>&1; then
  echo "Backend already listening on ${HOST}:${PORT}"
elif launchctl print "gui/$(id -u)/com.adityakm24.scout-dev-backend" >/dev/null 2>&1; then
  echo "Starting LaunchAgent com.adityakm24.scout-dev-backend"
  launchctl kickstart -k "gui/$(id -u)/com.adityakm24.scout-dev-backend"
else
  echo "Starting backend (SCOUT_HOME=$SCOUT_HOME) → ${LOG}"
  nohup "$BACKEND_SCRIPT" >>"$LOG" 2>&1 &
  backend_pid=$!
  for _ in $(seq 1 50); do
    if curl -sf -o /dev/null "http://${HOST}:${PORT}/api/status"; then
      echo "Backend ready (pid $backend_pid)"
      break
    fi
    if ! kill -0 "$backend_pid" 2>/dev/null; then
      echo "Backend exited; see $LOG" >&2
      tail -20 "$LOG" >&2 || true
      exit 1
    fi
    sleep 0.2
  done
fi

APP="${SCOUT_APP:-$ROOT/apps/desktop/release/mac-arm64/Scout.app}"
if [[ -d "$APP" ]]; then
  open -a "$APP"
else
  echo "Scout.app not found at $APP — run: cd apps/desktop && npm run pack" >&2
  echo "Backend is up at http://${HOST}:${PORT}" >&2
  exit 1
fi
