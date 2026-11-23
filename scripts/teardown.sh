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

# Remove the stack. Volumes and secrets are kept unless --purge is given.
set -euo pipefail
STACK_NAME="${STACK_NAME:-civicdesk}"

docker stack rm "$STACK_NAME"

if [ "${1:-}" = "--purge" ]; then
  echo "Waiting for services to stop..."
  while docker ps -q --filter "label=com.docker.stack.namespace=$STACK_NAME" | grep -q .; do sleep 2; done
  sleep 3
  docker volume rm "${STACK_NAME}_records_data" "${STACK_NAME}_pgdata" "${STACK_NAME}_seaweedfs_data" "${STACK_NAME}_upgrade_data" 2>/dev/null || true
  docker secret rm postgres_password 2>/dev/null || true
  docker config rm civicdesk_db_init_v1 2>/dev/null || true
  echo "Purged volumes, secrets and configs."
fi
