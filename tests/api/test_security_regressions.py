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

"""Security regression tests for findings in security_review.md."""

import io
import json
import uuid
import zipfile


def test_backup_export_import_requires_admin_and_redacts_secrets(admin_client):
    # Create a non-admin clerk user with agendas.manage
    uname = f"clerk_{uuid.uuid4().hex[:8]}"
    u_res = admin_client.post(
        "/api/users",
        json={"username": uname, "role": "admin_staff", "email": f"{uname}@city.gov", "permissions": ["agendas.manage"]},
    )
    assert u_res.status_code == 201
    pw = u_res.json()["generated_password"]
    uid = u_res.json()["id"]

    try:
        from fastapi.testclient import TestClient

        clerk = TestClient(admin_client.app)
        assert clerk.post("/api/login", json={"username": uname, "password": pw}).status_code == 200

        # Non-admin staff must be rejected (403) from backup export & import
        assert clerk.get("/api/backup/export").status_code == 403
        assert clerk.post(
            "/api/backup/import",
            files={"file": ("b.zip", b"not-a-zip", "application/zip")},
        ).status_code == 403

        # Admin export must redact core_integrations.api_key
        exp = admin_client.get("/api/backup/export")
        assert exp.status_code == 200
        with zipfile.ZipFile(io.BytesIO(exp.content), "r") as zf:
            if "data/core_integrations.json" in zf.namelist():
                rows = json.loads(zf.read("data/core_integrations.json").decode("utf-8"))
                for row in rows:
                    assert row.get("api_key", "") == "", "Plaintext api_key leaked in backup export!"
    finally:
        admin_client.delete(f"/api/users/{uid}")


def test_cross_origin_csrf_rejected(admin_client):
    res = admin_client.post(
        "/api/logout",
        headers={"Origin": "https://evil.dockethall.com", "Host": "docketwood.dockethall.com"},
    )
    assert res.status_code == 403


def test_password_reset_link_ignores_untrusted_origin_when_unconfigured(monkeypatch):
    from starlette.requests import Request
    from app.integrations import get_app_base_url

    monkeypatch.delenv("APP_BASE_URL", raising=False)
    scope = {
        "type": "http",
        "method": "POST",
        "path": "/api/password-reset/request",
        "headers": [
            (b"host", b"city.example.gov"),
            (b"origin", b"https://evil.example"),
        ],
    }
    req = Request(scope)
    assert get_app_base_url(req, require_configured=True) == ""
