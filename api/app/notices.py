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

"""News Flash, Public Notices, Bids/RFPs, and Job Postings module."""
from datetime import date
import os
import re
from typing import Literal
import uuid

from fastapi import APIRouter, Depends, File, HTTPException, Request, UploadFile
from fastapi.responses import Response
from pydantic import BaseModel

from .agendas import _bucket, _storage
from .audit import record_audit
from .auth import require_permission
from .db import pool
from .integrations import send_notification_email
from .tenancy import tenant_object_key

NOTICE_CATEGORIES = ("news", "public_notice", "bid", "job")

SCHEMA = """
CREATE TABLE IF NOT EXISTS city_notices (
    id              BIGSERIAL PRIMARY KEY,
    title           TEXT NOT NULL,
    category        TEXT NOT NULL DEFAULT 'news',
    summary         TEXT NOT NULL DEFAULT '',
    body            TEXT NOT NULL DEFAULT '',
    department      TEXT NOT NULL DEFAULT '',
    contact_info    TEXT NOT NULL DEFAULT '',
    attachment_url  TEXT NOT NULL DEFAULT '',
    attachment_key  TEXT NOT NULL DEFAULT '',
    attachment_filename TEXT NOT NULL DEFAULT '',
    publish_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    expires_at      DATE,
    deadline_at     DATE,
    is_pinned       BOOLEAN NOT NULL DEFAULT FALSE,
    is_published    BOOLEAN NOT NULL DEFAULT TRUE,
    created_by      TEXT NOT NULL DEFAULT '',
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE city_notices ADD COLUMN IF NOT EXISTS attachment_key TEXT NOT NULL DEFAULT '';
ALTER TABLE city_notices ADD COLUMN IF NOT EXISTS attachment_filename TEXT NOT NULL DEFAULT '';
CREATE INDEX IF NOT EXISTS city_notices_cat_idx ON city_notices(category, is_published, publish_at DESC);
CREATE TABLE IF NOT EXISTS city_notice_responses (
    id              BIGSERIAL PRIMARY KEY,
    notice_id       BIGINT NOT NULL REFERENCES city_notices(id) ON DELETE CASCADE,
    response_type   TEXT NOT NULL DEFAULT 'job_application',
    applicant_name  TEXT NOT NULL,
    applicant_email TEXT NOT NULL DEFAULT '',
    applicant_phone TEXT NOT NULL DEFAULT '',
    organization    TEXT NOT NULL DEFAULT '',
    cover_note      TEXT NOT NULL DEFAULT '',
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS city_notice_responses_idx ON city_notice_responses(notice_id, id DESC);
"""


def bootstrap() -> None:
    with pool.connection() as conn:
        conn.execute("SELECT pg_advisory_xact_lock(424247)")
        conn.execute(SCHEMA)


router = APIRouter(prefix="/api/notices", tags=["notices"])


class NoticeIn(BaseModel):
    title: str
    category: Literal["news", "public_notice", "bid", "job"] = "news"
    summary: str = ""
    body: str = ""
    department: str = ""
    contact_info: str = ""
    attachment_url: str = ""
    expires_at: str | None = None
    deadline_at: str | None = None
    is_pinned: bool = False
    is_published: bool = True


class NoticePatch(BaseModel):
    title: str | None = None
    category: Literal["news", "public_notice", "bid", "job"] | None = None
    summary: str | None = None
    body: str | None = None
    department: str | None = None
    contact_info: str | None = None
    attachment_url: str | None = None
    expires_at: str | None = None
    deadline_at: str | None = None
    is_pinned: bool | None = None
    is_published: bool | None = None


def _parse_optional_date(val: str | None) -> date | None:
    if val is None:
        return None
    s = val.strip()
    if not s:
        return None
    try:
        return date.fromisoformat(s)
    except ValueError:
        raise HTTPException(status_code=400, detail=f"Invalid date format '{s}'; expected YYYY-MM-DD")


def _row_to_notice(r) -> dict:
    return {
        "id": r[0],
        "title": r[1],
        "category": r[2],
        "summary": r[3],
        "body": r[4],
        "department": r[5],
        "contact_info": r[6],
        "attachment_url": r[7],
        "publish_at": r[8].isoformat() if r[8] else None,
        "expires_at": r[9].isoformat() if r[9] else None,
        "deadline_at": r[10].isoformat() if r[10] else None,
        "is_pinned": bool(r[11]),
        "is_published": bool(r[12]),
        "created_by": r[13],
        "created_at": r[14].isoformat() if r[14] else None,
        "updated_at": r[15].isoformat() if r[15] else None,
    }


_COLS = (
    "id, title, category, summary, body, department, contact_info, attachment_url, "
    "publish_at, expires_at, deadline_at, is_pinned, is_published, created_by, created_at, updated_at"
)


@router.get("/public")
def list_public_notices(category: str | None = None, q: str = ""):
    clauses = ["is_published = TRUE", "(expires_at IS NULL OR expires_at >= CURRENT_DATE)"]
    params: list = []
    if category and category in NOTICE_CATEGORIES:
        clauses.append("category = %s")
        params.append(category)
    if q.strip():
        like = f"%{q.strip()}%"
        clauses.append("(title ILIKE %s OR summary ILIKE %s OR body ILIKE %s OR department ILIKE %s)")
        params.extend([like, like, like, like])
    where = "WHERE " + " AND ".join(clauses)
    with pool.connection() as conn:
        rows = conn.execute(
            f"SELECT {_COLS} FROM city_notices {where} "
            "ORDER BY is_pinned DESC, publish_at DESC, id DESC LIMIT 100",
            tuple(params),
        ).fetchall()
    return [_row_to_notice(r) for r in rows]


@router.get("")
def list_all_notices(
    category: str | None = None,
    q: str = "",
    _: dict = Depends(require_permission("notices.manage")),
):
    clauses = []
    params: list = []
    if category and category in NOTICE_CATEGORIES:
        clauses.append("category = %s")
        params.append(category)
    if q.strip():
        like = f"%{q.strip()}%"
        clauses.append("(title ILIKE %s OR summary ILIKE %s OR body ILIKE %s OR department ILIKE %s)")
        params.extend([like, like, like, like])
    where = ("WHERE " + " AND ".join(clauses)) if clauses else ""
    with pool.connection() as conn:
        rows = conn.execute(
            f"SELECT {_COLS} FROM city_notices {where} "
            "ORDER BY is_pinned DESC, publish_at DESC, id DESC LIMIT 200",
            tuple(params),
        ).fetchall()
    return [_row_to_notice(r) for r in rows]


@router.post("", status_code=201)
def create_notice(
    body: NoticeIn,
    request: Request,
    user: dict = Depends(require_permission("notices.manage")),
):
    title = body.title.strip()
    if not title:
        raise HTTPException(status_code=400, detail="Title is required")
    exp_date = _parse_optional_date(body.expires_at)
    dead_date = _parse_optional_date(body.deadline_at)
    with pool.connection() as conn:
        row = conn.execute(
            f"INSERT INTO city_notices "
            "(title, category, summary, body, department, contact_info, attachment_url, "
            " expires_at, deadline_at, is_pinned, is_published, created_by) "
            "VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s) "
            f"RETURNING {_COLS}",
            (
                title,
                body.category,
                body.summary.strip(),
                body.body.strip(),
                body.department.strip(),
                body.contact_info.strip(),
                body.attachment_url.strip(),
                exp_date,
                dead_date,
                body.is_pinned,
                body.is_published,
                user["username"],
            ),
        ).fetchone()
    notice = _row_to_notice(row)
    record_audit(user["username"], "notice.create", f"[{body.category}] {title}")
    if body.is_published:
        send_notification_email(
            "notices_published",
            f"[DocketHall] {title}",
            f"A new {body.category.replace('_', ' ')} was published: {title}\n\n{body.summary.strip()}",
            link_path="/#notices",
            request=request,
        )
    return notice


@router.patch("/{notice_id}")
def update_notice(
    notice_id: int,
    body: NoticePatch,
    request: Request,
    user: dict = Depends(require_permission("notices.manage")),
):
    exp_date = _parse_optional_date(body.expires_at) if body.expires_at is not None else None
    dead_date = _parse_optional_date(body.deadline_at) if body.deadline_at is not None else None
    clear_exp = body.expires_at is not None and not body.expires_at.strip()
    clear_dead = body.deadline_at is not None and not body.deadline_at.strip()
    with pool.connection() as conn:
        prev = conn.execute("SELECT is_published FROM city_notices WHERE id = %s", (notice_id,)).fetchone()
        was_published = bool(prev and prev[0])
        row = conn.execute(
            f"UPDATE city_notices SET "
            "title = COALESCE(%s, title), "
            "category = COALESCE(%s, category), "
            "summary = COALESCE(%s, summary), "
            "body = COALESCE(%s, body), "
            "department = COALESCE(%s, department), "
            "contact_info = COALESCE(%s, contact_info), "
            "attachment_url = COALESCE(%s, attachment_url), "
            "expires_at = CASE WHEN %s THEN NULL ELSE COALESCE(%s, expires_at) END, "
            "deadline_at = CASE WHEN %s THEN NULL ELSE COALESCE(%s, deadline_at) END, "
            "is_pinned = COALESCE(%s, is_pinned), "
            "is_published = COALESCE(%s, is_published), "
            "updated_at = now() "
            f"WHERE id = %s RETURNING {_COLS}",
            (
                body.title.strip() if body.title is not None else None,
                body.category,
                body.summary.strip() if body.summary is not None else None,
                body.body.strip() if body.body is not None else None,
                body.department.strip() if body.department is not None else None,
                body.contact_info.strip() if body.contact_info is not None else None,
                body.attachment_url.strip() if body.attachment_url is not None else None,
                clear_exp,
                exp_date,
                clear_dead,
                dead_date,
                body.is_pinned,
                body.is_published,
                notice_id,
            ),
        ).fetchone()
        if not row:
            raise HTTPException(status_code=404, detail="Notice not found")
    record_audit(user["username"], "notice.update", f"Updated notice #{notice_id}")
    if not was_published and row[14]:
        send_notification_email(
            "notices_published",
            f"[DocketHall] {row[1]}",
            f"A {row[2].replace('_', ' ')} was published: {row[1]}\n\n{row[3] or ''}",
            link_path="/#notices",
            request=request,
        )
    return _row_to_notice(row)


@router.delete("/{notice_id}")
def delete_notice(
    notice_id: int,
    user: dict = Depends(require_permission("notices.manage")),
):
    with pool.connection() as conn:
        row = conn.execute("DELETE FROM city_notices WHERE id = %s RETURNING id, title", (notice_id,)).fetchone()
        if not row:
            raise HTTPException(status_code=404, detail="Notice not found")
    record_audit(user["username"], "notice.delete", f"Deleted notice #{notice_id}: {row[1]}")
    return {"deleted": True, "id": notice_id}


_SAFE_FILE_RE = re.compile(r"[^A-Za-z0-9._-]+")


@router.post("/{notice_id}/attachment")
async def upload_notice_attachment(
    notice_id: int,
    file: UploadFile = File(...),
    user: dict = Depends(require_permission("notices.manage")),
):
    raw = await file.read()
    if not raw or len(raw) > 25 * 1024 * 1024:
        raise HTTPException(status_code=400, detail="File must be non-empty and under 25 MB")
    orig = _SAFE_FILE_RE.sub("_", os.path.basename(file.filename or "attachment.pdf")) or "attachment.pdf"
    obj_key = tenant_object_key(f"notices/{notice_id}/{uuid.uuid4().hex[:12]}-{orig}")
    ctype = file.content_type or "application/octet-stream"
    _storage().put_object(_bucket(), obj_key, __import__("io").BytesIO(raw), length=len(raw), content_type=ctype)
    public_url = f"/api/notices/public/{notice_id}/attachment"
    with pool.connection() as conn:
        row = conn.execute(
            f"UPDATE city_notices SET attachment_key = %s, attachment_filename = %s, attachment_url = %s, updated_at = now() "
            f"WHERE id = %s RETURNING {_COLS}",
            (obj_key, orig, public_url, notice_id),
        ).fetchone()
        if not row:
            raise HTTPException(status_code=404, detail="Notice not found")
    record_audit(user["username"], "notice.attachment", f"Uploaded {orig} to notice #{notice_id}")
    return _row_to_notice(row)


@router.get("/public/{notice_id}/attachment")
def download_notice_attachment(notice_id: int):
    with pool.connection() as conn:
        row = conn.execute(
            "SELECT attachment_key, attachment_filename, is_published FROM city_notices WHERE id = %s",
            (notice_id,),
        ).fetchone()
    if not row or not row[0] or not row[2]:
        raise HTTPException(status_code=404, detail="Attachment not found")
    resp = _storage().get_object(_bucket(), row[0])
    try:
        data = resp.read()
    finally:
        resp.close()
        resp.release_conn()
    fname = row[1] or f"notice-{notice_id}.pdf"
    media = "application/pdf" if fname.lower().endswith(".pdf") else "application/octet-stream"
    return Response(
        content=data,
        media_type=media,
        headers={"Content-Disposition": f'inline; filename="{fname}"'},
    )


class NoticeResponseIn(BaseModel):
    applicant_name: str
    applicant_email: str = ""
    applicant_phone: str = ""
    organization: str = ""
    cover_note: str = ""


@router.post("/public/{notice_id}/respond", status_code=201)
def submit_notice_response(notice_id: int, body: NoticeResponseIn, request: Request):
    name = body.applicant_name.strip()
    if not name:
        raise HTTPException(status_code=400, detail="Your name is required")
    with pool.connection() as conn:
        n = conn.execute(
            "SELECT id, category, is_published, title FROM city_notices WHERE id = %s",
            (notice_id,),
        ).fetchone()
        if not n or not n[2]:
            raise HTTPException(status_code=404, detail="Posting not found")
        if n[1] not in ("job", "bid"):
            raise HTTPException(status_code=400, detail="Responses are only enabled for job and bid postings")
        rtype = "job_application" if n[1] == "job" else "bid_planholder"
        row = conn.execute(
            "INSERT INTO city_notice_responses "
            "(notice_id, response_type, applicant_name, applicant_email, applicant_phone, organization, cover_note) "
            "VALUES (%s, %s, %s, %s, %s, %s, %s) "
            "RETURNING id, notice_id, response_type, applicant_name, applicant_email, applicant_phone, organization, cover_note, created_at",
            (
                notice_id,
                rtype,
                name,
                body.applicant_email.strip(),
                body.applicant_phone.strip(),
                body.organization.strip(),
                body.cover_note.strip(),
            ),
        ).fetchone()
    send_notification_email(
        "notices_published",
        f"[DocketHall] New {'Job Application' if n[1] == 'job' else 'Bid Plan-Holder'}: {n[3]}",
        f"Submitted by {name} ({body.applicant_email.strip() or body.applicant_phone.strip() or 'no contact'}).",
        link_path="/app#notices-manage",
        request=request,
    )
    return {
        "id": row[0],
        "notice_id": row[1],
        "response_type": row[2],
        "applicant_name": row[3],
        "created_at": row[8].isoformat() if row[8] else None,
    }


@router.get("/{notice_id}/responses")
def list_notice_responses(notice_id: int, _: dict = Depends(require_permission("notices.manage"))):
    with pool.connection() as conn:
        rows = conn.execute(
            "SELECT id, notice_id, response_type, applicant_name, applicant_email, applicant_phone, organization, cover_note, created_at "
            "FROM city_notice_responses WHERE notice_id = %s ORDER BY id DESC",
            (notice_id,),
        ).fetchall()
    return {
        "items": [
            {
                "id": r[0],
                "notice_id": r[1],
                "response_type": r[2],
                "applicant_name": r[3],
                "applicant_email": r[4],
                "applicant_phone": r[5],
                "organization": r[6],
                "cover_note": r[7],
                "created_at": r[8].isoformat() if r[8] else None,
            }
            for r in rows
        ]
    }
