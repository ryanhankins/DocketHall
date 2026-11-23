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

"""Contracts, Resolutions & Document Repository module."""
from datetime import date, datetime, timedelta, timezone
import hashlib
import io
import os
import re
import uuid

from fastapi import APIRouter, Depends, File, Form, HTTPException, Request, UploadFile
from fastapi.responses import Response
from pydantic import BaseModel

from .agendas import _bucket, _storage, _remove_storage_objects
from .audit import record_audit
from .pdf_check import check_pdf_compliance
from .auth import require_permission
from .db import pool
from .tenancy import tenant_object_key
from .subscriptions import notify_topic_subscribers

MAX_REPO_FILE_BYTES = int(os.environ.get("MAX_REPO_FILE_BYTES", str(50 * 1024 * 1024)))
_SAFE_FILENAME_RE = re.compile(r"[^A-Za-z0-9._-]+")
RECORD_STATUSES = ("active", "pending", "expired", "archived", "superseded")

SCHEMA = """
CREATE TABLE IF NOT EXISTS repository_documents (
    id                  BIGSERIAL PRIMARY KEY,
    doc_number          TEXT NOT NULL DEFAULT '',
    category            TEXT NOT NULL DEFAULT 'Resolution',
    title               TEXT NOT NULL,
    counterparty        TEXT NOT NULL DEFAULT '',
    effective_date      TEXT NOT NULL DEFAULT '',
    expiration_date     TEXT NOT NULL DEFAULT '',
    renewal_notice_days INTEGER NOT NULL DEFAULT 30,
    status              TEXT NOT NULL DEFAULT 'active',
    tags                TEXT NOT NULL DEFAULT '',
    notes               TEXT NOT NULL DEFAULT '',
    is_public           BOOLEAN NOT NULL DEFAULT FALSE,
    auto_unpublish_on_expire BOOLEAN NOT NULL DEFAULT FALSE,
    created_by          TEXT NOT NULL DEFAULT '',
    created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE repository_documents ADD COLUMN IF NOT EXISTS auto_unpublish_on_expire BOOLEAN NOT NULL DEFAULT FALSE;
CREATE INDEX IF NOT EXISTS repo_docs_cat_idx ON repository_documents(category, status, id DESC);
CREATE TABLE IF NOT EXISTS repository_files (
    id           BIGSERIAL PRIMARY KEY,
    document_id  BIGINT NOT NULL REFERENCES repository_documents(id) ON DELETE CASCADE,
    title        TEXT NOT NULL DEFAULT '',
    filename     TEXT NOT NULL,
    content_type TEXT NOT NULL DEFAULT 'application/octet-stream',
    size_bytes   BIGINT NOT NULL DEFAULT 0,
    sha256       TEXT NOT NULL DEFAULT '',
    object_key   TEXT NOT NULL,
    uploaded_by  TEXT NOT NULL DEFAULT '',
    created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS repo_files_doc_idx ON repository_files(document_id, id);
CREATE TABLE IF NOT EXISTS public_records_requests (
    id              BIGSERIAL PRIMARY KEY,
    request_number  TEXT NOT NULL UNIQUE,
    requester_name  TEXT NOT NULL,
    requester_email TEXT NOT NULL DEFAULT '',
    requester_phone TEXT NOT NULL DEFAULT '',
    subject         TEXT NOT NULL,
    description     TEXT NOT NULL DEFAULT '',
    department      TEXT NOT NULL DEFAULT 'City Clerk',
    status          TEXT NOT NULL DEFAULT 'submitted',
    due_date        TEXT NOT NULL DEFAULT '',
    assigned_to     TEXT NOT NULL DEFAULT '',
    fee_estimate    TEXT NOT NULL DEFAULT '',
    response_notes  TEXT NOT NULL DEFAULT '',
    fulfillment_object_key TEXT NOT NULL DEFAULT '',
    fulfillment_filename   TEXT NOT NULL DEFAULT '',
    fulfilled_at    TIMESTAMPTZ,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE public_records_requests ADD COLUMN IF NOT EXISTS fulfillment_object_key TEXT NOT NULL DEFAULT '';
ALTER TABLE public_records_requests ADD COLUMN IF NOT EXISTS fulfillment_filename TEXT NOT NULL DEFAULT '';
CREATE INDEX IF NOT EXISTS prr_status_idx ON public_records_requests(status, id DESC);
"""


def bootstrap() -> None:
    with pool.connection() as conn:
        conn.execute("SELECT pg_advisory_xact_lock(424247)")
        conn.execute(SCHEMA)


router = APIRouter(prefix="/api/records", tags=["records"])


class RecordCreateIn(BaseModel):
    doc_number: str = ""
    category: str = "Resolution"
    title: str
    counterparty: str = ""
    effective_date: str = ""
    expiration_date: str = ""
    renewal_notice_days: int = 30
    status: str = "active"
    tags: str = ""
    notes: str = ""
    is_public: bool = False
    auto_unpublish_on_expire: bool = False


class RecordPatchIn(BaseModel):
    doc_number: str | None = None
    category: str | None = None
    title: str | None = None
    counterparty: str | None = None
    effective_date: str | None = None
    expiration_date: str | None = None
    renewal_notice_days: int | None = None
    status: str | None = None
    tags: str | None = None
    notes: str | None = None
    is_public: bool | None = None
    auto_unpublish_on_expire: bool | None = None


_COLS = (
    "id, doc_number, category, title, counterparty, effective_date, expiration_date, "
    "renewal_notice_days, status, tags, notes, is_public, created_by, created_at, updated_at, "
    "auto_unpublish_on_expire"
)


def _hydrate_records(conn, rows: list[tuple]) -> list[dict]:
    if not rows:
        return []
    ids = [r[0] for r in rows]
    f_rows = conn.execute(
        "SELECT id, document_id, title, filename, content_type, size_bytes, uploaded_by, created_at "
        "FROM repository_files WHERE document_id = ANY(%s) ORDER BY id ASC",
        (ids,),
    ).fetchall()
    files_by_doc: dict[int, list[dict]] = {}
    for f in f_rows:
        files_by_doc.setdefault(f[1], []).append({
            "id": f[0],
            "document_id": f[1],
            "title": f[2],
            "filename": f[3],
            "content_type": f[4],
            "size_bytes": f[5],
            "uploaded_by": f[6],
            "created_at": f[7].isoformat() if f[7] else None,
        })

    today = date.today()
    out = []
    for r in rows:
        exp_str = (r[6] or "").strip()
        notice_days = int(r[7]) if r[7] is not None else 30
        expiry_flag = ""
        if exp_str and r[8] in ("active", "pending"):
            try:
                exp_d = date.fromisoformat(exp_str)
                if exp_d < today:
                    expiry_flag = "expired"
                elif exp_d <= today + timedelta(days=notice_days):
                    expiry_flag = "expiring_soon"
            except ValueError:
                pass
        out.append({
            "id": r[0],
            "doc_number": r[1],
            "category": r[2],
            "title": r[3],
            "counterparty": r[4],
            "effective_date": r[5],
            "expiration_date": exp_str,
            "renewal_notice_days": notice_days,
            "status": r[8],
            "tags": r[9],
            "notes": r[10],
            "is_public": bool(r[11]),
            "auto_unpublish_on_expire": bool(r[15]),
            "created_by": r[12],
            "created_at": r[13].isoformat() if r[13] else None,
            "updated_at": r[14].isoformat() if r[14] else None,
            "expiry_flag": expiry_flag,
            "files": files_by_doc.get(r[0], []),
        })
    return out


def _get_record_or_404(conn, doc_id: int) -> dict:
    row = conn.execute(f"SELECT {_COLS} FROM repository_documents WHERE id = %s", (doc_id,)).fetchone()
    if not row:
        raise HTTPException(status_code=404, detail="Repository record not found")
    return _hydrate_records(conn, [row])[0]


def _is_publicly_visible(rec: dict, today: date | None = None) -> bool:
    if not rec.get("is_public"):
        return False
    if rec.get("auto_unpublish_on_expire") and rec.get("expiration_date"):
        try:
            exp_d = date.fromisoformat(rec["expiration_date"])
            if exp_d < (today or date.today()):
                return False
        except ValueError:
            pass
    return True


# ------------------------------------------------------------------ public endpoints
@router.get("/public")
def list_public_records(q: str = "", category: str = "", year: str = ""):
    with pool.connection() as conn:
        rows = conn.execute(
            f"SELECT {_COLS} FROM repository_documents WHERE is_public = TRUE ORDER BY effective_date DESC, id DESC"
        ).fetchall()
        items = _hydrate_records(conn, rows)
    today = date.today()
    items = [x for x in items if _is_publicly_visible(x, today)]
    ql = q.strip().lower()
    if category.strip():
        items = [x for x in items if x["category"] == category.strip()]
    if year.strip():
        yr = year.strip()
        items = [x for x in items if (x.get("effective_date") or x.get("created_at") or "").startswith(yr)]
    if ql:
        items = [
            x for x in items
            if ql in f"{x['doc_number']} {x['title']} {x['counterparty']} {x['tags']} {x['notes']}".lower()
        ]
    return items


@router.get("/public/files/{file_id}/download")
def download_public_file(file_id: int):
    with pool.connection() as conn:
        row = conn.execute(
            "SELECT f.filename, f.content_type, f.object_key, d.is_public, d.auto_unpublish_on_expire, d.expiration_date "
            "FROM repository_files f JOIN repository_documents d ON d.id = f.document_id "
            "WHERE f.id = %s AND d.is_public = TRUE",
            (file_id,),
        ).fetchone()
        if not row or not _is_publicly_visible(
            {"is_public": bool(row[3]), "auto_unpublish_on_expire": bool(row[4]), "expiration_date": row[5] or ""},
        ):
            raise HTTPException(status_code=404, detail="File not found")
    obj = _storage().get_object(_bucket(), row[2])
    try:
        data = obj.read()
    finally:
        obj.close()
        obj.release_conn()
    safe_fn = _SAFE_FILENAME_RE.sub("_", row[0] or "document").strip("._") or "document"
    raw_ctype = (row[1] or "application/octet-stream").split(";")[0].strip().lower()
    safe_inline = raw_ctype in {"application/pdf", "image/png", "image/jpeg", "image/webp", "image/gif", "text/plain"}
    disp = "inline" if safe_inline else "attachment"
    return Response(
        content=data,
        media_type=raw_ctype if safe_inline else "application/octet-stream",
        headers={
            "Content-Disposition": f'{disp}; filename="{safe_fn}"',
            "X-Content-Type-Options": "nosniff",
        },
    )


# ------------------------------------------------------------------ FOIA / Public Data Requests

FOIA_STATUSES = ("submitted", "in_review", "ready", "fulfilled", "denied")


class FoiaRequestIn(BaseModel):
    requester_name: str
    requester_email: str = ""
    requester_phone: str = ""
    subject: str
    description: str = ""
    department: str = "City Clerk"


class FoiaRequestPatch(BaseModel):
    status: str | None = None
    assigned_to: str | None = None
    due_date: str | None = None
    fee_estimate: str | None = None
    response_notes: str | None = None


def _row_to_foia(r) -> dict:
    return {
        "id": r[0],
        "request_number": r[1],
        "requester_name": r[2],
        "requester_email": r[3],
        "requester_phone": r[4],
        "subject": r[5],
        "description": r[6],
        "department": r[7],
        "status": r[8],
        "due_date": r[9],
        "assigned_to": r[10],
        "fee_estimate": r[11],
        "response_notes": r[12],
        "fulfillment_filename": r[13] or "",
        "fulfilled_at": r[14].isoformat() if r[14] else None,
        "created_at": r[15].isoformat() if r[15] else None,
        "updated_at": r[16].isoformat() if r[16] else None,
    }


_FOIA_COLS = (
    "id, request_number, requester_name, requester_email, requester_phone, "
    "subject, description, department, status, due_date, assigned_to, "
    "fee_estimate, response_notes, fulfillment_filename, fulfilled_at, created_at, updated_at"
)


@router.post("/requests/public", status_code=201)
def submit_public_foia_request(body: FoiaRequestIn):
    name = body.requester_name.strip()
    subj = body.subject.strip()
    if not name or not subj:
        raise HTTPException(status_code=400, detail="Your name and request subject are required")
    yr = date.today().year
    from .sla import get_sla_target_days
    due = (date.today() + timedelta(days=get_sla_target_days("foia_deadline", 10))).isoformat()
    tmp = f"PRR-{yr}-{uuid.uuid4().hex[:8].upper()}"
    with pool.connection() as conn:
        row = conn.execute(
            "INSERT INTO public_records_requests "
            "(request_number, requester_name, requester_email, requester_phone, subject, description, department, due_date) "
            "VALUES (%s, %s, %s, %s, %s, %s, %s, %s) RETURNING id",
            (tmp, name, body.requester_email.strip(), body.requester_phone.strip(), subj, body.description.strip(), body.department.strip() or "City Clerk", due),
        ).fetchone()
        final_num = f"PRR-{yr}-{row[0]:04d}"
        full = conn.execute(
            f"UPDATE public_records_requests SET request_number = %s WHERE id = %s RETURNING {_FOIA_COLS}",
            (final_num, row[0]),
        ).fetchone()
    try:
        from .integrations import send_notification_email
        send_notification_email(
            "records_foia",
            f"[DocketHall] New FOIA Request {full[1]}: {subj}",
            f"Requester: {name} ({body.requester_email.strip() or 'no email'})\nDue: {due}\n\n{body.description.strip()}",
            link_path="/app#records",
        )
    except Exception:
        pass
    return {
        "request_number": full[1],
        "subject": full[5],
        "status": full[8],
        "due_date": full[9],
        "created_at": full[14].isoformat() if full[14] else None,
    }


@router.get("/requests/public-lookup")
def lookup_public_foia_request(request_number: str = ""):
    num = request_number.strip().upper()
    if not num:
        raise HTTPException(status_code=400, detail="Request number is required")
    with pool.connection() as conn:
        row = conn.execute(
            "SELECT request_number, subject, department, status, due_date, fee_estimate, response_notes, fulfillment_filename, fulfilled_at, created_at "
            "FROM public_records_requests WHERE UPPER(request_number) = %s",
            (num,),
        ).fetchone()
    if not row:
        raise HTTPException(status_code=404, detail="Records request not found")
    return {
        "request_number": row[0],
        "subject": row[1],
        "department": row[2],
        "status": row[3],
        "due_date": row[4],
        "fee_estimate": row[5],
        "response_notes": row[6],
        "fulfillment_filename": row[7] or "",
        "fulfilled_at": row[8].isoformat() if row[8] else None,
        "created_at": row[9].isoformat() if row[9] else None,
    }


@router.post("/requests/{req_id}/fulfillment-file")
async def upload_foia_fulfillment_file(
    req_id: int,
    file: UploadFile = File(...),
    user: dict = Depends(require_permission("records.manage")),
):
    raw = await file.read()
    if not raw or len(raw) > MAX_REPO_FILE_BYTES:
        raise HTTPException(status_code=400, detail="File empty or too large")
    orig_name = (file.filename or "fulfillment.pdf").strip() or "fulfillment.pdf"
    safe_name = _SAFE_FILENAME_RE.sub("_", orig_name).strip("._") or "fulfillment"
    obj_key = tenant_object_key(f"foia/{req_id}/{uuid.uuid4().hex[:12]}_{safe_name}")
    _storage().put_object(_bucket(), obj_key, io.BytesIO(raw), length=len(raw), content_type=file.content_type or "application/octet-stream")
    with pool.connection() as conn:
        row = conn.execute(
            f"UPDATE public_records_requests SET fulfillment_object_key = %s, fulfillment_filename = %s, "
            f"status = CASE WHEN status IN ('submitted','in_review') THEN 'ready' ELSE status END, updated_at = now() "
            f"WHERE id = %s RETURNING {_FOIA_COLS}",
            (obj_key, orig_name, req_id),
        ).fetchone()
        if not row:
            raise HTTPException(status_code=404, detail="Records request not found")
    record_audit(user["username"], "records.foia_upload", f"{row[1]}: {orig_name}")
    return _row_to_foia(row)


@router.get("/requests/public-download/{request_number}")
def download_foia_fulfillment_file(request_number: str):
    num = request_number.strip().upper()
    with pool.connection() as conn:
        row = conn.execute(
            "SELECT fulfillment_object_key, fulfillment_filename, status FROM public_records_requests WHERE UPPER(request_number) = %s",
            (num,),
        ).fetchone()
    if not row or not row[0] or row[2] not in ("ready", "fulfilled"):
        raise HTTPException(status_code=404, detail="Fulfillment file not available")
    obj = _storage().get_object(_bucket(), row[0])
    try:
        data = obj.read()
    finally:
        obj.close()
        obj.release_conn()
    safe_fn = _SAFE_FILENAME_RE.sub("_", row[1] or "records").strip("._") or "records"
    return Response(content=data, media_type="application/octet-stream", headers={"Content-Disposition": f'attachment; filename="{safe_fn}"'})


@router.get("/requests")
def list_foia_requests(
    status: str = "",
    q: str = "",
    _: dict = Depends(require_permission("records.view", "records.manage")),
):
    st = status.strip().lower()
    ql = f"%{q.strip()}%"
    with pool.connection() as conn:
        rows = conn.execute(
            f"SELECT {_FOIA_COLS} FROM public_records_requests "
            "WHERE (%s = '' OR status = %s) "
            "AND (%s = '%%' OR request_number ILIKE %s OR subject ILIKE %s OR requester_name ILIKE %s) "
            "ORDER BY id DESC",
            (st, st, ql, ql, ql, ql),
        ).fetchall()
    return [_row_to_foia(r) for r in rows]


@router.patch("/requests/{req_id}")
def update_foia_request(
    req_id: int,
    body: FoiaRequestPatch,
    user: dict = Depends(require_permission("records.manage")),
):
    if body.status is not None and body.status.strip().lower() not in FOIA_STATUSES:
        raise HTTPException(status_code=400, detail="Invalid FOIA request status")
    ful_clause = ", fulfilled_at = COALESCE(fulfilled_at, now())" if body.status == "fulfilled" else ""
    with pool.connection() as conn:
        row = conn.execute(
            f"UPDATE public_records_requests SET "
            f"status = COALESCE(%s, status), "
            f"assigned_to = COALESCE(%s, assigned_to), "
            f"due_date = COALESCE(%s, due_date), "
            f"fee_estimate = COALESCE(%s, fee_estimate), "
            f"response_notes = COALESCE(%s, response_notes), "
            f"updated_at = now(){ful_clause} "
            f"WHERE id = %s RETURNING {_FOIA_COLS}",
            (
                body.status.strip().lower() if body.status is not None else None,
                body.assigned_to.strip() if body.assigned_to is not None else None,
                body.due_date.strip() if body.due_date is not None else None,
                body.fee_estimate.strip() if body.fee_estimate is not None else None,
                body.response_notes.strip() if body.response_notes is not None else None,
                req_id,
            ),
        ).fetchone()
        if not row:
            raise HTTPException(status_code=404, detail="Records request not found")
    record_audit(user["username"], "records.foia_update", f"Updated {row[1]} -> {row[8]}")
    if row[3] and "@" in row[3] and body.status in ("ready", "fulfilled", "denied"):
        from .integrations import send_direct_email
        send_direct_email(
            [row[3]],
            f"[DocketHall] Public Records Request {row[1]} — {row[8].replace('_', ' ').title()}",
            f"Hello {row[2]},\n\nYour public records request ({row[1]}: {row[5]}) is now marked '{row[8]}'.\n\n{row[12] or ''}",
            link_path="/#records",
        )
    return _row_to_foia(row)


@router.delete("/requests/{req_id}")
def delete_foia_request(req_id: int, user: dict = Depends(require_permission("records.manage"))):
    with pool.connection() as conn:
        row = conn.execute("DELETE FROM public_records_requests WHERE id = %s RETURNING request_number", (req_id,)).fetchone()
        if not row:
            raise HTTPException(status_code=404, detail="Records request not found")
    record_audit(user["username"], "records.foia_delete", f"Deleted {row[0]}")
    return {"deleted": True, "id": req_id}


# ------------------------------------------------------------------ staff endpoints
@router.get("")
def list_records(
    q: str = "",
    category: str = "",
    status: str = "",
    expiring_only: bool = False,
    _: dict = Depends(require_permission("records.view", "records.manage")),
):
    with pool.connection() as conn:
        rows = conn.execute(
            f"SELECT {_COLS} FROM repository_documents ORDER BY updated_at DESC, id DESC"
        ).fetchall()
        items = _hydrate_records(conn, rows)

    expiring_count = sum(1 for x in items if x["expiry_flag"] in ("expired", "expiring_soon"))
    if category.strip():
        items = [x for x in items if x["category"] == category.strip()]
    if status.strip():
        items = [x for x in items if x["status"] == status.strip()]
    if expiring_only:
        items = [x for x in items if x["expiry_flag"] in ("expired", "expiring_soon")]
    ql = q.strip().lower()
    if ql:
        items = [
            x for x in items
            if ql in f"{x['doc_number']} {x['title']} {x['counterparty']} {x['tags']} {x['notes']}".lower()
        ]
    return {"items": items, "expiring_count": expiring_count}


@router.post("", status_code=201)
def create_record(
    body: RecordCreateIn,
    request: Request,
    user: dict = Depends(require_permission("records.manage")),
):
    if not body.title.strip():
        raise HTTPException(status_code=400, detail="Title is required")
    if body.status not in RECORD_STATUSES:
        raise HTTPException(status_code=400, detail="Invalid status")

    with pool.connection() as conn:
        row = conn.execute(
            "INSERT INTO repository_documents "
            "(doc_number, category, title, counterparty, effective_date, expiration_date, "
            " renewal_notice_days, status, tags, notes, is_public, auto_unpublish_on_expire, created_by) "
            "VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s) RETURNING id",
            (
                body.doc_number.strip(),
                body.category.strip() or "Resolution",
                body.title.strip(),
                body.counterparty.strip(),
                body.effective_date.strip(),
                body.expiration_date.strip(),
                max(0, int(body.renewal_notice_days)),
                body.status,
                body.tags.strip(),
                body.notes.strip(),
                body.is_public,
                body.auto_unpublish_on_expire,
                user["username"],
            ),
        ).fetchone()
        doc_id = row[0]
        if not body.doc_number.strip():
            year = datetime.now(timezone.utc).year
            auto_num = f"REC-{year}-{doc_id:04d}"
            conn.execute("UPDATE repository_documents SET doc_number = %s WHERE id = %s", (auto_num, doc_id))
        rec = _get_record_or_404(conn, doc_id)
    if rec["is_public"]:
        notify_topic_subscribers(
            "records",
            f"[DocketHall] New Public Record Published: {rec['title']}",
            f"{rec['category']}: {rec['title']} ({rec['doc_number']}) has been published to Public Records.",
            link_path="/#records",
            request=request,
        )
    return rec


@router.patch("/{doc_id}")
def update_record(
    doc_id: int,
    body: RecordPatchIn,
    _: dict = Depends(require_permission("records.manage")),
):
    if body.status is not None and body.status not in RECORD_STATUSES:
        raise HTTPException(status_code=400, detail="Invalid status")
    with pool.connection() as conn:
        prev = conn.execute("SELECT is_public FROM repository_documents WHERE id = %s", (doc_id,)).fetchone()
        was_public = bool(prev and prev[0])
        row = conn.execute(
            "UPDATE repository_documents SET "
            "doc_number = COALESCE(%s, doc_number), "
            "category = COALESCE(%s, category), "
            "title = COALESCE(%s, title), "
            "counterparty = COALESCE(%s, counterparty), "
            "effective_date = COALESCE(%s, effective_date), "
            "expiration_date = COALESCE(%s, expiration_date), "
            "renewal_notice_days = COALESCE(%s, renewal_notice_days), "
            "status = COALESCE(%s, status), "
            "tags = COALESCE(%s, tags), "
            "notes = COALESCE(%s, notes), "
            "is_public = COALESCE(%s, is_public), "
            "auto_unpublish_on_expire = COALESCE(%s, auto_unpublish_on_expire), "
            "updated_at = now() "
            "WHERE id = %s RETURNING id",
            (
                (body.doc_number.strip() or None) if body.doc_number is not None else None,
                (body.category.strip() or None) if body.category is not None else None,
                (body.title.strip() or None) if body.title is not None else None,
                body.counterparty.strip() if body.counterparty is not None else None,
                body.effective_date.strip() if body.effective_date is not None else None,
                body.expiration_date.strip() if body.expiration_date is not None else None,
                max(0, int(body.renewal_notice_days)) if body.renewal_notice_days is not None else None,
                body.status,
                body.tags.strip() if body.tags is not None else None,
                body.notes.strip() if body.notes is not None else None,
                body.is_public,
                body.auto_unpublish_on_expire,
                doc_id,
            ),
        ).fetchone()
        if not row:
            raise HTTPException(status_code=404, detail="Repository record not found")
        rec = _get_record_or_404(conn, doc_id)
    if not was_public and rec.get("is_public"):
        try:
            from .subscriptions import notify_topic_subscribers
            notify_topic_subscribers("records", f"New Public Record: {rec['title']}", f"{rec['category']} — {rec['title']}", link_path="/#records")
        except Exception:
            pass
    return rec


@router.delete("/{doc_id}")
def delete_record(doc_id: int, _: dict = Depends(require_permission("records.manage"))):
    with pool.connection() as conn:
        keys = [
            r[0]
            for r in conn.execute("SELECT object_key FROM repository_files WHERE document_id = %s", (doc_id,)).fetchall()
        ]
        row = conn.execute("DELETE FROM repository_documents WHERE id = %s RETURNING id", (doc_id,)).fetchone()
        if not row:
            raise HTTPException(status_code=404, detail="Repository record not found")
    _remove_storage_objects(keys)
    return {"deleted": True, "id": doc_id}


@router.post("/{doc_id}/files", status_code=201)
async def upload_record_file(
    doc_id: int,
    file: UploadFile = File(...),
    title: str = Form(""),
    user: dict = Depends(require_permission("records.manage")),
):
    with pool.connection() as conn:
        _get_record_or_404(conn, doc_id)
    raw = await file.read(MAX_REPO_FILE_BYTES + 1)
    if len(raw) > MAX_REPO_FILE_BYTES:
        raise HTTPException(status_code=413, detail="File exceeds 50 MB limit")
    if not raw:
        raise HTTPException(status_code=400, detail="Uploaded file is empty")

    orig_name = (file.filename or "document").strip() or "document"
    safe_name = _SAFE_FILENAME_RE.sub("_", orig_name).strip("._") or "document"
    obj_key = tenant_object_key(f"records/{doc_id}/{uuid.uuid4().hex[:12]}_{safe_name}")
    sha = hashlib.sha256(raw).hexdigest()
    ctype = file.content_type or "application/octet-stream"
    _storage().put_object(_bucket(), obj_key, io.BytesIO(raw), length=len(raw), content_type=ctype)

    with pool.connection() as conn:
        conn.execute(
            "INSERT INTO repository_files "
            "(document_id, title, filename, content_type, size_bytes, sha256, object_key, uploaded_by) "
            "VALUES (%s, %s, %s, %s, %s, %s, %s, %s)",
            (doc_id, title.strip() or orig_name, orig_name, ctype, len(raw), sha, obj_key, user["username"]),
        )
        conn.execute("UPDATE repository_documents SET updated_at = now() WHERE id = %s", (doc_id,))
        return _get_record_or_404(conn, doc_id)


@router.get("/files/{file_id}/download")
def download_record_file(
    file_id: int,
    _: dict = Depends(require_permission("records.view", "records.manage")),
):
    with pool.connection() as conn:
        row = conn.execute(
            "SELECT filename, content_type, object_key FROM repository_files WHERE id = %s", (file_id,)
        ).fetchone()
        if not row:
            raise HTTPException(status_code=404, detail="File not found")
    obj = _storage().get_object(_bucket(), row[2])
    try:
        data = obj.read()
    finally:
        obj.close()
        obj.release_conn()
    safe_fn = _SAFE_FILENAME_RE.sub("_", row[0] or "document").strip("._") or "document"
    raw_ctype = (row[1] or "application/octet-stream").split(";")[0].strip().lower()
    safe_inline = raw_ctype in {"application/pdf", "image/png", "image/jpeg", "image/webp", "image/gif", "text/plain"}
    disp = "inline" if safe_inline else "attachment"
    return Response(
        content=data,
        media_type=raw_ctype if safe_inline else "application/octet-stream",
        headers={
            "Content-Disposition": f'{disp}; filename="{safe_fn}"',
            "X-Content-Type-Options": "nosniff",
        },
    )


@router.get("/files/{file_id}/compliance")
def check_record_file_compliance(
    file_id: int,
    _: dict = Depends(require_permission("records.view", "records.manage")),
):
    with pool.connection() as conn:
        row = conn.execute(
            "SELECT filename, content_type, object_key FROM repository_files WHERE id = %s",
            (file_id,),
        ).fetchone()
        if not row:
            raise HTTPException(status_code=404, detail="File not found")
    obj = _storage().get_object(_bucket(), row[2])
    try:
        data = obj.read()
    finally:
        obj.close()
        obj.release_conn()
    return check_pdf_compliance(data, row[0] or f"file_{file_id}.pdf")


@router.delete("/{doc_id}/files/{file_id}")
def delete_record_file(
    doc_id: int,
    file_id: int,
    _: dict = Depends(require_permission("records.manage")),
):
    with pool.connection() as conn:
        row = conn.execute(
            "DELETE FROM repository_files WHERE id = %s AND document_id = %s RETURNING object_key",
            (file_id, doc_id),
        ).fetchone()
        if not row:
            raise HTTPException(status_code=404, detail="File not found")
        _remove_storage_objects([row[0]])
        return _get_record_or_404(conn, doc_id)
