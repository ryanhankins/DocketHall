#!/usr/bin/env bash
# Host-side updater invoked by civicdesk-upgrade.service when the Admin UI
# writes /var/lib/civicdesk-upgrade/request.json.
set -euo pipefail

UPGRADE_DIR="${UPGRADE_DIR:-/var/lib/civicdesk-upgrade}"
INSTALL_DIR="${INSTALL_DIR:-/opt/civicdesk}"
ENV_FILE="${ENV_FILE:-/etc/civicdesk/upgrade.env}"
STATUS_FILE="${UPGRADE_DIR}/status.json"
LOG_FILE="${UPGRADE_DIR}/upgrade.log"
REQUEST_FILE="${UPGRADE_DIR}/request.json"

mkdir -p "$UPGRADE_DIR"
rm -f "$REQUEST_FILE"

write_status() {
  local state="$1"
  local msg="$2"
  local commit="${3:-}"
  python3 -c '
import json, sys, datetime
data = {
    "state": sys.argv[1],
    "message": sys.argv[2],
    "commit": sys.argv[3],
    "updated_at": datetime.datetime.now(datetime.timezone.utc).isoformat(),
}
with open(sys.argv[4], "w", encoding="utf-8") as f:
    json.dump(data, f)
' "$state" "$msg" "$commit" "$STATUS_FILE"
  chown 10001:10001 "$STATUS_FILE" 2>/dev/null || true
}

: > "$LOG_FILE"
chown 10001:10001 "$LOG_FILE" 2>/dev/null || true
exec >> "$LOG_FILE" 2>&1

trap 'write_status "failed" "Upgrade failed. Check upgrade log for details." "$(git -C "$INSTALL_DIR" rev-parse --short HEAD 2>/dev/null || true)"' ERR

echo "==> Starting CivicDesk upgrade at $(date -u)"
write_status "running" "Pulling latest code from GitHub..."

if [ -f "$ENV_FILE" ]; then
  set -a
  # shellcheck disable=SC1090
  source "$ENV_FILE"
  set +a
fi

cd "$INSTALL_DIR"
git pull --ff-only
NEW_COMMIT="$(git rev-parse --short HEAD 2>/dev/null || echo unknown)"
echo "==> Deploying commit ${NEW_COMMIT}"
write_status "running" "Updating containers to ${NEW_COMMIT}..." "$NEW_COMMIT"

./scripts/deploy.sh

write_status "succeeded" "Upgraded to ${NEW_COMMIT}." "$NEW_COMMIT"
echo "==> Upgrade complete at $(date -u)"
