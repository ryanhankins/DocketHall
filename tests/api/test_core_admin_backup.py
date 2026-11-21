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

"""Phase 2 API tests: core admin, backup/readiness, modules, branding, audit, SLA, and integrations."""

import pytest


@pytest.mark.parametrize(
    "path",
    [
        "/api/backup/status",
        "/api/backup/readiness",
        "/api/backup/policy",
        "/api/backup/export",
        "/api/modules/admin",
        "/api/modules/admin/presets",
        "/api/audit",
        "/api/sla/rules",
        "/api/sla/alerts",
        "/api/integrations/email",
        "/api/integrations/google-cloud",
        "/api/integrations/notification-users",
    ],
)
def test_admin_endpoints_reject_anon_and_applicant(anon_client, applicant_client, path):
    assert anon_client.get(path).status_code in (401, 403), f"anon should not access {path}"
    assert applicant_client.get(path).status_code == 403, f"applicant should get 403 on {path}"


def test_backup_readiness_policy_and_export_zip(admin_client):
    status_res = admin_client.get("/api/backup/status")
    assert status_res.status_code == 200

    readiness = admin_client.get("/api/backup/readiness")
    assert readiness.status_code == 200
    data = readiness.json()
    assert isinstance(data.get("checks"), list)
    assert len(data["checks"]) >= 1

    policy = admin_client.get("/api/backup/policy")
    assert policy.status_code == 200

    export_res = admin_client.get("/api/backup/export")
    assert export_res.status_code == 200
    assert export_res.content[:2] == b"PK", "Backup export should return a valid ZIP archive"


def test_modules_branding_audit_sla_integrations_reads(admin_client):
    for path in (
        "/api/modules",
        "/api/modules/admin",
        "/api/modules/admin/presets",
        "/api/branding",
        "/api/audit",
        "/api/sla/rules",
        "/api/sla/alerts",
        "/api/integrations/email",
        "/api/integrations/google-cloud",
        "/api/integrations/notification-users",
    ):
        res = admin_client.get(path)
        assert res.status_code == 200, f"{path} failed: {res.status_code} {res.text}"
