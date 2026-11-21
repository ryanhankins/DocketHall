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

"""Phase 1 API integration sanity tests exercising the conftest Postgres + TestClient harness."""


def test_health_and_public_modules(anon_client):
    res = anon_client.get("/api/health")
    assert res.status_code == 200
    assert res.json()["status"] == "ok"

    mods = anon_client.get("/api/modules/public")
    assert mods.status_code == 200
    assert "enabled" in mods.json()


def test_admin_launch_readiness_and_auth_boundary(anon_client, admin_client):
    unauth = anon_client.get("/api/backup/readiness")
    assert unauth.status_code in (401, 403)

    ready = admin_client.get("/api/backup/readiness")
    assert ready.status_code == 200
    body = ready.json()
    assert "checks" in body
    assert isinstance(body["checks"], list)
