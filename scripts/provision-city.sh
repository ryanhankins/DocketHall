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

# Provision an isolated CivicDesk stack for a municipality.
#
# Example:
#   STACK_NAME=northfield CIVICDESK_PORT=8081 MINIO_CONSOLE_PORT=9011 \
#   APP_BASE_URL=https://portal.northfield.gov COOKIE_SECURE=true \
#   SMTP_HOST=smtp.postmarkapp.com SMTP_PORT=587 \
#   SMTP_SENDER_EMAIL=alerts@northfield.gov SMTP_PASSWORD=... \
#   ./scripts/provision-city.sh
set -euo pipefail

cd "$(dirname "$0")/.."

if [ -z "${STACK_NAME:-}" ]; then
  echo "Usage: STACK_NAME=<slug> [CIVICDESK_PORT=8080] [APP_BASE_URL=https://...] $0" >&2
  exit 1
fi

export STACK_NAME
export CIVICDESK_PORT="${CIVICDESK_PORT:-8080}"
export MINIO_CONSOLE_PORT="${MINIO_CONSOLE_PORT:-9001}"
export COOKIE_SECURE="${COOKIE_SECURE:-true}"
export APP_BASE_URL="${APP_BASE_URL:-}"
export SEED_CITY_PROFILE="${SEED_CITY_PROFILE:-}"

echo "==> Provisioning CivicDesk stack '${STACK_NAME}' on port ${CIVICDESK_PORT}"
./scripts/deploy.sh
