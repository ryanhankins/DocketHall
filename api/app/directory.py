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

"""Staff & Council Directory, Local Business / Community Resources, and Self-Service FAQs module."""
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel

from .audit import record_audit
from .auth import require_permission
from .db import pool

SCHEMA = """
CREATE TABLE IF NOT EXISTS city_directory_entries (
    id           BIGSERIAL PRIMARY KEY,
    name         TEXT NOT NULL,
    title_role   TEXT NOT NULL DEFAULT '',
    department   TEXT NOT NULL DEFAULT '',
    email        TEXT NOT NULL DEFAULT '',
    phone        TEXT NOT NULL DEFAULT '',
    office_hours TEXT NOT NULL DEFAULT '',
    notes        TEXT NOT NULL DEFAULT '',
    is_elected   BOOLEAN NOT NULL DEFAULT FALSE,
    sort_order   INTEGER NOT NULL DEFAULT 0,
    is_public    BOOLEAN NOT NULL DEFAULT TRUE,
    created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS city_faqs (
    id         BIGSERIAL PRIMARY KEY,
    question   TEXT NOT NULL,
    answer     TEXT NOT NULL DEFAULT '',
    category   TEXT NOT NULL DEFAULT 'General',
    sort_order INTEGER NOT NULL DEFAULT 0,
    is_public  BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS city_community_resources (
    id          BIGSERIAL PRIMARY KEY,
    name        TEXT NOT NULL,
    category    TEXT NOT NULL DEFAULT 'Local Business',
    description TEXT NOT NULL DEFAULT '',
    address     TEXT NOT NULL DEFAULT '',
    phone       TEXT NOT NULL DEFAULT '',
    email       TEXT NOT NULL DEFAULT '',
    website_url TEXT NOT NULL DEFAULT '',
    hours       TEXT NOT NULL DEFAULT '',
    is_featured BOOLEAN NOT NULL DEFAULT FALSE,
    sort_order  INTEGER NOT NULL DEFAULT 0,
    is_public   BOOLEAN NOT NULL DEFAULT TRUE,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS city_board_members (
    id          BIGSERIAL PRIMARY KEY,
    board_name  TEXT NOT NULL,
    seat_name   TEXT NOT NULL DEFAULT '',
    member_name TEXT NOT NULL DEFAULT '',
    email       TEXT NOT NULL DEFAULT '',
    term_start  TEXT NOT NULL DEFAULT '',
    term_end    TEXT NOT NULL DEFAULT '',
    is_vacant   BOOLEAN NOT NULL DEFAULT FALSE,
    is_public   BOOLEAN NOT NULL DEFAULT TRUE,
    sort_order  INTEGER NOT NULL DEFAULT 0,
    notes       TEXT NOT NULL DEFAULT '',
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
"""

_SEED_RESOURCES = [
    (
        "Lakeview Hardware & Supply",
        "Local Business",
        "Full-service neighborhood hardware store, lumber, seasonal lawn & garden supplies, and tool rentals.",
        "214 Main Street",
        "(555) 234-1120",
        "info@lakeviewhardware.example",
        "https://example.com/lakeview-hardware",
        "Mon–Sat 7:30am–6pm, Sun 9am–4pm",
        True,
        1,
    ),
    (
        "Lakeside Food Shelf & Community Pantry",
        "Nonprofit & Civic",
        "Free weekly groceries, senior meal delivery coordination, and emergency household assistance for residents.",
        "408 Oak Avenue",
        "(555) 234-4490",
        "pantry@lakesidecares.example",
        "https://example.com/lakeside-pantry",
        "Tue & Thu 10am–6pm, Sat 9am–1pm",
        True,
        2,
    ),
    (
        "Regional Water & Electric Utility",
        "Utilities & Emergency",
        "24/7 outage reporting, utility locates, and residential service connections.",
        "890 Industrial Parkway",
        "(555) 234-9000",
        "support@regionalutility.example",
        "https://example.com/regional-utility",
        "24/7 Emergency Dispatch",
        False,
        3,
    ),
    (
        "Lakeside Public Library",
        "Schools & Youth",
        "Public computers, Wi-Fi hotspots, children's storytime, and community meeting rooms.",
        "105 Civic Plaza",
        "(555) 234-7750",
        "library@lakesidelibrary.example",
        "https://example.com/lakeside-library",
        "Mon–Thu 9am–8pm, Fri–Sat 9am–5pm",
        False,
        4,
    ),
]


def bootstrap() -> None:
    with pool.connection() as conn:
        conn.execute("SELECT pg_advisory_xact_lock(424248)")
        conn.execute(SCHEMA)
        if conn.execute("SELECT COUNT(*) FROM city_community_resources").fetchone()[0] == 0:
            for item in _SEED_RESOURCES:
                conn.execute(
                    "INSERT INTO city_community_resources "
                    "(name, category, description, address, phone, email, website_url, hours, is_featured, sort_order, is_public) "
                    "VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, TRUE)",
                    item,
                )
        if conn.execute("SELECT COUNT(*) FROM city_board_members").fetchone()[0] == 0:
            for b_row in (
                ("Planning Commission", "Chair — Seat 1", "Elena Rostova", "planning1@city.example", "2024-01-01", "2027-12-31", False, 1, "3-year term"),
                ("Planning Commission", "Commissioner — Seat 2", "David Kim", "planning2@city.example", "2025-01-01", "2028-12-31", False, 2, "3-year term"),
                ("Park & Recreation Board", "Member — Seat 3 (Open)", "", "", "", "", True, 3, "Accepting resident applications"),
            ):
                conn.execute(
                    "INSERT INTO city_board_members "
                    "(board_name, seat_name, member_name, email, term_start, term_end, is_vacant, sort_order, notes, is_public) "
                    "VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, TRUE)",
                    b_row,
                )


router = APIRouter(prefix="/api/directory", tags=["directory"])


class ContactIn(BaseModel):
    name: str
    title_role: str = ""
    department: str = ""
    email: str = ""
    phone: str = ""
    office_hours: str = ""
    notes: str = ""
    is_elected: bool = False
    sort_order: int = 0
    is_public: bool = True


class ContactPatch(BaseModel):
    name: str | None = None
    title_role: str | None = None
    department: str | None = None
    email: str | None = None
    phone: str | None = None
    office_hours: str | None = None
    notes: str | None = None
    is_elected: bool | None = None
    sort_order: int | None = None
    is_public: bool | None = None


class FaqIn(BaseModel):
    question: str
    answer: str = ""
    category: str = "General"
    sort_order: int = 0
    is_public: bool = True


class FaqPatch(BaseModel):
    question: str | None = None
    answer: str | None = None
    category: str | None = None
    sort_order: int | None = None
    is_public: bool | None = None


class ResourceIn(BaseModel):
    name: str
    category: str = "Local Business"
    description: str = ""
    address: str = ""
    phone: str = ""
    email: str = ""
    website_url: str = ""
    hours: str = ""
    is_featured: bool = False
    sort_order: int = 0
    is_public: bool = True


class ResourcePatch(BaseModel):
    name: str | None = None
    category: str | None = None
    description: str | None = None
    address: str | None = None
    phone: str | None = None
    email: str | None = None
    website_url: str | None = None
    hours: str | None = None
    is_featured: bool | None = None
    sort_order: int | None = None
    is_public: bool | None = None


def _clean_optional_url(raw: str) -> str:
    val = raw.strip()
    if val and not (val.startswith("http://") or val.startswith("https://")):
        raise HTTPException(status_code=400, detail="Website URL must start with http:// or https://")
    return val


def _row_to_contact(r) -> dict:
    return {
        "id": r[0],
        "name": r[1],
        "title_role": r[2],
        "department": r[3],
        "email": r[4],
        "phone": r[5],
        "office_hours": r[6],
        "notes": r[7],
        "is_elected": bool(r[8]),
        "sort_order": r[9],
        "is_public": bool(r[10]),
        "created_at": r[11].isoformat() if r[11] else None,
    }


def _row_to_faq(r) -> dict:
    return {
        "id": r[0],
        "question": r[1],
        "answer": r[2],
        "category": r[3],
        "sort_order": r[4],
        "is_public": bool(r[5]),
        "created_at": r[6].isoformat() if r[6] else None,
        "updated_at": r[7].isoformat() if r[7] else None,
    }


def _row_to_resource(r) -> dict:
    return {
        "id": r[0],
        "name": r[1],
        "category": r[2],
        "description": r[3],
        "address": r[4],
        "phone": r[5],
        "email": r[6],
        "website_url": r[7],
        "hours": r[8],
        "is_featured": bool(r[9]),
        "sort_order": r[10],
        "is_public": bool(r[11]),
        "created_at": r[12].isoformat() if r[12] else None,
        "updated_at": r[13].isoformat() if r[13] else None,
    }


def _row_to_board(r) -> dict:
    return {
        "id": r[0],
        "board_name": r[1],
        "seat_name": r[2],
        "member_name": r[3],
        "email": r[4],
        "term_start": r[5],
        "term_end": r[6],
        "is_vacant": bool(r[7]),
        "is_public": bool(r[8]),
        "sort_order": r[9],
        "notes": r[10],
        "created_at": r[11].isoformat() if r[11] else None,
    }


class BoardMemberIn(BaseModel):
    board_name: str
    seat_name: str = ""
    member_name: str = ""
    email: str = ""
    term_start: str = ""
    term_end: str = ""
    is_vacant: bool = False
    is_public: bool = True
    sort_order: int = 0
    notes: str = ""


class BoardMemberPatch(BaseModel):
    board_name: str | None = None
    seat_name: str | None = None
    member_name: str | None = None
    email: str | None = None
    term_start: str | None = None
    term_end: str | None = None
    is_vacant: bool | None = None
    is_public: bool | None = None
    sort_order: int | None = None
    notes: str | None = None


@router.get("/public")
def get_public_directory(q: str = "", resource_category: str = ""):
    ql = f"%{q.strip()}%"
    rc_filter = resource_category.strip()
    with pool.connection() as conn:
        if q.strip():
            c_rows = conn.execute(
                "SELECT id, name, title_role, department, email, phone, office_hours, notes, "
                "       is_elected, sort_order, is_public, created_at "
                "FROM city_directory_entries "
                "WHERE is_public = TRUE AND (name ILIKE %s OR title_role ILIKE %s OR department ILIKE %s OR email ILIKE %s) "
                "ORDER BY is_elected DESC, sort_order ASC, name ASC",
                (ql, ql, ql, ql),
            ).fetchall()
            f_rows = conn.execute(
                "SELECT id, question, answer, category, sort_order, is_public, created_at, updated_at "
                "FROM city_faqs "
                "WHERE is_public = TRUE AND (question ILIKE %s OR answer ILIKE %s OR category ILIKE %s) "
                "ORDER BY category ASC, sort_order ASC, id ASC",
                (ql, ql, ql),
            ).fetchall()
            r_rows = conn.execute(
                "SELECT id, name, category, description, address, phone, email, website_url, hours, "
                "       is_featured, sort_order, is_public, created_at, updated_at "
                "FROM city_community_resources "
                "WHERE is_public = TRUE AND (%s = '' OR category = %s) "
                "AND (name ILIKE %s OR category ILIKE %s OR description ILIKE %s OR address ILIKE %s) "
                "ORDER BY is_featured DESC, sort_order ASC, name ASC",
                (rc_filter, rc_filter, ql, ql, ql, ql),
            ).fetchall()
            b_rows = conn.execute(
                "SELECT id, board_name, seat_name, member_name, email, term_start, term_end, "
                "       is_vacant, is_public, sort_order, notes, created_at "
                "FROM city_board_members "
                "WHERE is_public = TRUE AND (board_name ILIKE %s OR seat_name ILIKE %s OR member_name ILIKE %s) "
                "ORDER BY board_name ASC, sort_order ASC, id ASC",
                (ql, ql, ql),
            ).fetchall()
        else:
            c_rows = conn.execute(
                "SELECT id, name, title_role, department, email, phone, office_hours, notes, "
                "       is_elected, sort_order, is_public, created_at "
                "FROM city_directory_entries WHERE is_public = TRUE "
                "ORDER BY is_elected DESC, sort_order ASC, name ASC"
            ).fetchall()
            f_rows = conn.execute(
                "SELECT id, question, answer, category, sort_order, is_public, created_at, updated_at "
                "FROM city_faqs WHERE is_public = TRUE "
                "ORDER BY category ASC, sort_order ASC, id ASC"
            ).fetchall()
            r_rows = conn.execute(
                "SELECT id, name, category, description, address, phone, email, website_url, hours, "
                "       is_featured, sort_order, is_public, created_at, updated_at "
                "FROM city_community_resources "
                "WHERE is_public = TRUE AND (%s = '' OR category = %s) "
                "ORDER BY is_featured DESC, sort_order ASC, name ASC",
                (rc_filter, rc_filter),
            ).fetchall()
            b_rows = conn.execute(
                "SELECT id, board_name, seat_name, member_name, email, term_start, term_end, "
                "       is_vacant, is_public, sort_order, notes, created_at "
                "FROM city_board_members WHERE is_public = TRUE "
                "ORDER BY board_name ASC, sort_order ASC, id ASC"
            ).fetchall()
    return {
        "contacts": [_row_to_contact(r) for r in c_rows],
        "faqs": [_row_to_faq(r) for r in f_rows],
        "resources": [_row_to_resource(r) for r in r_rows],
        "boards": [_row_to_board(r) for r in b_rows],
    }


@router.get("/contacts")
def list_contacts(_: dict = Depends(require_permission("directory.manage"))):
    with pool.connection() as conn:
        rows = conn.execute(
            "SELECT id, name, title_role, department, email, phone, office_hours, notes, "
            "       is_elected, sort_order, is_public, created_at "
            "FROM city_directory_entries ORDER BY is_elected DESC, sort_order ASC, name ASC"
        ).fetchall()
    return [_row_to_contact(r) for r in rows]


@router.post("/contacts", status_code=201)
def create_contact(body: ContactIn, user: dict = Depends(require_permission("directory.manage"))):
    name = body.name.strip()
    if not name:
        raise HTTPException(status_code=400, detail="Name is required")
    with pool.connection() as conn:
        row = conn.execute(
            "INSERT INTO city_directory_entries "
            "(name, title_role, department, email, phone, office_hours, notes, is_elected, sort_order, is_public) "
            "VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s) "
            "RETURNING id, name, title_role, department, email, phone, office_hours, notes, is_elected, sort_order, is_public, created_at",
            (
                name,
                body.title_role.strip(),
                body.department.strip(),
                body.email.strip(),
                body.phone.strip(),
                body.office_hours.strip(),
                body.notes.strip(),
                body.is_elected,
                body.sort_order,
                body.is_public,
            ),
        ).fetchone()
    record_audit(user["username"], "directory.contact_create", name)
    return _row_to_contact(row)


@router.patch("/contacts/{contact_id}")
def update_contact(contact_id: int, body: ContactPatch, user: dict = Depends(require_permission("directory.manage"))):
    with pool.connection() as conn:
        row = conn.execute(
            "UPDATE city_directory_entries SET "
            "name = COALESCE(%s, name), "
            "title_role = COALESCE(%s, title_role), "
            "department = COALESCE(%s, department), "
            "email = COALESCE(%s, email), "
            "phone = COALESCE(%s, phone), "
            "office_hours = COALESCE(%s, office_hours), "
            "notes = COALESCE(%s, notes), "
            "is_elected = COALESCE(%s, is_elected), "
            "sort_order = COALESCE(%s, sort_order), "
            "is_public = COALESCE(%s, is_public) "
            "WHERE id = %s "
            "RETURNING id, name, title_role, department, email, phone, office_hours, notes, is_elected, sort_order, is_public, created_at",
            (
                body.name.strip() if body.name is not None else None,
                body.title_role.strip() if body.title_role is not None else None,
                body.department.strip() if body.department is not None else None,
                body.email.strip() if body.email is not None else None,
                body.phone.strip() if body.phone is not None else None,
                body.office_hours.strip() if body.office_hours is not None else None,
                body.notes.strip() if body.notes is not None else None,
                body.is_elected,
                body.sort_order,
                body.is_public,
                contact_id,
            ),
        ).fetchone()
        if not row:
            raise HTTPException(status_code=404, detail="Directory contact not found")
    record_audit(user["username"], "directory.contact_update", f"Updated contact #{contact_id}")
    return _row_to_contact(row)


@router.delete("/contacts/{contact_id}")
def delete_contact(contact_id: int, user: dict = Depends(require_permission("directory.manage"))):
    with pool.connection() as conn:
        row = conn.execute("DELETE FROM city_directory_entries WHERE id = %s RETURNING id, name", (contact_id,)).fetchone()
        if not row:
            raise HTTPException(status_code=404, detail="Directory contact not found")
    record_audit(user["username"], "directory.contact_delete", f"Deleted contact #{contact_id}: {row[1]}")
    return {"deleted": True, "id": contact_id}


@router.get("/faqs")
def list_faqs(_: dict = Depends(require_permission("directory.manage"))):
    with pool.connection() as conn:
        rows = conn.execute(
            "SELECT id, question, answer, category, sort_order, is_public, created_at, updated_at "
            "FROM city_faqs ORDER BY category ASC, sort_order ASC, id ASC"
        ).fetchall()
    return [_row_to_faq(r) for r in rows]


@router.post("/faqs", status_code=201)
def create_faq(body: FaqIn, user: dict = Depends(require_permission("directory.manage"))):
    q_text = body.question.strip()
    if not q_text:
        raise HTTPException(status_code=400, detail="Question is required")
    with pool.connection() as conn:
        row = conn.execute(
            "INSERT INTO city_faqs (question, answer, category, sort_order, is_public) "
            "VALUES (%s, %s, %s, %s, %s) "
            "RETURNING id, question, answer, category, sort_order, is_public, created_at, updated_at",
            (q_text, body.answer.strip(), body.category.strip() or "General", body.sort_order, body.is_public),
        ).fetchone()
    record_audit(user["username"], "directory.faq_create", q_text[:80])
    return _row_to_faq(row)


@router.patch("/faqs/{faq_id}")
def update_faq(faq_id: int, body: FaqPatch, user: dict = Depends(require_permission("directory.manage"))):
    with pool.connection() as conn:
        row = conn.execute(
            "UPDATE city_faqs SET "
            "question = COALESCE(%s, question), "
            "answer = COALESCE(%s, answer), "
            "category = COALESCE(%s, category), "
            "sort_order = COALESCE(%s, sort_order), "
            "is_public = COALESCE(%s, is_public), "
            "updated_at = now() "
            "WHERE id = %s "
            "RETURNING id, question, answer, category, sort_order, is_public, created_at, updated_at",
            (
                body.question.strip() if body.question is not None else None,
                body.answer.strip() if body.answer is not None else None,
                body.category.strip() if body.category is not None else None,
                body.sort_order,
                body.is_public,
                faq_id,
            ),
        ).fetchone()
        if not row:
            raise HTTPException(status_code=404, detail="FAQ not found")
    record_audit(user["username"], "directory.faq_update", f"Updated FAQ #{faq_id}")
    return _row_to_faq(row)


@router.delete("/faqs/{faq_id}")
def delete_faq(faq_id: int, user: dict = Depends(require_permission("directory.manage"))):
    with pool.connection() as conn:
        row = conn.execute("DELETE FROM city_faqs WHERE id = %s RETURNING id", (faq_id,)).fetchone()
        if not row:
            raise HTTPException(status_code=404, detail="FAQ not found")
    record_audit(user["username"], "directory.faq_delete", f"Deleted FAQ #{faq_id}")
    return {"deleted": True, "id": faq_id}


@router.get("/resources")
def list_resources(_: dict = Depends(require_permission("directory.manage"))):
    with pool.connection() as conn:
        rows = conn.execute(
            "SELECT id, name, category, description, address, phone, email, website_url, hours, "
            "       is_featured, sort_order, is_public, created_at, updated_at "
            "FROM city_community_resources "
            "ORDER BY is_featured DESC, sort_order ASC, name ASC"
        ).fetchall()
    return [_row_to_resource(r) for r in rows]


@router.post("/resources", status_code=201)
def create_resource(body: ResourceIn, user: dict = Depends(require_permission("directory.manage"))):
    name = body.name.strip()
    if not name:
        raise HTTPException(status_code=400, detail="Resource name is required")
    website_url = _clean_optional_url(body.website_url)
    with pool.connection() as conn:
        row = conn.execute(
            "INSERT INTO city_community_resources "
            "(name, category, description, address, phone, email, website_url, hours, is_featured, sort_order, is_public) "
            "VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s) "
            "RETURNING id, name, category, description, address, phone, email, website_url, hours, "
            "          is_featured, sort_order, is_public, created_at, updated_at",
            (
                name,
                body.category.strip() or "Local Business",
                body.description.strip(),
                body.address.strip(),
                body.phone.strip(),
                body.email.strip(),
                website_url,
                body.hours.strip(),
                body.is_featured,
                body.sort_order,
                body.is_public,
            ),
        ).fetchone()
    record_audit(user["username"], "directory.resource_create", name)
    return _row_to_resource(row)


@router.patch("/resources/{resource_id}")
def update_resource(resource_id: int, body: ResourcePatch, user: dict = Depends(require_permission("directory.manage"))):
    website_url = _clean_optional_url(body.website_url) if body.website_url is not None else None
    with pool.connection() as conn:
        row = conn.execute(
            "UPDATE city_community_resources SET "
            "name = COALESCE(%s, name), "
            "category = COALESCE(%s, category), "
            "description = COALESCE(%s, description), "
            "address = COALESCE(%s, address), "
            "phone = COALESCE(%s, phone), "
            "email = COALESCE(%s, email), "
            "website_url = COALESCE(%s, website_url), "
            "hours = COALESCE(%s, hours), "
            "is_featured = COALESCE(%s, is_featured), "
            "sort_order = COALESCE(%s, sort_order), "
            "is_public = COALESCE(%s, is_public), "
            "updated_at = now() "
            "WHERE id = %s "
            "RETURNING id, name, category, description, address, phone, email, website_url, hours, "
            "          is_featured, sort_order, is_public, created_at, updated_at",
            (
                body.name.strip() if body.name is not None else None,
                body.category.strip() if body.category is not None else None,
                body.description.strip() if body.description is not None else None,
                body.address.strip() if body.address is not None else None,
                body.phone.strip() if body.phone is not None else None,
                body.email.strip() if body.email is not None else None,
                website_url,
                body.hours.strip() if body.hours is not None else None,
                body.is_featured,
                body.sort_order,
                body.is_public,
                resource_id,
            ),
        ).fetchone()
        if not row:
            raise HTTPException(status_code=404, detail="Community resource not found")
    record_audit(user["username"], "directory.resource_update", f"Updated resource #{resource_id}")
    return _row_to_resource(row)


@router.delete("/resources/{resource_id}")
def delete_resource(resource_id: int, user: dict = Depends(require_permission("directory.manage"))):
    with pool.connection() as conn:
        row = conn.execute("DELETE FROM city_community_resources WHERE id = %s RETURNING id, name", (resource_id,)).fetchone()
        if not row:
            raise HTTPException(status_code=404, detail="Community resource not found")
    record_audit(user["username"], "directory.resource_delete", f"Deleted resource #{resource_id}: {row[1]}")
    return {"deleted": True, "id": resource_id}


@router.get("/boards")
def list_boards(_: dict = Depends(require_permission("directory.manage"))):
    with pool.connection() as conn:
        rows = conn.execute(
            "SELECT id, board_name, seat_name, member_name, email, term_start, term_end, "
            "       is_vacant, is_public, sort_order, notes, created_at "
            "FROM city_board_members ORDER BY board_name ASC, sort_order ASC, id ASC"
        ).fetchall()
    return [_row_to_board(r) for r in rows]


@router.post("/boards", status_code=201)
def create_board_member(body: BoardMemberIn, user: dict = Depends(require_permission("directory.manage"))):
    bname = body.board_name.strip()
    if not bname:
        raise HTTPException(status_code=400, detail="Board / Commission name is required")
    with pool.connection() as conn:
        row = conn.execute(
            "INSERT INTO city_board_members "
            "(board_name, seat_name, member_name, email, term_start, term_end, is_vacant, is_public, sort_order, notes) "
            "VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s) "
            "RETURNING id, board_name, seat_name, member_name, email, term_start, term_end, is_vacant, is_public, sort_order, notes, created_at",
            (
                bname,
                body.seat_name.strip(),
                body.member_name.strip(),
                body.email.strip(),
                body.term_start.strip(),
                body.term_end.strip(),
                body.is_vacant,
                body.is_public,
                body.sort_order,
                body.notes.strip(),
            ),
        ).fetchone()
    record_audit(user["username"], "directory.board_create", f"{bname}: {body.seat_name.strip() or body.member_name.strip()}")
    return _row_to_board(row)


@router.patch("/boards/{board_id}")
def update_board_member(board_id: int, body: BoardMemberPatch, user: dict = Depends(require_permission("directory.manage"))):
    with pool.connection() as conn:
        row = conn.execute(
            "UPDATE city_board_members SET "
            "board_name = COALESCE(%s, board_name), "
            "seat_name = COALESCE(%s, seat_name), "
            "member_name = COALESCE(%s, member_name), "
            "email = COALESCE(%s, email), "
            "term_start = COALESCE(%s, term_start), "
            "term_end = COALESCE(%s, term_end), "
            "is_vacant = COALESCE(%s, is_vacant), "
            "is_public = COALESCE(%s, is_public), "
            "sort_order = COALESCE(%s, sort_order), "
            "notes = COALESCE(%s, notes) "
            "WHERE id = %s "
            "RETURNING id, board_name, seat_name, member_name, email, term_start, term_end, is_vacant, is_public, sort_order, notes, created_at",
            (
                body.board_name.strip() if body.board_name is not None else None,
                body.seat_name.strip() if body.seat_name is not None else None,
                body.member_name.strip() if body.member_name is not None else None,
                body.email.strip() if body.email is not None else None,
                body.term_start.strip() if body.term_start is not None else None,
                body.term_end.strip() if body.term_end is not None else None,
                body.is_vacant,
                body.is_public,
                body.sort_order,
                body.notes.strip() if body.notes is not None else None,
                board_id,
            ),
        ).fetchone()
        if not row:
            raise HTTPException(status_code=404, detail="Board member not found")
    record_audit(user["username"], "directory.board_update", f"Updated board seat #{board_id}")
    return _row_to_board(row)


@router.delete("/boards/{board_id}")
def delete_board_member(board_id: int, user: dict = Depends(require_permission("directory.manage"))):
    with pool.connection() as conn:
        row = conn.execute("DELETE FROM city_board_members WHERE id = %s RETURNING id", (board_id,)).fetchone()
        if not row:
            raise HTTPException(status_code=404, detail="Board member not found")
    record_audit(user["username"], "directory.board_delete", f"Deleted board seat #{board_id}")
    return {"deleted": True, "id": board_id}
