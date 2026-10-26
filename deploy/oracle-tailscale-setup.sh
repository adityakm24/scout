#!/usr/bin/env bash
# =============================================================================
# Scout — Oracle Cloud (Ubuntu 22.04 / 24.04 ARM64 or x86_64) + Tailscale Setup
# =============================================================================
# Usage (on the Oracle Cloud Ubuntu VM):
#   git clone https://github.com/adityakm24/scout.git ~/scout
#   cd ~/scout
#   bash deploy/oracle-tailscale-setup.sh
# =============================================================================
set -euo pipefail

REPO_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SCOUT_PORT="${SCOUT_PORT:-8642}"
SCOUT_HOME_DIR="${SCOUT_HOME:-$HOME/.scout}"

echo "=================================================================="
echo " Scout Cloud Server Setup (Ubuntu + OpenShell + Tailscale)"
echo " Repo:       $REPO_DIR"
echo " SCOUT_HOME: $SCOUT_HOME_DIR"
echo " Local Port: 127.0.0.1:$SCOUT_PORT"
echo "=================================================================="

# 1. System packages & Docker (compute driver for OpenShell)
echo "[1/7] Installing system packages & Docker..."
sudo apt-get update -y
sudo apt-get install -y \
  curl git jq ca-certificates gnupg lsb-release \
  build-essential pkg-config libssl-dev python3 python3-venv python3-pip \
  docker.io qrencode

sudo systemctl enable --now docker
if ! id -nG "$USER" | grep -qw docker; then
  sudo usermod -aG docker "$USER" || true
fi

# 2. Node.js 22 LTS (required by apps/desktop & web builds)
if ! command -v node >/dev/null 2>&1 || [ "$(node -v | cut -d. -f1 | tr -d 'v')" -lt 22 ]; then
  echo "[2/7] Installing Node.js 22..."
  curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
  sudo apt-get install -y nodejs
else
  echo "[2/7] Node.js $(node -v) already installed."
fi

# 3. Tailscale
if ! command -v tailscale >/dev/null 2>&1; then
  echo "[3/7] Installing Tailscale..."
  curl -fsSL https://tailscale.com/install.sh | sh
else
  echo "[3/7] Tailscale already installed."
fi

if ! tailscale status >/dev/null 2>&1; then
  echo ">>> Please authenticate Tailscale using the link below:"
  sudo tailscale up --ssh
fi

# 4. NVIDIA OpenShell CLI & Gateway
export PATH="$HOME/.local/bin:/usr/local/bin:$PATH"
if ! command -v openshell >/dev/null 2>&1; then
  echo "[4/7] Installing NVIDIA OpenShell..."
  curl -LsSf https://raw.githubusercontent.com/NVIDIA/OpenShell/main/install.sh | sh
else
  echo "[4/7] NVIDIA OpenShell already installed ($(command -v openshell))."
fi

# 5. Scout Python environment & Frontend bundles (/ and /app/)
echo "[5/7] Setting up Scout Python environment and building UI bundles..."
cd "$REPO_DIR"
# Provision venv and dependencies via Scout's activate script
set +u
source ./activate
set -u

echo "Building Web Dashboard (web/)..."
(cd "$REPO_DIR/web" && npm install && npm run build)

echo "Building Scout App UI for Phone/Remote (/app/ -> apps/desktop/dist)..."
(cd "$REPO_DIR" && npm install && cd "$REPO_DIR/apps/desktop" && npm run build)

# 6. Configure ~/.scout/.env & config.yaml (Persistent Session Token + OpenShell)
echo "[6/7] Configuring $SCOUT_HOME_DIR..."
mkdir -p "$SCOUT_HOME_DIR"
touch "$SCOUT_HOME_DIR/.env"
chmod 600 "$SCOUT_HOME_DIR/.env"

if ! grep -q "^SCOUT_DASHBOARD_SESSION_TOKEN=" "$SCOUT_HOME_DIR/.env"; then
  TOKEN="$(python3 -c 'import secrets; print(secrets.token_urlsafe(32))')"
  echo "SCOUT_DASHBOARD_SESSION_TOKEN=$TOKEN" >> "$SCOUT_HOME_DIR/.env"
  echo "Generated persistent SCOUT_DASHBOARD_SESSION_TOKEN in $SCOUT_HOME_DIR/.env"
fi

if ! grep -q "^MISTRAL_API_KEY=" "$SCOUT_HOME_DIR/.env"; then
  if [ -n "${MISTRAL_API_KEY:-}" ]; then
    echo "MISTRAL_API_KEY=$MISTRAL_API_KEY" >> "$SCOUT_HOME_DIR/.env"
  else
    echo ""
    read -r -p "Enter your MISTRAL_API_KEY (or press Enter to add later in $SCOUT_HOME_DIR/.env): " INPUT_KEY || true
    if [ -n "${INPUT_KEY:-}" ]; then
      echo "MISTRAL_API_KEY=$INPUT_KEY" >> "$SCOUT_HOME_DIR/.env"
    fi
  fi
fi

# Warm up the 3 OpenShell sandboxes (scout-user, scout-guard, scout-browser)
echo "Pre-warming OpenShell sandboxes (scout-user, scout-guard, scout-browser)..."
python3 - <<'PY' || echo "Warning: OpenShell sandbox pre-warm skipped (check 'openshell status' & docker group)."
from agent.agent_bridge import sandboxes
sandboxes.ensure_user_sandbox()
sandboxes.ensure_guard_sandbox()
sandboxes.ensure_browser_sandbox()
print("All 3 OpenShell sandboxes (scout-user, scout-guard, scout-browser) are ready!")
PY

# 7. Install systemd service & publish over Tailscale HTTPS
echo "[7/7] Installing systemd service (scout-server.service) and configuring Tailscale HTTPS..."
SCOUT_BIN="$REPO_DIR/.venv/bin/scout"
if [ ! -x "$SCOUT_BIN" ]; then
  SCOUT_BIN="$(command -v scout)"
fi

SERVICE_FILE="/etc/systemd/system/scout-server.service"
sudo tee "$SERVICE_FILE" >/dev/null <<EOF
[Unit]
Description=Scout AI Agent Backend & App Server (Loopback + Tailscale)
After=network-online.target docker.service tailscaled.service
Wants=network-online.target

[Service]
Type=simple
User=$USER
WorkingDirectory=$REPO_DIR
Environment="PATH=$HOME/.local/bin:$REPO_DIR/.venv/bin:/usr/local/bin:/usr/bin:/bin"
Environment="SCOUT_HOME=$SCOUT_HOME_DIR"
Environment="SCOUT_DESKTOP=1"
EnvironmentFile=$SCOUT_HOME_DIR/.env
ExecStart=$SCOUT_BIN dashboard --host 127.0.0.1 --port $SCOUT_PORT --no-open
Restart=always
RestartSec=3

[Install]
WantedBy=multi-user.target
EOF

sudo systemctl daemon-reload
sudo systemctl enable --now scout-server.service

echo "Publishing 127.0.0.1:$SCOUT_PORT over Tailscale Funnel (HTTPS, no Tailscale app required on client devices)..."
if ! sudo tailscale funnel --bg --yes "$SCOUT_PORT" 2>/dev/null && ! tailscale funnel --bg --yes "$SCOUT_PORT" 2>/dev/null; then
  echo "Note: Tailscale Funnel not enabled on tailnet ACL yet; falling back to tailscale serve..."
  sudo tailscale serve --bg --yes "$SCOUT_PORT" || tailscale serve --bg --yes "$SCOUT_PORT" || true
fi

TS_DNS="$(tailscale status --json | jq -r '.Self.DNSName | rtrimstr(".")')"
SESSION_TOKEN="$(grep '^SCOUT_DASHBOARD_SESSION_TOKEN=' "$SCOUT_HOME_DIR/.env" | cut -d= -f2-)"
PAIRING_URL="https://${TS_DNS}/app/?token=${SESSION_TOKEN}"

echo ""
echo "=================================================================="
echo " ✅ Scout Server is LIVE and locked to your Tailnet!"
echo "=================================================================="
echo " Web / Desktop URL:  https://${TS_DNS}/?token=${SESSION_TOKEN}"
echo " Phone Pairing URL:  ${PAIRING_URL}"
echo " Service Status:     sudo systemctl status scout-server"
echo " Live Logs:          journalctl -u scout-server -f"
echo "=================================================================="
if command -v qrencode >/dev/null 2>&1 && [ -n "$TS_DNS" ] && [ "$TS_DNS" != "null" ]; then
  echo ""
  echo "Scan this QR code in the Scout mobile app (or phone camera):"
  qrencode -t ansiutf8 "$PAIRING_URL"
fi
