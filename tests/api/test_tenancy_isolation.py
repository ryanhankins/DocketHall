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

"""Phase 2 API tests: multi-tenant platform routes and tenant isolation."""

import os


def test_platform_tenants_requires_auth(anon_client, applicant_client):
    assert anon_client.get("/api/platform/tenants").status_code in (401, 403, 404)
    assert applicant_client.get("/api/platform/tenants").status_code in (401, 403, 404)


def test_unknown_tenant_header_handled_cleanly(anon_client):
    res = anon_client.get("/api/modules/public", headers={"X-Tenant-Slug": "nonexistent_city_99999"})
    if os.environ.get("MULTI_TENANT", "").strip().lower() == "true":
        assert res.status_code == 404
    else:
        assert res.status_code == 200
