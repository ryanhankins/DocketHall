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
from typing import Literal

from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel

from .audit import record_audit
from .auth import require_permission
from .db import pool
from .integrations import send_notification_email

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
    publish_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    expires_at      DATE,
    deadline_at     DATE,
    is_pinned       BOOLEAN NOT NULL DEFAULT FALSE,
    is_published    BOOLEAN NOT NULL DEFAULT TRUE,
    created_by      TEXT NOT NULL DEFAULT '',
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS city_notices_cat_idx ON city_notices(category, is_published, publish_at DESC);
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
            f"[CivicDesk] {title}",
            f"A new {body.category.replace('_', ' ')} was published: {title}\n\n{body.summary.strip()}",
            link_path="/#notices",
            request=request,
        )
    return notice


@router.patch("/{notice_id}")
def update_notice(
    notice_id: int,
    body: NoticePatch,
    user: dict = Depends(require_permission("notices.manage")),
):
    exp_date = _parse_optional_date(body.expires_at) if body.expires_at is not None else None
    dead_date = _parse_optional_date(body.deadline_at) if body.deadline_at is not None else None
    clear_exp = body.expires_at is not None and not body.expires_at.strip()
    clear_dead = body.deadline_at is not None and not body.deadline_at.strip()
    with pool.connection() as conn:
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
