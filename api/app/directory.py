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

"""Staff & Council Directory and Self-Service FAQs module."""
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
"""


def bootstrap() -> None:
    with pool.connection() as conn:
        conn.execute("SELECT pg_advisory_xact_lock(424248)")
        conn.execute(SCHEMA)


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


@router.get("/public")
def get_public_directory(q: str = ""):
    ql = f"%{q.strip()}%"
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
    return {
        "contacts": [_row_to_contact(r) for r in c_rows],
        "faqs": [_row_to_faq(r) for r in f_rows],
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
