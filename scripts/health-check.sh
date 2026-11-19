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

# Health, Swarm replica, and disk-space check for a CivicDesk stack.
# Exits non-zero if any check fails (suitable for cron or uptime monitors).
#
# Usage:
#   ./scripts/health-check.sh
#
# Optional env:
#   STACK_NAME      Docker Swarm stack name (default: civicdesk)
#   HEALTH_URL      HTTP health URL (default: http://localhost:8080/api/health)
#   DISK_WARN_PCT   Max allowed root disk % before failing (default: 85)
set -euo pipefail

STACK_NAME="${STACK_NAME:-civicdesk}"
HEALTH_URL="${HEALTH_URL:-http://localhost:8080/api/health}"
DISK_WARN_PCT="${DISK_WARN_PCT:-85}"

# 1. HTTP /api/health
resp="$(curl -fsS --max-time 5 "$HEALTH_URL")"
if ! echo "$resp" | grep -q '"status":"ok"'; then
  echo "FAIL: unexpected /api/health response: $resp" >&2
  exit 1
fi

# 2. Swarm services convergence (api, web, db, plus minio if scaled > 0)
for svc in api web db minio; do
  replicas="$(docker service ls --filter "name=${STACK_NAME}_${svc}" --format '{{.Replicas}}' | head -n 1)"
  if [ -z "$replicas" ]; then
    [ "$svc" = "minio" ] && continue
    echo "FAIL: service ${STACK_NAME}_${svc} not found" >&2
    exit 1
  fi
  cur="${replicas%%/*}"
  des="${replicas##*/}"
  if [ "$svc" = "minio" ] && [ "$des" = "0" ]; then
    continue
  fi
  if [ "$cur" != "$des" ] || [ "$cur" = "0" ]; then
    echo "FAIL: service ${STACK_NAME}_${svc} replicas=${replicas}" >&2
    exit 1
  fi
done

# 3. Disk usage check
disk_pct="$(df -P / | awk 'NR==2 {gsub(/%/, "", $5); print $5}')"
if [ "$disk_pct" -ge "$DISK_WARN_PCT" ]; then
  echo "FAIL: root disk usage is ${disk_pct}% (threshold ${DISK_WARN_PCT}%)" >&2
  exit 1
fi

echo "OK: ${STACK_NAME} healthy (${HEALTH_URL}), disk ${disk_pct}%"
