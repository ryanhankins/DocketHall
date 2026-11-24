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


def test_backup_export_and_import_restores_all_stored_data(admin_client):
    import io
    import json
    import zipfile
    from app.backup import _get_export_tables

    # Enable all modules (including licensing & codification) and populate data across categories
    assert admin_client.post("/api/modules/admin/preset", json={"preset": "full"}).status_code == 200

    contractor_res = admin_client.post(
        "/api/permits/contractors",
        json={
            "license_number": "LIC-BACKUP-901",
            "business_name": "Backup Restore Builders LLC",
            "license_type": "General Contractor",
            "status": "active",
        },
    )
    assert contractor_res.status_code == 201, contractor_res.text

    comp_res = admin_client.post(
        "/api/permits/compliance-programs",
        json={
            "program_type": "Rental Housing",
            "property_address": "901 Backup Way",
            "owner_name": "Backup Owner",
            "unit_count": 4,
            "cycle_months": 12,
        },
    )
    assert comp_res.status_code == 201, comp_res.text
    comp_id = comp_res.json()["id"]

    agenda_res = admin_client.post(
        "/api/agendas",
        json={"title": "Backup Restore Agenda", "body": "City Council", "meeting_date": "2026-12-20"},
    )
    assert agenda_res.status_code == 201, agenda_res.text

    ch_res = admin_client.post(
        "/api/codification/chapters",
        json={"code_prefix": "901", "title": "Backup Code Chapter", "is_published": True},
    )
    assert ch_res.status_code == 201, ch_res.text

    bill_res = admin_client.post(
        "/api/payments/bills",
        json={
            "reference_number": "UTIL-BACKUP-901",
            "bill_type": "utility",
            "payer_name": "Backup Payer",
            "amount_due": "$55.00",
        },
    )
    assert bill_res.status_code == 201, bill_res.text

    # Export full backup archive and verify every registered table is present in the ZIP
    export_res = admin_client.get("/api/backup/export")
    assert export_res.status_code == 200
    zip_bytes = export_res.content

    expected_table_names = {t for t, _, _, _ in _get_export_tables()}
    assert "contractor_licenses" in expected_table_names
    assert "recurring_compliance_programs" in expected_table_names

    with zipfile.ZipFile(io.BytesIO(zip_bytes), "r") as zf:
        names = set(zf.namelist())
        for tname in expected_table_names:
            assert f"data/{tname}.json" in names, f"Backup ZIP missing data/{tname}.json"
        contractors_in_zip = json.loads(zf.read("data/contractor_licenses.json").decode("utf-8"))
        assert any(c["license_number"] == "LIC-BACKUP-901" for c in contractors_in_zip)
        comp_in_zip = json.loads(zf.read("data/recurring_compliance_programs.json").decode("utf-8"))
        assert any(p["property_address"] == "901 Backup Way" for p in comp_in_zip)

    # Delete the test rows while full preset is active, then switch to starter preset
    # (which disables licensing & codification) to simulate a fresh minimal instance
    contractor_id = contractor_res.json()["id"]
    assert admin_client.delete(f"/api/permits/contractors/{contractor_id}").status_code == 200
    assert admin_client.delete(f"/api/permits/compliance-programs/{comp_id}").status_code == 200

    try:
        assert admin_client.post("/api/modules/admin/preset", json={"preset": "starter"}).status_code == 200

        # Restore from backup ZIP while licensing/codification are disabled on the target instance
        import_res = admin_client.post(
            "/api/backup/import",
            files={"file": ("backup.zip", zip_bytes, "application/zip")},
        )
        assert import_res.status_code == 200, import_res.text
        imp_data = import_res.json()
        assert imp_data["status"] == "restored"
        assert "contractor_licenses" in imp_data["row_counts"]
        assert "recurring_compliance_programs" in imp_data["row_counts"]
    finally:
        admin_client.post("/api/modules/admin/preset", json={"preset": "full"})

    # Re-login because import_archive(include_users=True) truncates active sessions
    import os
    login_res = admin_client.post(
        "/api/login",
        json={
            "username": os.environ.get("CIVICDESK_TEST_ADMIN_USER", "admin"),
            "password": os.environ.get("CIVICDESK_TEST_ADMIN_PASS", "admin"),
        },
    )
    assert login_res.status_code == 200, login_res.text

    # Verify all data and module enablement were restored
    mods_res = admin_client.get("/api/modules/admin")
    assert mods_res.status_code == 200, mods_res.text
    mods = {m["id"]: m["enabled"] for m in mods_res.json()}
    assert mods["licensing"] is True
    assert mods["codification"] is True

    contractors_after = admin_client.get("/api/permits/contractors").json()
    assert any(c["license_number"] == "LIC-BACKUP-901" for c in contractors_after)

    comp_after = admin_client.get("/api/permits/compliance-programs").json()
    assert any(p["property_address"] == "901 Backup Way" for p in comp_after)

    agendas_after = admin_client.get("/api/agendas").json()
    assert any(a["title"] == "Backup Restore Agenda" for a in agendas_after)

    chapters_after = admin_client.get("/api/codification/public").json()["chapters"]
    assert any(c["code_prefix"] == "901" for c in chapters_after)

    bills_after = admin_client.get("/api/payments/bills").json()
    assert any(b["reference_number"] == "UTIL-BACKUP-901" for b in bills_after)


def test_home_hidden_cards_branding_config(admin_client, anon_client):
    res = admin_client.put(
        "/api/branding",
        json={"city_title": "Test City", "home_hidden_cards": ["complaints", "records"]},
    )
    assert res.status_code == 200, res.text
    assert res.json()["home_hidden_cards"] == ["complaints", "records"]

    pub = anon_client.get("/api/branding")
    assert pub.status_code == 200
    assert pub.json()["home_hidden_cards"] == ["complaints", "records"]

    reset = admin_client.put("/api/branding", json={"city_title": "Test City", "home_hidden_cards": []})
    assert reset.status_code == 200
    assert reset.json()["home_hidden_cards"] == []


def test_hidden_home_cards_block_public_endpoints(admin_client, anon_client):
    """Unchecking a card in Public Home Page Service Cards blocks its public endpoints while keeping staff endpoints active."""
    r = admin_client.put(
        "/api/branding",
        json={"city_title": "Test City", "home_hidden_cards": ["complaints", "citations", "utilities"]},
    )
    assert r.status_code == 200

    # Public complaint submission & log are blocked (404)
    sub = anon_client.post(
        "/api/complaints/public",
        json={"category": "Noise", "description": "Loud music", "location": "123 Main St"},
    )
    assert sub.status_code == 404
    assert anon_client.get("/api/complaints/public-log").status_code == 404

    # Staff complaints endpoint remains available
    assert admin_client.get("/api/complaints").status_code == 200

    # Public citation contest & billing lookup are blocked (404)
    assert anon_client.post("/api/payments/public/bills/contest", json={"reference_number": "CIT-1", "reason": "Test"}).status_code == 404
    assert anon_client.get("/api/payments/bills/public-lookup?q=TEST").status_code == 404

    # Re-enabling restores public access
    reset = admin_client.put("/api/branding", json={"city_title": "Test City", "home_hidden_cards": []})
    assert reset.status_code == 200
    assert anon_client.get("/api/complaints/public-log").status_code == 200


def test_demo_mode_guards_and_login(admin_client, anon_client, monkeypatch):
    """DEMO_MODE=true exposes demo_mode in branding, enables /api/demo-login, and blocks password/backup/payment mutations."""
    # Disabled by default
    assert anon_client.post("/api/demo-login", json={"role": "clerk"}).status_code == 404
    assert anon_client.get("/api/branding").json()["demo_mode"] is False

    monkeypatch.setenv("DEMO_MODE", "true")
    assert anon_client.get("/api/branding").json()["demo_mode"] is True

    # One-click demo login works
    dl = anon_client.post("/api/demo-login", json={"role": "clerk"})
    assert dl.status_code == 200
    assert dl.json()["username"] == "demo_clerk"

    # Destructive / external actions are blocked
    assert admin_client.put("/api/backup/policy", json={"enabled": True}).status_code == 403
    assert admin_client.post("/api/payments/checkout", json={"item_type": "bill", "item_id": 1}).status_code == 403
    assert admin_client.post("/api/codification/import-urls", json={"items": []}).status_code == 403
