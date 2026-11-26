#!/usr/bin/env bash
# Upgrade a Docker Compose demo installation in place (pulls latest git code,
# rebuilds api and multi-stage web images, and restarts containers).
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

if [ -d .git ]; then
  echo "==> Pulling latest changes..."
  git pull --ff-only
fi

echo "==> Rebuilding and restarting demo containers..."
docker compose -f docker-compose.demo.yml up -d --build api web

echo "==> Demo containers:"
docker compose -f docker-compose.demo.yml ps
