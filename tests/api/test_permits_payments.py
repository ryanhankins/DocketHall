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

"""Phase 3 API tests: permits, Property & Parcel Profile, inspections, and payments/GL reconciliation."""

import uuid


def test_permits_public_and_admin_reads_and_exports(anon_client, applicant_client, admin_client):
    assert anon_client.get("/api/permits/public/catalog").status_code == 200
    assert anon_client.get("/api/permits/parcels").status_code in (401, 403)
    assert applicant_client.get("/api/permits/reports/summary").status_code == 403

    for path in (
        "/api/permits",
        "/api/permits/parcels",
        "/api/permits/parcels/map",
        "/api/permits/contractors",
        "/api/permits/compliance-programs",
        "/api/permits/inspections/queue",
        "/api/permits/reports/summary",
        "/api/permits/link-candidates",
    ):
        res = admin_client.get(path)
        assert res.status_code == 200, f"{path} failed: {res.status_code} {res.text}"

    csv_res = admin_client.get("/api/permits/export.csv")
    assert csv_res.status_code == 200
    assert "text/csv" in csv_res.headers.get("content-type", "")

    rep_csv = admin_client.get("/api/permits/reports/summary.csv")
    assert rep_csv.status_code == 200
    assert "text/csv" in rep_csv.headers.get("content-type", "")


def test_parcel_crud_and_property_profile(admin_client):
    pid = f"P-{uuid.uuid4().hex[:6].upper()}"
    created = admin_client.post(
        "/api/permits/parcels",
        json={"parcel_id": pid, "address": "100 Civic Way", "owner_name": "City Test"},
    )
    assert created.status_code == 201, created.text
    parcel_pk = created.json()["id"]

    profile = admin_client.get(f"/api/permits/parcels/profile?parcel={pid}")
    assert profile.status_code == 200
    assert profile.json().get("parcel_id") == pid

    assert admin_client.delete(f"/api/permits/parcels/{parcel_pk}").status_code in (200, 204)


def test_payments_bills_and_gl_reconciliation(anon_client, applicant_client, admin_client):
    assert anon_client.get("/api/payments/config").status_code == 200
    assert anon_client.get("/api/payments/bills/public-lookup?q=UTIL").status_code == 200
    assert anon_client.get("/api/payments/reconciliation").status_code in (401, 403)
    assert applicant_client.get("/api/payments/reconciliation").status_code == 403

    assert admin_client.get("/api/payments/bills").status_code == 200
    assert admin_client.get("/api/payments/reconciliation").status_code == 200

    tpl = admin_client.get("/api/payments/bills/import-template.csv")
    assert tpl.status_code == 200
    assert "text/csv" in tpl.headers.get("content-type", "")

    rec_csv = admin_client.get("/api/payments/reconciliation.csv")
    assert rec_csv.status_code == 200
    assert "text/csv" in rec_csv.headers.get("content-type", "")
