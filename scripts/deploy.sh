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

# Build images, create Swarm secrets (if missing) and deploy the CivicDesk stack.
#
#   ./scripts/deploy.sh
#
# Optional env: STACK_NAME (default civicdesk), CIVICDESK_TAG (default latest),
#               CIVICDESK_REGISTRY (e.g. "registry.example.com/" — images are pushed if set)
set -euo pipefail

cd "$(dirname "$0")/.."
STACK_NAME="${STACK_NAME:-civicdesk}"
if [ -z "${CIVICDESK_SECRET_PREFIX+x}" ]; then
  if [ "$STACK_NAME" = "civicdesk" ]; then
    CIVICDESK_SECRET_PREFIX=""
  else
    CIVICDESK_SECRET_PREFIX="${STACK_NAME}_"
  fi
fi
export CIVICDESK_SECRET_PREFIX
export CIVICDESK_PORT="${CIVICDESK_PORT:-8080}"
export MINIO_CONSOLE_PORT="${MINIO_CONSOLE_PORT:-9001}"
export MINIO_REPLICAS="${MINIO_REPLICAS:-1}"
export CIVICDESK_TAG="${CIVICDESK_TAG:-latest}"
export CIVICDESK_REGISTRY="${CIVICDESK_REGISTRY:-}"
CIVICDESK_PULL_ONLY="${CIVICDESK_PULL_ONLY:-false}"

# 1. Swarm mode
if [ "$(docker info --format '{{.Swarm.LocalNodeState}}')" != "active" ]; then
  echo "==> Initialising swarm"
  docker swarm init >/dev/null
fi

# 2. Secrets (created once; never overwritten)
create_secret() {  # name value
  if docker secret inspect "$1" >/dev/null 2>&1; then
    echo "    secret $1 exists"
  else
    printf '%s' "$2" | docker secret create "$1" - >/dev/null
    echo "    secret $1 created"
  fi
}
rand() { LC_ALL=C tr -dc 'A-Za-z0-9' </dev/urandom | head -c 32; }

echo "==> Secrets"
create_secret "${CIVICDESK_SECRET_PREFIX}postgres_password"   "${POSTGRES_PASSWORD:-$(rand)}"
create_secret "${CIVICDESK_SECRET_PREFIX}minio_root_user"     "${MINIO_ROOT_USER:-civicdesk}"
create_secret "${CIVICDESK_SECRET_PREFIX}minio_root_password" "${MINIO_ROOT_PASSWORD:-$(rand)}"

# 3. Images
if [ "$CIVICDESK_PULL_ONLY" = "true" ]; then
  echo "==> Pulling pre-built images (${CIVICDESK_REGISTRY:-local})"
  PULL_LIST="api web"
  if [ "$MINIO_REPLICAS" != "0" ]; then
    PULL_LIST="$PULL_LIST minio minio-init"
  fi
  for name in $PULL_LIST; do
    docker pull "${CIVICDESK_REGISTRY}civicdesk-${name}:${CIVICDESK_TAG}"
  done
else
  echo "==> Building frontend bundle"
  (cd web && ([ -d node_modules ] || npm ci) && npm run build)

  echo "==> Building images"
  COMMIT_SHA="$(git rev-parse --short HEAD 2>/dev/null || echo unknown)"
  IMAGES="api:api web:web minio:minio minio-init:minio/init"
  for pair in $IMAGES; do
    name="${pair%%:*}"; ctx="${pair#*:}"
    if [ "$name" = "api" ]; then
      docker build -q --build-arg "CIVICDESK_COMMIT=${COMMIT_SHA}" -t "${CIVICDESK_REGISTRY}civicdesk-${name}:${CIVICDESK_TAG}" "$ctx"
    else
      docker build -q -t "${CIVICDESK_REGISTRY}civicdesk-${name}:${CIVICDESK_TAG}" "$ctx"
    fi
    if [ -n "$CIVICDESK_REGISTRY" ]; then docker push "${CIVICDESK_REGISTRY}civicdesk-${name}:${CIVICDESK_TAG}"; fi
  done
fi

# 4. Deploy
echo "==> Deploying stack '$STACK_NAME'"
docker stack deploy --detach=true -c docker-stack.yml "$STACK_NAME"

# Force services onto freshly built/pulled images
UPDATE_SVCS="api web"
if [ "$MINIO_REPLICAS" != "0" ]; then
  UPDATE_SVCS="$UPDATE_SVCS minio"
fi
for svc in $UPDATE_SVCS; do
  docker service update --detach=true --force --quiet \
    --image "${CIVICDESK_REGISTRY}civicdesk-${svc}:${CIVICDESK_TAG}" \
    "${STACK_NAME}_${svc}" >/dev/null
done

echo
echo "Dashboard:     http://localhost:${CIVICDESK_PORT}"
echo "MinIO console: http://localhost:${MINIO_CONSOLE_PORT}  (user: docker secret ${CIVICDESK_SECRET_PREFIX}minio_root_user)"
echo "Status:        docker stack services $STACK_NAME"
