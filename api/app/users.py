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

"""Admin user management endpoints."""
import re
import secrets
from typing import Literal

from fastapi import APIRouter, Depends, HTTPException
from psycopg.errors import UniqueViolation
from psycopg.types.json import Jsonb
from pydantic import BaseModel

from .audit import record_audit
from .auth import effective_permissions, hash_password, require_admin, require_not_demo_mode
from .db import pool

UserRole = Literal["council_member", "admin_staff", "non_admin_staff", "applicant", "read_only"]
_USERNAME_RE = re.compile(r"^[a-zA-Z0-9._-]{2,64}$")

_LOWER = "abcdefghjkmnpqrstuvwxyz"
_UPPER = "ABCDEFGHJKLMNPQRSTUVWXYZ"
_DIGITS = "23456789"
_SYMBOLS = "!@#$%&*"
_ALL_CHARS = _LOWER + _UPPER + _DIGITS + _SYMBOLS


def generate_password(length: int = 14) -> str:
    """Generate a random password with guaranteed character-class diversity."""
    chars = [
        secrets.choice(_LOWER),
        secrets.choice(_UPPER),
        secrets.choice(_DIGITS),
        secrets.choice(_SYMBOLS),
    ] + [secrets.choice(_ALL_CHARS) for _ in range(length - 4)]
    for i in range(len(chars) - 1, 0, -1):
        j = secrets.randbelow(i + 1)
        chars[i], chars[j] = chars[j], chars[i]
    return "".join(chars)


def _row_to_user(row) -> dict:
    explicit = list(row[6]) if len(row) > 6 and row[6] else []
    email = row[7] if len(row) > 7 and row[7] else ""
    return {
        "id": row[0],
        "username": row[1],
        "role": row[2],
        "is_active": row[3],
        "created_at": row[4].isoformat() if row[4] else None,
        "last_login_at": row[5].isoformat() if row[5] else None,
        "permissions": explicit,
        "effective_permissions": effective_permissions(row[2], explicit),
        "email": email,
    }


router = APIRouter(prefix="/api/users", tags=["users"])


class CreateUserIn(BaseModel):
    username: str
    role: UserRole
    email: str = ""
    permissions: list[str] = []


class UpdateUserIn(BaseModel):
    is_active: bool | None = None
    role: UserRole | None = None
    email: str | None = None
    permissions: list[str] | None = None


@router.get("")
def list_users(_: dict = Depends(require_admin)):
    with pool.connection() as conn:
        rows = conn.execute(
            "SELECT id, username, role, is_active, created_at, last_login_at, permissions, email "
            "FROM users ORDER BY id"
        ).fetchall()
    return [_row_to_user(r) for r in rows]


@router.post("", status_code=201)
def create_user(body: CreateUserIn, admin: dict = Depends(require_admin)):
    username = body.username.strip()
    if not _USERNAME_RE.match(username):
        raise HTTPException(
            status_code=400,
            detail="Username must be 2-64 characters (letters, digits, ., _, -).",
        )
    clean_perms = sorted({str(p).strip() for p in body.permissions if str(p).strip()})
    password = generate_password()
    try:
        with pool.connection() as conn:
            row = conn.execute(
                "INSERT INTO users (username, email, password_hash, role, permissions) "
                "VALUES (%s, %s, %s, %s, %s) "
                "RETURNING id, username, role, is_active, created_at, last_login_at, permissions, email",
                (username, body.email.strip(), hash_password(password), body.role, Jsonb(clean_perms)),
            ).fetchone()
    except UniqueViolation:
        raise HTTPException(status_code=409, detail="Username already exists")

    user = _row_to_user(row)
    user["generated_password"] = password
    record_audit(admin["username"], "user.created", "users", user["id"], f"Created user '{username}' (role={body.role})")
    return user


@router.patch("/{user_id}")
def update_user(user_id: int, body: UpdateUserIn, admin: dict = Depends(require_admin)):
    require_not_demo_mode("Updating user accounts")
    if body.is_active is None and body.role is None and body.email is None and body.permissions is None:
        raise HTTPException(status_code=400, detail="No fields to update")
    if user_id == admin["id"]:
        if body.is_active is False:
            raise HTTPException(status_code=400, detail="Cannot disable your own account")
        if body.role is not None:
            raise HTTPException(status_code=400, detail="Cannot change your own role")

    with pool.connection() as conn:
        existing = conn.execute(
            "SELECT id, role FROM users WHERE id = %s", (user_id,)
        ).fetchone()
        if not existing:
            raise HTTPException(status_code=404, detail="User not found")
        if existing[1] == "admin" and body.role is not None:
            raise HTTPException(status_code=400, detail="Cannot change admin role")

        perms_param = (
            Jsonb(sorted({str(p).strip() for p in body.permissions if str(p).strip()}))
            if body.permissions is not None
            else None
        )
        row = conn.execute(
            "UPDATE users SET "
            "is_active = COALESCE(%s, is_active), "
            "role = COALESCE(%s, role), "
            "email = COALESCE(%s, email), "
            "permissions = COALESCE(%s, permissions) "
            "WHERE id = %s "
            "RETURNING id, username, role, is_active, created_at, last_login_at, permissions, email",
            (body.is_active, body.role, body.email.strip() if body.email is not None else None, perms_param, user_id),
        ).fetchone()
        if body.is_active is False:
            conn.execute("DELETE FROM sessions WHERE user_id = %s", (user_id,))
    updated = _row_to_user(row)
    record_audit(admin["username"], "user.updated", "users", user_id, f"Updated user '{updated['username']}' (role={updated['role']}, active={updated['is_active']})")
    return updated


@router.post("/{user_id}/reset-password")
def reset_password(user_id: int, admin: dict = Depends(require_admin)):
    require_not_demo_mode("Resetting user passwords")
    password = generate_password()
    with pool.connection() as conn:
        row = conn.execute(
            "UPDATE users SET password_hash = %s, is_default_password = FALSE WHERE id = %s RETURNING id, username",
            (hash_password(password), user_id),
        ).fetchone()
        if not row:
            raise HTTPException(status_code=404, detail="User not found")
        conn.execute("DELETE FROM sessions WHERE user_id = %s", (user_id,))
    record_audit(admin["username"], "user.password_reset", "users", row[0], f"Reset password for '{row[1]}'")
    return {"id": row[0], "username": row[1], "generated_password": password}


@router.delete("/{user_id}")
def delete_user(user_id: int, admin: dict = Depends(require_admin)):
    require_not_demo_mode("Deleting user accounts")
    if user_id == admin["id"]:
        raise HTTPException(status_code=400, detail="Cannot remove your own account")
    with pool.connection() as conn:
        row = conn.execute(
            "DELETE FROM users WHERE id = %s RETURNING id, username", (user_id,)
        ).fetchone()
        if not row:
            raise HTTPException(status_code=404, detail="User not found")
    record_audit(admin["username"], "user.deleted", "users", user_id, f"Deleted user '{row[1]}'")
    return {"deleted": True, "id": user_id}
