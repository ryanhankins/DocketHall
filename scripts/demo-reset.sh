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

CODE_UPDATED=0
if [ -d .git ]; then
  echo "==> Checking for latest commit on origin/main..."
  if git fetch -q origin main; then
    LOCAL_SHA="$(git rev-parse HEAD)"
    REMOTE_SHA="$(git rev-parse origin/main)"
    if [[ "$LOCAL_SHA" != "$REMOTE_SHA" ]]; then
      echo "==> New commit detected ($LOCAL_SHA -> $REMOTE_SHA); pulling..."
      if git pull --ff-only origin main; then
        CODE_UPDATED=1
      else
        echo "WARNING: git pull --ff-only failed; continuing with existing code" >&2
      fi
    fi
  else
    echo "WARNING: git fetch failed; continuing with existing code" >&2
  fi
fi

ensure_api_started() {
  docker compose -f docker-compose.demo.yml start api >/dev/null 2>&1 || true
}
trap ensure_api_started EXIT

echo "==> Stopping API container for clean restore..."
docker compose -f docker-compose.demo.yml stop api

echo "==> Restoring Postgres snapshot..."
docker compose -f docker-compose.demo.yml exec -T db \
  psql -U civicdesk -d civicdesk -v ON_ERROR_STOP=1 -c "DROP SCHEMA public CASCADE; CREATE SCHEMA public;" >/dev/null
docker compose -f docker-compose.demo.yml exec -T db \
  psql -U civicdesk -d civicdesk -v ON_ERROR_STOP=1 < "$SNAP_DIR/demo_seed.sql" >/dev/null

echo "==> Restoring local uploads snapshot..."
docker compose -f docker-compose.demo.yml run -T --rm --no-deps --entrypoint sh api -c \
  'rm -rf /data/records/* && tar -xzf - -C /data/records' < "$SNAP_DIR/demo_files.tar.gz"

if [[ "$CODE_UPDATED" -eq 1 ]]; then
  echo "==> Rebuilding and restarting demo containers for new commit..."
  docker compose -f docker-compose.demo.yml up -d --build api web
else
  echo "==> Starting API container..."
  docker compose -f docker-compose.demo.yml start api
fi

for i in $(seq 1 90); do
  if curl -fsS http://127.0.0.1:8080/api/health >/dev/null 2>&1; then
    echo "Demo reset complete!"
    exit 0
  fi
  sleep 1
done

echo "WARNING: /api/health did not respond within 90s" >&2
exit 1
