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

"""Phase 3 API tests: blog, pages, calendar, directory, forms, notices, search, and subscriptions."""


def test_public_cms_search_and_feeds(anon_client):
    for path in (
        "/api/blog/public",
        "/api/pages/public",
        "/api/calendar/public",
        "/api/directory/public",
        "/api/forms/public",
        "/api/notices/public",
        "/api/public/search?q=council",
        "/api/public/transparency",
        "/api/public/performance",
        "/api/subscriptions/topics",
    ):
        res = anon_client.get(path)
        assert res.status_code == 200, f"{path} failed: {res.status_code} {res.text}"

    rss = anon_client.get("/api/blog/rss.xml")
    assert rss.status_code == 200
    assert b"<rss" in rss.content

    ics = anon_client.get("/api/calendar/public/ics?kind=event&item_id=1")
    assert ics.status_code in (200, 404)
    if ics.status_code == 200:
        assert b"BEGIN:VCALENDAR" in ics.content

    perf_csv = anon_client.get("/api/public/performance.csv")
    assert perf_csv.status_code == 200
    assert "text/csv" in perf_csv.headers.get("content-type", "")


def test_admin_cms_reads_and_rbac(anon_client, applicant_client, admin_client):
    admin_paths = (
        "/api/blog/categories",
        "/api/blog/posts",
        "/api/blog/comments",
        "/api/pages",
        "/api/pages/quick-links",
        "/api/calendar/facilities",
        "/api/calendar/reservations",
        "/api/calendar/events",
        "/api/directory/contacts",
        "/api/directory/faqs",
        "/api/directory/resources",
        "/api/directory/boards",
        "/api/directory/locations",
        "/api/forms",
        "/api/notices",
        "/api/subscriptions",
    )
    for path in admin_paths:
        assert anon_client.get(path).status_code in (401, 403), f"anon blocked on {path}"
        assert applicant_client.get(path).status_code == 403, f"applicant 403 on {path}"
        res = admin_client.get(path)
        assert res.status_code == 200, f"admin failed on {path}: {res.status_code} {res.text}"


def test_directory_locations_crud_and_public(admin_client, anon_client):
    pub_before = anon_client.get("/api/directory/locations/public")
    assert pub_before.status_code == 200
    assert len(pub_before.json()) >= 1

    created = admin_client.post(
        "/api/directory/locations",
        json={
            "name": "Pine Ridge Nature Trail",
            "category": "Park & Trail",
            "address": "700 Pine Ridge Rd",
            "hours": "Dawn to Dusk",
            "amenities": "Trailhead, Restrooms, Bike Rack",
            "ada_accessible": True,
        },
    )
    assert created.status_code == 201, created.text
    loc_id = created.json()["id"]

    pub_dir = anon_client.get("/api/directory/public?q=Pine+Ridge").json()
    assert any(loc["id"] == loc_id for loc in pub_dir["locations"])

    patched = admin_client.patch(f"/api/directory/locations/{loc_id}", json={"hours": "Daily 6am-9pm"})
    assert patched.status_code == 200
    assert patched.json()["hours"] == "Daily 6am-9pm"

    assert admin_client.delete(f"/api/directory/locations/{loc_id}").status_code == 200
