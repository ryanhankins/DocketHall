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

"""Phase 3 API tests: complaints/311, records/FOIA, and codification."""

import uuid


def test_complaints_and_work_orders_endpoints(anon_client, applicant_client, admin_client):
    assert anon_client.get("/api/complaints/public-log").status_code == 200
    assert anon_client.get("/api/complaints").status_code in (401, 403)
    assert applicant_client.get("/api/complaints").status_code == 403

    assert admin_client.get("/api/complaints").status_code == 200
    assert admin_client.get("/api/complaints/settings").status_code == 200
    assert admin_client.get("/api/complaints/work-orders").status_code == 200
    assert admin_client.get("/api/complaints/reinspections/queue").status_code == 200

    wo = admin_client.post(
        "/api/complaints/work-orders",
        json={"title": f"Pothole {uuid.uuid4().hex[:6]}", "location": "1st & Main", "priority": "normal"},
    )
    assert wo.status_code == 201, wo.text
    wo_id = wo.json()["id"]
    assert admin_client.delete(f"/api/complaints/work-orders/{wo_id}").status_code in (200, 204)


def test_records_and_foia_endpoints(anon_client, applicant_client, admin_client):
    assert anon_client.get("/api/records/public").status_code == 200
    assert anon_client.get("/api/records/requests").status_code in (401, 403)
    assert applicant_client.get("/api/records/requests").status_code == 403

    assert admin_client.get("/api/records").status_code == 200
    assert admin_client.get("/api/records/requests").status_code == 200

    foia = anon_client.post(
        "/api/records/requests/public",
        json={
            "requester_name": "Jane Resident",
            "requester_email": "jane@example.com",
            "description": "Public works budget 2026",
        },
    )
    assert foia.status_code == 201, foia.text
    req_id = foia.json()["id"]
    assert admin_client.delete(f"/api/records/requests/{req_id}").status_code in (200, 204)


def test_codification_public_pdf_and_admin_crud(anon_client, applicant_client, admin_client):
    assert anon_client.get("/api/codification/public").status_code == 200
    pdf_res = anon_client.get("/api/codification/public/full.pdf")
    assert pdf_res.status_code == 200
    assert pdf_res.content[:4] == b"%PDF"

    assert anon_client.get("/api/codification/admin").status_code in (401, 403)
    assert applicant_client.get("/api/codification/admin").status_code == 403
    assert admin_client.get("/api/codification/admin").status_code == 200

    ch_num = f"99{uuid.uuid4().hex[:3]}"
    ch = admin_client.post(
        "/api/codification/chapters",
        json={"chapter_number": ch_num, "title": "Test Chapter"},
    )
    assert ch.status_code == 201, ch.text
    ch_id = ch.json()["id"]
    assert admin_client.delete(f"/api/codification/chapters/{ch_id}").status_code in (200, 204)
