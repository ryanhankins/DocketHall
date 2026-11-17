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

from fastapi import APIRouter, Depends, File, Form, HTTPException, UploadFile
from fastapi.responses import Response
from pydantic import BaseModel

from .agendas import _bucket, _minio, _remove_minio_objects
from .auth import require_permission
from .db import pool

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
    created_by          TEXT NOT NULL DEFAULT '',
    created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);
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


_COLS = (
    "id, doc_number, category, title, counterparty, effective_date, expiration_date, "
    "renewal_notice_days, status, tags, notes, is_public, created_by, created_at, updated_at"
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
        notice_days = int(r[7] or 30)
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


# ------------------------------------------------------------------ public endpoints
@router.get("/public")
def list_public_records(q: str = "", category: str = ""):
    with pool.connection() as conn:
        rows = conn.execute(
            f"SELECT {_COLS} FROM repository_documents WHERE is_public = TRUE ORDER BY effective_date DESC, id DESC"
        ).fetchall()
        items = _hydrate_records(conn, rows)
    ql = q.strip().lower()
    if category.strip():
        items = [x for x in items if x["category"] == category.strip()]
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
            "SELECT f.filename, f.content_type, f.object_key "
            "FROM repository_files f JOIN repository_documents d ON d.id = f.document_id "
            "WHERE f.id = %s AND d.is_public = TRUE",
            (file_id,),
        ).fetchone()
        if not row:
            raise HTTPException(status_code=404, detail="File not found")
    obj = _minio().get_object(_bucket(), row[2])
    try:
        data = obj.read()
    finally:
        obj.close()
        obj.release_conn()
    return Response(
        content=data,
        media_type=row[1] or "application/octet-stream",
        headers={"Content-Disposition": f'inline; filename="{row[0]}"'},
    )


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
            " renewal_notice_days, status, tags, notes, is_public, created_by) "
            "VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s) RETURNING id",
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
                user["username"],
            ),
        ).fetchone()
        doc_id = row[0]
        if not body.doc_number.strip():
            year = datetime.now(timezone.utc).year
            auto_num = f"REC-{year}-{doc_id:04d}"
            conn.execute("UPDATE repository_documents SET doc_number = %s WHERE id = %s", (auto_num, doc_id))
        return _get_record_or_404(conn, doc_id)


@router.patch("/{doc_id}")
def update_record(
    doc_id: int,
    body: RecordPatchIn,
    _: dict = Depends(require_permission("records.manage")),
):
    if body.status is not None and body.status not in RECORD_STATUSES:
        raise HTTPException(status_code=400, detail="Invalid status")
    with pool.connection() as conn:
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
            "updated_at = now() "
            "WHERE id = %s RETURNING id",
            (
                body.doc_number.strip() if body.doc_number is not None else None,
                body.category.strip() if body.category is not None else None,
                body.title.strip() if body.title is not None else None,
                body.counterparty.strip() if body.counterparty is not None else None,
                body.effective_date.strip() if body.effective_date is not None else None,
                body.expiration_date.strip() if body.expiration_date is not None else None,
                max(0, int(body.renewal_notice_days)) if body.renewal_notice_days is not None else None,
                body.status,
                body.tags.strip() if body.tags is not None else None,
                body.notes.strip() if body.notes is not None else None,
                body.is_public,
                doc_id,
            ),
        ).fetchone()
        if not row:
            raise HTTPException(status_code=404, detail="Repository record not found")
        return _get_record_or_404(conn, doc_id)


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
    _remove_minio_objects(keys)
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
    obj_key = f"records/{doc_id}/{uuid.uuid4().hex[:12]}_{safe_name}"
    sha = hashlib.sha256(raw).hexdigest()
    ctype = file.content_type or "application/octet-stream"
    _minio().put_object(_bucket(), obj_key, io.BytesIO(raw), length=len(raw), content_type=ctype)

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
    obj = _minio().get_object(_bucket(), row[2])
    try:
        data = obj.read()
    finally:
        obj.close()
        obj.release_conn()
    return Response(
        content=data,
        media_type=row[1] or "application/octet-stream",
        headers={"Content-Disposition": f'inline; filename="{row[0]}"'},
    )


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
        _remove_minio_objects([row[0]])
        return _get_record_or_404(conn, doc_id)
