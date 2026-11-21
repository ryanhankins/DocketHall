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


def test_public_agenda_and_council_endpoints(anon_client):
    assert anon_client.get("/api/agendas/public").status_code == 200
    assert anon_client.get("/api/agendas/council").status_code == 200
    assert anon_client.get("/api/agendas/council-members").status_code == 200
    assert anon_client.get("/api/agendas/ordinance-history").status_code == 200


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
    bl_id = bl_res.json()["id"]

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
    item_id = item_res.json()["id"]

    patched_item = admin_client.patch(
        f"/api/agendas/{ag_id}/items/{item_id}",
        json={"motion": "Motion to approve", "seconded_by": "Member B", "vote_result": "Carried 5-0"},
    )
    assert patched_item.status_code == 200

    # Clean up agenda and backlog item
    assert admin_client.delete(f"/api/agendas/{ag_id}").status_code in (200, 204)
    assert admin_client.delete(f"/api/agendas/backlog/{bl_id}").status_code in (200, 204)
