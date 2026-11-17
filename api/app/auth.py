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

from fastapi import APIRouter, Depends, HTTPException, Request, Response
from pydantic import BaseModel

from .db import pool

SESSION_COOKIE = "cg_session"
SESSION_TTL = timedelta(hours=int(os.environ.get("SESSION_TTL_HOURS", "8")))
COOKIE_SECURE = os.environ.get("COOKIE_SECURE", "false").lower() == "true"
PBKDF2_ITERATIONS = 600_000

ROLE_PRESET_PERMISSIONS: dict[str, list[str]] = {
    "admin": ["*"],
    "admin_staff": [
        "agendas.manage", "permits.manage", "codification.manage",
        "records.manage", "records.view",
        "complaints.manage", "complaints.submit", "complaints.log",
        "settings.manage",
    ],
    "council_member": ["agendas.submit", "complaints.submit", "complaints.log"],
    "non_admin_staff": ["agendas.submit", "complaints.submit", "complaints.log"],
    "applicant": ["permits.submit", "complaints.submit", "complaints.log"],
    "read_only": ["complaints.log"],
}


def effective_permissions(role: str, explicit: list[str] | None = None) -> list[str]:
    """Return sorted unique permissions combining role presets and explicit user grants."""
    perms = set(ROLE_PRESET_PERMISSIONS.get(role, []))
    if explicit:
        perms.update(str(p).strip() for p in explicit if str(p).strip())
    return sorted(perms)


def has_permission(user: dict, perm: str) -> bool:
    perms = user.get("permissions") or []
    return "*" in perms or perm in perms

SCHEMA = """
CREATE TABLE IF NOT EXISTS users (
    id             BIGSERIAL PRIMARY KEY,
    username       TEXT NOT NULL UNIQUE,
    email          TEXT NOT NULL DEFAULT '',
    password_hash  TEXT NOT NULL,
    role           TEXT NOT NULL DEFAULT 'read_only',
    permissions         JSONB NOT NULL DEFAULT '[]'::jsonb,
    is_active           BOOLEAN NOT NULL DEFAULT TRUE,
    is_default_password BOOLEAN NOT NULL DEFAULT FALSE,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
    last_login_at       TIMESTAMPTZ
);
ALTER TABLE users ADD COLUMN IF NOT EXISTS role TEXT NOT NULL DEFAULT 'read_only';
ALTER TABLE users ADD COLUMN IF NOT EXISTS permissions JSONB NOT NULL DEFAULT '[]'::jsonb;
ALTER TABLE users ADD COLUMN IF NOT EXISTS email TEXT NOT NULL DEFAULT '';
ALTER TABLE users ADD COLUMN IF NOT EXISTS is_default_password BOOLEAN NOT NULL DEFAULT FALSE;
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
            "SELECT role, password_hash FROM users WHERE username = 'admin'"
        ).fetchone()
        if not existing_admin:
            conn.execute(
                "INSERT INTO users (username, password_hash, role, is_default_password) "
                "VALUES (%s, %s, 'admin', TRUE)",
                ("admin", hash_password("admin")),
            )
        else:
            if existing_admin[0] != "admin":
                conn.execute("UPDATE users SET role = 'admin' WHERE username = 'admin'")
            is_def = verify_password("admin", existing_admin[1])
            conn.execute(
                "UPDATE users SET is_default_password = %s WHERE username = 'admin'",
                (is_def,),
            )
        conn.execute("UPDATE users SET role = 'admin_staff' WHERE role = 'staff_member'")
        conn.execute("DELETE FROM sessions WHERE expires_at < now()")


# ------------------------------------------------------------------ routes
router = APIRouter(prefix="/api")


class LoginIn(BaseModel):
    username: str
    password: str


class RegisterIn(BaseModel):
    username: str
    password: str
    email: str = ""


class ChangePasswordIn(BaseModel):
    current_password: str
    new_password: str


def current_user(request: Request) -> dict | None:
    token = request.cookies.get(SESSION_COOKIE)
    if not token:
        return None
    with pool.connection() as conn:
        row = conn.execute(
            "SELECT u.id, u.username, u.role, u.permissions, u.email, u.is_default_password "
            "FROM sessions s JOIN users u ON u.id = s.user_id "
            "WHERE s.token_hash = %s AND s.expires_at > now() AND u.is_active",
            (_token_hash(token),),
        ).fetchone()
    if not row:
        return None
    explicit = list(row[3]) if row[3] else []
    return {
        "id": row[0],
        "username": row[1],
        "role": row[2],
        "email": row[4] or "",
        "is_default_password": bool(row[5]),
        "permissions": effective_permissions(row[2], explicit),
    }


def require_admin(request: Request) -> dict:
    user = current_user(request)
    if not user:
        raise HTTPException(status_code=401, detail="Not authenticated")
    if user["role"] != "admin":
        raise HTTPException(status_code=403, detail="Admin access required")
    return user


def require_permission(*perms: str):
    """FastAPI dependency requiring at least one of the specified permissions."""
    def _dep(request: Request) -> dict:
        user = current_user(request)
        if not user:
            raise HTTPException(status_code=401, detail="Not authenticated")
        if not any(has_permission(user, p) for p in perms):
            raise HTTPException(status_code=403, detail="Insufficient permissions")
        return user
    return _dep


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


@router.post("/register", status_code=201)
def register(body: RegisterIn, response: Response):
    """Self-service registration for citizen/contractor permit applicants."""
    import re
    from psycopg.errors import UniqueViolation

    username = body.username.strip()
    if not re.match(r"^[a-zA-Z0-9._-]{2,64}$", username):
        raise HTTPException(
            status_code=400,
            detail="Username must be 2-64 characters (letters, digits, ., _, -).",
        )
    if len(body.password) < 8:
        raise HTTPException(status_code=400, detail="Password must be at least 8 characters")

    try:
        with pool.connection() as conn:
            row = conn.execute(
                "INSERT INTO users (username, email, password_hash, role) "
                "VALUES (%s, %s, %s, 'applicant') RETURNING id",
                (username, body.email.strip(), hash_password(body.password)),
            ).fetchone()
            token = secrets.token_urlsafe(32)
            conn.execute(
                "INSERT INTO sessions (token_hash, user_id, expires_at) "
                "VALUES (%s, %s, now() + %s)",
                (_token_hash(token), row[0], SESSION_TTL),
            )
    except UniqueViolation:
        raise HTTPException(status_code=409, detail="Username is already taken")

    response.set_cookie(
        SESSION_COOKIE, token,
        max_age=int(SESSION_TTL.total_seconds()),
        httponly=True, secure=COOKIE_SECURE, samesite="strict", path="/",
    )
    return {"username": username, "role": "applicant"}


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
            "UPDATE users SET password_hash = %s, is_default_password = %s WHERE id = %s",
            (hash_password(body.new_password), body.new_password == "admin", user["id"]),
        )
        # Keep the current session alive; revoke any other active sessions.
        conn.execute(
            "DELETE FROM sessions WHERE user_id = %s AND token_hash <> %s",
            (user["id"], _token_hash(token)),
        )
    return {"ok": True}
