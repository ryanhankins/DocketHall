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
from pydantic import BaseModel

from .auth import hash_password, require_admin
from .db import pool

UserRole = Literal["council_member", "staff_member", "read_only"]
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
    return {
        "id": row[0],
        "username": row[1],
        "role": row[2],
        "is_active": row[3],
        "created_at": row[4].isoformat() if row[4] else None,
        "last_login_at": row[5].isoformat() if row[5] else None,
    }


router = APIRouter(prefix="/api/users", tags=["users"])


class CreateUserIn(BaseModel):
    username: str
    role: UserRole


class UpdateUserIn(BaseModel):
    is_active: bool | None = None
    role: UserRole | None = None


@router.get("")
def list_users(_: dict = Depends(require_admin)):
    with pool.connection() as conn:
        rows = conn.execute(
            "SELECT id, username, role, is_active, created_at, last_login_at "
            "FROM users ORDER BY id"
        ).fetchall()
    return [_row_to_user(r) for r in rows]


@router.post("", status_code=201)
def create_user(body: CreateUserIn, _: dict = Depends(require_admin)):
    username = body.username.strip()
    if not _USERNAME_RE.match(username):
        raise HTTPException(
            status_code=400,
            detail="Username must be 2-64 characters (letters, digits, ., _, -).",
        )
    password = generate_password()
    try:
        with pool.connection() as conn:
            row = conn.execute(
                "INSERT INTO users (username, password_hash, role) "
                "VALUES (%s, %s, %s) "
                "RETURNING id, username, role, is_active, created_at, last_login_at",
                (username, hash_password(password), body.role),
            ).fetchone()
    except UniqueViolation:
        raise HTTPException(status_code=409, detail="Username already exists")

    user = _row_to_user(row)
    user["generated_password"] = password
    return user


@router.patch("/{user_id}")
def update_user(user_id: int, body: UpdateUserIn, admin: dict = Depends(require_admin)):
    if body.is_active is None and body.role is None:
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

        row = conn.execute(
            "UPDATE users SET "
            "is_active = COALESCE(%s, is_active), "
            "role = COALESCE(%s, role) "
            "WHERE id = %s "
            "RETURNING id, username, role, is_active, created_at, last_login_at",
            (body.is_active, body.role, user_id),
        ).fetchone()
        if body.is_active is False:
            conn.execute("DELETE FROM sessions WHERE user_id = %s", (user_id,))
    return _row_to_user(row)


@router.post("/{user_id}/reset-password")
def reset_password(user_id: int, _: dict = Depends(require_admin)):
    password = generate_password()
    with pool.connection() as conn:
        row = conn.execute(
            "UPDATE users SET password_hash = %s WHERE id = %s RETURNING id, username",
            (hash_password(password), user_id),
        ).fetchone()
        if not row:
            raise HTTPException(status_code=404, detail="User not found")
        conn.execute("DELETE FROM sessions WHERE user_id = %s", (user_id,))
    return {"id": row[0], "username": row[1], "generated_password": password}


@router.delete("/{user_id}")
def delete_user(user_id: int, admin: dict = Depends(require_admin)):
    if user_id == admin["id"]:
        raise HTTPException(status_code=400, detail="Cannot remove your own account")
    with pool.connection() as conn:
        row = conn.execute(
            "DELETE FROM users WHERE id = %s RETURNING id", (user_id,)
        ).fetchone()
        if not row:
            raise HTTPException(status_code=404, detail="User not found")
    return {"deleted": True, "id": user_id}
