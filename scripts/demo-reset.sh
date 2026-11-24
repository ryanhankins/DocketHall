#!/usr/bin/env bash
set -euo pipefail

# Restore the demo database and local files from the golden snapshot (~3-5 seconds).
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SNAP_DIR="${SNAP_DIR:-/var/lib/dockethall-demo}"

if [[ ! -f "$SNAP_DIR/demo_seed.sql" ]] || [[ ! -f "$SNAP_DIR/demo_files.tar.gz" ]]; then
  echo "ERROR: Snapshot files missing in $SNAP_DIR" >&2
  exit 1
fi

cd "$ROOT"

echo "==> Stopping API container for clean restore..."
docker compose -f docker-compose.demo.yml stop api

echo "==> Restoring Postgres snapshot..."
docker compose -f docker-compose.demo.yml exec -T db \
  psql -U civicdesk -d civicdesk -v ON_ERROR_STOP=1 < "$SNAP_DIR/demo_seed.sql" >/dev/null

echo "==> Restoring local uploads snapshot..."
docker compose -f docker-compose.demo.yml run --rm --no-deps --entrypoint sh api -c \
  'rm -rf /data/records/* && tar -xzf - -C /data/records' < "$SNAP_DIR/demo_files.tar.gz"

echo "==> Starting API container..."
docker compose -f docker-compose.demo.yml start api

for i in $(seq 1 30); do
  if curl -fsS http://127.0.0.1:8080/api/health >/dev/null 2>&1; then
    echo "Demo reset complete!"
    exit 0
  fi
  sleep 1
done

echo "WARNING: /api/health did not respond within 30s" >&2
exit 1
