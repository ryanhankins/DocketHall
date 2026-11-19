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

# Automated nightly backup of Postgres + MinIO data for a CivicDesk stack,
# with optional off-site sync via rclone (e.g. Backblaze B2 or S3).
#
# Usage:
#   ./scripts/backup-offsite.sh
#
# Optional env:
#   STACK_NAME             Docker Swarm stack name (default: civicdesk)
#   BACKUP_DIR             Local snapshot directory (default: /var/backups/civicdesk/<stack>)
#   BACKUP_RETENTION_DAYS  Local retention in days (default: 14)
#   BACKUP_RCLONE_REMOTE   Optional rclone destination (e.g. b2:civicdesk-backups/birchwood)
set -euo pipefail

STACK_NAME="${STACK_NAME:-civicdesk}"
BACKUP_DIR="${BACKUP_DIR:-/var/backups/civicdesk/${STACK_NAME}}"
BACKUP_RETENTION_DAYS="${BACKUP_RETENTION_DAYS:-14}"
BACKUP_RCLONE_REMOTE="${BACKUP_RCLONE_REMOTE:-}"

STAMP="$(date -u +%Y%m%d_%H%M%SZ)"
DEST="${BACKUP_DIR}/${STAMP}"
mkdir -p "$DEST"

DB_CID="$(docker ps -q --filter "name=${STACK_NAME}_db" | head -n 1)"
MINIO_CID="$(docker ps -q --filter "name=${STACK_NAME}_minio" | head -n 1)"

if [ -z "$DB_CID" ]; then
  echo "ERROR: No running container found for ${STACK_NAME}_db" >&2
  exit 1
fi
if [ -z "$MINIO_CID" ]; then
  echo "ERROR: No running container found for ${STACK_NAME}_minio" >&2
  exit 1
fi

echo "==> Dumping Postgres (${STACK_NAME}_db)"
docker exec "$DB_CID" pg_dump -U civicdesk -d civicdesk -Fc > "${DEST}/postgres.dump"
test -s "${DEST}/postgres.dump"

echo "==> Archiving MinIO data (${STACK_NAME}_minio)"
docker cp "${MINIO_CID}:/data" "${DEST}/minio_data"
tar -C "${DEST}/minio_data" -czf "${DEST}/minio_data.tar.gz" .
rm -rf "${DEST}/minio_data"
test -s "${DEST}/minio_data.tar.gz"

(
  cd "$DEST"
  if command -v sha256sum >/dev/null 2>&1; then
    sha256sum postgres.dump minio_data.tar.gz > SHA256SUMS
  else
    shasum -a 256 postgres.dump minio_data.tar.gz > SHA256SUMS
  fi
)

echo "==> Snapshot saved to ${DEST}"

if [ -n "$BACKUP_RCLONE_REMOTE" ]; then
  if ! command -v rclone >/dev/null 2>&1; then
    echo "ERROR: BACKUP_RCLONE_REMOTE is set but rclone is not installed" >&2
    exit 1
  fi
  echo "==> Syncing to ${BACKUP_RCLONE_REMOTE}/${STAMP}"
  rclone copy "$DEST" "${BACKUP_RCLONE_REMOTE%/}/${STAMP}"
fi

echo "==> Pruning local snapshots older than ${BACKUP_RETENTION_DAYS} days"
find "$BACKUP_DIR" -mindepth 1 -maxdepth 1 -type d -mtime "+${BACKUP_RETENTION_DAYS}" -exec rm -rf {} +
