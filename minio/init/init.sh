#!/bin/sh
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

# Create the records bucket (object lock + versioning enabled). Idempotent.
set -e
ENDPOINT="${MINIO_ENDPOINT:-http://minio:9000}"
BUCKET="${MINIO_BUCKET:-records}"
USER="$(cat /run/secrets/minio_root_user)"
PASS="$(cat /run/secrets/minio_root_password)"

until mc alias set local "$ENDPOINT" "$USER" "$PASS" >/dev/null 2>&1; do
  echo "waiting for minio at $ENDPOINT ..."
  sleep 2
done

mc mb --ignore-existing --with-lock "local/$BUCKET"
echo "minio bucket '$BUCKET' ready"
