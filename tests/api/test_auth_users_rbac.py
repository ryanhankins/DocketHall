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

"""Phase 2 API tests: authentication, session lifecycle, my-account, and Users/RBAC."""

import uuid


def test_login_logout_and_me_lifecycle(anon_client):
    # Unauthenticated /api/me -> 401
    assert anon_client.get("/api/me").status_code == 401

    # Invalid password -> 401
    bad = anon_client.post("/api/login", json={"username": "admin", "password": "wrong-password-123"})
    assert bad.status_code == 401

    # Valid admin login -> 200 + session cookie -> /api/me succeeds
    ok = anon_client.post("/api/login", json={"username": "admin", "password": "admin"})
    assert ok.status_code == 200
    me = anon_client.get("/api/me")
    assert me.status_code == 200
    assert me.json()["username"] == "admin"

    # Logout clears session
    out = anon_client.post("/api/logout")
    assert out.status_code == 200
    assert anon_client.get("/api/me").status_code == 401


def test_register_validation_and_duplicate_rejection(anon_client):
    bad_user = anon_client.post(
        "/api/register",
        json={"username": "bad user!", "email": "x@example.com", "password": "StrongPassword123!"},
    )
    assert bad_user.status_code == 400

    short_pw = anon_client.post(
        "/api/register",
        json={"username": f"user_{uuid.uuid4().hex[:8]}", "email": "x@example.com", "password": "short"},
    )
    assert short_pw.status_code == 400

    uname = f"resident_{uuid.uuid4().hex[:8]}"
    created = anon_client.post(
        "/api/register",
        json={"username": uname, "email": f"{uname}@example.com", "password": "StrongPassword123!"},
    )
    assert created.status_code == 201

    dup = anon_client.post(
        "/api/register",
        json={"username": uname, "email": f"{uname}@example.com", "password": "StrongPassword123!"},
    )
    assert dup.status_code in (400, 409)


def test_my_account_summary_and_profile(applicant_client, anon_client):
    assert anon_client.get("/api/my-account/summary").status_code in (401, 403)

    summary = applicant_client.get("/api/my-account/summary")
    assert summary.status_code == 200

    upd = applicant_client.put(
        "/api/my-account/profile",
        json={"email": "updated_resident@example.com"},
    )
    assert upd.status_code == 200


def test_users_crud_and_rbac_boundaries(anon_client, applicant_client, admin_client):
    # Anonymous & non-admin users cannot access /api/users
    assert anon_client.get("/api/users").status_code in (401, 403)
    assert applicant_client.get("/api/users").status_code == 403
    assert applicant_client.post(
        "/api/users",
        json={"username": "evil_admin", "role": "admin", "email": "evil@example.com"},
    ).status_code == 403

    # Admin creates a staff user
    staff_name = f"clerk_{uuid.uuid4().hex[:8]}"
    created = admin_client.post(
        "/api/users",
        json={"username": staff_name, "role": "staff", "email": f"{staff_name}@city.gov", "permissions": ["agendas.manage"]},
    )
    assert created.status_code == 201
    user_obj = created.json()
    uid = user_obj["id"]
    assert user_obj["generated_password"]

    # List users includes new user
    listed = admin_client.get("/api/users")
    assert listed.status_code == 200
    assert any(u["id"] == uid for u in listed.json())

    # Update user permissions/status
    patched = admin_client.patch(f"/api/users/{uid}", json={"is_active": False})
    assert patched.status_code == 200
    assert patched.json()["is_active"] is False

    # Reset password
    reset = admin_client.post(f"/api/users/{uid}/reset-password")
    assert reset.status_code == 200
    assert reset.json().get("generated_password")

    # Delete user
    deleted = admin_client.delete(f"/api/users/{uid}")
    assert deleted.status_code in (200, 204)
