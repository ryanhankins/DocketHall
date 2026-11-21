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

# Automated backup of Postgres + object storage (SeaweedFS or local /data/records)
# for a CivicDesk stack.
#
# Incremental mode (recommended):
#   Set RESTIC_REPOSITORY (and RESTIC_PASSWORD or RESTIC_PASSWORD_FILE) to run
#   deduplicated, encrypted incremental snapshots via restic.
#
# Snapshot mode (default when RESTIC_REPOSITORY is unset):
#   Writes timestamped postgres.dump + storage_data.tar.gz + SHA256SUMS locally
#   and optionally syncs off-site via rclone (BACKUP_RCLONE_REMOTE).
#
# Optional env:
#   STACK_NAME             Docker Swarm stack name (default: civicdesk)
#   BACKUP_DIR             Local snapshot directory (default: /var/backups/civicdesk/<stack>)
#   BACKUP_RETENTION_DAYS  Retention in days (default: 14)
#   RESTIC_REPOSITORY      restic repo (e.g. s3:s3.us-west-004.backblazeb2.com/bucket/civicdesk)
#   RESTIC_PRUNE           Run restic forget --prune after backup (default: true)
#   BACKUP_RCLONE_REMOTE   Optional rclone destination for snapshot mode
set -euo pipefail

STACK_NAME="${STACK_NAME:-civicdesk}"
BACKUP_DIR="${BACKUP_DIR:-/var/backups/civicdesk/${STACK_NAME}}"
BACKUP_RETENTION_DAYS="${BACKUP_RETENTION_DAYS:-14}"
RESTIC_REPOSITORY="${RESTIC_REPOSITORY:-}"
RESTIC_PRUNE="${RESTIC_PRUNE:-true}"
BACKUP_RCLONE_REMOTE="${BACKUP_RCLONE_REMOTE:-}"

DB_CID="$(docker ps -q --filter "name=${STACK_NAME}_db" | head -n 1)"
API_CID="$(docker ps -q --filter "name=${STACK_NAME}_api" | head -n 1)"
SEAWEEDFS_CID="$(docker ps -q --filter "name=${STACK_NAME}_seaweedfs" | head -n 1)"
MINIO_CID="$(docker ps -q --filter "name=${STACK_NAME}_minio" | head -n 1)"

if [ -z "$DB_CID" ]; then
  echo "ERROR: No running container found for ${STACK_NAME}_db" >&2
  exit 1
fi
if [ -z "$SEAWEEDFS_CID" ] && [ -z "$MINIO_CID" ] && [ -z "$API_CID" ]; then
  echo "ERROR: Neither ${STACK_NAME}_seaweedfs nor ${STACK_NAME}_api is running" >&2
  exit 1
fi

stage_storage_dir() {
  local target="$1"
  if [ -n "$SEAWEEDFS_CID" ]; then
    echo "==> Copying SeaweedFS data (${STACK_NAME}_seaweedfs)"
    docker cp "${SEAWEEDFS_CID}:/data" "$target"
  elif [ -n "$MINIO_CID" ]; then
    echo "==> Copying legacy MinIO data (${STACK_NAME}_minio)"
    docker cp "${MINIO_CID}:/data" "$target"
  else
    echo "==> Copying local storage (${STACK_NAME}_api:/data/records)"
    docker cp "${API_CID}:/data/records" "$target"
  fi
}

if [ -n "$RESTIC_REPOSITORY" ]; then
  if ! command -v restic >/dev/null 2>&1; then
    echo "ERROR: RESTIC_REPOSITORY is set but restic is not installed" >&2
    exit 1
  fi
  STAGE="$(mktemp -d)"
  trap 'rm -rf "$STAGE"' EXIT

  echo "==> Dumping Postgres (${STACK_NAME}_db)"
  docker exec "$DB_CID" pg_dump -U civicdesk -d civicdesk -Fc > "${STAGE}/postgres.dump"
  test -s "${STAGE}/postgres.dump"

  stage_storage_dir "${STAGE}/storage_data"

  if ! restic snapshots >/dev/null 2>&1; then
    echo "==> Initializing restic repository"
    restic init
  fi

  echo "==> Running incremental restic backup"
  restic backup --tag "$STACK_NAME" "$STAGE"

  if [ "$RESTIC_PRUNE" = "true" ]; then
    echo "==> Pruning snapshots (keep ${BACKUP_RETENTION_DAYS} daily)"
    restic forget --tag "$STACK_NAME" --keep-daily "$BACKUP_RETENTION_DAYS" --prune
  fi
  echo "==> Incremental backup complete"
  exit 0
fi

STAMP="$(date -u +%Y%m%d_%H%M%SZ)"
DEST="${BACKUP_DIR}/${STAMP}"
mkdir -p "$DEST"

echo "==> Dumping Postgres (${STACK_NAME}_db)"
docker exec "$DB_CID" pg_dump -U civicdesk -d civicdesk -Fc > "${DEST}/postgres.dump"
test -s "${DEST}/postgres.dump"

stage_storage_dir "${DEST}/storage_data"
tar -C "${DEST}/storage_data" -czf "${DEST}/storage_data.tar.gz" .
rm -rf "${DEST}/storage_data"
test -s "${DEST}/storage_data.tar.gz"

(
  cd "$DEST"
  if command -v sha256sum >/dev/null 2>&1; then
    sha256sum postgres.dump storage_data.tar.gz > SHA256SUMS
  else
    shasum -a 256 postgres.dump storage_data.tar.gz > SHA256SUMS
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
