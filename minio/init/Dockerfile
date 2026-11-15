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

# One-shot bucket setup. Chainguard's mc image has no shell, so copy the
# static mc binary onto alpine to be able to read Swarm secret files.
FROM cgr.dev/chainguard/minio-client:latest AS mc

FROM alpine:3.20
COPY --from=mc /usr/bin/mc /usr/bin/mc
COPY init.sh /init.sh
ENTRYPOINT ["/bin/sh", "/init.sh"]
