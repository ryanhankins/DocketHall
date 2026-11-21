#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
NET_NAME="dockethall-test-net"
PG_NAME="dockethall-test-pg"

cleanup() {
  docker stop "$PG_NAME" >/dev/null 2>&1 || true
  docker network rm "$NET_NAME" >/dev/null 2>&1 || true
}
trap cleanup EXIT

cd "$ROOT"
docker rm -f "$PG_NAME" >/dev/null 2>&1 || true
docker network create "$NET_NAME" >/dev/null 2>&1 || true
docker run -d --rm --name "$PG_NAME" --network "$NET_NAME" \
  -e POSTGRES_DB=civicdesk_test \
  -e POSTGRES_USER=civicdesk \
  -e POSTGRES_PASSWORD=testpassword \
  postgres:16-alpine >/dev/null

for _ in $(seq 1 20); do
  docker exec "$PG_NAME" pg_isready -U civicdesk -d civicdesk_test >/dev/null 2>&1 && break
  sleep 1
done

docker run --rm --user root --network "$NET_NAME" \
  -v "$ROOT:/workspace" -w /workspace \
  -e CIVICDESK_TEST_PG=1 \
  -e POSTGRES_HOST="$PG_NAME" \
  -e POSTGRES_PORT=5432 \
  -e POSTGRES_DB=civicdesk_test \
  -e POSTGRES_USER=civicdesk \
  -e POSTGRES_PASSWORD=testpassword \
  civicdesk-api:latest \
  sh -c "pip install -q pytest httpx && python3 -m unittest discover -s tests -v && pytest tests/api -v --tb=short"
