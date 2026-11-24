#!/usr/bin/env bash
set -euo pipefail

# Capture a clean golden snapshot of the seeded demo database and local files.
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SNAP_DIR="${SNAP_DIR:-/var/lib/dockethall-demo}"

mkdir -p "$SNAP_DIR"
cd "$ROOT"

echo "==> Dumping clean demo database to $SNAP_DIR/demo_seed.sql..."
docker compose -f docker-compose.demo.yml exec -T db \
  pg_dump -U civicdesk -d civicdesk --clean --if-exists > "$SNAP_DIR/demo_seed.sql"

echo "==> Archiving clean demo files to $SNAP_DIR/demo_files.tar.gz..."
docker compose -f docker-compose.demo.yml exec -T api \
  tar -czf - -C /data/records . > "$SNAP_DIR/demo_files.tar.gz"

echo "Snapshot saved in $SNAP_DIR"
ls -lh "$SNAP_DIR/demo_seed.sql" "$SNAP_DIR/demo_files.tar.gz"
