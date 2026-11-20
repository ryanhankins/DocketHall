#!/usr/bin/env bash
# Copyright 2026 Ryan Hankins
#
# This program is free software: you can redistribute it and/or modify
# it under the terms of the GNU Affero General Public License as
# published by the Free Software Foundation, either version 3 of the
# License, or (at your option) any later version.
#
# This program is distributed in the hope that it will be useful,
# but WITHOUT ANY WARRANTY; without even the implied warranty of
# MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
# GNU Affero General Public License for more details.
#
# You should have received a copy of the GNU Affero General Public License
# along with this program.  If not, see <https://www.gnu.org/licenses/>.

# Turnkey Ubuntu/Debian VPS installer for CivicDesk (Lightsail, DigitalOcean,
# Hetzner, Linode, Google Compute Engine).
#
# Example:
#   DOMAIN=portal.cityofbirchwood.com \
#   curl -fsSL https://raw.githubusercontent.com/ryanhankins/CivicDesk/main/scripts/install-vps.sh | sudo -E bash
#
# Optional env:
#   DOMAIN                 Public domain for automatic Caddy HTTPS (recommended)
#   INSTALL_DIR            Install path (default: /opt/civicdesk)
#   REPO_URL               Git repo URL (default: https://github.com/ryanhankins/CivicDesk.git)
#   CIVICDESK_REGISTRY     Container registry prefix (default: ghcr.io/ryanhankins/)
#   CIVICDESK_PULL_ONLY    Pull prebuilt images without Node/Docker build (default: true)
#   STORAGE_BACKEND        local (default on VPS) or minio
#   MINIO_REPLICAS         0 (default when STORAGE_BACKEND=local) or 1
#   MULTI_TENANT           false (default) or true
#   TENANT_BASE_DOMAIN     Wildcard base domain when MULTI_TENANT=true (e.g. civicdesk.org)
#   RESTIC_REPOSITORY      Optional restic repo for nightly incremental off-site backups
#   RESTIC_PASSWORD        Password for restic repository (stored in /etc/civicdesk/backup.env)
set -euo pipefail

if [ "$(id -u)" -ne 0 ]; then
  echo "Please run as root (e.g. sudo -E $0)" >&2
  exit 1
fi

DOMAIN="${DOMAIN:-}"
INSTALL_DIR="${INSTALL_DIR:-/opt/civicdesk}"
REPO_URL="${REPO_URL:-https://github.com/ryanhankins/CivicDesk.git}"
export CIVICDESK_REGISTRY="${CIVICDESK_REGISTRY:-ghcr.io/ryanhankins/}"
export CIVICDESK_PULL_ONLY="${CIVICDESK_PULL_ONLY:-true}"
export STORAGE_BACKEND="${STORAGE_BACKEND:-local}"
if [ -z "${MINIO_REPLICAS+x}" ]; then
  if [ "$STORAGE_BACKEND" = "local" ]; then MINIO_REPLICAS=0; else MINIO_REPLICAS=1; fi
fi
export MINIO_REPLICAS
export CIVICDESK_PORT="${CIVICDESK_PORT:-8080}"

echo "==> Installing system packages (Docker, Caddy, restic, git)"
export DEBIAN_FRONTEND=noninteractive
apt-get update -qq
apt-get install -y -qq ca-certificates curl git gnupg restic >/dev/null

if ! command -v docker >/dev/null 2>&1; then
  curl -fsSL https://get.docker.com | sh
fi
systemctl enable --now docker

if ! command -v caddy >/dev/null 2>&1; then
  apt-get install -y -qq debian-keyring debian-archive-keyring apt-transport-https >/dev/null
  curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/gpg.key' | gpg --dearmor -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
  curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt' > /etc/apt/sources.list.d/caddy-stable.list
  apt-get update -qq
  apt-get install -y -qq caddy >/dev/null
fi

if command -v ufw >/dev/null 2>&1; then
  ufw allow 22/tcp >/dev/null 2>&1 || true
  ufw allow 80/tcp >/dev/null 2>&1 || true
  ufw allow 443/tcp >/dev/null 2>&1 || true
fi

echo "==> Syncing CivicDesk repository to ${INSTALL_DIR}"
if [ -d "${INSTALL_DIR}/.git" ]; then
  git -C "$INSTALL_DIR" pull --ff-only
else
  git clone --depth 1 "$REPO_URL" "$INSTALL_DIR"
fi

if [ -n "$DOMAIN" ]; then
  export COOKIE_SECURE="${COOKIE_SECURE:-true}"
  export APP_BASE_URL="${APP_BASE_URL:-https://${DOMAIN}}"
  echo "==> Configuring Caddy HTTPS for ${DOMAIN}"
  cat >/etc/caddy/Caddyfile <<EOF
${DOMAIN} {
    reverse_proxy 127.0.0.1:${CIVICDESK_PORT}
}
EOF
  systemctl enable --now caddy
  systemctl reload caddy
else
  export COOKIE_SECURE="${COOKIE_SECURE:-false}"
  echo "==> Configuring Caddy HTTP reverse proxy on :80"
  cat >/etc/caddy/Caddyfile <<EOF
:80 {
    reverse_proxy 127.0.0.1:${CIVICDESK_PORT}
}
EOF
  systemctl enable --now caddy
  systemctl reload caddy
fi

echo "==> Setting up host-assisted in-app updater"
UPGRADE_DIR="/var/lib/civicdesk-upgrade"
mkdir -p "$UPGRADE_DIR"
chown 10001:10001 "$UPGRADE_DIR"
chmod 755 "$UPGRADE_DIR"
touch "${UPGRADE_DIR}/.host-watcher-enabled"
export CIVICDESK_UPGRADE_SOURCE="$UPGRADE_DIR"

mkdir -p /etc/civicdesk /var/log/civicdesk
cat >/etc/civicdesk/upgrade.env <<EOF
DOMAIN=${DOMAIN:-}
STORAGE_BACKEND=${STORAGE_BACKEND:-local}
MINIO_REPLICAS=${MINIO_REPLICAS:-0}
SEED_CITY_PROFILE=${SEED_CITY_PROFILE:-}
MULTI_TENANT=${MULTI_TENANT:-false}
TENANT_BASE_DOMAIN=${TENANT_BASE_DOMAIN:-}
CIVICDESK_PULL_ONLY=${CIVICDESK_PULL_ONLY:-true}
CIVICDESK_REGISTRY=${CIVICDESK_REGISTRY:-ghcr.io/ryanhankins/}
CIVICDESK_TAG=${CIVICDESK_TAG:-latest}
CIVICDESK_UPGRADE_SOURCE=${UPGRADE_DIR}
COOKIE_SECURE=${COOKIE_SECURE:-false}
APP_BASE_URL=${APP_BASE_URL:-}
EOF
chmod 600 /etc/civicdesk/upgrade.env

echo "==> Deploying CivicDesk stack"
cd "$INSTALL_DIR"
chmod +x "${INSTALL_DIR}/scripts/upgrade.sh"
./scripts/deploy.sh

cat >/etc/systemd/system/civicdesk-upgrade.service <<EOF
[Unit]
Description=CivicDesk Host-Assisted Upgrade
After=docker.service

[Service]
Type=oneshot
ExecStart=${INSTALL_DIR}/scripts/upgrade.sh
EOF

cat >/etc/systemd/system/civicdesk-upgrade.path <<EOF
[Unit]
Description=Watch for CivicDesk In-App Upgrade Requests

[Path]
PathExists=${UPGRADE_DIR}/request.json

[Install]
WantedBy=multi-user.target
EOF

systemctl daemon-reload
systemctl enable --now civicdesk-upgrade.path

cat >/etc/civicdesk/backup.env <<EOF
STACK_NAME=${STACK_NAME:-civicdesk}
RESTIC_REPOSITORY=${RESTIC_REPOSITORY:-}
RESTIC_PASSWORD=${RESTIC_PASSWORD:-}
BACKUP_RCLONE_REMOTE=${BACKUP_RCLONE_REMOTE:-}
EOF
chmod 600 /etc/civicdesk/backup.env

cat >/etc/cron.d/civicdesk <<EOF
SHELL=/bin/bash
PATH=/usr/local/sbin:/usr/local/bin:/sbin:/bin:/usr/sbin:/usr/bin
15 2 * * * root set -a && source /etc/civicdesk/backup.env && set +a && ${INSTALL_DIR}/scripts/backup-offsite.sh >> /var/log/civicdesk/backup.log 2>&1
*/5 * * * * root HEALTH_URL=http://127.0.0.1:${CIVICDESK_PORT}/api/health ${INSTALL_DIR}/scripts/health-check.sh >/dev/null 2>&1 || echo "\$(date -u) HEALTH CHECK FAILED" >> /var/log/civicdesk/health.log
EOF
chmod 644 /etc/cron.d/civicdesk

echo
echo "CivicDesk installation complete!"
if [ -n "$DOMAIN" ]; then
  echo "Public Portal: https://${DOMAIN}"
else
  echo "Public Portal: http://$(hostname -I | awk '{print $1}'):${CIVICDESK_PORT}"
fi
