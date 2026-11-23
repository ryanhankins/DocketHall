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

"""Phase 3 API tests: agendas, backlog, live meeting updates, and public/council endpoints."""

import uuid


def test_public_agenda_and_council_endpoints(anon_client, admin_client):
    assert anon_client.get("/api/agendas/public").status_code == 200
    assert anon_client.get("/api/agendas/council").status_code in (401, 403)
    assert anon_client.get("/api/agendas/council-members").status_code in (401, 403)
    assert admin_client.get("/api/agendas/council-members").status_code == 200
    assert anon_client.get("/api/agendas/ordinance-history").status_code in (401, 403)
    assert admin_client.get("/api/agendas/ordinance-history").status_code == 200


def test_agenda_and_backlog_crud_lifecycle(anon_client, applicant_client, admin_client):
    assert anon_client.get("/api/agendas").status_code in (401, 403)
    assert applicant_client.get("/api/agendas").status_code == 403

    assert admin_client.get("/api/agendas/preferences").status_code == 200
    assert admin_client.get("/api/agendas/templates").status_code == 200
    assert admin_client.get("/api/agendas/backlog").status_code == 200

    # Create backlog item
    bl_title = f"Test Backlog Item {uuid.uuid4().hex[:6]}"
    bl_res = admin_client.post(
        "/api/agendas/backlog",
        json={"title": bl_title, "description": "Testing backlog creation"},
    )
    assert bl_res.status_code == 201, bl_res.text
    bl_data = bl_res.json()
    bl_id = bl_data[0]["id"] if isinstance(bl_data, list) else bl_data["id"]

    prefs = admin_client.get("/api/agendas/preferences").json()
    governing_body = (prefs.get("bodies") or ["City Council"])[0]

    # Create agenda
    ag_res = admin_client.post(
        "/api/agendas",
        json={"title": f"Test Council Meeting {uuid.uuid4().hex[:6]}", "body": governing_body, "meeting_date": "2026-12-15"},
    )
    assert ag_res.status_code == 201, ag_res.text
    ag_id = ag_res.json()["id"]

    # Fetch agenda detail
    detail = admin_client.get(f"/api/agendas/{ag_id}")
    assert detail.status_code == 200

    # Add agenda item & update motion/vote state (Live Meeting workflow)
    item_res = admin_client.post(
        f"/api/agendas/{ag_id}/items",
        json={"title": "Approve Consent Calendar", "item_type": "action"},
    )
    assert item_res.status_code == 201, item_res.text
    item_data = item_res.json()
    item_id = (item_data.get("items") or [{}])[-1].get("id") or item_data["id"]

    patched_item = admin_client.patch(
        f"/api/agendas/{ag_id}/items/{item_id}",
        json={"motion": "Motion to approve", "seconded_by": "Member B", "vote_result": "Carried 5-0"},
    )
    assert patched_item.status_code == 200

    # Clean up agenda and backlog item
    assert admin_client.delete(f"/api/agendas/{ag_id}").status_code in (200, 204)
    assert admin_client.delete(f"/api/agendas/backlog/{bl_id}").status_code in (200, 204)


def test_legislative_doc_template_and_adopt_to_code(admin_client):
    # 1. List seeded document templates and create a custom one
    tpls_res = admin_client.get("/api/agendas/doc-templates")
    assert tpls_res.status_code == 200, tpls_res.text
    tpls = tpls_res.json()
    assert any(t["doc_kind"] == "ordinance" for t in tpls)
    assert any(t["doc_kind"] == "resolution" for t in tpls)

    custom_tpl = admin_client.post(
        "/api/agendas/doc-templates",
        json={
            "name": "Custom Zoning Ordinance",
            "doc_kind": "ordinance",
            "description": "Test template",
            "body_template": "AN ORDINANCE OF {{city_name}} ({{doc_number}}) FOR {{title}}.",
        },
    )
    assert custom_tpl.status_code == 201, custom_tpl.text
    custom_tpl_id = custom_tpl.json()["id"]

    # 2. Create an agenda + item, generate a PDF from the template
    ag = admin_client.post(
        "/api/agendas",
        json={"title": "Ordinance Adoption Meeting", "body": "City Council", "meeting_date": "2026-12-15"},
    ).json()
    ag_id = ag["id"]
    item_ag = admin_client.post(
        f"/api/agendas/{ag_id}/items",
        json={"title": "Short-Term Rental Regulations", "section": "New Business"},
    ).json()
    item_id = item_ag["items"][-1]["id"]

    gen_res = admin_client.post(
        f"/api/agendas/{ag_id}/items/{item_id}/generate-document",
        json={
            "doc_kind": "ordinance",
            "doc_number": "ORD-2026-88",
            "title": "Short-Term Rental Regulations",
            "body": custom_tpl.json()["body_template"],
            "effective_date": "2027-01-01",
        },
    )
    assert gen_res.status_code == 201, gen_res.text
    gen_item = next(i for i in gen_res.json()["items"] if i["id"] == item_id)
    assert gen_item["ordinance_number"] == "ORD-2026-88"
    assert len(gen_item["documents"]) == 1
    doc_id = gen_item["documents"][0]["id"]

    pdf_res = admin_client.get(f"/api/agendas/{ag_id}/documents/{doc_id}/download")
    assert pdf_res.status_code == 200
    assert pdf_res.content.startswith(b"%PDF")

    # 3. Adopt the ordinance into Codification and verify it is tagged in /api/codification/public
    ch = admin_client.post(
        "/api/codification/chapters",
        json={"code_prefix": "880", "title": "Rental Licensing", "is_published": True},
    ).json()
    adopt_res = admin_client.post(
        f"/api/agendas/{ag_id}/items/{item_id}/adopt-to-code",
        json={
            "chapter_id": ch["id"],
            "section_number": "880.01",
            "section_title": "Short-Term Rental Permits",
            "body": "All short-term rentals must hold an annual city permit.",
            "effective_date": "2027-01-01",
        },
    )
    assert adopt_res.status_code == 200, adopt_res.text
    adopt_data = adopt_res.json()
    assert adopt_data["status"] == "codified"
    assert adopt_data["ordinance_ref"] == "ORD-2026-88"

    pub_code = admin_client.get("/api/codification/public").json()["chapters"]
    target_ch = next(c for c in pub_code if c["id"] == ch["id"])
    tagged_sec = next(s for s in target_ch["sections"] if s["section_number"] == "880.01")
    assert tagged_sec["ordinance_ref"] == "ORD-2026-88"
    assert tagged_sec["effective_date"] == "2027-01-01"

    # Clean up custom template & agenda
    assert admin_client.delete(f"/api/agendas/doc-templates/{custom_tpl_id}").status_code == 200
    assert admin_client.delete(f"/api/agendas/{ag_id}").status_code in (200, 204)
