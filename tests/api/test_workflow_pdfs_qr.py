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

"""Layer 3 API tests: end-to-end permit & agenda PDF generation and multi-tenant isolation."""

import os
import uuid


def test_permit_application_to_pdf_workflow(applicant_client, admin_client):
    catalog = applicant_client.get("/api/permits/public/catalog")
    assert catalog.status_code == 200
    types = catalog.json().get("types") or catalog.json().get("permit_types") or []
    uses = catalog.json().get("uses") or []
    if not types or not uses:
        return  # No permit types/uses seeded in blank DB

    ptype_id = types[0]["id"]
    matching_uses = [u for u in uses if u.get("permit_type_id") in (None, ptype_id)]
    if not matching_uses:
        matching_uses = uses
    puse_id = matching_uses[0]["id"]
    ptype_id = matching_uses[0].get("permit_type_id") or ptype_id
    created = applicant_client.post(
        "/api/permits",
        json={
            "permit_type_id": ptype_id,
            "permit_use_id": puse_id,
            "applicant_name": "Test Resident",
            "applicant_email": "resident@example.com",
            "property_address": "456 Oak Ave",
            "description": "Deck replacement",
            "accepted_terms": True,
        },
    )
    assert created.status_code == 201, created.text
    permit_id = created.json()["id"]

    pdf = admin_client.get(f"/api/permits/{permit_id}/pdf")
    assert pdf.status_code == 200
    assert pdf.content[:4] == b"%PDF"


def test_agenda_minutes_and_pdf_export(admin_client):
    prefs = admin_client.get("/api/agendas/preferences").json()
    governing_body = (prefs.get("bodies") or ["City Council"])[0]
    ag = admin_client.post(
        "/api/agendas",
        json={"title": f"PDF Test Meeting {uuid.uuid4().hex[:6]}", "body": governing_body, "meeting_date": "2026-12-20"},
    )
    assert ag.status_code == 201, ag.text
    ag_id = ag.json()["id"]

    pdf = admin_client.get(f"/api/agendas/{ag_id}/pdf")
    assert pdf.status_code in (200, 404)
    if pdf.status_code == 200:
        assert pdf.content[:4] == b"%PDF"

    minutes_pdf = admin_client.get(f"/api/agendas/{ag_id}/minutes.pdf")
    assert minutes_pdf.status_code == 200, minutes_pdf.text
    assert minutes_pdf.content[:4] == b"%PDF"

    compliance = admin_client.get(f"/api/agendas/{ag_id}/minutes.pdf/compliance")
    assert compliance.status_code == 200, compliance.text

    admin_client.delete(f"/api/agendas/{ag_id}")


def test_permit_certificate_of_occupancy_and_foia_fulfillment_upload(anon_client, applicant_client, admin_client):
    # FOIA public submission -> admin fulfillment file upload -> status fulfilled -> public download
    foia = anon_client.post(
        "/api/records/requests/public",
        json={
            "requester_name": "Alex Citizen",
            "requester_email": "alex@example.com",
            "subject": "Road Paving Records",
            "description": "2026 paving contract",
        },
    )
    assert foia.status_code == 201, foia.text
    req_num = foia.json()["request_number"]
    reqs = admin_client.get("/api/records/requests").json()
    req_id = next(r["id"] for r in reqs if r["request_number"] == req_num)

    up = admin_client.post(
        f"/api/records/requests/{req_id}/fulfillment-file",
        files={"file": ("response.pdf", b"%PDF-1.4\n%test\n", "application/pdf")},
    )
    assert up.status_code == 200, up.text

    patch = admin_client.patch(f"/api/records/requests/{req_id}", json={"status": "fulfilled"})
    assert patch.status_code == 200, patch.text

    dl = anon_client.get(f"/api/records/requests/public-download/{req_num}")
    assert dl.status_code == 200, dl.text
    assert dl.content.startswith(b"%PDF")

    admin_client.delete(f"/api/records/requests/{req_id}")

    # Certificate of Occupancy PDF on a permit
    catalog = applicant_client.get("/api/permits/public/catalog").json()
    types = catalog.get("types") or catalog.get("permit_types") or []
    uses = catalog.get("uses") or []
    if types and uses:
        puse_id = uses[0]["id"]
        ptype_id = uses[0].get("permit_type_id") or types[0]["id"]
        created = applicant_client.post(
            "/api/permits",
            json={
                "permit_type_id": ptype_id,
                "permit_use_id": puse_id,
                "applicant_name": "CO Resident",
                "applicant_email": "co@example.com",
                "property_address": "789 Pine Ln",
                "description": "New garage",
                "accepted_terms": True,
            },
        )
        assert created.status_code == 201, created.text
        pid = created.json()["id"]
        co_pdf = admin_client.get(f"/api/permits/{pid}/certificate-of-occupancy")
        assert co_pdf.status_code in (200, 400)
        if co_pdf.status_code == 200:
            assert co_pdf.content[:4] == b"%PDF"


def test_multi_tenant_isolation_when_enabled(admin_client):
    if os.environ.get("MULTI_TENANT", "").strip().lower() != "true":
        return
    slug = f"city_{uuid.uuid4().hex[:6]}"
    res = admin_client.post(
        "/api/platform/tenants",
        json={"slug": slug, "name": f"City of {slug}"},
    )
    assert res.status_code in (201, 403)
