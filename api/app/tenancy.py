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

"""Schema-per-tenant resolution, context management, and tenant provisioning."""
from contextlib import contextmanager
from contextvars import ContextVar
import hmac
import os
import re
from typing import Callable

from fastapi import APIRouter, Depends, Header, HTTPException
from psycopg import sql
from pydantic import BaseModel

from .db import raw_connection

_SLUG_RE = re.compile(r"^[a-z][a-z0-9_]{1,39}$")
_SCHEMA_RE = re.compile(r"^(public|tenant_[a-z][a-z0-9_]{1,39})$")
_RESERVED_SLUGS = {"default", "public", "pg_catalog", "information_schema", "platform", "admin"}

_current_slug: ContextVar[str] = ContextVar("civicdesk_tenant_slug", default="default")
_current_schema: ContextVar[str] = ContextVar("civicdesk_tenant_schema", default="public")

_bootstrap_schema_cb: Callable[[str, str], None] | None = None

SCHEMA = """
CREATE TABLE IF NOT EXISTS public.platform_tenants (
    slug          TEXT PRIMARY KEY,
    schema_name   TEXT NOT NULL UNIQUE,
    display_name  TEXT NOT NULL DEFAULT '',
    custom_domain TEXT NOT NULL DEFAULT '',
    status        TEXT NOT NULL DEFAULT 'active',
    created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS platform_tenants_domain_idx
    ON public.platform_tenants(lower(custom_domain))
    WHERE custom_domain <> '';
"""


def is_multi_tenant() -> bool:
    return os.environ.get("MULTI_TENANT", "false").strip().lower() == "true"


def get_current_tenant_slug() -> str:
    return _current_slug.get()


def get_current_tenant_schema() -> str:
    schema = _current_schema.get()
    if not _SCHEMA_RE.match(schema):
        raise RuntimeError(f"Invalid tenant schema name: {schema!r}")
    return schema


@contextmanager
def tenant_context(slug: str, schema: str):
    if not _SCHEMA_RE.match(schema):
        raise ValueError(f"Invalid tenant schema name: {schema!r}")
    tok_slug = _current_slug.set(slug)
    tok_schema = _current_schema.set(schema)
    try:
        yield
    finally:
        _current_schema.reset(tok_schema)
        _current_slug.reset(tok_slug)


def validate_tenant_slug(slug: str) -> str:
    clean = (slug or "").strip().lower().replace("-", "_")
    if clean in _RESERVED_SLUGS or not _SLUG_RE.match(clean):
        raise HTTPException(
            status_code=400,
            detail="Tenant slug must be 2-40 lowercase letters, digits, or underscores, starting with a letter.",
        )
    return clean


def schema_for_slug(slug: str) -> str:
    if slug == "default":
        return "public"
    return f"tenant_{slug}"


def tenant_object_key(key: str) -> str:
    """Prefix S3 object keys with tenants/<slug>/ in multi-tenant schemas."""
    clean = (key or "").lstrip("/")
    if not clean:
        return ""
    slug = get_current_tenant_slug()
    if slug == "default":
        return clean
    prefix = f"tenants/{slug}/"
    return clean if clean.startswith(prefix) else f"{prefix}{clean}"


def strip_tenant_prefix(key: str) -> str:
    """Strip any tenants/<slug>/ prefix so backups can be restored across tenants."""
    clean = (key or "").lstrip("/")
    if clean.startswith("tenants/"):
        parts = clean.split("/", 2)
        if len(parts) == 3:
            return parts[2]
    return clean


def register_schema_bootstrapper(fn: Callable[[str, str], None]) -> None:
    global _bootstrap_schema_cb
    _bootstrap_schema_cb = fn


def bootstrap() -> None:
    with raw_connection() as conn:
        conn.execute("SELECT pg_advisory_xact_lock(424299)")
        conn.execute(SCHEMA)
        conn.execute(
            "INSERT INTO public.platform_tenants (slug, schema_name, display_name, status) "
            "VALUES ('default', 'public', 'Default City', 'active') "
            "ON CONFLICT (slug) DO NOTHING"
        )


def list_active_tenants() -> list[tuple[str, str]]:
    with raw_connection() as conn:
        rows = conn.execute(
            "SELECT slug, schema_name FROM public.platform_tenants "
            "WHERE status = 'active' ORDER BY (slug <> 'default'), slug"
        ).fetchall()
    return [(r[0], r[1]) for r in rows]


def _normalize_host(raw_host: str) -> str:
    host = (raw_host or "").split(",")[0].strip().lower()
    if ":" in host:
        host = host.split(":", 1)[0]
    return host


def resolve_tenant_for_request(raw_host: str, header_slug: str = "") -> tuple[str, str] | None:
    if not is_multi_tenant():
        return ("default", "public")

    if header_slug and os.environ.get("ALLOW_TENANT_HEADER", "false").strip().lower() == "true":
        clean_hdr = header_slug.strip().lower().replace("-", "_")
        if clean_hdr == "default":
            return ("default", "public")
        if _SLUG_RE.match(clean_hdr):
            with raw_connection() as conn:
                row = conn.execute(
                    "SELECT slug, schema_name FROM public.platform_tenants "
                    "WHERE slug = %s AND status = 'active'",
                    (clean_hdr,),
                ).fetchone()
            if row:
                return (row[0], row[1])
            return None

    host = _normalize_host(raw_host)
    if not host:
        return ("default", "public")

    with raw_connection() as conn:
        row = conn.execute(
            "SELECT slug, schema_name FROM public.platform_tenants "
            "WHERE lower(custom_domain) = %s AND status = 'active'",
            (host,),
        ).fetchone()
        if row:
            return (row[0], row[1])

        base_domain = os.environ.get("TENANT_BASE_DOMAIN", "").strip().lower().lstrip(".")
        if base_domain and host.endswith(f".{base_domain}"):
            sub = host[: -(len(base_domain) + 1)].replace("-", "_")
            if _SLUG_RE.match(sub):
                row = conn.execute(
                    "SELECT slug, schema_name FROM public.platform_tenants "
                    "WHERE slug = %s AND status = 'active'",
                    (sub,),
                ).fetchone()
                if row:
                    return (row[0], row[1])
            return None

        if host in ("localhost", "127.0.0.1"):
            row = conn.execute(
                "SELECT slug, schema_name FROM public.platform_tenants "
                "WHERE slug = 'default' AND status = 'active'"
            ).fetchone()
            if row:
                return (row[0], row[1])

    return None


def _require_platform_token(x_platform_token: str = Header(default="")) -> None:
    expected = os.environ.get("PLATFORM_ADMIN_TOKEN", "").strip()
    if not expected:
        raise HTTPException(status_code=503, detail="PLATFORM_ADMIN_TOKEN is not configured")
    if not x_platform_token or not hmac.compare_digest(x_platform_token, expected):
        raise HTTPException(status_code=403, detail="Invalid platform admin token")


router = APIRouter(
    prefix="/api/platform/tenants",
    tags=["platform"],
    dependencies=[Depends(_require_platform_token)],
)


class TenantCreateIn(BaseModel):
    slug: str
    display_name: str = ""
    custom_domain: str = ""


class TenantUpdateIn(BaseModel):
    display_name: str | None = None
    custom_domain: str | None = None
    status: str | None = None


@router.get("")
def list_tenants():
    with raw_connection() as conn:
        rows = conn.execute(
            "SELECT slug, schema_name, display_name, custom_domain, status, created_at "
            "FROM public.platform_tenants ORDER BY (slug <> 'default'), slug"
        ).fetchall()
    return [
        {
            "slug": r[0],
            "schema_name": r[1],
            "display_name": r[2],
            "custom_domain": r[3],
            "status": r[4],
            "created_at": r[5].isoformat() if r[5] else None,
        }
        for r in rows
    ]


@router.post("", status_code=201)
def create_tenant(body: TenantCreateIn):
    slug = validate_tenant_slug(body.slug)
    schema = schema_for_slug(slug)
    domain = _normalize_host(body.custom_domain)
    display_name = (body.display_name or "").strip() or slug.replace("_", " ").title()

    with raw_connection() as conn:
        existing = conn.execute(
            "SELECT 1 FROM public.platform_tenants WHERE slug = %s", (slug,)
        ).fetchone()
        if existing:
            raise HTTPException(status_code=409, detail=f"Tenant '{slug}' already exists")
        if domain:
            dom_exists = conn.execute(
                "SELECT 1 FROM public.platform_tenants WHERE lower(custom_domain) = %s",
                (domain,),
            ).fetchone()
            if dom_exists:
                raise HTTPException(status_code=409, detail=f"Domain '{domain}' is already assigned")
        conn.execute(f"CREATE SCHEMA IF NOT EXISTS {schema}")
        conn.execute(
            "INSERT INTO public.platform_tenants (slug, schema_name, display_name, custom_domain, status) "
            "VALUES (%s, %s, %s, %s, 'active')",
            (slug, schema, display_name, domain),
        )

    if _bootstrap_schema_cb is not None:
        _bootstrap_schema_cb(slug, schema)
    if display_name:
        with tenant_context(slug, schema):
            with raw_connection() as conn:
                conn.execute(sql.SQL("SET search_path TO {}").format(sql.Identifier(schema)))
                try:
                    conn.execute(
                        "INSERT INTO agenda_preferences (id, city_title) VALUES (1, %s) "
                        "ON CONFLICT (id) DO UPDATE SET city_title = CASE "
                        "WHEN agenda_preferences.city_title = '' THEN EXCLUDED.city_title "
                        "ELSE agenda_preferences.city_title END",
                        (display_name,),
                    )
                finally:
                    conn.execute("SET search_path TO public")

    return {
        "slug": slug,
        "schema_name": schema,
        "display_name": display_name,
        "custom_domain": domain,
        "status": "active",
    }


@router.patch("/{slug}")
def update_tenant(slug: str, body: TenantUpdateIn):
    clean_slug = (slug or "").strip().lower().replace("-", "_")
    if body.status is not None and body.status not in ("active", "suspended"):
        raise HTTPException(status_code=400, detail="status must be 'active' or 'suspended'")
    with raw_connection() as conn:
        row = conn.execute(
            "SELECT display_name, custom_domain, status FROM public.platform_tenants WHERE slug = %s",
            (clean_slug,),
        ).fetchone()
        if not row:
            raise HTTPException(status_code=404, detail="Tenant not found")
        new_name = row[0] if body.display_name is None else body.display_name.strip()
        new_dom = row[1] if body.custom_domain is None else _normalize_host(body.custom_domain)
        new_status = row[2] if body.status is None else body.status
        if clean_slug == "default" and new_status != "active":
            raise HTTPException(status_code=400, detail="Default tenant cannot be suspended")
        conn.execute(
            "UPDATE public.platform_tenants SET display_name = %s, custom_domain = %s, status = %s WHERE slug = %s",
            (new_name, new_dom, new_status, clean_slug),
        )
    return {
        "slug": clean_slug,
        "display_name": new_name,
        "custom_domain": new_dom,
        "status": new_status,
    }
