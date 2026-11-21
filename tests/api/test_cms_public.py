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
        "/api/forms",
        "/api/notices",
        "/api/subscriptions",
    )
    for path in admin_paths:
        assert anon_client.get(path).status_code in (401, 403), f"anon blocked on {path}"
        assert applicant_client.get(path).status_code == 403, f"applicant 403 on {path}"
        res = admin_client.get(path)
        assert res.status_code == 200, f"admin failed on {path}: {res.status_code} {res.text}"
