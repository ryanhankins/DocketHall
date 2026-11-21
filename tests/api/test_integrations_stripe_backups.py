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

"""Layer 3 API tests: mocked Stripe/SMTP integrations, backup ZIP export/import, and demo seed."""

from unittest.mock import patch


def test_backup_export_import_roundtrip_and_demo_seed(admin_client):
    # Export full ZIP
    exp = admin_client.get("/api/backup/export")
    assert exp.status_code == 200
    assert exp.content[:2] == b"PK"

    # Re-import exported ZIP
    imp = admin_client.post(
        "/api/backup/import",
        files={"file": ("backup.zip", exp.content, "application/zip")},
    )
    assert imp.status_code == 200, imp.text

    # Re-authenticate in case backup import replaced sessions table
    admin_client.post("/api/login", json={"username": "admin", "password": "admin"})

    # Seed demo data (idempotent)
    seed = admin_client.post("/api/backup/seed-demo")
    assert seed.status_code == 200, seed.text
    assert "seeded" in seed.json()


def test_integrations_email_test_mocked_and_stripe_webhook_validation(anon_client, admin_client):
    # Stripe webhook without valid signature or secret rejects cleanly (not 500)
    hook = anon_client.post("/api/payments/webhook", content=b"{}", headers={"stripe-signature": "invalid"})
    assert hook.status_code in (400, 401, 403)

    # SMTP test-send rejects unauthenticated/applicant and handles mocked send as admin
    assert anon_client.post("/api/integrations/email/test", json={"to": "test@example.com"}).status_code in (401, 403)
    with patch("smtplib.SMTP") as mock_smtp:
        res = admin_client.post("/api/integrations/email/test", json={"to": "test@example.com"})
        assert res.status_code in (200, 400), res.text
