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

"""Custom City Info Pages & Quick Links module."""
from datetime import date

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel

from .audit import record_audit
from .auth import require_permission
from .db import pool

SCHEMA = """
CREATE TABLE IF NOT EXISTS city_pages (
    id         BIGSERIAL PRIMARY KEY,
    slug       TEXT NOT NULL UNIQUE,
    title      TEXT NOT NULL,
    summary    TEXT NOT NULL DEFAULT '',
    body       TEXT NOT NULL DEFAULT '',
    category   TEXT NOT NULL DEFAULT 'City Services',
    sort_order INTEGER NOT NULL DEFAULT 0,
    is_public  BOOLEAN NOT NULL DEFAULT TRUE,
    updated_by TEXT NOT NULL DEFAULT '',
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS city_quick_links (
    id          BIGSERIAL PRIMARY KEY,
    label       TEXT NOT NULL,
    description TEXT NOT NULL DEFAULT '',
    url         TEXT NOT NULL,
    sort_order  INTEGER NOT NULL DEFAULT 0,
    is_public   BOOLEAN NOT NULL DEFAULT TRUE,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
"""

_SEED_PAGES = [
    {
        "slug": "trash-and-recycling",
        "title": "Trash, Recycling & Yard Waste",
        "category": "City Services",
        "summary": "Weekly curbside collection guidelines, holiday schedule shifts, and seasonal brush pickup.",
        "body": (
            "Curbside trash and recycling carts should be placed at the curb by 7:00 AM on your scheduled pickup day.\n\n"
            "• Holiday Delays: When a major holiday falls on or before your collection day, pickup shifts by one day.\n"
            "• Yard Waste & Brush: Place bundled brush or yard waste bags at the street edge during scheduled spring and fall cleanups.\n\n"
            "(Edit this page in Admin → City Pages & Quick Links to add your local hauler phone number and pickup day.)"
        ),
        "sort_order": 1,
    },
    {
        "slug": "utilities-and-billing",
        "title": "Water, Sewer & Utility Billing",
        "category": "Utilities",
        "summary": "How municipal utility bills are issued, payment options, and after-hours water emergency contacts.",
        "body": (
            "Municipal water and sewer bills are issued quarterly/monthly according to your city billing cycle.\n\n"
            "• Payment Options: Pay at City Hall, by mail, or via the online payment link.\n"
            "• Water/Sewer Emergencies: Contact City Hall during business hours or the Public Works emergency line after hours.\n\n"
            "(Edit this page in Admin → City Pages & Quick Links with your city's exact billing schedule and phone numbers.)"
        ),
        "sort_order": 2,
    },
    {
        "slug": "snow-and-parking",
        "title": "Winter Snow Plowing & Parking Policy",
        "category": "Public Works",
        "summary": "Seasonal on-street parking restrictions during snowfalls to keep city streets clear and safe.",
        "body": (
            "To allow snowplows to clear streets safely from curb to curb, no on-street parking is permitted during snow emergencies "
            "or after snowfall of 2 inches or more until streets have been plowed full-width.\n\n"
            "Please do not push or blow snow from driveways back into city streets."
        ),
        "sort_order": 3,
    },
]

_SEED_LINKS = [
    {
        "label": "Apply for a Building or Zoning Permit",
        "description": "Online permit applications, fee schedule, and document uploads.",
        "url": "/portal",
        "sort_order": 1,
    },
    {
        "label": "Reserve City Hall / Community Room",
        "description": "Check facility availability and submit a rental request.",
        "url": "/#calendar",
        "sort_order": 2,
    },
]


def bootstrap() -> None:
    with pool.connection() as conn:
        conn.execute("SELECT pg_advisory_xact_lock(424251)")
        conn.execute(SCHEMA)
        if conn.execute("SELECT COUNT(*) FROM city_pages").fetchone()[0] == 0:
            for p in _SEED_PAGES:
                conn.execute(
                    "INSERT INTO city_pages (slug, title, category, summary, body, sort_order, updated_by) "
                    "VALUES (%s, %s, %s, %s, %s, %s, 'system') ON CONFLICT (slug) DO NOTHING",
                    (p["slug"], p["title"], p["category"], p["summary"], p["body"], p["sort_order"]),
                )
        if conn.execute("SELECT COUNT(*) FROM city_quick_links").fetchone()[0] == 0:
            for l in _SEED_LINKS:
                conn.execute(
                    "INSERT INTO city_quick_links (label, description, url, sort_order) "
                    "VALUES (%s, %s, %s, %s)",
                    (l["label"], l["description"], l["url"], l["sort_order"]),
                )


router = APIRouter(prefix="/api/pages", tags=["pages"])


def _slugify(raw: str) -> str:
    s = "".join(c if c.isalnum() else "-" for c in (raw or "").strip().lower()).strip("-")
    while "--" in s:
        s = s.replace("--", "-")
    return s[:60] or "page"


def _row_to_page(r) -> dict:
    return {
        "id": r[0],
        "slug": r[1],
        "title": r[2],
        "summary": r[3],
        "body": r[4],
        "category": r[5],
        "sort_order": r[6],
        "is_public": bool(r[7]),
        "updated_by": r[8],
        "created_at": r[9].isoformat() if r[9] else None,
        "updated_at": r[10].isoformat() if r[10] else None,
    }


def _row_to_link(r) -> dict:
    return {
        "id": r[0],
        "label": r[1],
        "description": r[2],
        "url": r[3],
        "sort_order": r[4],
        "is_public": bool(r[5]),
        "created_at": r[6].isoformat() if r[6] else None,
    }


class PageIn(BaseModel):
    title: str
    slug: str = ""
    summary: str = ""
    body: str = ""
    category: str = "City Services"
    sort_order: int = 0
    is_public: bool = True


class PagePatch(BaseModel):
    title: str | None = None
    summary: str | None = None
    body: str | None = None
    category: str | None = None
    sort_order: int | None = None
    is_public: bool | None = None


class QuickLinkIn(BaseModel):
    label: str
    description: str = ""
    url: str
    sort_order: int = 0
    is_public: bool = True


class QuickLinkPatch(BaseModel):
    label: str | None = None
    description: str | None = None
    url: str | None = None
    sort_order: int | None = None
    is_public: bool | None = None


@router.get("/public")
def get_public_pages(q: str = ""):
    ql = f"%{q.strip()}%"
    with pool.connection() as conn:
        if q.strip():
            p_rows = conn.execute(
                "SELECT id, slug, title, summary, body, category, sort_order, is_public, updated_by, created_at, updated_at "
                "FROM city_pages WHERE is_public = TRUE AND (title ILIKE %s OR summary ILIKE %s OR body ILIKE %s OR category ILIKE %s) "
                "ORDER BY sort_order ASC, title ASC",
                (ql, ql, ql, ql),
            ).fetchall()
        else:
            p_rows = conn.execute(
                "SELECT id, slug, title, summary, body, category, sort_order, is_public, updated_by, created_at, updated_at "
                "FROM city_pages WHERE is_public = TRUE ORDER BY sort_order ASC, title ASC"
            ).fetchall()
        l_rows = conn.execute(
            "SELECT id, label, description, url, sort_order, is_public, created_at "
            "FROM city_quick_links WHERE is_public = TRUE ORDER BY sort_order ASC, id ASC"
        ).fetchall()
    return {
        "pages": [_row_to_page(r) for r in p_rows],
        "quick_links": [_row_to_link(r) for r in l_rows],
    }


@router.get("")
def list_pages(_: dict = Depends(require_permission("pages.manage"))):
    with pool.connection() as conn:
        rows = conn.execute(
            "SELECT id, slug, title, summary, body, category, sort_order, is_public, updated_by, created_at, updated_at "
            "FROM city_pages ORDER BY sort_order ASC, title ASC"
        ).fetchall()
    return [_row_to_page(r) for r in rows]


@router.post("", status_code=201)
def create_page(body: PageIn, user: dict = Depends(require_permission("pages.manage"))):
    title = body.title.strip()
    if not title:
        raise HTTPException(status_code=400, detail="Page title is required")
    base_slug = _slugify(body.slug or title)
    with pool.connection() as conn:
        slug = base_slug
        if conn.execute("SELECT 1 FROM city_pages WHERE slug = %s", (slug,)).fetchone():
            slug = f"{base_slug}-{int(date.today().strftime('%m%d'))}"
        row = conn.execute(
            "INSERT INTO city_pages (slug, title, summary, body, category, sort_order, is_public, updated_by) "
            "VALUES (%s, %s, %s, %s, %s, %s, %s, %s) "
            "RETURNING id, slug, title, summary, body, category, sort_order, is_public, updated_by, created_at, updated_at",
            (slug, title, body.summary.strip(), body.body.strip(), body.category.strip() or "City Services", body.sort_order, body.is_public, user["username"]),
        ).fetchone()
    record_audit(user["username"], "pages.create", title)
    return _row_to_page(row)


@router.patch("/{page_id}")
def update_page(page_id: int, body: PagePatch, user: dict = Depends(require_permission("pages.manage"))):
    with pool.connection() as conn:
        row = conn.execute(
            "UPDATE city_pages SET "
            "title = COALESCE(%s, title), "
            "summary = COALESCE(%s, summary), "
            "body = COALESCE(%s, body), "
            "category = COALESCE(%s, category), "
            "sort_order = COALESCE(%s, sort_order), "
            "is_public = COALESCE(%s, is_public), "
            "updated_by = %s, updated_at = now() "
            "WHERE id = %s "
            "RETURNING id, slug, title, summary, body, category, sort_order, is_public, updated_by, created_at, updated_at",
            (
                body.title.strip() if body.title is not None else None,
                body.summary.strip() if body.summary is not None else None,
                body.body.strip() if body.body is not None else None,
                body.category.strip() if body.category is not None else None,
                body.sort_order,
                body.is_public,
                user["username"],
                page_id,
            ),
        ).fetchone()
        if not row:
            raise HTTPException(status_code=404, detail="Page not found")
    record_audit(user["username"], "pages.update", f"Updated page #{page_id}")
    return _row_to_page(row)


@router.delete("/{page_id}")
def delete_page(page_id: int, user: dict = Depends(require_permission("pages.manage"))):
    with pool.connection() as conn:
        row = conn.execute("DELETE FROM city_pages WHERE id = %s RETURNING id, title", (page_id,)).fetchone()
        if not row:
            raise HTTPException(status_code=404, detail="Page not found")
    record_audit(user["username"], "pages.delete", f"Deleted page #{page_id}: {row[1]}")
    return {"deleted": True, "id": page_id}


@router.get("/quick-links")
def list_quick_links(_: dict = Depends(require_permission("pages.manage"))):
    with pool.connection() as conn:
        rows = conn.execute(
            "SELECT id, label, description, url, sort_order, is_public, created_at "
            "FROM city_quick_links ORDER BY sort_order ASC, id ASC"
        ).fetchall()
    return [_row_to_link(r) for r in rows]


@router.post("/quick-links", status_code=201)
def create_quick_link(body: QuickLinkIn, user: dict = Depends(require_permission("pages.manage"))):
    label = body.label.strip()
    url = body.url.strip()
    if not label or not url:
        raise HTTPException(status_code=400, detail="Label and URL are required")
    with pool.connection() as conn:
        row = conn.execute(
            "INSERT INTO city_quick_links (label, description, url, sort_order, is_public) "
            "VALUES (%s, %s, %s, %s, %s) "
            "RETURNING id, label, description, url, sort_order, is_public, created_at",
            (label, body.description.strip(), url, body.sort_order, body.is_public),
        ).fetchone()
    record_audit(user["username"], "pages.quick_link_create", label)
    return _row_to_link(row)


@router.patch("/quick-links/{link_id}")
def update_quick_link(link_id: int, body: QuickLinkPatch, _: dict = Depends(require_permission("pages.manage"))):
    with pool.connection() as conn:
        row = conn.execute(
            "UPDATE city_quick_links SET "
            "label = COALESCE(%s, label), "
            "description = COALESCE(%s, description), "
            "url = COALESCE(%s, url), "
            "sort_order = COALESCE(%s, sort_order), "
            "is_public = COALESCE(%s, is_public) "
            "WHERE id = %s "
            "RETURNING id, label, description, url, sort_order, is_public, created_at",
            (
                body.label.strip() if body.label is not None else None,
                body.description.strip() if body.description is not None else None,
                body.url.strip() if body.url is not None else None,
                body.sort_order,
                body.is_public,
                link_id,
            ),
        ).fetchone()
        if not row:
            raise HTTPException(status_code=404, detail="Quick link not found")
    return _row_to_link(row)


@router.delete("/quick-links/{link_id}")
def delete_quick_link(link_id: int, _: dict = Depends(require_permission("pages.manage"))):
    with pool.connection() as conn:
        row = conn.execute("DELETE FROM city_quick_links WHERE id = %s RETURNING id", (link_id,)).fetchone()
        if not row:
            raise HTTPException(status_code=404, detail="Quick link not found")
    return {"deleted": True, "id": link_id}
