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

"""Administrative Complaints module (City Code Section 618): intake, private complainant
data protection (MN Stat. 13.44), public complaint log book, investigation reports,
Notice of Violation (<=60-day deadline), Council referral, and final resolution.
"""
import hashlib
import io
import os
import secrets
from datetime import date, datetime, timedelta

from fastapi import APIRouter, Depends, File, Form, HTTPException, Query, Request, UploadFile
from fastapi.responses import StreamingResponse
from pydantic import BaseModel

from .agendas import _bucket, _minio
from .auth import current_user, has_permission, require_permission
from .db import pool

router = APIRouter(prefix="/api/complaints", tags=["complaints"])

VALID_CHANNELS = {"written", "oral", "anonymous"}
VALID_STATUSES = {
    "submitted",
    "investigating",
    "informal_resolution",
    "notice_of_violation",
    "hearing_requested",
    "council_review",
    "resolved",
    "dismissed",
}
VALID_DOC_CATEGORIES = {
    "evidence",
    "investigation_report",
    "notice_of_violation",
    "correspondence",
    "other",
}

SCHEMA = """
CREATE TABLE IF NOT EXISTS complaints (
    id                          BIGSERIAL PRIMARY KEY,
    complaint_number            TEXT NOT NULL UNIQUE,
    intake_channel              TEXT NOT NULL DEFAULT 'written',
    is_anonymous                BOOLEAN NOT NULL DEFAULT FALSE,
    is_real_property_complaint  BOOLEAN NOT NULL DEFAULT TRUE,

    -- Confidential complainant fields (never exposed in public log book)
    complainant_user_id         BIGINT,
    complainant_username        TEXT NOT NULL DEFAULT '',
    complainant_name            TEXT NOT NULL DEFAULT '',
    complainant_email           TEXT NOT NULL DEFAULT '',
    complainant_phone           TEXT NOT NULL DEFAULT '',
    complainant_address         TEXT NOT NULL DEFAULT '',

    -- Public subject & conduct fields
    subject_property_address    TEXT NOT NULL DEFAULT '',
    subject_person_name         TEXT NOT NULL DEFAULT '',
    ordinance_section           TEXT NOT NULL DEFAULT '',
    conduct_description         TEXT NOT NULL DEFAULT '',
    date_observed               TEXT NOT NULL DEFAULT '',

    -- Workflow & investigation (Section 618.030 - 618.070)
    status                      TEXT NOT NULL DEFAULT 'submitted',
    assigned_to                 TEXT NOT NULL DEFAULT '',
    assisting_agency            TEXT NOT NULL DEFAULT '',
    investigation_report        TEXT NOT NULL DEFAULT '',
    internal_notes              TEXT NOT NULL DEFAULT '',

    -- Notice of Violation (Section 618.040)
    nov_issued_at               TIMESTAMPTZ,
    nov_issuing_official        TEXT NOT NULL DEFAULT '',
    nov_violation_datetime      TEXT NOT NULL DEFAULT '',
    nov_required_action         TEXT NOT NULL DEFAULT '',
    nov_compliance_deadline     TEXT NOT NULL DEFAULT '',
    hearing_requested_at        TIMESTAMPTZ,
    council_meeting_date        TEXT NOT NULL DEFAULT '',

    -- Final resolution (Section 618.070)
    final_resolution            TEXT NOT NULL DEFAULT '',
    resolved_at                 TIMESTAMPTZ,

    created_at                  TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at                  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS complaints_status_idx ON complaints(status);
CREATE INDEX IF NOT EXISTS complaints_user_idx ON complaints(complainant_user_id);

CREATE TABLE IF NOT EXISTS complaint_documents (
    id              BIGSERIAL PRIMARY KEY,
    complaint_id    BIGINT NOT NULL REFERENCES complaints(id) ON DELETE CASCADE,
    doc_category    TEXT NOT NULL DEFAULT 'evidence',
    is_confidential BOOLEAN NOT NULL DEFAULT FALSE,
    title           TEXT NOT NULL DEFAULT '',
    filename        TEXT NOT NULL,
    content_type    TEXT NOT NULL DEFAULT 'application/octet-stream',
    size_bytes      BIGINT NOT NULL DEFAULT 0,
    sha256          TEXT NOT NULL DEFAULT '',
    object_key      TEXT NOT NULL,
    uploaded_by     TEXT NOT NULL DEFAULT '',
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS complaint_documents_cid_idx ON complaint_documents(complaint_id);

CREATE TABLE IF NOT EXISTS complaint_activity_log (
    id              BIGSERIAL PRIMARY KEY,
    complaint_id    BIGINT NOT NULL REFERENCES complaints(id) ON DELETE CASCADE,
    action          TEXT NOT NULL,
    actor_username  TEXT NOT NULL DEFAULT '',
    is_internal     BOOLEAN NOT NULL DEFAULT FALSE,
    note            TEXT NOT NULL DEFAULT '',
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS complaint_activity_cid_idx ON complaint_activity_log(complaint_id);
"""


def bootstrap() -> None:
    with pool.connection() as conn:
        with conn.transaction():
            conn.execute("SELECT pg_advisory_xact_lock(424248)")
            conn.execute(SCHEMA)


def _iso(v) -> str:
    return v.isoformat() if v else ""


def _next_complaint_number(conn) -> str:
    year = date.today().year
    row = conn.execute(
        "SELECT COALESCE(MAX(id), 0) + 1 FROM complaints"
    ).fetchone()
    seq = row[0] if row else 1
    return f"CMP-{year}-{seq:04d}"


def _fetch_docs(conn, complaint_id: int, include_confidential: bool) -> list[dict]:
    sql = """
        SELECT id, complaint_id, doc_category, is_confidential, title, filename,
               content_type, size_bytes, uploaded_by, created_at
        FROM complaint_documents
        WHERE complaint_id = %s
    """
    if not include_confidential:
        sql += " AND is_confidential = FALSE"
    sql += " ORDER BY id ASC"
    rows = conn.execute(sql, (complaint_id,)).fetchall()
    return [
        {
            "id": r[0],
            "complaint_id": r[1],
            "doc_category": r[2],
            "is_confidential": r[3],
            "title": r[4],
            "filename": r[5],
            "content_type": r[6],
            "size_bytes": r[7],
            "uploaded_by": r[8] if include_confidential else "",
            "created_at": _iso(r[9]),
        }
        for r in rows
    ]


def _fetch_activity(conn, complaint_id: int, include_internal: bool) -> list[dict]:
    sql = """
        SELECT id, complaint_id, action, actor_username, is_internal, note, created_at
        FROM complaint_activity_log
        WHERE complaint_id = %s
    """
    if not include_internal:
        sql += " AND is_internal = FALSE"
    sql += " ORDER BY id DESC"
    rows = conn.execute(sql, (complaint_id,)).fetchall()
    return [
        {
            "id": r[0],
            "complaint_id": r[1],
            "action": r[2],
            "actor_username": r[3] if include_internal else "",
            "is_internal": r[4],
            "note": r[5],
            "created_at": _iso(r[6]),
        }
        for r in rows
    ]


_SELECT_COLS = """
    id, complaint_number, intake_channel, is_anonymous, is_real_property_complaint,
    complainant_user_id, complainant_username, complainant_name, complainant_email,
    complainant_phone, complainant_address,
    subject_property_address, subject_person_name, ordinance_section,
    conduct_description, date_observed,
    status, assigned_to, assisting_agency, investigation_report, internal_notes,
    nov_issued_at, nov_issuing_official, nov_violation_datetime,
    nov_required_action, nov_compliance_deadline, hearing_requested_at,
    council_meeting_date, final_resolution, resolved_at,
    created_at, updated_at
"""


def _serialize_public(row, docs: list[dict] | None = None, activity: list[dict] | None = None) -> dict:
    """Public Complaint Log Book representation (Section 618.025 & MN Stat. 13.44).
    Complainant identity, contact info, and internal staff notes are strictly omitted.
    """
    return {
        "id": row[0],
        "complaint_number": row[1],
        "intake_channel": row[2],
        "is_anonymous": row[3],
        "is_real_property_complaint": row[4],
        "subject_property_address": row[11],
        "subject_person_name": row[12],
        "ordinance_section": row[13],
        "conduct_description": row[14],
        "date_observed": row[15],
        "status": row[16],
        "assisting_agency": row[18],
        "investigation_report": row[19],
        "nov_issued_at": _iso(row[21]),
        "nov_issuing_official": row[22],
        "nov_violation_datetime": row[23],
        "nov_required_action": row[24],
        "nov_compliance_deadline": row[25],
        "hearing_requested_at": _iso(row[26]),
        "council_meeting_date": row[27],
        "final_resolution": row[28],
        "resolved_at": _iso(row[29]),
        "created_at": _iso(row[30]),
        "updated_at": _iso(row[31]),
        "documents": docs if docs is not None else [],
        "activity": activity if activity is not None else [],
    }


def _serialize_private(row, docs: list[dict] | None = None, activity: list[dict] | None = None, include_internal: bool = True) -> dict:
    """Full representation for complaints.manage staff (or the complainant viewing their own filing)."""
    base = _serialize_public(row, docs=docs, activity=activity)
    base.update(
        {
            "complainant_user_id": row[5],
            "complainant_username": row[6],
            "complainant_name": row[7],
            "complainant_email": row[8],
            "complainant_phone": row[9],
            "complainant_address": row[10],
            "assigned_to": row[17],
            "internal_notes": row[20] if include_internal else "",
        }
    )
    return base


class ComplaintCreateIn(BaseModel):
    intake_channel: str = "written"
    is_anonymous: bool = False
    is_real_property_complaint: bool = True
    complainant_name: str = ""
    complainant_email: str = ""
    complainant_phone: str = ""
    complainant_address: str = ""
    subject_property_address: str = ""
    subject_person_name: str = ""
    ordinance_section: str = ""
    conduct_description: str
    date_observed: str = ""


class ComplaintPatchIn(BaseModel):
    status: str | None = None
    assigned_to: str | None = None
    assisting_agency: str | None = None
    investigation_report: str | None = None
    internal_notes: str | None = None
    ordinance_section: str | None = None
    subject_property_address: str | None = None
    subject_person_name: str | None = None
    council_meeting_date: str | None = None
    final_resolution: str | None = None
    hearing_requested: bool | None = None


class NoticeOfViolationIn(BaseModel):
    issuing_official: str
    violation_datetime: str = ""
    required_action: str
    compliance_deadline: str  # YYYY-MM-DD, <= 60 days from today per Section 618.040


def _create_complaint_row(body: ComplaintCreateIn, user: dict | None, allow_staff_channel: bool) -> dict:
    conduct = body.conduct_description.strip()
    if not conduct:
        raise HTTPException(status_code=400, detail="Conduct description is required")

    channel = (body.intake_channel or "written").strip().lower()
    if channel not in VALID_CHANNELS:
        channel = "written"
    if not allow_staff_channel and channel == "oral":
        channel = "written"

    is_anon = bool(body.is_anonymous) or channel == "anonymous"
    cname = "" if is_anon else body.complainant_name.strip()
    cemail = "" if is_anon else body.complainant_email.strip()
    cphone = "" if is_anon else body.complainant_phone.strip()
    caddr = "" if is_anon else body.complainant_address.strip()

    uid = user["id"] if (user and not is_anon) else None
    uname = user["username"] if (user and not is_anon) else ""

    with pool.connection() as conn:
        with conn.transaction():
            cnum = _next_complaint_number(conn)
            row = conn.execute(
                f"""
                INSERT INTO complaints (
                    complaint_number, intake_channel, is_anonymous, is_real_property_complaint,
                    complainant_user_id, complainant_username,
                    complainant_name, complainant_email, complainant_phone, complainant_address,
                    subject_property_address, subject_person_name, ordinance_section,
                    conduct_description, date_observed
                )
                VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
                RETURNING {_SELECT_COLS}
                """,
                (
                    cnum,
                    "anonymous" if is_anon else channel,
                    is_anon,
                    body.is_real_property_complaint,
                    uid,
                    uname,
                    cname,
                    cemail,
                    cphone,
                    caddr,
                    body.subject_property_address.strip(),
                    body.subject_person_name.strip(),
                    body.ordinance_section.strip(),
                    conduct,
                    body.date_observed.strip(),
                ),
            ).fetchone()
            conn.execute(
                """
                INSERT INTO complaint_activity_log (complaint_id, action, actor_username, is_internal, note)
                VALUES (%s, 'submitted', %s, FALSE, %s)
                """,
                (
                    row[0],
                    user["username"] if user else "public",
                    f"Complaint {cnum} filed ({'anonymous' if is_anon else channel}). No filing fee.",
                ),
            )
            docs = _fetch_docs(conn, row[0], include_confidential=True)
            act = _fetch_activity(conn, row[0], include_internal=False)
    return _serialize_private(row, docs=docs, activity=act, include_internal=False)


@router.post("/public")
def file_public_complaint(body: ComplaintCreateIn, request: Request):
    """Public / anonymous complaint filing endpoint (no fee, MN Stat. 13.44 confidentiality)."""
    user = current_user(request)
    return _create_complaint_row(body, user, allow_staff_channel=False)


@router.post("")
def file_complaint(
    body: ComplaintCreateIn,
    user: dict = Depends(require_permission("complaints.submit", "complaints.manage")),
):
    """Authenticated complaint filing (resident/applicant or staff logging an oral complaint)."""
    is_staff = has_permission(user, "complaints.manage")
    return _create_complaint_row(body, user, allow_staff_channel=is_staff)


@router.get("/public-log")
def public_complaint_log(
    q: str = Query(""),
    status: str = Query(""),
    ordinance: str = Query(""),
):
    """Public Complaint Log Book (Section 618.025).
    Complainant names, contact info, internal notes, and confidential files are stripped.
    """
    clauses = ["1=1"]
    params: list = []
    if q.strip():
        like = f"%{q.strip()}%"
        clauses.append(
            "(complaint_number ILIKE %s OR subject_property_address ILIKE %s "
            "OR ordinance_section ILIKE %s OR conduct_description ILIKE %s "
            "OR final_resolution ILIKE %s)"
        )
        params.extend([like, like, like, like, like])
    if status.strip():
        clauses.append("status = %s")
        params.append(status.strip())
    if ordinance.strip():
        clauses.append("ordinance_section ILIKE %s")
        params.append(f"%{ordinance.strip()}%")

    where_sql = " AND ".join(clauses)
    with pool.connection() as conn:
        rows = conn.execute(
            f"SELECT {_SELECT_COLS} FROM complaints WHERE {where_sql} ORDER BY id DESC LIMIT 500",
            params,
        ).fetchall()
        items = []
        for r in rows:
            docs = _fetch_docs(conn, r[0], include_confidential=False)
            act = _fetch_activity(conn, r[0], include_internal=False)
            items.append(_serialize_public(r, docs=docs, activity=act))
    return {"items": items}


@router.get("/mine")
def my_complaints(user: dict = Depends(require_permission("complaints.submit", "complaints.manage"))):
    """Complaints filed by the current logged-in user."""
    with pool.connection() as conn:
        rows = conn.execute(
            f"SELECT {_SELECT_COLS} FROM complaints WHERE complainant_user_id = %s ORDER BY id DESC",
            (user["id"],),
        ).fetchall()
        items = []
        for r in rows:
            docs = _fetch_docs(conn, r[0], include_confidential=False)
            act = _fetch_activity(conn, r[0], include_internal=False)
            items.append(_serialize_private(r, docs=docs, activity=act, include_internal=False))
    return {"items": items}


@router.get("")
def list_complaints_staff(
    q: str = Query(""),
    status: str = Query(""),
    user: dict = Depends(require_permission("complaints.manage")),
):
    """Full staff complaint queue including confidential complainant fields."""
    clauses = ["1=1"]
    params: list = []
    if q.strip():
        like = f"%{q.strip()}%"
        clauses.append(
            "(complaint_number ILIKE %s OR subject_property_address ILIKE %s "
            "OR subject_person_name ILIKE %s OR complainant_name ILIKE %s "
            "OR ordinance_section ILIKE %s OR conduct_description ILIKE %s)"
        )
        params.extend([like, like, like, like, like, like])
    if status.strip():
        clauses.append("status = %s")
        params.append(status.strip())
    where_sql = " AND ".join(clauses)
    with pool.connection() as conn:
        rows = conn.execute(
            f"SELECT {_SELECT_COLS} FROM complaints WHERE {where_sql} ORDER BY id DESC LIMIT 500",
            params,
        ).fetchall()
        items = []
        for r in rows:
            docs = _fetch_docs(conn, r[0], include_confidential=True)
            act = _fetch_activity(conn, r[0], include_internal=True)
            items.append(_serialize_private(r, docs=docs, activity=act, include_internal=True))
    return {"items": items}


@router.patch("/{complaint_id}")
def update_complaint(
    complaint_id: int,
    body: ComplaintPatchIn,
    user: dict = Depends(require_permission("complaints.manage")),
):
    sets = ["updated_at = now()"]
    params: list = []

    if body.status is not None:
        st = body.status.strip()
        if st not in VALID_STATUSES:
            raise HTTPException(status_code=400, detail="Invalid status")
        sets.append("status = %s")
        params.append(st)
        if st in ("resolved", "dismissed"):
            sets.append("resolved_at = COALESCE(resolved_at, now())")

    for field in (
        "assigned_to",
        "assisting_agency",
        "investigation_report",
        "internal_notes",
        "ordinance_section",
        "subject_property_address",
        "subject_person_name",
        "council_meeting_date",
        "final_resolution",
    ):
        val = getattr(body, field)
        if val is not None:
            sets.append(f"{field} = %s")
            params.append(val.strip())

    if body.hearing_requested:
        sets.append("hearing_requested_at = COALESCE(hearing_requested_at, now())")
        if body.status is None:
            sets.append("status = 'hearing_requested'")

    params.append(complaint_id)
    with pool.connection() as conn:
        with conn.transaction():
            row = conn.execute(
                f"UPDATE complaints SET {', '.join(sets)} WHERE id = %s RETURNING {_SELECT_COLS}",
                params,
            ).fetchone()
            if not row:
                raise HTTPException(status_code=404, detail="Complaint not found")
            note_parts = []
            if body.status is not None:
                note_parts.append(f"Status set to {body.status}")
            if body.final_resolution is not None and body.final_resolution.strip():
                note_parts.append("Final resolution updated")
            if body.investigation_report is not None:
                note_parts.append("Investigation report updated")
            if body.hearing_requested:
                note_parts.append("Public hearing requested")
            if note_parts:
                conn.execute(
                    """
                    INSERT INTO complaint_activity_log (complaint_id, action, actor_username, is_internal, note)
                    VALUES (%s, 'updated', %s, FALSE, %s)
                    """,
                    (complaint_id, user["username"], "; ".join(note_parts)),
                )
            docs = _fetch_docs(conn, complaint_id, include_confidential=True)
            act = _fetch_activity(conn, complaint_id, include_internal=True)
    return _serialize_private(row, docs=docs, activity=act, include_internal=True)


@router.post("/{complaint_id}/nov")
def issue_notice_of_violation(
    complaint_id: int,
    body: NoticeOfViolationIn,
    user: dict = Depends(require_permission("complaints.manage")),
):
    """Issue a Section 618.040 Notice of Violation (compliance deadline <= 60 days)."""
    official = body.issuing_official.strip()
    action = body.required_action.strip()
    deadline_str = body.compliance_deadline.strip()
    if not official or not action or not deadline_str:
        raise HTTPException(status_code=400, detail="Issuing official, required action, and deadline are required")
    try:
        dl = date.fromisoformat(deadline_str)
    except ValueError:
        raise HTTPException(status_code=400, detail="Deadline must be YYYY-MM-DD")
    today = date.today()
    if dl < today:
        raise HTTPException(status_code=400, detail="Compliance deadline cannot be in the past")
    if dl > today + timedelta(days=60):
        raise HTTPException(
            status_code=400,
            detail="Per Section 618.040, compliance deadline cannot exceed 60 days from the Notice date",
        )

    with pool.connection() as conn:
        with conn.transaction():
            row = conn.execute(
                f"""
                UPDATE complaints
                SET status = 'notice_of_violation',
                    nov_issued_at = now(),
                    nov_issuing_official = %s,
                    nov_violation_datetime = %s,
                    nov_required_action = %s,
                    nov_compliance_deadline = %s,
                    updated_at = now()
                WHERE id = %s
                RETURNING {_SELECT_COLS}
                """,
                (official, body.violation_datetime.strip(), action, deadline_str, complaint_id),
            ).fetchone()
            if not row:
                raise HTTPException(status_code=404, detail="Complaint not found")
            conn.execute(
                """
                INSERT INTO complaint_activity_log (complaint_id, action, actor_username, is_internal, note)
                VALUES (%s, 'notice_of_violation', %s, FALSE, %s)
                """,
                (
                    complaint_id,
                    user["username"],
                    f"Notice of Violation issued by {official}; compliance deadline {deadline_str} (10-day public hearing request window).",
                ),
            )
            docs = _fetch_docs(conn, complaint_id, include_confidential=True)
            act = _fetch_activity(conn, complaint_id, include_internal=True)
    return _serialize_private(row, docs=docs, activity=act, include_internal=True)


@router.post("/{complaint_id}/documents")
async def upload_complaint_document(
    complaint_id: int,
    request: Request,
    file: UploadFile = File(...),
    doc_category: str = Form("evidence"),
    title: str = Form(""),
    is_confidential: bool = Form(False),
):
    user = current_user(request)
    cat = doc_category.strip().lower()
    if cat not in VALID_DOC_CATEGORIES:
        cat = "other"

    with pool.connection() as conn:
        exists = conn.execute("SELECT id, complainant_user_id FROM complaints WHERE id = %s", (complaint_id,)).fetchone()
        if not exists:
            raise HTTPException(status_code=404, detail="Complaint not found")

    is_staff = bool(user and has_permission(user, "complaints.manage"))
    if is_confidential and not is_staff:
        # Public submitters' attachments default to confidential only if marked, or staff can mark confidential
        pass

    raw = await file.read()
    if len(raw) > 25 * 1024 * 1024:
        raise HTTPException(status_code=413, detail="File exceeds 25 MB limit")

    sha = hashlib.sha256(raw).hexdigest()
    safe_name = os.path.basename(file.filename or "attachment")
    object_key = f"complaints/{complaint_id}/{secrets.token_hex(8)}_{safe_name}"
    ctype = file.content_type or "application/octet-stream"

    _minio().put_object(
        _bucket(),
        object_key,
        io.BytesIO(raw),
        length=len(raw),
        content_type=ctype,
    )

    uploader = user["username"] if user else "public"
    with pool.connection() as conn:
        with conn.transaction():
            conn.execute(
                """
                INSERT INTO complaint_documents
                    (complaint_id, doc_category, is_confidential, title, filename,
                     content_type, size_bytes, sha256, object_key, uploaded_by)
                VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
                """,
                (
                    complaint_id,
                    cat,
                    bool(is_confidential),
                    title.strip() or safe_name,
                    safe_name,
                    ctype,
                    len(raw),
                    sha,
                    object_key,
                    uploader,
                ),
            )
            conn.execute("UPDATE complaints SET updated_at = now() WHERE id = %s", (complaint_id,))
            row = conn.execute(f"SELECT {_SELECT_COLS} FROM complaints WHERE id = %s", (complaint_id,)).fetchone()
            docs = _fetch_docs(conn, complaint_id, include_confidential=is_staff)
            act = _fetch_activity(conn, complaint_id, include_internal=is_staff)

    if is_staff:
        return _serialize_private(row, docs=docs, activity=act, include_internal=True)
    return _serialize_public(row, docs=docs, activity=act)


@router.get("/documents/{doc_id}/download")
def download_complaint_document(doc_id: int, request: Request):
    user = current_user(request)
    with pool.connection() as conn:
        row = conn.execute(
            """
            SELECT d.object_key, d.filename, d.content_type, d.is_confidential, c.complainant_user_id
            FROM complaint_documents d
            JOIN complaints c ON c.id = d.complaint_id
            WHERE d.id = %s
            """,
            (doc_id,),
        ).fetchone()
        if not row:
            raise HTTPException(status_code=404, detail="Document not found")

    object_key, filename, ctype, is_conf, owner_uid = row
    if is_conf:
        is_staff = bool(user and has_permission(user, "complaints.manage"))
        is_owner = bool(user and owner_uid and user["id"] == owner_uid)
        if not (is_staff or is_owner):
            raise HTTPException(status_code=403, detail="Confidential document")

    obj = _minio().get_object(_bucket(), object_key)
    data = obj.read()
    obj.close()
    obj.release_conn()
    return StreamingResponse(
        io.BytesIO(data),
        media_type=ctype or "application/octet-stream",
        headers={"Content-Disposition": f'inline; filename="{filename}"'},
    )


@router.delete("/{complaint_id}")
def delete_complaint(complaint_id: int, user: dict = Depends(require_permission("complaints.manage"))):
    with pool.connection() as conn:
        with conn.transaction():
            keys = [
                r[0]
                for r in conn.execute(
                    "SELECT object_key FROM complaint_documents WHERE complaint_id = %s",
                    (complaint_id,),
                ).fetchall()
            ]
            row = conn.execute("DELETE FROM complaints WHERE id = %s RETURNING id", (complaint_id,)).fetchone()
            if not row:
                raise HTTPException(status_code=404, detail="Complaint not found")
    mc = _minio()
    bkt = _bucket()
    for k in keys:
        try:
            mc.remove_object(bkt, k)
        except Exception:
            pass
    return {"deleted": True, "id": complaint_id}
