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

"""Staff agenda management and supporting document storage (MinIO)."""
import calendar
import hashlib
import io
import json
import os
import re
import uuid
from datetime import date
from typing import Literal

from fastapi import APIRouter, Depends, File, Form, HTTPException, Request, UploadFile
from fastapi.concurrency import run_in_threadpool
from fastapi.responses import Response, StreamingResponse
from minio import Minio
from minio.commonconfig import CopySource
from PIL import Image as PILImage
from pydantic import BaseModel

from .agenda_pdf import build_agenda_packet_pdf, build_minutes_pdf, render_single_document_pdf
from .audit import record_audit
from .auth import current_user, has_permission
from .db import _read_secret, pool
from .integrations import send_notification_email
from .storage import get_storage_client
from .subscriptions import notify_topic_subscribers
from .tenancy import tenant_object_key

STAFF_ROLES = {"admin_staff", "admin"}
COUNCIL_ACCESS_ROLES = STAFF_ROLES | {"council_member", "non_admin_staff"}
DEFAULT_BODIES = ["City Council", "Parks Committee", "Planning Commission"]
DEFAULT_SECTIONS = ["Opening", "Consent", "Old Business", "New Business", "Public Hearing", "Closing"]
DEFAULT_CATEGORIES = [
    {"name": "In-Progress Agendas", "warn_on_leave": False},
    {"name": "Finalized Agendas", "warn_on_leave": True},
]

ALLOWED_DOCS = {
    ".pdf": "application/pdf",
    ".docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    ".xlsx": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    ".pptx": "application/vnd.openxmlformats-officedocument.presentationml.presentation",
    ".csv": "text/csv",
    ".txt": "text/plain; charset=utf-8",
    ".md": "text/markdown; charset=utf-8",
    ".png": "image/png",
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
}
_ZIP_EXTS = {".docx", ".xlsx", ".pptx"}
_TEXT_EXTS = {".csv", ".txt", ".md"}
_SAFE_NAME_RE = re.compile(r"[^A-Za-z0-9._-]+")
MAX_DOC_BYTES = 100 * 1024 * 1024
MAX_LOGO_BYTES = 5 * 1024 * 1024

SCHEMA = """
CREATE TABLE IF NOT EXISTS agendas (
    id            BIGSERIAL PRIMARY KEY,
    title         TEXT NOT NULL,
    body          TEXT NOT NULL DEFAULT '',
    meeting_date  DATE,
    meeting_time  TEXT NOT NULL DEFAULT '',
    status        TEXT NOT NULL DEFAULT 'in_progress',
    finalized_at  TIMESTAMPTZ,
    created_by    BIGINT REFERENCES users(id) ON DELETE SET NULL,
    created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE agendas ADD COLUMN IF NOT EXISTS body TEXT NOT NULL DEFAULT '';
ALTER TABLE agendas ADD COLUMN IF NOT EXISTS meeting_time TEXT NOT NULL DEFAULT '';
ALTER TABLE agendas ADD COLUMN IF NOT EXISTS finalized_at TIMESTAMPTZ;
ALTER TABLE agendas ADD COLUMN IF NOT EXISTS minutes_attendance TEXT NOT NULL DEFAULT '';
ALTER TABLE agendas ADD COLUMN IF NOT EXISTS minutes_notes TEXT NOT NULL DEFAULT '';
ALTER TABLE agendas ADD COLUMN IF NOT EXISTS media_url TEXT NOT NULL DEFAULT '';
ALTER TABLE agendas ADD COLUMN IF NOT EXISTS media_type TEXT NOT NULL DEFAULT '';
ALTER TABLE agendas ADD COLUMN IF NOT EXISTS minutes_status TEXT NOT NULL DEFAULT 'draft';
ALTER TABLE agendas ADD COLUMN IF NOT EXISTS amended_at TIMESTAMPTZ;
CREATE TABLE IF NOT EXISTS agenda_items (
    id                  BIGSERIAL PRIMARY KEY,
    agenda_id           BIGINT REFERENCES agendas(id) ON DELETE CASCADE,
    position            INTEGER NOT NULL,
    title               TEXT NOT NULL,
    description         TEXT NOT NULL DEFAULT '',
    section             TEXT NOT NULL DEFAULT '',
    presenter           TEXT NOT NULL DEFAULT '',
    recommended_motion  TEXT NOT NULL DEFAULT '',
    fiscal_impact       TEXT NOT NULL DEFAULT '',
    revision_status     TEXT NOT NULL DEFAULT '',
    target_body         TEXT NOT NULL DEFAULT '',
    target_date         DATE,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE agenda_items ALTER COLUMN agenda_id DROP NOT NULL;
ALTER TABLE agenda_items ADD COLUMN IF NOT EXISTS target_body TEXT NOT NULL DEFAULT '';
ALTER TABLE agenda_items ADD COLUMN IF NOT EXISTS target_date DATE;
ALTER TABLE agenda_items ADD COLUMN IF NOT EXISTS todo_status TEXT NOT NULL DEFAULT 'open';
ALTER TABLE agenda_items ADD COLUMN IF NOT EXISTS assigned_to TEXT NOT NULL DEFAULT '';
ALTER TABLE agenda_items ADD COLUMN IF NOT EXISTS recurrence TEXT NOT NULL DEFAULT 'none';
ALTER TABLE agenda_items ADD COLUMN IF NOT EXISTS recurrence_month INTEGER;
ALTER TABLE agenda_items ADD COLUMN IF NOT EXISTS source_agenda_id BIGINT REFERENCES agendas(id) ON DELETE SET NULL;
ALTER TABLE agenda_items ADD COLUMN IF NOT EXISTS source_item_id BIGINT REFERENCES agenda_items(id) ON DELETE SET NULL;
ALTER TABLE agenda_items ADD COLUMN IF NOT EXISTS completed_at TIMESTAMPTZ;
ALTER TABLE agenda_items ADD COLUMN IF NOT EXISTS folder TEXT NOT NULL DEFAULT '';
CREATE TABLE IF NOT EXISTS backlog_agenda_links (
    backlog_item_id BIGINT NOT NULL REFERENCES agenda_items(id) ON DELETE CASCADE,
    agenda_id       BIGINT NOT NULL REFERENCES agendas(id) ON DELETE CASCADE,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (backlog_item_id, agenda_id)
);
ALTER TABLE agenda_items ADD COLUMN IF NOT EXISTS section TEXT NOT NULL DEFAULT '';
ALTER TABLE agenda_items ADD COLUMN IF NOT EXISTS presenter TEXT NOT NULL DEFAULT '';
ALTER TABLE agenda_items ADD COLUMN IF NOT EXISTS recommended_motion TEXT NOT NULL DEFAULT '';
ALTER TABLE agenda_items ADD COLUMN IF NOT EXISTS fiscal_impact TEXT NOT NULL DEFAULT '';
ALTER TABLE agenda_items ADD COLUMN IF NOT EXISTS revision_status TEXT NOT NULL DEFAULT '';
ALTER TABLE agenda_items ADD COLUMN IF NOT EXISTS minutes_action TEXT NOT NULL DEFAULT '';
ALTER TABLE agenda_items ADD COLUMN IF NOT EXISTS minutes_motion_by TEXT NOT NULL DEFAULT '';
ALTER TABLE agenda_items ADD COLUMN IF NOT EXISTS minutes_second_by TEXT NOT NULL DEFAULT '';
ALTER TABLE agenda_items ADD COLUMN IF NOT EXISTS minutes_vote TEXT NOT NULL DEFAULT '';
ALTER TABLE agenda_items ADD COLUMN IF NOT EXISTS minutes_notes TEXT NOT NULL DEFAULT '';
CREATE INDEX IF NOT EXISTS agenda_items_agenda_idx ON agenda_items(agenda_id, position);
CREATE TABLE IF NOT EXISTS agenda_status_log (
    id              BIGSERIAL PRIMARY KEY,
    agenda_id       BIGINT NOT NULL REFERENCES agendas(id) ON DELETE CASCADE,
    action          TEXT NOT NULL,
    actor_username  TEXT NOT NULL DEFAULT '',
    note            TEXT NOT NULL DEFAULT '',
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS agenda_status_log_idx ON agenda_status_log(agenda_id, created_at DESC, id DESC);
CREATE TABLE IF NOT EXISTS agenda_templates (
    id            BIGSERIAL PRIMARY KEY,
    name          TEXT NOT NULL,
    body          TEXT NOT NULL DEFAULT '',
    meeting_time  TEXT NOT NULL DEFAULT '',
    items         JSONB NOT NULL DEFAULT '[]'::jsonb,
    created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS agenda_documents (
    id              BIGSERIAL PRIMARY KEY,
    agenda_item_id  BIGINT NOT NULL REFERENCES agenda_items(id) ON DELETE CASCADE,
    position        INTEGER NOT NULL,
    title           TEXT NOT NULL,
    filename        TEXT NOT NULL,
    content_type    TEXT NOT NULL,
    size_bytes      BIGINT NOT NULL,
    sha256          TEXT NOT NULL,
    object_key      TEXT NOT NULL,
    uploaded_by     BIGINT REFERENCES users(id) ON DELETE SET NULL,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS agenda_docs_item_idx ON agenda_documents(agenda_item_id, position);
CREATE TABLE IF NOT EXISTS council_submissions (
    id                 BIGSERIAL PRIMARY KEY,
    submitted_by       BIGINT REFERENCES users(id) ON DELETE SET NULL,
    submitted_username TEXT NOT NULL DEFAULT '',
    title              TEXT NOT NULL,
    description        TEXT NOT NULL DEFAULT '',
    section            TEXT NOT NULL DEFAULT '',
    recommended_motion TEXT NOT NULL DEFAULT '',
    fiscal_impact      TEXT NOT NULL DEFAULT '',
    target_date        DATE,
    target_note        TEXT NOT NULL DEFAULT '',
    status             TEXT NOT NULL DEFAULT 'pending',
    accepted_agenda_id BIGINT REFERENCES agendas(id) ON DELETE SET NULL,
    accepted_item_id   BIGINT REFERENCES agenda_items(id) ON DELETE SET NULL,
    reviewed_by        BIGINT REFERENCES users(id) ON DELETE SET NULL,
    reviewed_username  TEXT NOT NULL DEFAULT '',
    review_note        TEXT NOT NULL DEFAULT '',
    created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
    reviewed_at        TIMESTAMPTZ
);
ALTER TABLE council_submissions ADD COLUMN IF NOT EXISTS target_agenda_id BIGINT REFERENCES agendas(id) ON DELETE SET NULL;
CREATE TABLE IF NOT EXISTS council_submission_documents (
    id                BIGSERIAL PRIMARY KEY,
    submission_id     BIGINT NOT NULL REFERENCES council_submissions(id) ON DELETE CASCADE,
    title             TEXT NOT NULL,
    filename          TEXT NOT NULL,
    content_type      TEXT NOT NULL,
    size_bytes        BIGINT NOT NULL,
    sha256            TEXT NOT NULL,
    object_key        TEXT NOT NULL,
    uploaded_by       BIGINT REFERENCES users(id) ON DELETE SET NULL,
    uploaded_username TEXT NOT NULL DEFAULT '',
    approval_status   TEXT NOT NULL DEFAULT 'approved',
    reviewed_by       BIGINT REFERENCES users(id) ON DELETE SET NULL,
    reviewed_username TEXT NOT NULL DEFAULT '',
    agenda_doc_id     BIGINT REFERENCES agenda_documents(id) ON DELETE SET NULL,
    created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
    reviewed_at       TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS council_sub_docs_idx ON council_submission_documents(submission_id, id);
CREATE TABLE IF NOT EXISTS agenda_preferences (
    id                         INTEGER PRIMARY KEY CHECK (id = 1),
    include_item_cover_sheets  BOOLEAN NOT NULL DEFAULT TRUE,
    include_page_numbers       BOOLEAN NOT NULL DEFAULT TRUE,
    city_name                  TEXT NOT NULL DEFAULT '',
    meeting_location           TEXT NOT NULL DEFAULT '',
    meeting_time               TEXT NOT NULL DEFAULT '',
    other_notes                TEXT NOT NULL DEFAULT '',
    footer_disclosures         TEXT NOT NULL DEFAULT '',
    bodies                     JSONB NOT NULL DEFAULT '["City Council", "Parks Committee", "Planning Commission"]'::jsonb,
    sections                   JSONB NOT NULL DEFAULT '["Opening", "Consent", "Old Business", "New Business", "Public Hearing", "Closing"]'::jsonb,
    categories                 JSONB NOT NULL DEFAULT '[{"name": "In-Progress Agendas", "warn_on_leave": false}, {"name": "Finalized Agendas", "warn_on_leave": true}]'::jsonb,
    city_logo_key              TEXT NOT NULL DEFAULT '',
    city_title                 TEXT NOT NULL DEFAULT '',
    updated_at                 TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE agenda_preferences ADD COLUMN IF NOT EXISTS include_page_numbers BOOLEAN NOT NULL DEFAULT TRUE;
ALTER TABLE agenda_preferences ADD COLUMN IF NOT EXISTS city_name TEXT NOT NULL DEFAULT '';
ALTER TABLE agenda_preferences ADD COLUMN IF NOT EXISTS meeting_location TEXT NOT NULL DEFAULT '';
ALTER TABLE agenda_preferences ADD COLUMN IF NOT EXISTS meeting_time TEXT NOT NULL DEFAULT '';
ALTER TABLE agenda_preferences ADD COLUMN IF NOT EXISTS other_notes TEXT NOT NULL DEFAULT '';
ALTER TABLE agenda_preferences ADD COLUMN IF NOT EXISTS footer_disclosures TEXT NOT NULL DEFAULT '';
ALTER TABLE agenda_preferences ADD COLUMN IF NOT EXISTS bodies JSONB NOT NULL DEFAULT '["City Council", "Parks Committee", "Planning Commission"]'::jsonb;
ALTER TABLE agenda_preferences ADD COLUMN IF NOT EXISTS sections JSONB NOT NULL DEFAULT '["Opening", "Consent", "Old Business", "New Business", "Public Hearing", "Closing"]'::jsonb;
ALTER TABLE agenda_preferences ADD COLUMN IF NOT EXISTS categories JSONB NOT NULL DEFAULT '[{"name": "In-Progress Agendas", "warn_on_leave": false}, {"name": "Finalized Agendas", "warn_on_leave": true}]'::jsonb;
ALTER TABLE agenda_preferences ADD COLUMN IF NOT EXISTS city_logo_key TEXT NOT NULL DEFAULT '';
ALTER TABLE agenda_preferences ADD COLUMN IF NOT EXISTS city_title TEXT NOT NULL DEFAULT '';
ALTER TABLE agenda_preferences ADD COLUMN IF NOT EXISTS backup_reminder_days INTEGER NOT NULL DEFAULT 0;
ALTER TABLE agenda_preferences ADD COLUMN IF NOT EXISTS last_backup_at TIMESTAMPTZ;
ALTER TABLE agenda_preferences ADD COLUMN IF NOT EXISTS posting_notice_hours INTEGER NOT NULL DEFAULT 72;
ALTER TABLE agenda_preferences ADD COLUMN IF NOT EXISTS alert_enabled BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE agenda_preferences ADD COLUMN IF NOT EXISTS alert_level TEXT NOT NULL DEFAULT 'danger';
ALTER TABLE agenda_preferences ADD COLUMN IF NOT EXISTS alert_title TEXT NOT NULL DEFAULT '';
ALTER TABLE agenda_preferences ADD COLUMN IF NOT EXISTS alert_message TEXT NOT NULL DEFAULT '';
ALTER TABLE agenda_preferences ADD COLUMN IF NOT EXISTS alert_link_url TEXT NOT NULL DEFAULT '';
ALTER TABLE agenda_preferences ADD COLUMN IF NOT EXISTS alert_link_label TEXT NOT NULL DEFAULT '';
ALTER TABLE agenda_preferences ADD COLUMN IF NOT EXISTS footer_text TEXT NOT NULL DEFAULT '';
ALTER TABLE agenda_preferences ADD COLUMN IF NOT EXISTS city_website_url TEXT NOT NULL DEFAULT '';
ALTER TABLE agenda_preferences ADD COLUMN IF NOT EXISTS city_website_label TEXT NOT NULL DEFAULT '';
ALTER TABLE agenda_preferences ADD COLUMN IF NOT EXISTS directory_url TEXT NOT NULL DEFAULT '';
ALTER TABLE agenda_preferences ADD COLUMN IF NOT EXISTS directory_label TEXT NOT NULL DEFAULT '';
ALTER TABLE agenda_preferences ADD COLUMN IF NOT EXISTS theme_primary TEXT NOT NULL DEFAULT '#2563eb';
ALTER TABLE agenda_preferences ADD COLUMN IF NOT EXISTS theme_secondary TEXT NOT NULL DEFAULT '#1d4ed8';
ALTER TABLE agenda_preferences ADD COLUMN IF NOT EXISTS theme_tint TEXT NOT NULL DEFAULT '#e6f0ff';
ALTER TABLE agenda_preferences ADD COLUMN IF NOT EXISTS theme_bg TEXT NOT NULL DEFAULT '#f3f5f8';
ALTER TABLE agenda_preferences ADD COLUMN IF NOT EXISTS theme_surface TEXT NOT NULL DEFAULT '#ffffff';
ALTER TABLE agenda_preferences ADD COLUMN IF NOT EXISTS theme_header_bg TEXT NOT NULL DEFAULT '#ffffff';
"""

def _minio():
    return get_storage_client()


def _bucket() -> str:
    return os.environ.get("MINIO_BUCKET", "records")


def _remove_minio_objects(keys: list[str]) -> None:
    if not keys:
        return
    client = _minio()
    bucket = _bucket()
    for key in keys:
        if not key:
            continue
        try:
            client.remove_object(bucket, key)
        except Exception:
            pass


async def _read_upload_limited(file: UploadFile, max_bytes: int, limit_label: str) -> bytes:
    chunks: list[bytes] = []
    total = 0
    while True:
        chunk = await file.read(1024 * 1024)
        if not chunk:
            break
        total += len(chunk)
        if total > max_bytes:
            raise HTTPException(
                status_code=413,
                detail=f"Uploaded file exceeds {limit_label} limit",
            )
        chunks.append(chunk)
    return b"".join(chunks)


def bootstrap() -> None:
    with pool.connection() as conn:
        conn.execute("SELECT pg_advisory_xact_lock(424243)")
        conn.execute(SCHEMA)
        conn.execute(
            "INSERT INTO agenda_preferences (id, include_item_cover_sheets) "
            "VALUES (1, TRUE) ON CONFLICT (id) DO NOTHING"
        )
        conn.execute(
            "UPDATE agendas SET status = 'In-Progress Agendas' WHERE status = 'in_progress'"
        )
        conn.execute(
            "UPDATE agendas SET status = 'Finalized Agendas' WHERE status = 'finalized'"
        )
        tpl_cnt = conn.execute("SELECT COUNT(*) FROM agenda_templates").fetchone()[0]
        if tpl_cnt == 0:
            default_items = [
                {"section": "Opening", "title": "Call to Order & Pledge of Allegiance", "description": "", "presenter": "Mayor", "recommended_motion": "", "fiscal_impact": ""},
                {"section": "Opening", "title": "Roll Call & Approval of Agenda", "description": "", "presenter": "City Clerk", "recommended_motion": "Move to approve the agenda as presented.", "fiscal_impact": "None"},
                {"section": "Public Input", "title": "Public Comment", "description": "Members of the public may address the Council for up to 3 minutes.", "presenter": "", "recommended_motion": "", "fiscal_impact": ""},
                {"section": "Consent Agenda", "title": "Approval of Prior Meeting Minutes", "description": "", "presenter": "City Clerk", "recommended_motion": "Move to approve the Consent Agenda.", "fiscal_impact": "None"},
                {"section": "New Business", "title": "Staff Reports & Resolutions", "description": "", "presenter": "City Manager", "recommended_motion": "", "fiscal_impact": ""},
                {"section": "Closing", "title": "Adjournment", "description": "", "presenter": "Mayor", "recommended_motion": "Move to adjourn.", "fiscal_impact": ""},
            ]
            conn.execute(
                "INSERT INTO agenda_templates (name, body, meeting_time, items) VALUES (%s, %s, %s, %s::jsonb)",
                ("Regular City Council Meeting", "City Council", "18:30", json.dumps(default_items)),
            )


def _is_agenda_staff(user: dict) -> bool:
    return has_permission(user, "agendas.manage") or has_permission(user, "settings.manage")


def get_staff_user(request: Request) -> dict:
    user = current_user(request)
    if not user:
        raise HTTPException(status_code=401, detail="Not authenticated")
    if not _is_agenda_staff(user):
        raise HTTPException(status_code=403, detail="Staff access required")
    return user


def get_council_or_staff_user(request: Request) -> dict:
    """Require an authenticated council member, staff member, or admin."""
    user = current_user(request)
    if not user:
        raise HTTPException(status_code=401, detail="Not authenticated")
    if not (_is_agenda_staff(user) or has_permission(user, "agendas.submit")):
        raise HTTPException(status_code=403, detail="Council or staff access required")
    return user


_COUNCIL_FINALIZED_WHERE = "(a.finalized_at IS NOT NULL OR LOWER(a.status) LIKE 'finalized%%')"


def _is_council_finalized(conn, agenda_id: int) -> bool:
    """Return True if agenda_id is a finalized agenda."""
    row = conn.execute(
        f"SELECT 1 FROM agendas a WHERE a.id = %s AND {_COUNCIL_FINALIZED_WHERE}",
        (agenda_id,),
    ).fetchone()
    return row is not None


def _touch_agenda(conn, agenda_id: int, *, mark_amended: bool = True) -> None:
    """Update updated_at and mark finalized agendas as amended when items/docs change."""
    if mark_amended and _is_council_finalized(conn, agenda_id):
        conn.execute(
            "UPDATE agendas SET updated_at = now(), amended_at = now() WHERE id = %s",
            (agenda_id,),
        )
    else:
        conn.execute("UPDATE agendas SET updated_at = now() WHERE id = %s", (agenda_id,))


def _validate_doc(filename: str, data: bytes) -> tuple[str, str]:
    ext = os.path.splitext(filename.lower())[1]
    if ext not in ALLOWED_DOCS:
        raise HTTPException(
            status_code=400,
            detail="Allowed formats: PDF, DOCX, XLSX, PPTX, CSV, PNG, JPG, TXT, MD",
        )
    if ext == ".pdf" and not data.startswith(b"%PDF-"):
        raise HTTPException(status_code=400, detail="File is not a valid PDF")
    if ext in _ZIP_EXTS and not data.startswith(b"PK\x03\x04"):
        raise HTTPException(status_code=400, detail=f"File is not a valid {ext.upper()[1:]}")
    if ext == ".png" and not data.startswith(b"\x89PNG\r\n\x1a\n"):
        raise HTTPException(status_code=400, detail="File is not a valid PNG")
    if ext in (".jpg", ".jpeg") and not data.startswith(b"\xff\xd8\xff"):
        raise HTTPException(status_code=400, detail="File is not a valid JPEG")
    if ext in _TEXT_EXTS and b"\x00" in data[:4096]:
        raise HTTPException(status_code=400, detail="File is not valid text")
    safe = _SAFE_NAME_RE.sub("_", os.path.basename(filename)).strip("._") or f"doc{ext}"
    return safe, ALLOWED_DOCS[ext]


def _renumber_items(conn, agenda_id: int) -> None:
    rows = conn.execute(
        "SELECT id FROM agenda_items WHERE agenda_id = %s ORDER BY position, id",
        (agenda_id,),
    ).fetchall()
    for idx, (item_id,) in enumerate(rows, start=1):
        conn.execute(
            "UPDATE agenda_items SET position = %s WHERE id = %s", (idx, item_id)
        )


def _renumber_docs(conn, item_id: int) -> None:
    rows = conn.execute(
        "SELECT id FROM agenda_documents WHERE agenda_item_id = %s ORDER BY position, id",
        (item_id,),
    ).fetchall()
    for idx, (doc_id,) in enumerate(rows, start=1):
        conn.execute(
            "UPDATE agenda_documents SET position = %s WHERE id = %s", (idx, doc_id)
        )


def _log_agenda_event(conn, agenda_id: int, action: str, actor: str = "", note: str = "") -> None:
    conn.execute(
        "INSERT INTO agenda_status_log (agenda_id, action, actor_username, note) "
        "VALUES (%s, %s, %s, %s)",
        (agenda_id, action, actor, note),
    )


def _doc_type_label(filename: str, content_type: str = "") -> str:
    fname_l = (filename or "").lower()
    if fname_l.endswith(".pdf"):
        return "PDF"
    if fname_l.endswith(".docx"):
        return "DOCX"
    if fname_l.endswith(".xlsx"):
        return "XLSX"
    if fname_l.endswith(".pptx"):
        return "PPTX"
    if fname_l.endswith(".csv"):
        return "CSV"
    if fname_l.endswith(".png"):
        return "PNG"
    if fname_l.endswith((".jpg", ".jpeg")):
        return "JPG"
    return "TEXT"


def _load_agenda(conn, agenda_id: int) -> dict | None:
    row = conn.execute(
        "SELECT id, title, body, meeting_date, meeting_time, status, finalized_at, "
        "       created_at, updated_at, minutes_attendance, minutes_notes, "
        "       media_url, media_type, minutes_status, amended_at "
        "FROM agendas WHERE id = %s",
        (agenda_id,),
    ).fetchone()
    if not row:
        return None

    item_rows = conn.execute(
        "SELECT id, position, title, description, section, presenter, "
        "       recommended_motion, fiscal_impact, revision_status, "
        "       minutes_action, minutes_motion_by, minutes_second_by, minutes_vote, minutes_notes "
        "FROM agenda_items WHERE agenda_id = %s ORDER BY position, id",
        (agenda_id,),
    ).fetchall()
    doc_rows = conn.execute(
        "SELECT d.id, d.agenda_item_id, d.position, d.title, d.filename, "
        "       d.content_type, d.size_bytes, d.sha256, d.created_at, d.object_key "
        "FROM agenda_documents d "
        "JOIN agenda_items i ON i.id = d.agenda_item_id "
        "WHERE i.agenda_id = %s ORDER BY d.position, d.id",
        (agenda_id,),
    ).fetchall()

    docs_by_item: dict[int, list[dict]] = {}
    for d in doc_rows:
        fname_l = d[4].lower()
        if fname_l.endswith(".pdf"):
            ext = "PDF"
        elif fname_l.endswith(".docx"):
            ext = "DOCX"
        elif fname_l.endswith(".xlsx"):
            ext = "XLSX"
        elif fname_l.endswith(".pptx"):
            ext = "PPTX"
        elif fname_l.endswith(".csv"):
            ext = "CSV"
        elif fname_l.endswith(".png"):
            ext = "PNG"
        elif fname_l.endswith((".jpg", ".jpeg")):
            ext = "JPG"
        else:
            ext = "TEXT"
        docs_by_item.setdefault(d[1], []).append({
            "id": d[0],
            "position": d[2],
            "title": d[3],
            "filename": d[4],
            "doc_type": ext,
            "content_type": d[5],
            "size_bytes": d[6],
            "sha256": d[7],
            "created_at": d[8].isoformat() if d[8] else None,
            "object_key": d[9],
        })

    log_rows = conn.execute(
        "SELECT id, action, actor_username, note, created_at "
        "FROM agenda_status_log WHERE agenda_id = %s ORDER BY created_at DESC, id DESC",
        (agenda_id,),
    ).fetchall()

    items = [
        {
            "id": it[0],
            "position": it[1],
            "title": it[2],
            "description": it[3],
            "section": it[4],
            "presenter": it[5],
            "recommended_motion": it[6],
            "fiscal_impact": it[7],
            "revision_status": it[8],
            "minutes_action": it[9],
            "minutes_motion_by": it[10],
            "minutes_second_by": it[11],
            "minutes_vote": it[12],
            "minutes_notes": it[13],
            "documents": docs_by_item.get(it[0], []),
        }
        for it in item_rows
    ]
    return {
        "id": row[0],
        "title": row[1],
        "body": row[2],
        "meeting_date": row[3].isoformat() if row[3] else None,
        "meeting_time": row[4],
        "status": row[5],
        "finalized_at": row[6].isoformat() if row[6] else None,
        "created_at": row[7].isoformat() if row[7] else None,
        "updated_at": row[8].isoformat() if row[8] else None,
        "minutes_attendance": row[9],
        "minutes_notes": row[10],
        "media_url": row[11],
        "media_type": row[12],
        "minutes_status": row[13],
        "amended_at": row[14].isoformat() if row[14] else None,
        "items": items,
        "activity_log": [
            {
                "id": lr[0],
                "action": lr[1],
                "actor": lr[2],
                "note": lr[3],
                "created_at": lr[4].isoformat() if lr[4] else None,
            }
            for lr in log_rows
        ],
    }


router = APIRouter(prefix="/api/agendas", tags=["agendas"])


def _validate_media(media_url: str | None, media_type: str | None) -> tuple[str | None, str | None]:
    url = media_url.strip() if media_url is not None else None
    mtype = media_type.strip().lower() if media_type is not None else None
    if mtype is not None and mtype not in ("", "video", "audio"):
        raise HTTPException(status_code=400, detail="Media type must be video, audio, or blank")
    if url is not None:
        if len(url) > 500:
            raise HTTPException(status_code=400, detail="Media URL cannot exceed 500 characters")
        if url and not url.startswith(("http://", "https://")):
            raise HTTPException(status_code=400, detail="Media URL must start with http:// or https://")
        if not url and mtype is None:
            mtype = ""
        elif url and (mtype is None or mtype == ""):
            mtype = "video"
    return url, mtype


class AgendaIn(BaseModel):
    title: str
    body: str
    meeting_date: date
    meeting_time: str | None = None
    template_id: int | None = None
    media_url: str | None = None
    media_type: Literal["", "video", "audio"] | None = None


class AgendaPatch(BaseModel):
    title: str | None = None
    body: str | None = None
    meeting_date: date | None = None
    meeting_time: str | None = None
    status: str | None = None
    minutes_attendance: str | None = None
    minutes_notes: str | None = None
    media_url: str | None = None
    media_type: Literal["", "video", "audio"] | None = None
    minutes_status: Literal["draft", "approved"] | None = None


class ItemIn(BaseModel):
    title: str
    description: str = ""
    section: str = ""
    presenter: str = ""
    recommended_motion: str = ""
    fiscal_impact: str = ""
    revision_status: Literal["", "revised", "addendum"] = ""


RecurrenceType = Literal[
    "none",
    "every_agenda",
    "monthly",
    "quarterly",
    "yearly",
    "first_agenda_month",
]
TodoStatus = Literal["open", "in_progress", "done"]


class BacklogItemIn(ItemIn):
    target_body: str = ""
    target_date: date | None = None
    todo_status: TodoStatus = "open"
    assigned_to: str = ""
    recurrence: RecurrenceType = "none"
    recurrence_month: int | None = None
    source_agenda_id: int | None = None
    source_item_id: int | None = None
    folder: str = ""


class BacklogItemPatch(BaseModel):
    title: str | None = None
    description: str | None = None
    section: str | None = None
    presenter: str | None = None
    recommended_motion: str | None = None
    fiscal_impact: str | None = None
    revision_status: Literal["", "revised", "addendum"] | None = None
    target_body: str | None = None
    target_date: date | None = None
    clear_target_date: bool = False
    todo_status: TodoStatus | None = None
    assigned_to: str | None = None
    recurrence: RecurrenceType | None = None
    recurrence_month: int | None = None
    advance_recurring: bool = True
    folder: str | None = None


class MoveItemIn(BaseModel):
    target_agenda_id: int
    copy: bool = False


class MoveSectionIn(BaseModel):
    section: str
    target_agenda_id: int
    copy: bool = False


class MoveToBacklogIn(BaseModel):
    target_body: str | None = None
    target_date: date | None = None


class ItemPatch(BaseModel):
    title: str | None = None
    description: str | None = None
    section: str | None = None
    presenter: str | None = None
    recommended_motion: str | None = None
    fiscal_impact: str | None = None
    revision_status: Literal["", "revised", "addendum"] | None = None
    minutes_action: str | None = None
    minutes_motion_by: str | None = None
    minutes_second_by: str | None = None
    minutes_vote: str | None = None
    minutes_notes: str | None = None
    direction: str | None = None  # "up" | "down"
    position: int | None = None


class SaveTemplateIn(BaseModel):
    name: str


class ReorderItemsIn(BaseModel):
    item_ids: list[int]


class TextDocIn(BaseModel):
    title: str
    content: str


class DocPatch(BaseModel):
    title: str | None = None
    content: str | None = None
    position: int | None = None
    target_item_id: int | None = None


class AgendaCategoryIn(BaseModel):
    name: str
    warn_on_leave: bool = False


class GeneralPreferencesIn(BaseModel):
    city_title: str = ""
    alert_enabled: bool = False
    alert_level: Literal["danger", "warning", "info"] = "danger"
    alert_title: str = ""
    alert_message: str = ""
    alert_link_url: str = ""
    alert_link_label: str = ""
    footer_text: str = ""
    city_website_url: str = ""
    city_website_label: str = ""
    directory_url: str = ""
    directory_label: str = ""
    theme_primary: str = "#2563eb"
    theme_secondary: str = "#1d4ed8"
    theme_tint: str = "#e6f0ff"
    theme_bg: str = "#f3f5f8"
    theme_surface: str = "#ffffff"
    theme_header_bg: str = "#ffffff"


class AgendaPreferencesIn(BaseModel):
    include_item_cover_sheets: bool = True
    include_page_numbers: bool = True
    city_name: str = ""
    meeting_location: str = ""
    meeting_time: str = ""
    other_notes: str = ""
    footer_disclosures: str = ""
    bodies: list[str] = list(DEFAULT_BODIES)
    sections: list[str] = list(DEFAULT_SECTIONS)
    categories: list[AgendaCategoryIn] = [AgendaCategoryIn(**c) for c in DEFAULT_CATEGORIES]
    posting_notice_hours: int = 72


DEFAULT_THEME_COLORS = {
    "theme_primary": "#2563eb",
    "theme_secondary": "#1d4ed8",
    "theme_tint": "#e6f0ff",
    "theme_bg": "#f3f5f8",
    "theme_surface": "#ffffff",
    "theme_header_bg": "#ffffff",
}
_HEX_COLOR_RE = re.compile(r"^#[0-9a-fA-F]{6}$")


def _validate_hex_color(value: str, fallback: str, label: str) -> str:
    clean = (value or "").strip()
    if not clean:
        return fallback
    if not _HEX_COLOR_RE.match(clean):
        raise HTTPException(status_code=400, detail=f"{label} must be a 6-digit hex color like #2d4a2d")
    return clean.lower()


def _load_preferences(conn) -> dict:
    row = conn.execute(
        "SELECT include_item_cover_sheets, include_page_numbers, "
        "       city_name, meeting_location, meeting_time, other_notes, "
        "       footer_disclosures, bodies, city_logo_key, sections, categories, "
        "       city_title, posting_notice_hours, "
        "       alert_enabled, alert_level, alert_title, alert_message, alert_link_url, alert_link_label, "
        "       footer_text, city_website_url, city_website_label, "
        "       theme_primary, theme_secondary, theme_tint, theme_bg, theme_surface, theme_header_bg, "
        "       directory_url, directory_label "
        "FROM agenda_preferences WHERE id = 1"
    ).fetchone()
    if not row:
        return {
            "include_item_cover_sheets": True,
            "include_page_numbers": True,
            "city_title": "",
            "city_name": "",
            "meeting_location": "",
            "meeting_time": "",
            "other_notes": "",
            "footer_disclosures": "",
            "bodies": list(DEFAULT_BODIES),
            "sections": list(DEFAULT_SECTIONS),
            "categories": [dict(c) for c in DEFAULT_CATEGORIES],
            "posting_notice_hours": 72,
            "alert_enabled": False,
            "alert_level": "danger",
            "alert_title": "",
            "alert_message": "",
            "alert_link_url": "",
            "alert_link_label": "",
            "footer_text": "",
            "city_website_url": "",
            "city_website_label": "",
            "directory_url": "",
            "directory_label": "",
            **DEFAULT_THEME_COLORS,
            "city_logo_key": "",
            "has_city_logo": False,
        }
    logo_key = row[8] or ""
    raw_cats = row[10] if row[10] else DEFAULT_CATEGORIES
    cats = [
        {"name": str(c.get("name", "")).strip(), "warn_on_leave": bool(c.get("warn_on_leave", False))}
        for c in raw_cats
        if isinstance(c, dict) and str(c.get("name", "")).strip()
    ]
    if not cats:
        cats = [dict(c) for c in DEFAULT_CATEGORIES]
    return {
        "include_item_cover_sheets": bool(row[0]),
        "include_page_numbers": bool(row[1]),
        "city_title": row[11] or "",
        "city_name": row[2],
        "meeting_location": row[3],
        "meeting_time": row[4],
        "other_notes": row[5],
        "footer_disclosures": row[6],
        "bodies": list(row[7]) if row[7] else list(DEFAULT_BODIES),
        "sections": list(row[9]) if row[9] is not None else list(DEFAULT_SECTIONS),
        "categories": cats,
        "posting_notice_hours": int(row[12]) if row[12] is not None else 72,
        "alert_enabled": bool(row[13]),
        "alert_level": row[14] or "danger",
        "alert_title": row[15] or "",
        "alert_message": row[16] or "",
        "alert_link_url": row[17] or "",
        "alert_link_label": row[18] or "",
        "footer_text": row[19] or "",
        "city_website_url": row[20] or "",
        "city_website_label": row[21] or "",
        "theme_primary": row[22] or DEFAULT_THEME_COLORS["theme_primary"],
        "theme_secondary": row[23] or DEFAULT_THEME_COLORS["theme_secondary"],
        "theme_tint": row[24] or DEFAULT_THEME_COLORS["theme_tint"],
        "theme_bg": row[25] or DEFAULT_THEME_COLORS["theme_bg"],
        "theme_surface": row[26] or DEFAULT_THEME_COLORS["theme_surface"],
        "theme_header_bg": row[27] or DEFAULT_THEME_COLORS["theme_header_bg"],
        "directory_url": row[28] or "",
        "directory_label": row[29] or "",
        "city_logo_key": logo_key,
        "has_city_logo": bool(logo_key),
    }


@router.get("/preferences")
def get_preferences(_: dict = Depends(get_staff_user)):
    with pool.connection() as conn:
        return _load_preferences(conn)


@router.get("/preferences/branding")
def get_preferences_branding():
    with pool.connection() as conn:
        prefs = _load_preferences(conn)
    return {
        "city_title": prefs.get("city_title", ""),
        "has_city_logo": bool(prefs.get("has_city_logo", False)),
        "alert_enabled": bool(prefs.get("alert_enabled", False)),
        "alert_level": prefs.get("alert_level", "danger"),
        "alert_title": prefs.get("alert_title", ""),
        "alert_message": prefs.get("alert_message", ""),
        "alert_link_url": prefs.get("alert_link_url", ""),
        "alert_link_label": prefs.get("alert_link_label", ""),
        "footer_text": prefs.get("footer_text", ""),
        "city_website_url": prefs.get("city_website_url", ""),
        "city_website_label": prefs.get("city_website_label", ""),
        "directory_url": prefs.get("directory_url", ""),
        "directory_label": prefs.get("directory_label", ""),
        "theme_primary": prefs.get("theme_primary", DEFAULT_THEME_COLORS["theme_primary"]),
        "theme_secondary": prefs.get("theme_secondary", DEFAULT_THEME_COLORS["theme_secondary"]),
        "theme_tint": prefs.get("theme_tint", DEFAULT_THEME_COLORS["theme_tint"]),
        "theme_bg": prefs.get("theme_bg", DEFAULT_THEME_COLORS["theme_bg"]),
        "theme_surface": prefs.get("theme_surface", DEFAULT_THEME_COLORS["theme_surface"]),
        "theme_header_bg": prefs.get("theme_header_bg", DEFAULT_THEME_COLORS["theme_header_bg"]),
    }


def _validate_optional_http_url(url: str, field_label: str) -> str:
    clean = url.strip()
    if not clean:
        return ""
    if not clean.startswith(("http://", "https://")) or len(clean) > 500:
        raise HTTPException(status_code=400, detail=f"{field_label} must start with http:// or https://")
    return clean


@router.put("/preferences/general")
def update_general_preferences(body: GeneralPreferencesIn, _: dict = Depends(get_staff_user)):
    alert_url = _validate_optional_http_url(body.alert_link_url, "Alert link URL")
    city_url = _validate_optional_http_url(body.city_website_url, "Main city website URL")
    directory_url = _validate_optional_http_url(body.directory_url, "Contact / Directory URL")
    theme_primary = _validate_hex_color(body.theme_primary, DEFAULT_THEME_COLORS["theme_primary"], "Primary color")
    theme_secondary = _validate_hex_color(body.theme_secondary, DEFAULT_THEME_COLORS["theme_secondary"], "Secondary color")
    theme_tint = _validate_hex_color(body.theme_tint, DEFAULT_THEME_COLORS["theme_tint"], "Highlight tint color")
    theme_bg = _validate_hex_color(body.theme_bg, DEFAULT_THEME_COLORS["theme_bg"], "Page background color")
    theme_surface = _validate_hex_color(body.theme_surface, DEFAULT_THEME_COLORS["theme_surface"], "Card & sidebar color")
    theme_header_bg = _validate_hex_color(body.theme_header_bg, DEFAULT_THEME_COLORS["theme_header_bg"], "Header background color")
    with pool.connection() as conn:
        conn.execute(
            "INSERT INTO agenda_preferences "
            "(id, city_title, alert_enabled, alert_level, alert_title, alert_message, "
            " alert_link_url, alert_link_label, footer_text, city_website_url, city_website_label, "
            " theme_primary, theme_secondary, theme_tint, theme_bg, theme_surface, theme_header_bg, "
            " directory_url, directory_label, updated_at) "
            "VALUES (1, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, now()) "
            "ON CONFLICT (id) DO UPDATE SET "
            "city_title = EXCLUDED.city_title, "
            "alert_enabled = EXCLUDED.alert_enabled, "
            "alert_level = EXCLUDED.alert_level, "
            "alert_title = EXCLUDED.alert_title, "
            "alert_message = EXCLUDED.alert_message, "
            "alert_link_url = EXCLUDED.alert_link_url, "
            "alert_link_label = EXCLUDED.alert_link_label, "
            "footer_text = EXCLUDED.footer_text, "
            "city_website_url = EXCLUDED.city_website_url, "
            "city_website_label = EXCLUDED.city_website_label, "
            "theme_primary = EXCLUDED.theme_primary, "
            "theme_secondary = EXCLUDED.theme_secondary, "
            "theme_tint = EXCLUDED.theme_tint, "
            "theme_bg = EXCLUDED.theme_bg, "
            "theme_surface = EXCLUDED.theme_surface, "
            "theme_header_bg = EXCLUDED.theme_header_bg, "
            "directory_url = EXCLUDED.directory_url, "
            "directory_label = EXCLUDED.directory_label, "
            "updated_at = now()",
            (
                body.city_title.strip(),
                bool(body.alert_enabled),
                body.alert_level,
                body.alert_title.strip(),
                body.alert_message.strip(),
                alert_url,
                body.alert_link_label.strip(),
                body.footer_text.strip(),
                city_url,
                body.city_website_label.strip(),
                theme_primary,
                theme_secondary,
                theme_tint,
                theme_bg,
                theme_surface,
                theme_header_bg,
                directory_url,
                body.directory_label.strip(),
            ),
        )
        return _load_preferences(conn)


_LOGO_MEDIA = {"png": "image/png", "jpg": "image/jpeg", "jpeg": "image/jpeg"}


@router.post("/preferences/logo")
async def upload_preferences_logo(
    file: UploadFile = File(...),
    _: dict = Depends(get_staff_user),
):
    raw = await _read_upload_limited(file, MAX_LOGO_BYTES, "5 MB")
    if not raw:
        raise HTTPException(status_code=400, detail="Uploaded logo file is empty")

    def _process_and_store_logo() -> dict:
        try:
            with PILImage.open(io.BytesIO(raw)) as im:
                fmt = (im.format or "").upper()
                im.verify()
        except Exception:
            raise HTTPException(status_code=400, detail="Uploaded file is not a valid image")

        if fmt == "JPEG":
            ext = "jpg"
            content_type = "image/jpeg"
            out_bytes = raw
        elif fmt == "PNG":
            ext = "png"
            content_type = "image/png"
            out_bytes = raw
        elif fmt in ("GIF", "WEBP", "BMP", "TIFF"):
            with PILImage.open(io.BytesIO(raw)) as im:
                buf = io.BytesIO()
                im.convert("RGBA").save(buf, format="PNG")
                out_bytes = buf.getvalue()
            ext = "png"
            content_type = "image/png"
        else:
            raise HTTPException(status_code=400, detail="Unsupported image format; use PNG or JPEG")

        new_key = tenant_object_key(f"preferences/city_logo_{uuid.uuid4().hex[:12]}.{ext}")
        _minio().put_object(
            _bucket(),
            new_key,
            io.BytesIO(out_bytes),
            length=len(out_bytes),
            content_type=content_type,
        )

        with pool.connection() as conn:
            old_row = conn.execute(
                "SELECT city_logo_key FROM agenda_preferences WHERE id = 1"
            ).fetchone()
            old_key = old_row[0] if old_row else ""
            conn.execute(
                "UPDATE agenda_preferences SET city_logo_key = %s, updated_at = now() WHERE id = 1",
                (new_key,),
            )
            prefs = _load_preferences(conn)

        if old_key and old_key != new_key:
            _remove_minio_objects([old_key])
        return prefs

    return await run_in_threadpool(_process_and_store_logo)


@router.get("/preferences/logo")
def get_preferences_logo():
    with pool.connection() as conn:
        prefs = _load_preferences(conn)
    key = prefs.get("city_logo_key") or ""
    if not key:
        raise HTTPException(status_code=404, detail="No city logo configured")

    ext = key.rsplit(".", 1)[-1].lower() if "." in key else "png"
    media_type = _LOGO_MEDIA.get(ext, "image/png")
    try:
        obj = _minio().get_object(_bucket(), key)
        try:
            data = obj.read()
        finally:
            obj.close()
            obj.release_conn()
    except Exception:
        raise HTTPException(status_code=404, detail="City logo file not found")

    return Response(
        content=data,
        media_type=media_type,
        headers={"Cache-Control": "no-store"},
    )


@router.delete("/preferences/logo")
def delete_preferences_logo(_: dict = Depends(get_staff_user)):
    with pool.connection() as conn:
        old_row = conn.execute(
            "SELECT city_logo_key FROM agenda_preferences WHERE id = 1"
        ).fetchone()
        old_key = old_row[0] if old_row else ""
        conn.execute(
            "UPDATE agenda_preferences SET city_logo_key = '', updated_at = now() WHERE id = 1"
        )
        prefs = _load_preferences(conn)

    _remove_minio_objects([old_key] if old_key else [])
    return prefs


@router.put("/preferences")
def update_preferences(body: AgendaPreferencesIn, _: dict = Depends(get_staff_user)):
    clean_bodies: list[str] = []
    seen: set[str] = set()
    for b in body.bodies:
        name = b.strip()
        if name and name not in seen:
            clean_bodies.append(name)
            seen.add(name)
    if not clean_bodies:
        raise HTTPException(status_code=400, detail="At least one governing body is required")

    clean_sections: list[str] = []
    seen_sec: set[str] = set()
    for s in body.sections:
        sname = s.strip()
        if sname and sname not in seen_sec:
            clean_sections.append(sname)
            seen_sec.add(sname)

    clean_categories: list[dict] = []
    seen_cat: set[str] = set()
    for c in body.categories:
        cname = c.name.strip()
        if cname and cname not in seen_cat:
            clean_categories.append({"name": cname, "warn_on_leave": bool(c.warn_on_leave)})
            seen_cat.add(cname)
    if not clean_categories:
        raise HTTPException(status_code=400, detail="At least one agenda category is required")

    vals = (
        body.include_item_cover_sheets,
        body.include_page_numbers,
        body.city_name.strip(),
        body.meeting_location.strip(),
        body.meeting_time.strip(),
        body.other_notes.strip(),
        body.footer_disclosures.strip(),
        json.dumps(clean_bodies),
        json.dumps(clean_sections),
        json.dumps(clean_categories),
        max(0, int(body.posting_notice_hours)),
    )
    with pool.connection() as conn:
        in_use = conn.execute(
            "SELECT status, COUNT(*) FROM agendas WHERE status <> '' GROUP BY status"
        ).fetchall()
        for cat_name, count in in_use:
            if cat_name not in seen_cat:
                raise HTTPException(
                    status_code=400,
                    detail=f'Cannot remove category "{cat_name}" while {count} agenda(s) are assigned to it',
                )
        conn.execute(
            "INSERT INTO agenda_preferences "
            "(id, include_item_cover_sheets, include_page_numbers, "
            " city_name, meeting_location, meeting_time, other_notes, "
            " footer_disclosures, bodies, sections, categories, posting_notice_hours, updated_at) "
            "VALUES (1, %s, %s, %s, %s, %s, %s, %s, %s::jsonb, %s::jsonb, %s::jsonb, %s, now()) "
            "ON CONFLICT (id) DO UPDATE SET "
            "include_item_cover_sheets = EXCLUDED.include_item_cover_sheets, "
            "include_page_numbers = EXCLUDED.include_page_numbers, "
            "city_name = EXCLUDED.city_name, "
            "meeting_location = EXCLUDED.meeting_location, "
            "meeting_time = EXCLUDED.meeting_time, "
            "other_notes = EXCLUDED.other_notes, "
            "footer_disclosures = EXCLUDED.footer_disclosures, "
            "bodies = EXCLUDED.bodies, "
            "sections = EXCLUDED.sections, "
            "categories = EXCLUDED.categories, "
            "posting_notice_hours = EXCLUDED.posting_notice_hours, "
            "updated_at = now()",
            vals,
        )
        return _load_preferences(conn)


@router.get("/templates")
def list_templates(_: dict = Depends(get_staff_user)):
    with pool.connection() as conn:
        rows = conn.execute(
            "SELECT id, name, body, meeting_time, items, created_at, updated_at "
            "FROM agenda_templates ORDER BY name, id"
        ).fetchall()
    return [
        {
            "id": r[0],
            "name": r[1],
            "body": r[2],
            "meeting_time": r[3],
            "items": list(r[4]) if r[4] else [],
            "item_count": len(r[4]) if r[4] else 0,
            "created_at": r[5].isoformat() if r[5] else None,
            "updated_at": r[6].isoformat() if r[6] else None,
        }
        for r in rows
    ]


@router.delete("/templates/{template_id}")
def delete_template(template_id: int, _: dict = Depends(get_staff_user)):
    with pool.connection() as conn:
        row = conn.execute(
            "DELETE FROM agenda_templates WHERE id = %s RETURNING id", (template_id,)
        ).fetchone()
        if not row:
            raise HTTPException(status_code=404, detail="Template not found")
    return {"deleted": True, "id": template_id}


def _add_months(d: date, months: int) -> date:
    month_idx = (d.month - 1) + months
    year = d.year + month_idx // 12
    month = (month_idx % 12) + 1
    max_day = calendar.monthrange(year, month)[1]
    return date(year, month, min(d.day, max_day))


def _advance_due_date(
    d: date | None, recurrence: str, recurrence_month: int | None
) -> date | None:
    base = d or date.today()
    if recurrence == "monthly":
        return _add_months(base, 1)
    if recurrence == "quarterly":
        return _add_months(base, 3)
    if recurrence == "yearly":
        return _add_months(base, 12)
    if recurrence == "first_agenda_month" and recurrence_month:
        next_year = base.year + (1 if base.month >= recurrence_month else 0)
        return date(next_year, recurrence_month, 1)
    return d


def _load_backlog(conn) -> list[dict]:
    item_rows = conn.execute(
        "SELECT i.id, i.position, i.title, i.description, i.section, i.presenter, "
        "       i.recommended_motion, i.fiscal_impact, i.revision_status, "
        "       i.target_body, i.target_date, i.todo_status, i.assigned_to, "
        "       i.recurrence, i.recurrence_month, i.source_agenda_id, a.title, "
        "       i.source_item_id, i.completed_at, i.created_at, i.folder "
        "FROM agenda_items i "
        "LEFT JOIN agendas a ON a.id = i.source_agenda_id "
        "WHERE i.agenda_id IS NULL "
        "ORDER BY CASE WHEN i.todo_status = 'done' THEN 1 ELSE 0 END, "
        "         i.target_date ASC NULLS LAST, i.position, i.id"
    ).fetchall()
    item_ids = [r[0] for r in item_rows]
    docs_by_item: dict[int, list[dict]] = {iid: [] for iid in item_ids}
    if item_ids:
        doc_rows = conn.execute(
            "SELECT id, agenda_item_id, position, title, filename, content_type, size_bytes, sha256, object_key, created_at "
            "FROM agenda_documents WHERE agenda_item_id = ANY(%s) ORDER BY position, id",
            (item_ids,),
        ).fetchall()
        for dr in doc_rows:
            docs_by_item[dr[1]].append({
                "id": dr[0],
                "position": dr[2],
                "title": dr[3],
                "filename": dr[4],
                "content_type": dr[5],
                "doc_type": _doc_type_label(dr[4], dr[5]),
                "size_bytes": dr[6],
                "sha256": dr[7],
                "object_key": dr[8],
                "created_at": dr[9].isoformat() if dr[9] else None,
            })
    return [
        {
            "id": it[0],
            "position": it[1],
            "title": it[2],
            "description": it[3],
            "section": it[4],
            "presenter": it[5],
            "recommended_motion": it[6],
            "fiscal_impact": it[7],
            "revision_status": it[8],
            "target_body": it[9],
            "target_date": it[10].isoformat() if it[10] else None,
            "todo_status": it[11],
            "assigned_to": it[12],
            "recurrence": it[13],
            "recurrence_month": it[14],
            "source_agenda_id": it[15],
            "source_agenda_title": it[16] or "",
            "source_item_id": it[17],
            "completed_at": it[18].isoformat() if it[18] else None,
            "created_at": it[19].isoformat() if it[19] else None,
            "folder": it[20] or "",
            "documents": docs_by_item[it[0]],
        }
        for it in item_rows
    ]


@router.get("/backlog")
def list_backlog(_: dict = Depends(get_staff_user)):
    with pool.connection() as conn:
        return _load_backlog(conn)


@router.get("/backlog/for-agenda/{agenda_id}")
def backlog_for_agenda(agenda_id: int, _: dict = Depends(get_staff_user)):
    with pool.connection() as conn:
        ag = conn.execute(
            "SELECT id, body, meeting_date FROM agendas WHERE id = %s",
            (agenda_id,),
        ).fetchone()
        if not ag:
            raise HTTPException(status_code=404, detail="Agenda not found")
        ag_body = ag[1] or ""
        ag_date: date = ag[2] or date.today()
        linked_ids = {
            r[0]
            for r in conn.execute(
                "SELECT backlog_item_id FROM backlog_agenda_links WHERE agenda_id = %s",
                (agenda_id,),
            ).fetchall()
        }
        is_first_in_month = False
        if ag[2]:
            month_start = date(ag_date.year, ag_date.month, 1)
            month_end = _add_months(month_start, 1)
            earlier = conn.execute(
                "SELECT 1 FROM agendas "
                "WHERE body = %s AND meeting_date >= %s AND meeting_date < %s "
                "  AND (meeting_date < %s OR (meeting_date = %s AND id < %s)) "
                "LIMIT 1",
                (ag_body, month_start, month_end, ag_date, ag_date, agenda_id),
            ).fetchone()
            is_first_in_month = earlier is None

        matching: list[dict] = []
        for it in _load_backlog(conn):
            if it["todo_status"] == "done":
                continue
            if it["id"] in linked_ids:
                continue
            if it["target_body"] and ag_body and it["target_body"] != ag_body:
                continue
            if it["target_body"] and not ag_body:
                continue

            rec = it["recurrence"]
            if rec == "every_agenda":
                matching.append(it)
            elif rec == "first_agenda_month":
                rm = it["recurrence_month"]
                if rm and ag[2] and ag_date.month == rm and is_first_in_month:
                    matching.append(it)
            elif it["target_date"]:
                if date.fromisoformat(it["target_date"]) <= ag_date:
                    matching.append(it)
        return matching


@router.post("/backlog", status_code=201)
def create_backlog_item(body: BacklogItemIn, _: dict = Depends(get_staff_user)):
    title = body.title.strip()
    if not title:
        raise HTTPException(status_code=400, detail="Item title is required")
    rec_month = body.recurrence_month
    if body.recurrence == "first_agenda_month":
        if not rec_month or not (1 <= rec_month <= 12):
            raise HTTPException(
                status_code=400,
                detail="Month (1-12) is required for first-agenda-of-month recurrence",
            )
    else:
        rec_month = None
    with pool.connection() as conn:
        next_pos = conn.execute(
            "SELECT COALESCE(MAX(position), 0) + 1 FROM agenda_items WHERE agenda_id IS NULL"
        ).fetchone()[0]
        conn.execute(
            "INSERT INTO agenda_items "
            "(agenda_id, position, title, description, section, presenter, recommended_motion, "
            " fiscal_impact, revision_status, target_body, target_date, todo_status, assigned_to, "
            " recurrence, recurrence_month, source_agenda_id, source_item_id, folder) "
            "VALUES (NULL, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)",
            (
                next_pos,
                title,
                body.description.strip(),
                body.section.strip(),
                body.presenter.strip(),
                body.recommended_motion.strip(),
                body.fiscal_impact.strip(),
                body.revision_status,
                body.target_body.strip(),
                body.target_date,
                body.todo_status,
                body.assigned_to.strip(),
                body.recurrence,
                rec_month,
                body.source_agenda_id,
                body.source_item_id,
                body.folder.strip(),
            ),
        )
        return _load_backlog(conn)


@router.patch("/backlog/{item_id}")
def update_backlog_item(item_id: int, body: BacklogItemPatch, _: dict = Depends(get_staff_user)):
    if body.title is not None and not body.title.strip():
        raise HTTPException(status_code=400, detail="Item title cannot be empty")
    with pool.connection() as conn:
        cur = conn.execute(
            "SELECT target_date, recurrence, recurrence_month, todo_status "
            "FROM agenda_items WHERE id = %s AND agenda_id IS NULL",
            (item_id,),
        ).fetchone()
        if not cur:
            raise HTTPException(status_code=404, detail="Backlog item not found")
        cur_due, cur_rec, cur_month, cur_status = cur
        next_rec = body.recurrence if body.recurrence is not None else cur_rec
        next_month = body.recurrence_month if body.recurrence_month is not None else cur_month
        if next_rec != "first_agenda_month":
            next_month = None
        elif not next_month or not (1 <= next_month <= 12):
            raise HTTPException(
                status_code=400,
                detail="Month (1-12) is required for first-agenda-of-month recurrence",
            )
        next_status = body.todo_status if body.todo_status is not None else cur_status
        next_due = None if body.clear_target_date else (body.target_date if body.target_date is not None else cur_due)
        completed_at_set = False
        completed_at_clear = False
        if (
            body.todo_status == "done"
            and body.advance_recurring
            and next_rec in ("monthly", "quarterly", "yearly", "first_agenda_month")
        ):
            next_due = _advance_due_date(next_due, next_rec, next_month)
            next_status = "open"
            completed_at_clear = True
        elif body.todo_status == "done" and cur_status != "done":
            completed_at_set = True
        elif body.todo_status is not None and body.todo_status != "done" and cur_status == "done":
            completed_at_clear = True

        conn.execute(
            "UPDATE agenda_items SET "
            "title = COALESCE(%s, title), "
            "description = COALESCE(%s, description), "
            "section = COALESCE(%s, section), "
            "presenter = COALESCE(%s, presenter), "
            "recommended_motion = COALESCE(%s, recommended_motion), "
            "fiscal_impact = COALESCE(%s, fiscal_impact), "
            "revision_status = COALESCE(%s, revision_status), "
            "target_body = COALESCE(%s, target_body), "
            "target_date = %s, "
            "assigned_to = COALESCE(%s, assigned_to), "
            "recurrence = %s, "
            "recurrence_month = %s, "
            "todo_status = %s, "
            "folder = COALESCE(%s, folder), "
            "completed_at = CASE WHEN %s THEN now() WHEN %s THEN NULL ELSE completed_at END "
            "WHERE id = %s AND agenda_id IS NULL",
            (
                body.title.strip() if body.title is not None else None,
                body.description.strip() if body.description is not None else None,
                body.section.strip() if body.section is not None else None,
                body.presenter.strip() if body.presenter is not None else None,
                body.recommended_motion.strip() if body.recommended_motion is not None else None,
                body.fiscal_impact.strip() if body.fiscal_impact is not None else None,
                body.revision_status,
                body.target_body.strip() if body.target_body is not None else None,
                next_due,
                body.assigned_to.strip() if body.assigned_to is not None else None,
                next_rec,
                next_month,
                next_status,
                body.folder.strip() if body.folder is not None else None,
                completed_at_set,
                completed_at_clear,
                item_id,
            ),
        )
        return _load_backlog(conn)


@router.delete("/backlog/{item_id}")
def delete_backlog_item(item_id: int, _: dict = Depends(get_staff_user)):
    with pool.connection() as conn:
        keys = [
            r[0]
            for r in conn.execute(
                "SELECT object_key FROM agenda_documents WHERE agenda_item_id = %s",
                (item_id,),
            ).fetchall()
        ]
        row = conn.execute(
            "DELETE FROM agenda_items WHERE id = %s AND agenda_id IS NULL RETURNING id",
            (item_id,),
        ).fetchone()
        if not row:
            raise HTTPException(status_code=404, detail="Backlog item not found")
        items = _load_backlog(conn)
    _remove_minio_objects(keys)
    return items


@router.post("/backlog/{item_id}/documents", status_code=201)
async def upload_backlog_document(
    item_id: int,
    file: UploadFile = File(...),
    title: str = Form(""),
    user: dict = Depends(get_staff_user),
):
    data = await _read_upload_limited(file, MAX_DOC_BYTES, "100 MB")
    if not data:
        raise HTTPException(status_code=400, detail="Uploaded file is empty")
    safe_name, content_type = _validate_doc(file.filename or "", data)
    doc_title = title.strip() or safe_name
    digest = hashlib.sha256(data).hexdigest()

    def _store() -> list[dict]:
        with pool.connection() as conn:
            if not conn.execute(
                "SELECT 1 FROM agenda_items WHERE id = %s AND agenda_id IS NULL",
                (item_id,),
            ).fetchone():
                raise HTTPException(status_code=404, detail="Backlog item not found")
            next_pos = conn.execute(
                "SELECT COALESCE(MAX(position), 0) + 1 FROM agenda_documents WHERE agenda_item_id = %s",
                (item_id,),
            ).fetchone()[0]
            object_key = tenant_object_key(f"backlog/{item_id}/{digest[:12]}_{safe_name}")
            _minio().put_object(
                _bucket(),
                object_key,
                io.BytesIO(data),
                length=len(data),
                content_type=content_type,
            )
            conn.execute(
                "INSERT INTO agenda_documents "
                "(agenda_item_id, position, title, filename, content_type, size_bytes, sha256, object_key, uploaded_by) "
                "VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s)",
                (item_id, next_pos, doc_title, safe_name, content_type, len(data), digest, object_key, user["id"]),
            )
            return _load_backlog(conn)

    return await run_in_threadpool(_store)


@router.delete("/backlog/{item_id}/documents/{doc_id}")
def delete_backlog_document(item_id: int, doc_id: int, _: dict = Depends(get_staff_user)):
    with pool.connection() as conn:
        row = conn.execute(
            "DELETE FROM agenda_documents d USING agenda_items i "
            "WHERE d.id = %s AND d.agenda_item_id = i.id AND i.id = %s AND i.agenda_id IS NULL "
            "RETURNING d.object_key",
            (doc_id, item_id),
        ).fetchone()
        if not row:
            raise HTTPException(status_code=404, detail="Document not found")
        _renumber_docs(conn, item_id)
        items = _load_backlog(conn)
    _remove_minio_objects([row[0]])
    return items


@router.get("/backlog/documents/{doc_id}/download")
def download_backlog_document(doc_id: int, _: dict = Depends(get_staff_user)):
    with pool.connection() as conn:
        row = conn.execute(
            "SELECT d.filename, d.content_type, d.object_key "
            "FROM agenda_documents d "
            "JOIN agenda_items i ON i.id = d.agenda_item_id "
            "WHERE d.id = %s AND i.agenda_id IS NULL",
            (doc_id,),
        ).fetchone()
    if not row:
        raise HTTPException(status_code=404, detail="Document not found")
    filename, content_type, object_key = row
    try:
        obj = _minio().get_object(_bucket(), object_key)
    except Exception:
        raise HTTPException(status_code=404, detail="Document file not found")
    inline_types = ("application/pdf", "image/png", "image/jpeg")
    is_inline = content_type in inline_types or content_type.startswith(("text/plain", "text/markdown"))
    disp = "inline" if is_inline else "attachment"

    def stream():
        try:
            for chunk in obj.stream(65536):
                yield chunk
        finally:
            obj.close()
            obj.release_conn()

    return StreamingResponse(
        stream(),
        media_type=content_type,
        headers={"Content-Disposition": f'{disp}; filename="{filename}"'},
    )


@router.get("/backlog/documents/{doc_id}/pdf")
def view_backlog_document_as_pdf(doc_id: int, _: dict = Depends(get_staff_user)):
    with pool.connection() as conn:
        backlog = _load_backlog(conn)
    target_item = None
    target_doc = None
    for it in backlog:
        for d in it["documents"]:
            if d["id"] == doc_id:
                target_item, target_doc = it, d
                break
        if target_doc:
            break
    if not target_doc:
        raise HTTPException(status_code=404, detail="Document not found")
    try:
        obj = _minio().get_object(_bucket(), target_doc["object_key"])
        try:
            raw = obj.read()
        finally:
            obj.close()
            obj.release_conn()
    except Exception:
        raise HTTPException(status_code=404, detail="Document file not found")
    pdf_bytes = render_single_document_pdf(target_item, target_doc, raw)
    base = os.path.splitext(target_doc["filename"])[0]
    return Response(
        content=pdf_bytes,
        media_type="application/pdf",
        headers={"Content-Disposition": f'inline; filename="{base}.pdf"'},
    )


@router.post("/backlog/{item_id}/assign")
def assign_backlog_item(
    item_id: int,
    body: MoveItemIn,
    user: dict = Depends(get_staff_user),
):
    with pool.connection() as conn:
        item = conn.execute(
            "SELECT title, recurrence, target_date, recurrence_month "
            "FROM agenda_items WHERE id = %s AND agenda_id IS NULL",
            (item_id,),
        ).fetchone()
        if not item:
            raise HTTPException(status_code=404, detail="Backlog item not found")
        target = conn.execute(
            "SELECT title, meeting_date FROM agendas WHERE id = %s", (body.target_agenda_id,)
        ).fetchone()
        if not target:
            raise HTTPException(status_code=404, detail="Target agenda not found")
        next_pos = conn.execute(
            "SELECT COALESCE(MAX(position), 0) + 1 FROM agenda_items WHERE agenda_id = %s",
            (body.target_agenda_id,),
        ).fetchone()[0]
        is_recurring = item[1] != "none"
        if body.copy or is_recurring:
            _copy_item_to_agenda(conn, item_id, body.target_agenda_id, next_pos)
            conn.execute(
                "INSERT INTO backlog_agenda_links (backlog_item_id, agenda_id) "
                "VALUES (%s, %s) ON CONFLICT DO NOTHING",
                (item_id, body.target_agenda_id),
            )
            if is_recurring and item[1] in ("monthly", "quarterly", "yearly", "first_agenda_month"):
                next_due = _advance_due_date(target[1] or item[2], item[1], item[3])
                conn.execute(
                    "UPDATE agenda_items SET target_date = %s WHERE id = %s",
                    (next_due, item_id),
                )
            _log_agenda_event(conn, body.target_agenda_id, f'added "{item[0]}" from Todos & Backlog', user["username"])
        else:
            conn.execute(
                "UPDATE agenda_items SET agenda_id = %s, position = %s WHERE id = %s",
                (body.target_agenda_id, next_pos, item_id),
            )
            _log_agenda_event(conn, body.target_agenda_id, f'added "{item[0]}" from Todos & Backlog', user["username"])
        _touch_agenda(conn, body.target_agenda_id)
        return _load_backlog(conn)


@router.get("")
def list_agendas(status: str | None = None, _: dict = Depends(get_staff_user)):
    sql = (
        "SELECT a.id, a.title, a.body, a.meeting_date, a.meeting_time, a.status, a.finalized_at, "
        "       a.created_at, a.updated_at, a.media_url, a.media_type, a.minutes_status, a.amended_at, "
        "       COUNT(DISTINCT i.id) AS item_count, "
        "       COUNT(d.id) AS doc_count "
        "FROM agendas a "
        "LEFT JOIN agenda_items i ON i.agenda_id = a.id "
        "LEFT JOIN agenda_documents d ON d.agenda_item_id = i.id "
    )
    params: list = []
    if status:
        sql += "WHERE a.status = %s "
        params.append(status)
    sql += "GROUP BY a.id ORDER BY a.updated_at DESC, a.id DESC"

    with pool.connection() as conn:
        rows = conn.execute(sql, params).fetchall()
    return [
        {
            "id": r[0],
            "title": r[1],
            "body": r[2],
            "meeting_date": r[3].isoformat() if r[3] else None,
            "meeting_time": r[4],
            "status": r[5],
            "finalized_at": r[6].isoformat() if r[6] else None,
            "created_at": r[7].isoformat() if r[7] else None,
            "updated_at": r[8].isoformat() if r[8] else None,
            "media_url": r[9],
            "media_type": r[10],
            "minutes_status": r[11],
            "amended_at": r[12].isoformat() if r[12] else None,
            "item_count": r[13],
            "doc_count": r[14],
        }
        for r in rows
    ]


@router.post("", status_code=201)
def create_agenda(body: AgendaIn, user: dict = Depends(get_staff_user)):
    title = body.title.strip()
    governing_body = body.body.strip()
    if not title:
        raise HTTPException(status_code=400, detail="Agenda title is required")
    if not governing_body:
        raise HTTPException(status_code=400, detail="Governing body is required")
    with pool.connection() as conn:
        prefs = _load_preferences(conn)
        if governing_body not in prefs["bodies"]:
            raise HTTPException(
                status_code=400, detail="Body must be one of the configured agenda bodies"
            )
        mtime = (
            body.meeting_time.strip()
            if body.meeting_time is not None
            else prefs["meeting_time"]
        )
        default_status = prefs["categories"][0]["name"] if prefs.get("categories") else "In-Progress Agendas"
        row = conn.execute(
            "INSERT INTO agendas (title, body, meeting_date, meeting_time, status, created_by) "
            "VALUES (%s, %s, %s, %s, %s, %s) RETURNING id",
            (title, governing_body, body.meeting_date, mtime, default_status, user["id"]),
        ).fetchone()
        agenda_id = row[0]

        note = ""
        if body.template_id is not None:
            trow = conn.execute(
                "SELECT name, items FROM agenda_templates WHERE id = %s",
                (body.template_id,),
            ).fetchone()
            if not trow:
                raise HTTPException(status_code=404, detail="Template not found")
            note = f"From template: {trow[0]}"
            for idx, it in enumerate(trow[1] or [], start=1):
                conn.execute(
                    "INSERT INTO agenda_items "
                    "(agenda_id, position, title, description, section, presenter, recommended_motion, fiscal_impact) "
                    "VALUES (%s, %s, %s, %s, %s, %s, %s, %s)",
                    (
                        agenda_id,
                        idx,
                        str(it.get("title", "")).strip() or f"Item {idx}",
                        str(it.get("description", "")).strip(),
                        str(it.get("section", "")).strip(),
                        str(it.get("presenter", "")).strip(),
                        str(it.get("recommended_motion", "")).strip(),
                        str(it.get("fiscal_impact", "")).strip(),
                    ),
                )
        _log_agenda_event(conn, agenda_id, "created", user["username"], note)
        return _load_agenda(conn, agenda_id)


class CouncilSubmissionIn(BaseModel):
    title: str
    description: str = ""
    section: str = ""
    recommended_motion: str = ""
    fiscal_impact: str = ""
    target_agenda_id: int | None = None
    target_date: date | None = None
    target_note: str = ""


class AcceptSubmissionIn(BaseModel):
    agenda_id: int | None = None
    new_agenda_title: str | None = None
    new_agenda_date: date | None = None


class DeclineSubmissionIn(BaseModel):
    review_note: str = ""


@router.get("/council/targets")
def list_council_target_agendas(_: dict = Depends(get_council_or_staff_user)):
    """Return minimal info (id, title, meeting_date) for in-progress council agendas as submission targets."""
    sql = (
        "SELECT id, title, body, meeting_date "
        "FROM agendas "
        "WHERE STRPOS(LOWER(body), 'council') > 0 "
        "  AND status = 'In-Progress Agendas' "
        "ORDER BY meeting_date ASC NULLS LAST, id DESC"
    )
    with pool.connection() as conn:
        rows = conn.execute(sql).fetchall()
    return [
        {
            "id": r[0],
            "title": r[1],
            "body": r[2],
            "meeting_date": r[3].isoformat() if r[3] else None,
        }
        for r in rows
    ]


@router.get("/council/submissions")
def list_council_submissions(user: dict = Depends(get_council_or_staff_user)):
    """List council item submissions (own submissions for council, pending/recent for staff)."""
    sql = (
        "SELECT s.id, s.submitted_username, s.title, s.description, s.section, "
        "       s.recommended_motion, s.fiscal_impact, s.target_date, s.target_note, "
        "       s.status, s.accepted_agenda_id, a.title AS accepted_agenda_title, "
        "       a.meeting_date AS accepted_agenda_date, s.reviewed_username, "
        "       s.review_note, s.created_at, s.reviewed_at, "
        "       s.target_agenda_id, ta.title AS target_agenda_title, "
        "       ta.meeting_date AS target_agenda_date "
        "FROM council_submissions s "
        "LEFT JOIN agendas a ON a.id = s.accepted_agenda_id "
        "LEFT JOIN agendas ta ON ta.id = s.target_agenda_id "
    )
    params: list = []
    if not has_permission(user, "agendas.manage"):
        sql += "WHERE s.submitted_by = %s "
        params.append(user["id"])
    else:
        sql += (
            "WHERE s.status = 'pending' "
            "   OR EXISTS (SELECT 1 FROM council_submission_documents sd "
            "              WHERE sd.submission_id = s.id AND sd.approval_status = 'pending') "
        )
    sql += "ORDER BY s.created_at DESC, s.id DESC"

    with pool.connection() as conn:
        rows = conn.execute(sql, params).fetchall()
        sub_ids = [r[0] for r in rows]
        docs_by_sub: dict[int, list[dict]] = {sid: [] for sid in sub_ids}
        if sub_ids:
            doc_rows = conn.execute(
                "SELECT id, submission_id, title, filename, size_bytes, approval_status, "
                "       uploaded_username, created_at "
                "FROM council_submission_documents "
                "WHERE submission_id = ANY(%s) ORDER BY id ASC",
                (sub_ids,),
            ).fetchall()
            for dr in doc_rows:
                docs_by_sub[dr[1]].append({
                    "id": dr[0],
                    "title": dr[2],
                    "filename": dr[3],
                    "size_bytes": dr[4],
                    "approval_status": dr[5],
                    "uploaded_username": dr[6],
                    "created_at": dr[7].isoformat() if dr[7] else None,
                })
    return [
        {
            "id": r[0],
            "submitted_username": r[1],
            "title": r[2],
            "description": r[3],
            "section": r[4],
            "recommended_motion": r[5],
            "fiscal_impact": r[6],
            "target_date": r[7].isoformat() if r[7] else None,
            "target_note": r[8],
            "status": r[9],
            "accepted_agenda_id": r[10],
            "accepted_agenda_title": r[11],
            "accepted_agenda_date": r[12].isoformat() if r[12] else None,
            "reviewed_username": r[13],
            "review_note": r[14],
            "created_at": r[15].isoformat() if r[15] else None,
            "reviewed_at": r[16].isoformat() if r[16] else None,
            "target_agenda_id": r[17],
            "target_agenda_title": r[18],
            "target_agenda_date": r[19].isoformat() if r[19] else None,
            "documents": docs_by_sub.get(r[0], []),
        }
        for r in rows
    ]


@router.post("/council/submissions", status_code=201)
def create_council_submission(
    body: CouncilSubmissionIn,
    request: Request,
    user: dict = Depends(get_council_or_staff_user),
):
    """Submit a pending agenda item from a council member."""
    title = body.title.strip()
    if not title:
        raise HTTPException(status_code=400, detail="Item title is required")
    with pool.connection() as conn:
        if body.target_agenda_id is not None:
            trow = conn.execute(
                "SELECT 1 FROM agendas WHERE id = %s AND STRPOS(LOWER(body), 'council') > 0 "
                "AND status = 'In-Progress Agendas'",
                (body.target_agenda_id,),
            ).fetchone()
            if not trow:
                raise HTTPException(status_code=400, detail="Selected target agenda is not available")
        row = conn.execute(
            "INSERT INTO council_submissions "
            "(submitted_by, submitted_username, title, description, section, "
            " recommended_motion, fiscal_impact, target_agenda_id, target_date, target_note, status) "
            "VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, 'pending') "
            "RETURNING id, created_at",
            (
                user["id"],
                user["username"],
                title,
                body.description.strip(),
                body.section.strip(),
                body.recommended_motion.strip(),
                body.fiscal_impact.strip(),
                body.target_agenda_id,
                body.target_date,
                body.target_note.strip(),
            ),
        ).fetchone()
    send_notification_email(
        "agendas_council_submission",
        f"[CivicDesk] New Council Submission: {title}",
        f"{user['username']} submitted a proposed agenda item: {title}.",
        link_path="/app#council",
        request=request,
    )
    return {
        "id": row[0],
        "submitted_username": user["username"],
        "title": title,
        "description": body.description.strip(),
        "section": body.section.strip(),
        "recommended_motion": body.recommended_motion.strip(),
        "fiscal_impact": body.fiscal_impact.strip(),
        "target_agenda_id": body.target_agenda_id,
        "target_date": body.target_date.isoformat() if body.target_date else None,
        "target_note": body.target_note.strip(),
        "status": "pending",
        "created_at": row[1].isoformat() if row[1] else None,
    }


def _attach_submission_doc_to_item(
    conn,
    sub_doc_id: int,
    title: str,
    filename: str,
    content_type: str,
    size_bytes: int,
    sha256: str,
    src_key: str,
    agenda_id: int,
    item_id: int,
    uploaded_by: int | None,
) -> int:
    """Copy a submission attachment in MinIO onto an agenda item and link agenda_doc_id."""
    bucket = _bucket()
    dst_key = f"agendas/{agenda_id}/{item_id}/{uuid.uuid4().hex[:12]}_{filename}"
    _minio().copy_object(bucket, dst_key, CopySource(bucket, src_key))
    doc_pos = conn.execute(
        "SELECT COALESCE(MAX(position), 0) + 1 FROM agenda_documents WHERE agenda_item_id = %s",
        (item_id,),
    ).fetchone()[0]
    drow = conn.execute(
        "INSERT INTO agenda_documents "
        "(agenda_item_id, position, title, filename, content_type, size_bytes, sha256, object_key, uploaded_by) "
        "VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s) RETURNING id",
        (item_id, doc_pos, title, filename, content_type, size_bytes, sha256, dst_key, uploaded_by),
    ).fetchone()
    agenda_doc_id = drow[0]
    conn.execute(
        "UPDATE council_submission_documents SET agenda_doc_id = %s WHERE id = %s",
        (agenda_doc_id, sub_doc_id),
    )
    return agenda_doc_id


@router.post("/council/submissions/{sub_id}/documents", status_code=201)
async def upload_council_submission_document(
    sub_id: int,
    file: UploadFile = File(...),
    title: str = Form(""),
    user: dict = Depends(get_council_or_staff_user),
):
    """Attach a document to a council submission (requires staff approval if already accepted)."""
    data = await _read_upload_limited(file, MAX_DOC_BYTES, "100 MB")
    safe_name, content_type = _validate_doc(file.filename or "document", data)
    doc_title = title.strip() or os.path.splitext(safe_name)[0].replace("_", " ").strip() or safe_name
    sha = hashlib.sha256(data).hexdigest()

    def _store() -> dict:
        with pool.connection() as conn:
            sub = conn.execute(
                "SELECT submitted_by, status FROM council_submissions WHERE id = %s",
                (sub_id,),
            ).fetchone()
            if not sub:
                raise HTTPException(status_code=404, detail="Submission not found")
            if not has_permission(user, "agendas.manage") and sub[0] != user["id"]:
                raise HTTPException(status_code=403, detail="You may only attach files to your own submissions")
            if sub[1] == "declined":
                raise HTTPException(status_code=400, detail="Cannot attach files to a declined submission")

            approval_status = "pending" if (sub[1] == "accepted" and not has_permission(user, "agendas.manage")) else "approved"
            obj_key = tenant_object_key(f"submissions/{sub_id}/{uuid.uuid4().hex[:12]}_{safe_name}")
            _minio().put_object(
                _bucket(), obj_key, io.BytesIO(data), length=len(data), content_type=content_type
            )
            row = conn.execute(
                "INSERT INTO council_submission_documents "
                "(submission_id, title, filename, content_type, size_bytes, sha256, object_key, "
                " uploaded_by, uploaded_username, approval_status) "
                "VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s) RETURNING id, created_at",
                (
                    sub_id, doc_title, safe_name, content_type, len(data), sha, obj_key,
                    user["id"], user["username"], approval_status,
                ),
            ).fetchone()

            if sub[1] == "accepted" and approval_status == "approved":
                acc = conn.execute(
                    "SELECT accepted_agenda_id, accepted_item_id FROM council_submissions WHERE id = %s",
                    (sub_id,),
                ).fetchone()
                if acc and acc[0] and acc[1]:
                    _attach_submission_doc_to_item(
                        conn, row[0], doc_title, safe_name, content_type,
                        len(data), sha, obj_key, acc[0], acc[1], user["id"],
                    )

            return {
                "id": row[0],
                "title": doc_title,
                "filename": safe_name,
                "size_bytes": len(data),
                "approval_status": approval_status,
                "uploaded_username": user["username"],
                "created_at": row[1].isoformat() if row[1] else None,
            }

    return await run_in_threadpool(_store)


@router.post("/council/submissions/{sub_id}/documents/{doc_id}/approve")
def approve_council_submission_document(
    sub_id: int, doc_id: int, user: dict = Depends(get_staff_user)
):
    """Approve a pending post-acceptance attachment and add it to the agenda item."""
    with pool.connection() as conn:
        row = conn.execute(
            "SELECT sd.id, sd.title, sd.filename, sd.content_type, sd.size_bytes, sd.sha256, "
            "       sd.object_key, sd.uploaded_by, sd.approval_status, "
            "       s.accepted_agenda_id, s.accepted_item_id "
            "FROM council_submission_documents sd "
            "JOIN council_submissions s ON s.id = sd.submission_id "
            "WHERE sd.id = %s AND sd.submission_id = %s",
            (doc_id, sub_id),
        ).fetchone()
        if not row:
            raise HTTPException(status_code=404, detail="Submission document not found")
        if row[8] != "pending":
            raise HTTPException(status_code=400, detail="Document is not pending approval")
        if not row[9] or not row[10]:
            raise HTTPException(status_code=400, detail="Submission is not linked to an agenda item")
        agenda_doc_id = _attach_submission_doc_to_item(
            conn, row[0], row[1], row[2], row[3], row[4], row[5], row[6],
            row[9], row[10], row[7],
        )
        conn.execute(
            "UPDATE council_submission_documents "
            "SET approval_status = 'approved', reviewed_by = %s, reviewed_username = %s, reviewed_at = now() "
            "WHERE id = %s",
            (user["id"], user["username"], doc_id),
        )
        _touch_agenda(conn, row[9])
    return {"status": "approved", "agenda_doc_id": agenda_doc_id}


@router.post("/council/submissions/{sub_id}/documents/{doc_id}/decline")
def decline_council_submission_document(
    sub_id: int, doc_id: int, user: dict = Depends(get_staff_user)
):
    """Decline a pending post-acceptance attachment on a council submission."""
    with pool.connection() as conn:
        row = conn.execute(
            "SELECT approval_status FROM council_submission_documents "
            "WHERE id = %s AND submission_id = %s",
            (doc_id, sub_id),
        ).fetchone()
        if not row:
            raise HTTPException(status_code=404, detail="Submission document not found")
        if row[0] != "pending":
            raise HTTPException(status_code=400, detail="Document is not pending approval")
        conn.execute(
            "UPDATE council_submission_documents "
            "SET approval_status = 'declined', reviewed_by = %s, reviewed_username = %s, reviewed_at = now() "
            "WHERE id = %s",
            (user["id"], user["username"], doc_id),
        )
    return {"status": "declined"}


@router.post("/council/submissions/{sub_id}/accept")
def accept_council_submission(
    sub_id: int, body: AcceptSubmissionIn, user: dict = Depends(get_staff_user)
):
    """Accept a pending council submission onto an existing or newly created agenda."""
    with pool.connection() as conn:
        sub = conn.execute(
            "SELECT id, title, description, section, recommended_motion, fiscal_impact, "
            "       target_date, submitted_username, status "
            "FROM council_submissions WHERE id = %s",
            (sub_id,),
        ).fetchone()
        if not sub:
            raise HTTPException(status_code=404, detail="Submission not found")
        if sub[8] != "pending":
            raise HTTPException(status_code=400, detail="Submission has already been reviewed")

        agenda_id = body.agenda_id
        if agenda_id is None:
            new_title = (body.new_agenda_title or "").strip()
            if not new_title:
                raise HTTPException(
                    status_code=400,
                    detail="Select an existing agenda or provide a title for a new agenda",
                )
            prefs = _load_preferences(conn)
            council_body = next(
                (b for b in prefs["bodies"] if "council" in b.lower()),
                prefs["bodies"][0] if prefs["bodies"] else "City Council",
            )
            default_status = (
                prefs["categories"][0]["name"] if prefs.get("categories") else "In-Progress Agendas"
            )
            mdate = body.new_agenda_date or sub[6]
            arow = conn.execute(
                "INSERT INTO agendas (title, body, meeting_date, meeting_time, status, created_by) "
                "VALUES (%s, %s, %s, %s, %s, %s) RETURNING id",
                (new_title, council_body, mdate, prefs["meeting_time"], default_status, user["id"]),
            ).fetchone()
            agenda_id = arow[0]
            _log_agenda_event(conn, agenda_id, "created", user["username"], "From council submission")
        else:
            exists = conn.execute("SELECT 1 FROM agendas WHERE id = %s", (agenda_id,)).fetchone()
            if not exists:
                raise HTTPException(status_code=404, detail="Target agenda not found")

        pos = conn.execute(
            "SELECT COALESCE(MAX(position), 0) + 1 FROM agenda_items WHERE agenda_id = %s",
            (agenda_id,),
        ).fetchone()[0]
        irow = conn.execute(
            "INSERT INTO agenda_items "
            "(agenda_id, position, title, description, section, presenter, recommended_motion, fiscal_impact) "
            "VALUES (%s, %s, %s, %s, %s, %s, %s, %s) RETURNING id",
            (agenda_id, pos, sub[1], sub[2], sub[3], sub[7], sub[4], sub[5]),
        ).fetchone()
        item_id = irow[0]
        sub_docs = conn.execute(
            "SELECT id, title, filename, content_type, size_bytes, sha256, object_key, uploaded_by "
            "FROM council_submission_documents "
            "WHERE submission_id = %s AND approval_status != 'declined' ORDER BY id ASC",
            (sub_id,),
        ).fetchall()
        for sd in sub_docs:
            _attach_submission_doc_to_item(
                conn, sd[0], sd[1], sd[2], sd[3], sd[4], sd[5], sd[6],
                agenda_id, item_id, sd[7],
            )
            conn.execute(
                "UPDATE council_submission_documents "
                "SET approval_status = 'approved', reviewed_by = %s, reviewed_username = %s, reviewed_at = now() "
                "WHERE id = %s",
                (user["id"], user["username"], sd[0]),
            )
        _touch_agenda(conn, agenda_id)
        conn.execute(
            "UPDATE council_submissions "
            "SET status = 'accepted', accepted_agenda_id = %s, accepted_item_id = %s, "
            "    reviewed_by = %s, reviewed_username = %s, reviewed_at = now() "
            "WHERE id = %s",
            (agenda_id, item_id, user["id"], user["username"], sub_id),
        )
    return {"status": "accepted", "agenda_id": agenda_id, "item_id": item_id}


@router.post("/council/submissions/{sub_id}/decline")
def decline_council_submission(
    sub_id: int, body: DeclineSubmissionIn, user: dict = Depends(get_staff_user)
):
    """Decline a pending council submission."""
    with pool.connection() as conn:
        sub = conn.execute(
            "SELECT status FROM council_submissions WHERE id = %s", (sub_id,)
        ).fetchone()
        if not sub:
            raise HTTPException(status_code=404, detail="Submission not found")
        if sub[0] != "pending":
            raise HTTPException(status_code=400, detail="Submission has already been reviewed")
        conn.execute(
            "UPDATE council_submissions "
            "SET status = 'declined', review_note = %s, reviewed_by = %s, "
            "    reviewed_username = %s, reviewed_at = now() "
            "WHERE id = %s",
            (body.review_note.strip(), user["id"], user["username"], sub_id),
        )
    return {"status": "declined"}


@router.delete("/council/submissions/{sub_id}")
def delete_council_submission(sub_id: int, user: dict = Depends(get_council_or_staff_user)):
    """Delete a pending council submission and its MinIO attachments."""
    with pool.connection() as conn:
        sub = conn.execute(
            "SELECT submitted_by, status FROM council_submissions WHERE id = %s",
            (sub_id,),
        ).fetchone()
        if not sub:
            raise HTTPException(status_code=404, detail="Submission not found")
        if not has_permission(user, "agendas.manage") and sub[0] != user["id"]:
            raise HTTPException(status_code=403, detail="You may only delete your own submissions")
        if sub[1] != "pending":
            raise HTTPException(status_code=400, detail="Only pending submissions can be deleted")
        keys = [
            r[0]
            for r in conn.execute(
                "SELECT object_key FROM council_submission_documents WHERE submission_id = %s",
                (sub_id,),
            ).fetchall()
        ]
        conn.execute("DELETE FROM council_submissions WHERE id = %s", (sub_id,))
    _remove_minio_objects(keys)
    return {"status": "deleted"}


def _query_finalized_agendas() -> list[dict]:
    sql = (
        "SELECT a.id, a.title, a.body, a.meeting_date, a.meeting_time, a.status, "
        "       a.finalized_at, a.created_at, a.updated_at, a.media_url, a.media_type, a.minutes_status, a.amended_at, "
        "       COUNT(DISTINCT i.id) AS item_count, "
        "       COUNT(d.id) AS doc_count "
        "FROM agendas a "
        "LEFT JOIN agenda_items i ON i.agenda_id = a.id "
        "LEFT JOIN agenda_documents d ON d.agenda_item_id = i.id "
        f"WHERE {_COUNCIL_FINALIZED_WHERE} "
        "GROUP BY a.id ORDER BY a.meeting_date DESC NULLS LAST, a.updated_at DESC, a.id DESC"
    )
    with pool.connection() as conn:
        rows = conn.execute(sql).fetchall()
    return [
        {
            "id": r[0],
            "title": r[1],
            "body": r[2],
            "meeting_date": r[3].isoformat() if r[3] else None,
            "meeting_time": r[4],
            "status": r[5],
            "finalized_at": r[6].isoformat() if r[6] else None,
            "created_at": r[7].isoformat() if r[7] else None,
            "updated_at": r[8].isoformat() if r[8] else None,
            "media_url": r[9],
            "media_type": r[10],
            "minutes_status": r[11],
            "amended_at": r[12].isoformat() if r[12] else None,
            "item_count": r[13],
            "doc_count": r[14],
        }
        for r in rows
    ]


@router.get("/public")
def list_public_finalized_agendas():
    """Publicly list finalized meeting agendas and minutes."""
    return {"items": _query_finalized_agendas()}


@router.get("/council")
def list_council_finalized_agendas(_: dict = Depends(get_council_or_staff_user)):
    """List finalized council agendas (agenda-only access for council members)."""
    return _query_finalized_agendas()


@router.get("/{agenda_id}")
def get_agenda(agenda_id: int, _: dict = Depends(get_staff_user)):
    with pool.connection() as conn:
        agenda = _load_agenda(conn, agenda_id)
    if not agenda:
        raise HTTPException(status_code=404, detail="Agenda not found")
    return agenda


@router.patch("/{agenda_id}")
def update_agenda(agenda_id: int, body: AgendaPatch, request: Request, user: dict = Depends(get_staff_user)):
    with pool.connection() as conn:
        prev = conn.execute(
            "SELECT status FROM agendas WHERE id = %s", (agenda_id,)
        ).fetchone()
        if not prev:
            raise HTTPException(status_code=404, detail="Agenda not found")
        prev_status = prev[0]

        prefs = _load_preferences(conn) if (body.body is not None or body.status is not None) else None
        if body.body is not None:
            if body.body.strip() not in prefs["bodies"]:
                raise HTTPException(
                    status_code=400, detail="Body must be one of the configured agenda bodies"
                )
        next_status = body.status.strip() if body.status is not None else None
        cat_map = {c["name"]: c for c in prefs["categories"]} if prefs else {}
        if next_status:
            if next_status not in cat_map:
                raise HTTPException(
                    status_code=400, detail="Category must be one of the configured agenda categories"
                )
        is_next_final = bool(
            next_status
            and (cat_map.get(next_status, {}).get("warn_on_leave") or next_status.lower().startswith("finalized"))
        )
        is_prev_final = bool(
            prev_status
            and (cat_map.get(prev_status, {}).get("warn_on_leave") or prev_status.lower().startswith("finalized"))
        )
        set_finalized = is_next_final and not is_prev_final
        clear_finalized = (next_status is not None) and (not is_next_final)
        media_url, media_type = _validate_media(body.media_url, body.media_type)
        row = conn.execute(
            "UPDATE agendas SET "
            "title = COALESCE(%s, title), "
            "body = COALESCE(%s, body), "
            "meeting_date = COALESCE(%s, meeting_date), "
            "meeting_time = COALESCE(%s, meeting_time), "
            "status = COALESCE(%s, status), "
            "finalized_at = CASE WHEN %s THEN now() WHEN %s THEN NULL ELSE finalized_at END, "
            "amended_at = CASE WHEN %s THEN NULL ELSE amended_at END, "
            "minutes_attendance = COALESCE(%s, minutes_attendance), "
            "minutes_notes = COALESCE(%s, minutes_notes), "
            "media_url = COALESCE(%s, media_url), "
            "media_type = COALESCE(%s, media_type), "
            "minutes_status = COALESCE(%s, minutes_status), "
            "updated_at = now() "
            "WHERE id = %s RETURNING id",
            (
                body.title.strip() if body.title else None,
                body.body.strip() if body.body is not None else None,
                body.meeting_date,
                body.meeting_time.strip() if body.meeting_time is not None else None,
                next_status,
                set_finalized,
                clear_finalized,
                clear_finalized,
                body.minutes_attendance.strip() if body.minutes_attendance is not None else None,
                body.minutes_notes.strip() if body.minutes_notes is not None else None,
                media_url,
                media_type,
                body.minutes_status,
                agenda_id,
            ),
        ).fetchone()
        if not row:
            raise HTTPException(status_code=404, detail="Agenda not found")
        if next_status is not None and next_status != prev_status:
            action = f"moved to {next_status}" if next_status else f"removed from {prev_status}"
            _log_agenda_event(conn, agenda_id, action, user["username"])
        loaded = _load_agenda(conn, agenda_id)
    if set_finalized:
        record_audit(user["username"], "agenda.finalized", "agendas", agenda_id, f"Finalized agenda '{loaded['title']}'")
        send_notification_email(
            "agendas_finalized",
            f"[CivicDesk] Agenda Finalized: {loaded['title']}",
            f"Agenda '{loaded['title']}' ({loaded['body']}, {loaded['meeting_date']}) was finalized by {user['username']}.",
            link_path=f"/app#agendas/{agenda_id}",
            request=request,
        )
        notify_topic_subscribers(
            "agendas",
            f"[CivicDesk] New Meeting Agenda Published: {loaded['title']}",
            f"A finalized agenda for {loaded['body']} ({loaded['title']}, {loaded['meeting_date']}) has been published.",
            link_path="/#agendas",
            request=request,
        )
    return loaded


@router.post("/{agenda_id}/clone", status_code=201)
def clone_agenda(agenda_id: int, user: dict = Depends(get_staff_user)):
    with pool.connection() as conn:
        src = conn.execute(
            "SELECT title, body, meeting_date, meeting_time FROM agendas WHERE id = %s",
            (agenda_id,),
        ).fetchone()
        if not src:
            raise HTTPException(status_code=404, detail="Agenda not found")
        prefs = _load_preferences(conn)
        default_status = prefs["categories"][0]["name"] if prefs.get("categories") else "In-Progress Agendas"
        new_row = conn.execute(
            "INSERT INTO agendas (title, body, meeting_date, meeting_time, status, created_by) "
            "VALUES (%s, %s, %s, %s, %s, %s) RETURNING id",
            (f"Copy of {src[0]}", src[1], src[2], src[3], default_status, user["id"]),
        ).fetchone()
        new_id = new_row[0]
        items = conn.execute(
            "SELECT position, title, description, section, presenter, recommended_motion, fiscal_impact "
            "FROM agenda_items WHERE agenda_id = %s ORDER BY position, id",
            (agenda_id,),
        ).fetchall()
        for it in items:
            conn.execute(
                "INSERT INTO agenda_items "
                "(agenda_id, position, title, description, section, presenter, recommended_motion, fiscal_impact) "
                "VALUES (%s, %s, %s, %s, %s, %s, %s, %s)",
                (new_id, it[0], it[1], it[2], it[3], it[4], it[5], it[6]),
            )
        _log_agenda_event(conn, new_id, "cloned", user["username"], f"Cloned from agenda #{agenda_id}")
        return _load_agenda(conn, new_id)


@router.post("/{agenda_id}/save-template", status_code=201)
def save_agenda_as_template(
    agenda_id: int, body: SaveTemplateIn, _: dict = Depends(get_staff_user)
):
    name = body.name.strip()
    if not name:
        raise HTTPException(status_code=400, detail="Template name is required")
    with pool.connection() as conn:
        ag = conn.execute(
            "SELECT body, meeting_time FROM agendas WHERE id = %s", (agenda_id,)
        ).fetchone()
        if not ag:
            raise HTTPException(status_code=404, detail="Agenda not found")
        items = conn.execute(
            "SELECT title, description, section, presenter, recommended_motion, fiscal_impact "
            "FROM agenda_items WHERE agenda_id = %s ORDER BY position, id",
            (agenda_id,),
        ).fetchall()
        tpl_items = [
            {
                "title": r[0],
                "description": r[1],
                "section": r[2],
                "presenter": r[3],
                "recommended_motion": r[4],
                "fiscal_impact": r[5],
            }
            for r in items
        ]
        row = conn.execute(
            "INSERT INTO agenda_templates (name, body, meeting_time, items) "
            "VALUES (%s, %s, %s, %s::jsonb) RETURNING id",
            (name, ag[0], ag[1], json.dumps(tpl_items)),
        ).fetchone()
        return {"id": row[0], "name": name, "item_count": len(tpl_items)}


@router.delete("/{agenda_id}")
def delete_agenda(agenda_id: int, _: dict = Depends(get_staff_user)):
    with pool.connection() as conn:
        ag = conn.execute(
            "SELECT title, body, meeting_date FROM agendas WHERE id = %s",
            (agenda_id,),
        ).fetchone()
        if not ag:
            raise HTTPException(status_code=404, detail="Agenda not found")
        ag_title, ag_body, ag_date = ag
        recover_folder = f"From: {ag_title}" + (f" ({ag_date.isoformat()})" if ag_date else "")

        items = conn.execute(
            "SELECT id, title, description, source_item_id "
            "FROM agenda_items WHERE agenda_id = %s ORDER BY position, id",
            (agenda_id,),
        ).fetchall()

        unique_ids: list[int] = []
        dup_ids: list[int] = []
        for iid, ititle, idesc, src_iid in items:
            has_link = False
            if src_iid is not None:
                has_link = bool(
                    conn.execute(
                        "SELECT 1 FROM agenda_items "
                        "WHERE id = %s AND (agenda_id IS NULL OR agenda_id <> %s)",
                        (src_iid, agenda_id),
                    ).fetchone()
                )
            if not has_link:
                has_link = bool(
                    conn.execute(
                        "SELECT 1 FROM agenda_items "
                        "WHERE source_item_id = %s AND (agenda_id IS NULL OR agenda_id <> %s)",
                        (iid, agenda_id),
                    ).fetchone()
                )
            if not has_link:
                has_link = bool(
                    conn.execute(
                        "SELECT 1 FROM agenda_items "
                        "WHERE (agenda_id IS NULL OR agenda_id <> %s) "
                        "  AND lower(trim(title)) = lower(trim(%s)) "
                        "  AND trim(description) = trim(%s)",
                        (agenda_id, ititle or "", idesc or ""),
                    ).fetchone()
                )
            if has_link:
                dup_ids.append(iid)
            else:
                unique_ids.append(iid)

        keys: list[str] = []
        if dup_ids:
            keys = [
                r[0]
                for r in conn.execute(
                    "SELECT object_key FROM agenda_documents WHERE agenda_item_id = ANY(%s)",
                    (dup_ids,),
                ).fetchall()
            ]

        if unique_ids:
            next_pos = conn.execute(
                "SELECT COALESCE(MAX(position), 0) FROM agenda_items WHERE agenda_id IS NULL"
            ).fetchone()[0]
            for offset, iid in enumerate(unique_ids, start=1):
                conn.execute(
                    "UPDATE agenda_items SET "
                    "agenda_id = NULL, "
                    "position = %s, "
                    "folder = %s, "
                    "target_body = CASE WHEN target_body = '' THEN %s ELSE target_body END, "
                    "todo_status = CASE WHEN todo_status = '' THEN 'open' ELSE todo_status END, "
                    "source_agenda_id = NULL "
                    "WHERE id = %s",
                    (next_pos + offset, recover_folder, ag_body or "", iid),
                )

        conn.execute("DELETE FROM agendas WHERE id = %s", (agenda_id,))

    _remove_minio_objects(keys)
    return {
        "deleted": True,
        "id": agenda_id,
        "moved_to_backlog": len(unique_ids),
        "folder": recover_folder if unique_ids else "",
    }


@router.post("/{agenda_id}/items", status_code=201)
def add_item(agenda_id: int, body: ItemIn, _: dict = Depends(get_staff_user)):
    title = body.title.strip()
    if not title:
        raise HTTPException(status_code=400, detail="Item title is required")
    with pool.connection() as conn:
        if not conn.execute("SELECT 1 FROM agendas WHERE id = %s", (agenda_id,)).fetchone():
            raise HTTPException(status_code=404, detail="Agenda not found")
        next_pos = conn.execute(
            "SELECT COALESCE(MAX(position), 0) + 1 FROM agenda_items WHERE agenda_id = %s",
            (agenda_id,),
        ).fetchone()[0]
        conn.execute(
            "INSERT INTO agenda_items "
            "(agenda_id, position, title, description, section, presenter, recommended_motion, fiscal_impact, revision_status) "
            "VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s)",
            (
                agenda_id,
                next_pos,
                title,
                body.description.strip(),
                body.section.strip(),
                body.presenter.strip(),
                body.recommended_motion.strip(),
                body.fiscal_impact.strip(),
                body.revision_status,
            ),
        )
        _touch_agenda(conn, agenda_id)
        return _load_agenda(conn, agenda_id)


@router.post("/{agenda_id}/items/reorder")
def reorder_items(
    agenda_id: int, body: ReorderItemsIn, _: dict = Depends(get_staff_user)
):
    with pool.connection() as conn:
        existing = [
            r[0]
            for r in conn.execute(
                "SELECT id FROM agenda_items WHERE agenda_id = %s", (agenda_id,)
            ).fetchall()
        ]
        if not existing:
            raise HTTPException(status_code=404, detail="Agenda not found or has no items")
        if set(body.item_ids) != set(existing) or len(body.item_ids) != len(existing):
            raise HTTPException(status_code=400, detail="item_ids must match all items on this agenda")
        for idx, iid in enumerate(body.item_ids, start=1):
            conn.execute(
                "UPDATE agenda_items SET position = %s WHERE id = %s", (idx, iid)
            )
        _touch_agenda(conn, agenda_id)
        return _load_agenda(conn, agenda_id)


@router.patch("/{agenda_id}/items/{item_id}")
def update_item(
    agenda_id: int, item_id: int, body: ItemPatch, _: dict = Depends(get_staff_user)
):
    with pool.connection() as conn:
        cur = conn.execute(
            "SELECT id, position FROM agenda_items WHERE id = %s AND agenda_id = %s",
            (item_id, agenda_id),
        ).fetchone()
        if not cur:
            raise HTTPException(status_code=404, detail="Agenda item not found")

        if any(
            v is not None
            for v in (
                body.title,
                body.description,
                body.section,
                body.presenter,
                body.recommended_motion,
                body.fiscal_impact,
                body.revision_status,
                body.minutes_action,
                body.minutes_motion_by,
                body.minutes_second_by,
                body.minutes_vote,
                body.minutes_notes,
            )
        ):
            conn.execute(
                "UPDATE agenda_items SET "
                "title = COALESCE(%s, title), "
                "description = COALESCE(%s, description), "
                "section = COALESCE(%s, section), "
                "presenter = COALESCE(%s, presenter), "
                "recommended_motion = COALESCE(%s, recommended_motion), "
                "fiscal_impact = COALESCE(%s, fiscal_impact), "
                "revision_status = COALESCE(%s, revision_status), "
                "minutes_action = COALESCE(%s, minutes_action), "
                "minutes_motion_by = COALESCE(%s, minutes_motion_by), "
                "minutes_second_by = COALESCE(%s, minutes_second_by), "
                "minutes_vote = COALESCE(%s, minutes_vote), "
                "minutes_notes = COALESCE(%s, minutes_notes) "
                "WHERE id = %s",
                (
                    body.title.strip() if body.title is not None else None,
                    body.description.strip() if body.description is not None else None,
                    body.section.strip() if body.section is not None else None,
                    body.presenter.strip() if body.presenter is not None else None,
                    body.recommended_motion.strip() if body.recommended_motion is not None else None,
                    body.fiscal_impact.strip() if body.fiscal_impact is not None else None,
                    body.revision_status,
                    body.minutes_action.strip() if body.minutes_action is not None else None,
                    body.minutes_motion_by.strip() if body.minutes_motion_by is not None else None,
                    body.minutes_second_by.strip() if body.minutes_second_by is not None else None,
                    body.minutes_vote.strip() if body.minutes_vote is not None else None,
                    body.minutes_notes.strip() if body.minutes_notes is not None else None,
                    item_id,
                ),
            )

        if body.position is not None:
            ordered_ids = [
                r[0]
                for r in conn.execute(
                    "SELECT id FROM agenda_items WHERE agenda_id = %s ORDER BY position, id",
                    (agenda_id,),
                ).fetchall()
            ]
            if item_id in ordered_ids:
                ordered_ids.remove(item_id)
                target_idx = max(0, min(body.position - 1, len(ordered_ids)))
                ordered_ids.insert(target_idx, item_id)
                for idx, oid in enumerate(ordered_ids, start=1):
                    conn.execute(
                        "UPDATE agenda_items SET position = %s WHERE id = %s",
                        (idx, oid),
                    )
        elif body.direction in ("up", "down"):
            pos = cur[1]
            cmp = "<" if body.direction == "up" else ">"
            order = "DESC" if body.direction == "up" else "ASC"
            neighbor = conn.execute(
                f"SELECT id, position FROM agenda_items "
                f"WHERE agenda_id = %s AND position {cmp} %s ORDER BY position {order} LIMIT 1",
                (agenda_id, pos),
            ).fetchone()
            if neighbor:
                conn.execute(
                    "UPDATE agenda_items SET position = %s WHERE id = %s",
                    (neighbor[1], item_id),
                )
                conn.execute(
                    "UPDATE agenda_items SET position = %s WHERE id = %s",
                    (pos, neighbor[0]),
                )

        only_minutes = (
            body.title is None and body.description is None and body.section is None
            and body.presenter is None and body.recommended_motion is None
            and body.fiscal_impact is None and body.revision_status is None
            and body.position is None and body.direction is None
        )
        _touch_agenda(conn, agenda_id, mark_amended=not only_minutes)
        return _load_agenda(conn, agenda_id)


def _copy_item_to_agenda(conn, src_item_id: int, target_agenda_id: int, position: int) -> int:
    src = conn.execute(
        "SELECT title, description, section, presenter, recommended_motion, fiscal_impact, revision_status "
        "FROM agenda_items WHERE id = %s",
        (src_item_id,),
    ).fetchone()
    new_item_id = conn.execute(
        "INSERT INTO agenda_items "
        "(agenda_id, position, title, description, section, presenter, recommended_motion, fiscal_impact, revision_status) "
        "VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s) RETURNING id",
        (target_agenda_id, position, src[0], src[1], src[2], src[3], src[4], src[5], src[6]),
    ).fetchone()[0]
    docs = conn.execute(
        "SELECT position, title, filename, content_type, size_bytes, sha256, object_key, uploaded_by "
        "FROM agenda_documents WHERE agenda_item_id = %s ORDER BY position, id",
        (src_item_id,),
    ).fetchall()
    for d in docs:
        old_key = d[6]
        ext = os.path.splitext(d[2])[1].lower()
        new_key = f"agendas/{target_agenda_id}/{new_item_id}/{uuid.uuid4().hex}{ext}"
        _minio().copy_object(_bucket(), new_key, CopySource(_bucket(), old_key))
        conn.execute(
            "INSERT INTO agenda_documents "
            "(agenda_item_id, position, title, filename, content_type, size_bytes, sha256, object_key, uploaded_by) "
            "VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s)",
            (new_item_id, d[0], d[1], d[2], d[3], d[4], d[5], new_key, d[7]),
        )
    return new_item_id


@router.delete("/{agenda_id}/items/{item_id}")
def delete_item(agenda_id: int, item_id: int, _: dict = Depends(get_staff_user)):
    with pool.connection() as conn:
        keys = [
            r[0]
            for r in conn.execute(
                "SELECT object_key FROM agenda_documents WHERE agenda_item_id = %s",
                (item_id,),
            ).fetchall()
        ]
        row = conn.execute(
            "DELETE FROM agenda_items WHERE id = %s AND agenda_id = %s RETURNING id",
            (item_id, agenda_id),
        ).fetchone()
        if not row:
            raise HTTPException(status_code=404, detail="Agenda item not found")
        _renumber_items(conn, agenda_id)
        _touch_agenda(conn, agenda_id)
        agenda = _load_agenda(conn, agenda_id)
    _remove_minio_objects(keys)
    return agenda


@router.post("/{agenda_id}/items/{item_id}/move")
def move_item(
    agenda_id: int,
    item_id: int,
    body: MoveItemIn,
    user: dict = Depends(get_staff_user),
):
    if body.target_agenda_id == agenda_id:
        raise HTTPException(status_code=400, detail="Item is already on this agenda")
    with pool.connection() as conn:
        item = conn.execute(
            "SELECT title FROM agenda_items WHERE id = %s AND agenda_id = %s",
            (item_id, agenda_id),
        ).fetchone()
        if not item:
            raise HTTPException(status_code=404, detail="Agenda item not found")
        target = conn.execute(
            "SELECT title FROM agendas WHERE id = %s", (body.target_agenda_id,)
        ).fetchone()
        if not target:
            raise HTTPException(status_code=404, detail="Target agenda not found")
        next_pos = conn.execute(
            "SELECT COALESCE(MAX(position), 0) + 1 FROM agenda_items WHERE agenda_id = %s",
            (body.target_agenda_id,),
        ).fetchone()[0]
        if body.copy:
            _copy_item_to_agenda(conn, item_id, body.target_agenda_id, next_pos)
            _touch_agenda(conn, body.target_agenda_id)
            _log_agenda_event(conn, agenda_id, f'copied item "{item[0]}" to {target[0]}', user["username"])
            _log_agenda_event(conn, body.target_agenda_id, f'received copy of item "{item[0]}"', user["username"])
        else:
            conn.execute(
                "UPDATE agenda_items SET agenda_id = %s, position = %s WHERE id = %s",
                (body.target_agenda_id, next_pos, item_id),
            )
            _renumber_items(conn, agenda_id)
            _touch_agenda(conn, agenda_id)
            _touch_agenda(conn, body.target_agenda_id)
            _log_agenda_event(conn, agenda_id, f'moved item "{item[0]}" to {target[0]}', user["username"])
            _log_agenda_event(conn, body.target_agenda_id, f'received item "{item[0]}"', user["username"])
        return _load_agenda(conn, agenda_id)


@router.post("/{agenda_id}/items/{item_id}/move-to-backlog")
def move_item_to_backlog(
    agenda_id: int,
    item_id: int,
    body: MoveToBacklogIn | None = None,
    user: dict = Depends(get_staff_user),
):
    with pool.connection() as conn:
        ag = conn.execute("SELECT body FROM agendas WHERE id = %s", (agenda_id,)).fetchone()
        if not ag:
            raise HTTPException(status_code=404, detail="Agenda not found")
        it = conn.execute(
            "SELECT title FROM agenda_items WHERE id = %s AND agenda_id = %s",
            (item_id, agenda_id),
        ).fetchone()
        if not it:
            raise HTTPException(status_code=404, detail="Agenda item not found")
        next_pos = conn.execute(
            "SELECT COALESCE(MAX(position), 0) + 1 FROM agenda_items WHERE agenda_id IS NULL"
        ).fetchone()[0]
        target_body = (body.target_body.strip() if body and body.target_body is not None else ag[0])
        target_date = body.target_date if body else None
        conn.execute(
            "UPDATE agenda_items SET agenda_id = NULL, position = %s, target_body = %s, target_date = %s WHERE id = %s",
            (next_pos, target_body, target_date, item_id),
        )
        _renumber_items(conn, agenda_id)
        _touch_agenda(conn, agenda_id)
        _log_agenda_event(conn, agenda_id, f'moved item "{it[0]}" to backlog', user["username"])
        return _load_agenda(conn, agenda_id)


@router.post("/{agenda_id}/sections/move")
def move_section(
    agenda_id: int,
    body: MoveSectionIn,
    user: dict = Depends(get_staff_user),
):
    section_name = body.section.strip()
    if not section_name:
        raise HTTPException(status_code=400, detail="Section name is required")
    if body.target_agenda_id == agenda_id:
        raise HTTPException(status_code=400, detail="Section is already on this agenda")
    with pool.connection() as conn:
        target = conn.execute(
            "SELECT title FROM agendas WHERE id = %s", (body.target_agenda_id,)
        ).fetchone()
        if not target:
            raise HTTPException(status_code=404, detail="Target agenda not found")
        rows = conn.execute(
            "SELECT id FROM agenda_items WHERE agenda_id = %s AND section = %s ORDER BY position, id",
            (agenda_id, section_name),
        ).fetchall()
        if not rows:
            raise HTTPException(status_code=404, detail="Section not found on this agenda")
        next_pos = conn.execute(
            "SELECT COALESCE(MAX(position), 0) + 1 FROM agenda_items WHERE agenda_id = %s",
            (body.target_agenda_id,),
        ).fetchone()[0]
        if body.copy:
            for offset, (iid,) in enumerate(rows):
                _copy_item_to_agenda(conn, iid, body.target_agenda_id, next_pos + offset)
            _touch_agenda(conn, body.target_agenda_id)
            _log_agenda_event(
                conn,
                agenda_id,
                f'copied section "{section_name}" ({len(rows)} item(s)) to {target[0]}',
                user["username"],
            )
            _log_agenda_event(
                conn,
                body.target_agenda_id,
                f'received copy of section "{section_name}" ({len(rows)} item(s))',
                user["username"],
            )
        else:
            for offset, (iid,) in enumerate(rows):
                conn.execute(
                    "UPDATE agenda_items SET agenda_id = %s, position = %s WHERE id = %s",
                    (body.target_agenda_id, next_pos + offset, iid),
                )
            _renumber_items(conn, agenda_id)
            _touch_agenda(conn, agenda_id)
            _touch_agenda(conn, body.target_agenda_id)
            _log_agenda_event(
                conn,
                agenda_id,
                f'moved section "{section_name}" ({len(rows)} item(s)) to {target[0]}',
                user["username"],
            )
            _log_agenda_event(
                conn,
                body.target_agenda_id,
                f'received section "{section_name}" ({len(rows)} item(s))',
                user["username"],
            )
        return _load_agenda(conn, agenda_id)


@router.post("/{agenda_id}/items/{item_id}/documents", status_code=201)
async def upload_document(
    agenda_id: int,
    item_id: int,
    file: UploadFile = File(...),
    title: str = Form(""),
    user: dict = Depends(get_staff_user),
):
    data = await _read_upload_limited(file, MAX_DOC_BYTES, "100 MB")
    if not data:
        raise HTTPException(status_code=400, detail="Uploaded file is empty")
    safe_name, content_type = _validate_doc(file.filename or "", data)
    doc_title = title.strip() or safe_name
    digest = hashlib.sha256(data).hexdigest()

    def _store_document() -> dict:
        with pool.connection() as conn:
            if not conn.execute(
                "SELECT 1 FROM agenda_items WHERE id = %s AND agenda_id = %s",
                (item_id, agenda_id),
            ).fetchone():
                raise HTTPException(status_code=404, detail="Agenda item not found")

            next_pos = conn.execute(
                "SELECT COALESCE(MAX(position), 0) + 1 FROM agenda_documents WHERE agenda_item_id = %s",
                (item_id,),
            ).fetchone()[0]
            object_key = tenant_object_key(f"agendas/{agenda_id}/{item_id}/{digest[:12]}_{safe_name}")
            _minio().put_object(
                _bucket(),
                object_key,
                io.BytesIO(data),
                length=len(data),
                content_type=content_type,
            )
            conn.execute(
                "INSERT INTO agenda_documents "
                "(agenda_item_id, position, title, filename, content_type, size_bytes, sha256, object_key, uploaded_by) "
                "VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s)",
                (
                    item_id,
                    next_pos,
                    doc_title,
                    safe_name,
                    content_type,
                    len(data),
                    digest,
                    object_key,
                    user["id"],
                ),
            )
            _touch_agenda(conn, agenda_id)
            return _load_agenda(conn, agenda_id)

    return await run_in_threadpool(_store_document)


@router.post("/{agenda_id}/items/{item_id}/text-documents", status_code=201)
def create_text_document(
    agenda_id: int,
    item_id: int,
    body: TextDocIn,
    user: dict = Depends(get_staff_user),
):
    doc_title = body.title.strip()
    text = body.content.strip()
    if not doc_title:
        raise HTTPException(status_code=400, detail="Document title is required")
    if not text:
        raise HTTPException(status_code=400, detail="Document text is required")

    data = text.encode("utf-8")
    slug = _SAFE_NAME_RE.sub("_", doc_title).strip("._") or "note"
    safe_name = f"{slug[:60]}.txt"
    digest = hashlib.sha256(data).hexdigest()

    with pool.connection() as conn:
        if not conn.execute(
            "SELECT 1 FROM agenda_items WHERE id = %s AND agenda_id = %s",
            (item_id, agenda_id),
        ).fetchone():
            raise HTTPException(status_code=404, detail="Agenda item not found")

        next_pos = conn.execute(
            "SELECT COALESCE(MAX(position), 0) + 1 FROM agenda_documents WHERE agenda_item_id = %s",
            (item_id,),
        ).fetchone()[0]
        object_key = tenant_object_key(f"agendas/{agenda_id}/{item_id}/{digest[:12]}_{safe_name}")
        _minio().put_object(
            _bucket(),
            object_key,
            io.BytesIO(data),
            length=len(data),
            content_type="text/plain; charset=utf-8",
        )
        conn.execute(
            "INSERT INTO agenda_documents "
            "(agenda_item_id, position, title, filename, content_type, size_bytes, sha256, object_key, uploaded_by) "
            "VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s)",
            (
                item_id,
                next_pos,
                doc_title,
                safe_name,
                "text/plain; charset=utf-8",
                len(data),
                digest,
                object_key,
                user["id"],
            ),
        )
        _touch_agenda(conn, agenda_id)
        return _load_agenda(conn, agenda_id)


@router.patch("/{agenda_id}/items/{item_id}/documents/{doc_id}")
def update_document(
    agenda_id: int,
    item_id: int,
    doc_id: int,
    body: DocPatch,
    _: dict = Depends(get_staff_user),
):
    with pool.connection() as conn:
        cur = conn.execute(
            "SELECT d.id, d.position, d.filename, d.object_key, d.content_type FROM agenda_documents d "
            "JOIN agenda_items i ON i.id = d.agenda_item_id "
            "WHERE d.id = %s AND i.id = %s AND i.agenda_id = %s",
            (doc_id, item_id, agenda_id),
        ).fetchone()
        if not cur:
            raise HTTPException(status_code=404, detail="Document not found")

        if body.title is not None:
            new_title = body.title.strip()
            if not new_title:
                raise HTTPException(status_code=400, detail="Document title cannot be empty")
            conn.execute(
                "UPDATE agenda_documents SET title = %s WHERE id = %s",
                (new_title, doc_id),
            )

        if body.content is not None:
            fname_l = (cur[2] or "").lower()
            if not (fname_l.endswith(".txt") or fname_l.endswith(".md") or fname_l.endswith(".csv")):
                raise HTTPException(status_code=400, detail="Only text attachments can be edited inline")
            data = body.content.encode("utf-8")
            digest = hashlib.sha256(data).hexdigest()
            _minio().put_object(
                _bucket(),
                cur[3],
                io.BytesIO(data),
                length=len(data),
                content_type=cur[4] or "text/plain; charset=utf-8",
            )
            conn.execute(
                "UPDATE agenda_documents SET size_bytes = %s, sha256 = %s WHERE id = %s",
                (len(data), digest, doc_id),
            )

        dest_item_id = item_id
        if body.target_item_id is not None and body.target_item_id != item_id:
            if not conn.execute(
                "SELECT 1 FROM agenda_items WHERE id = %s AND agenda_id = %s",
                (body.target_item_id, agenda_id),
            ).fetchone():
                raise HTTPException(status_code=404, detail="Target agenda item not found")
            dest_item_id = body.target_item_id
            next_pos = conn.execute(
                "SELECT COALESCE(MAX(position), 0) + 1 FROM agenda_documents WHERE agenda_item_id = %s",
                (dest_item_id,),
            ).fetchone()[0]
            conn.execute(
                "UPDATE agenda_documents SET agenda_item_id = %s, position = %s WHERE id = %s",
                (dest_item_id, next_pos, doc_id),
            )
            _renumber_docs(conn, item_id)

        if body.position is not None:
            ordered_ids = [
                r[0]
                for r in conn.execute(
                    "SELECT id FROM agenda_documents WHERE agenda_item_id = %s ORDER BY position, id",
                    (dest_item_id,),
                ).fetchall()
            ]
            if doc_id in ordered_ids:
                ordered_ids.remove(doc_id)
                target_idx = max(0, min(body.position - 1, len(ordered_ids)))
                ordered_ids.insert(target_idx, doc_id)
                for idx, did in enumerate(ordered_ids, start=1):
                    conn.execute(
                        "UPDATE agenda_documents SET position = %s WHERE id = %s",
                        (idx, did),
                    )
        elif dest_item_id != item_id:
            _renumber_docs(conn, dest_item_id)

        _touch_agenda(conn, agenda_id)
        return _load_agenda(conn, agenda_id)


@router.delete("/{agenda_id}/items/{item_id}/documents/{doc_id}")
def delete_document(
    agenda_id: int, item_id: int, doc_id: int, _: dict = Depends(get_staff_user)
):
    with pool.connection() as conn:
        row = conn.execute(
            "DELETE FROM agenda_documents d USING agenda_items i "
            "WHERE d.id = %s AND d.agenda_item_id = i.id AND i.id = %s AND i.agenda_id = %s "
            "RETURNING d.object_key",
            (doc_id, item_id, agenda_id),
        ).fetchone()
        if not row:
            raise HTTPException(status_code=404, detail="Document not found")
        _renumber_docs(conn, item_id)
        _touch_agenda(conn, agenda_id)
        agenda = _load_agenda(conn, agenda_id)
    _remove_minio_objects([row[0]])
    return agenda


@router.get("/{agenda_id}/documents/{doc_id}/download")
def download_document(agenda_id: int, doc_id: int, _: dict = Depends(get_staff_user)):
    with pool.connection() as conn:
        row = conn.execute(
            "SELECT d.filename, d.content_type, d.object_key "
            "FROM agenda_documents d "
            "JOIN agenda_items i ON i.id = d.agenda_item_id "
            "WHERE d.id = %s AND i.agenda_id = %s",
            (doc_id, agenda_id),
        ).fetchone()
    if not row:
        raise HTTPException(status_code=404, detail="Document not found")

    filename, content_type, object_key = row
    try:
        obj = _minio().get_object(_bucket(), object_key)
    except Exception:
        raise HTTPException(status_code=404, detail="Document file not found")
    inline_types = ("application/pdf", "image/png", "image/jpeg")
    is_inline = content_type in inline_types or content_type.startswith(("text/plain", "text/markdown"))
    disp = "inline" if is_inline else "attachment"

    def stream():
        try:
            for chunk in obj.stream(65536):
                yield chunk
        finally:
            obj.close()
            obj.release_conn()

    return StreamingResponse(
        stream(),
        media_type=content_type,
        headers={"Content-Disposition": f'{disp}; filename="{filename}"'},
    )


@router.get("/{agenda_id}/documents/{doc_id}/pdf")
def view_document_as_pdf(agenda_id: int, doc_id: int, _: dict = Depends(get_staff_user)):
    with pool.connection() as conn:
        agenda = _load_agenda(conn, agenda_id)
    if not agenda:
        raise HTTPException(status_code=404, detail="Agenda not found")

    target_item = None
    target_doc = None
    for it in agenda["items"]:
        for d in it["documents"]:
            if d["id"] == doc_id:
                target_item, target_doc = it, d
                break
        if target_doc:
            break
    if not target_doc:
        raise HTTPException(status_code=404, detail="Document not found")

    try:
        obj = _minio().get_object(_bucket(), target_doc["object_key"])
        try:
            raw = obj.read()
        finally:
            obj.close()
            obj.release_conn()
    except Exception:
        raise HTTPException(status_code=404, detail="Document file not found")

    pdf_bytes = render_single_document_pdf(target_item, target_doc, raw)
    base = os.path.splitext(target_doc["filename"])[0]
    return Response(
        content=pdf_bytes,
        media_type="application/pdf",
        headers={"Content-Disposition": f'inline; filename="{base}.pdf"'},
    )


def _build_packet_response(agenda: dict, prefs: dict, agenda_id: int, summary: bool, download: bool) -> Response:
    def fetch_doc(object_key: str) -> bytes:
        obj = _minio().get_object(_bucket(), object_key)
        try:
            return obj.read()
        finally:
            obj.close()
            obj.release_conn()

    pdf_bytes = build_agenda_packet_pdf(
        agenda,
        fetch_doc,
        include_item_cover_sheets=prefs["include_item_cover_sheets"],
        include_page_numbers=prefs["include_page_numbers"],
        preferences=prefs,
        summary_only=summary,
    )
    safe_title = _SAFE_NAME_RE.sub("_", agenda["title"]).strip("._") or f"agenda_{agenda_id}"
    suffix = "_agenda_only" if summary else "_packet"
    disp = "attachment" if download else "inline"
    return Response(
        content=pdf_bytes,
        media_type="application/pdf",
        headers={"Content-Disposition": f'{disp}; filename="{safe_title}{suffix}.pdf"'},
    )


def _build_minutes_response(agenda: dict, prefs: dict, agenda_id: int, download: bool) -> Response:
    def fetch_doc(object_key: str) -> bytes:
        obj = _minio().get_object(_bucket(), object_key)
        try:
            return obj.read()
        finally:
            obj.close()
            obj.release_conn()

    pdf_bytes = build_minutes_pdf(
        agenda,
        fetch_doc,
        include_page_numbers=prefs["include_page_numbers"],
        preferences=prefs,
        watermark_draft=(agenda.get("minutes_status", "draft") != "approved"),
    )
    safe_title = _SAFE_NAME_RE.sub("_", agenda["title"]).strip("._") or f"agenda_{agenda_id}"
    disp = "attachment" if download else "inline"
    return Response(
        content=pdf_bytes,
        media_type="application/pdf",
        headers={"Content-Disposition": f'{disp}; filename="{safe_title}_minutes.pdf"'},
    )


@router.get("/public/{agenda_id}/packet.pdf")
def generate_public_agenda_pdf(
    agenda_id: int,
    download: bool = False,
    summary: bool = False,
):
    with pool.connection() as conn:
        agenda = _load_agenda(conn, agenda_id)
        if not agenda:
            raise HTTPException(status_code=404, detail="Agenda not found")
        if not _is_council_finalized(conn, agenda_id):
            raise HTTPException(status_code=403, detail="Access restricted to finalized agendas")
        prefs = _load_preferences(conn)
    return _build_packet_response(agenda, prefs, agenda_id, summary, download)


@router.get("/public/{agenda_id}/minutes.pdf")
def generate_public_minutes_pdf(
    agenda_id: int,
    download: bool = False,
):
    with pool.connection() as conn:
        agenda = _load_agenda(conn, agenda_id)
        if not agenda:
            raise HTTPException(status_code=404, detail="Agenda not found")
        if not _is_council_finalized(conn, agenda_id):
            raise HTTPException(status_code=403, detail="Access restricted to finalized agendas")
        prefs = _load_preferences(conn)
    return _build_minutes_response(agenda, prefs, agenda_id, download)


@router.get("/{agenda_id}/packet.pdf")
def generate_agenda_pdf(
    agenda_id: int,
    download: bool = False,
    summary: bool = False,
    user: dict = Depends(get_council_or_staff_user),
):
    with pool.connection() as conn:
        agenda = _load_agenda(conn, agenda_id)
        if not agenda:
            raise HTTPException(status_code=404, detail="Agenda not found")
        if not has_permission(user, "agendas.manage"):
            if not _is_council_finalized(conn, agenda_id):
                raise HTTPException(
                    status_code=403, detail="Access restricted to finalized agendas"
                )
        prefs = _load_preferences(conn)
    return _build_packet_response(agenda, prefs, agenda_id, summary, download)


@router.get("/{agenda_id}/minutes.pdf")
def generate_minutes_pdf(
    agenda_id: int,
    download: bool = False,
    user: dict = Depends(get_council_or_staff_user),
):
    with pool.connection() as conn:
        agenda = _load_agenda(conn, agenda_id)
        if not agenda:
            raise HTTPException(status_code=404, detail="Agenda not found")
        if not has_permission(user, "agendas.manage") and not _is_council_finalized(conn, agenda_id):
            raise HTTPException(status_code=403, detail="Access restricted to finalized agendas")
        prefs = _load_preferences(conn)
    return _build_minutes_response(agenda, prefs, agenda_id, download)
