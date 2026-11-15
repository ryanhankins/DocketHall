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

"""Users, password hashing and cookie sessions."""
import base64
import hashlib
import hmac
import os
import secrets
from datetime import timedelta

from fastapi import APIRouter, HTTPException, Request, Response
from pydantic import BaseModel

from .db import pool

SESSION_COOKIE = "cg_session"
SESSION_TTL = timedelta(hours=int(os.environ.get("SESSION_TTL_HOURS", "8")))
COOKIE_SECURE = os.environ.get("COOKIE_SECURE", "false").lower() == "true"
PBKDF2_ITERATIONS = 600_000

SCHEMA = """
CREATE TABLE IF NOT EXISTS users (
    id             BIGSERIAL PRIMARY KEY,
    username       TEXT NOT NULL UNIQUE,
    password_hash  TEXT NOT NULL,
    role           TEXT NOT NULL DEFAULT 'read_only',
    is_active      BOOLEAN NOT NULL DEFAULT TRUE,
    created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
    last_login_at  TIMESTAMPTZ
);
ALTER TABLE users ADD COLUMN IF NOT EXISTS role TEXT NOT NULL DEFAULT 'read_only';
CREATE TABLE IF NOT EXISTS sessions (
    token_hash  TEXT PRIMARY KEY,          -- sha256 of the cookie value; raw token never stored
    user_id     BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    expires_at  TIMESTAMPTZ NOT NULL
);
CREATE INDEX IF NOT EXISTS sessions_user_id_idx ON sessions(user_id);
"""


# ------------------------------------------------------------------ passwords
def hash_password(password: str) -> str:
    salt = secrets.token_bytes(16)
    dk = hashlib.pbkdf2_hmac("sha256", password.encode(), salt, PBKDF2_ITERATIONS)
    b64 = lambda b: base64.b64encode(b).decode()
    return f"pbkdf2_sha256${PBKDF2_ITERATIONS}${b64(salt)}${b64(dk)}"


def verify_password(password: str, stored: str) -> bool:
    try:
        algo, iters, salt_b64, hash_b64 = stored.split("$")
        if algo != "pbkdf2_sha256":
            return False
        dk = hashlib.pbkdf2_hmac(
            "sha256", password.encode(), base64.b64decode(salt_b64), int(iters)
        )
        return hmac.compare_digest(dk, base64.b64decode(hash_b64))
    except Exception:
        return False


_DUMMY_HASH = hash_password(secrets.token_hex(8))  # equalises timing for unknown users


def _token_hash(token: str) -> str:
    return hashlib.sha256(token.encode()).hexdigest()


# ------------------------------------------------------------------ bootstrap
def bootstrap() -> None:
    """Create auth tables and seed the default admin user if it doesn't exist."""
    with pool.connection() as conn:
        conn.execute("SELECT pg_advisory_xact_lock(424242)")  # safe with >1 replica
        conn.execute(SCHEMA)
        existing_admin = conn.execute(
            "SELECT role FROM users WHERE username = 'admin'"
        ).fetchone()
        if not existing_admin:
            conn.execute(
                "INSERT INTO users (username, password_hash, role) VALUES (%s, %s, 'admin')",
                ("admin", hash_password("admin")),
            )
        elif existing_admin[0] != "admin":
            conn.execute("UPDATE users SET role = 'admin' WHERE username = 'admin'")
        conn.execute("UPDATE users SET role = 'admin_staff' WHERE role = 'staff_member'")
        conn.execute("DELETE FROM sessions WHERE expires_at < now()")


# ------------------------------------------------------------------ routes
router = APIRouter(prefix="/api")


class LoginIn(BaseModel):
    username: str
    password: str


class ChangePasswordIn(BaseModel):
    current_password: str
    new_password: str


def current_user(request: Request) -> dict | None:
    token = request.cookies.get(SESSION_COOKIE)
    if not token:
        return None
    with pool.connection() as conn:
        row = conn.execute(
            "SELECT u.id, u.username, u.role FROM sessions s JOIN users u ON u.id = s.user_id "
            "WHERE s.token_hash = %s AND s.expires_at > now() AND u.is_active",
            (_token_hash(token),),
        ).fetchone()
    return {"id": row[0], "username": row[1], "role": row[2]} if row else None


def require_admin(request: Request) -> dict:
    user = current_user(request)
    if not user:
        raise HTTPException(status_code=401, detail="Not authenticated")
    if user["role"] != "admin":
        raise HTTPException(status_code=403, detail="Admin access required")
    return user


@router.post("/login")
def login(body: LoginIn, response: Response):
    with pool.connection() as conn:
        row = conn.execute(
            "SELECT id, password_hash FROM users WHERE username = %s AND is_active",
            (body.username,),
        ).fetchone()
        ok = verify_password(body.password, row[1] if row else _DUMMY_HASH)
        if not (row and ok):
            raise HTTPException(status_code=401, detail="Invalid username or password")

        token = secrets.token_urlsafe(32)
        conn.execute(
            "INSERT INTO sessions (token_hash, user_id, expires_at) "
            "VALUES (%s, %s, now() + %s)",
            (_token_hash(token), row[0], SESSION_TTL),
        )
        conn.execute("UPDATE users SET last_login_at = now() WHERE id = %s", (row[0],))

    response.set_cookie(
        SESSION_COOKIE, token,
        max_age=int(SESSION_TTL.total_seconds()),
        httponly=True, secure=COOKIE_SECURE, samesite="strict", path="/",
    )
    return {"username": body.username}


@router.post("/logout")
def logout(request: Request, response: Response):
    token = request.cookies.get(SESSION_COOKIE)
    if token:
        with pool.connection() as conn:
            conn.execute("DELETE FROM sessions WHERE token_hash = %s", (_token_hash(token),))
    response.delete_cookie(SESSION_COOKIE, path="/")
    return {"ok": True}


@router.get("/me")
def me(request: Request):
    """Also used by nginx auth_request to guard internal pages (2xx = allowed)."""
    user = current_user(request)
    if not user:
        raise HTTPException(status_code=401, detail="Not authenticated")
    return user


@router.post("/change-password")
def change_password(body: ChangePasswordIn, request: Request):
    """Allow any logged-in user to change only their own password."""
    user = current_user(request)
    if not user:
        raise HTTPException(status_code=401, detail="Not authenticated")
    if len(body.new_password) < 8:
        raise HTTPException(
            status_code=400, detail="New password must be at least 8 characters"
        )
    if body.new_password == body.current_password:
        raise HTTPException(
            status_code=400, detail="New password must differ from current password"
        )

    token = request.cookies.get(SESSION_COOKIE, "")
    with pool.connection() as conn:
        row = conn.execute(
            "SELECT password_hash FROM users WHERE id = %s AND is_active",
            (user["id"],),
        ).fetchone()
        if not (row and verify_password(body.current_password, row[0])):
            raise HTTPException(status_code=400, detail="Current password is incorrect")
        conn.execute(
            "UPDATE users SET password_hash = %s WHERE id = %s",
            (hash_password(body.new_password), user["id"]),
        )
        # Keep the current session alive; revoke any other active sessions.
        conn.execute(
            "DELETE FROM sessions WHERE user_id = %s AND token_hash <> %s",
            (user["id"], _token_hash(token)),
        )
    return {"ok": True}
