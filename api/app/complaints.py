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
import re
import secrets
from datetime import date, datetime, timedelta

from fastapi import APIRouter, Depends, File, Form, HTTPException, Query, Request, UploadFile
from fastapi.responses import Response
from pydantic import BaseModel

from .agendas import _bucket, _minio
from .audit import record_audit
from .auth import current_user, has_permission, require_permission
from .db import pool
from .tenancy import tenant_object_key
from .integrations import send_notification_email

router = APIRouter(prefix="/api/complaints", tags=["complaints"])

MAX_COMPLAINT_DOC_BYTES = 25 * 1024 * 1024
_SAFE_FILENAME_RE = re.compile(r"[^A-Za-z0-9._-]+")
_SAFE_INLINE_TYPES = {"application/pdf", "image/png", "image/jpeg", "image/webp", "image/gif", "text/plain"}

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
CREATE TABLE IF NOT EXISTS complaint_messages (
    id              BIGSERIAL PRIMARY KEY,
    complaint_id    BIGINT NOT NULL REFERENCES complaints(id) ON DELETE CASCADE,
    sender_username TEXT NOT NULL DEFAULT '',
    sender_role     TEXT NOT NULL DEFAULT '',
    is_internal     BOOLEAN NOT NULL DEFAULT FALSE,
    body            TEXT NOT NULL,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS complaint_messages_cid_idx ON complaint_messages(complaint_id, id);
CREATE TABLE IF NOT EXISTS complaint_settings (
    id                  INTEGER PRIMARY KEY CHECK (id = 1),
    code_citation       TEXT NOT NULL DEFAULT '',
    privacy_statute     TEXT NOT NULL DEFAULT '',
    max_compliance_days INTEGER NOT NULL DEFAULT 60,
    ordinance_presets   JSONB NOT NULL DEFAULT '["Zoning / Land Use","Property Maintenance / Nuisance","Noise / Animal Control","Sign / Right-of-Way","Other / Unknown"]'::jsonb,
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);
"""

_DEFAULT_ORDINANCE_PRESETS = [
    "Zoning / Land Use",
    "Property Maintenance / Nuisance",
    "Noise / Animal Control",
    "Sign / Right-of-Way",
    "Other / Unknown",
]


def _load_complaint_settings(conn) -> dict:
    row = conn.execute(
        "SELECT code_citation, privacy_statute, max_compliance_days, ordinance_presets "
        "FROM complaint_settings WHERE id = 1"
    ).fetchone()
    if not row:
        return {
            "code_citation": "",
            "privacy_statute": "",
            "max_compliance_days": 60,
            "ordinance_presets": list(_DEFAULT_ORDINANCE_PRESETS),
        }
    presets = [str(p).strip() for p in (row[3] or []) if str(p).strip()]
    return {
        "code_citation": row[0] or "",
        "privacy_statute": row[1] or "",
        "max_compliance_days": int(row[2]) if row[2] is not None else 60,
        "ordinance_presets": presets or list(_DEFAULT_ORDINANCE_PRESETS),
    }


def bootstrap() -> None:
    with pool.connection() as conn:
        with conn.transaction():
            conn.execute("SELECT pg_advisory_xact_lock(424248)")
            conn.execute(SCHEMA)


def _iso(v) -> str:
    return v.isoformat() if v else ""


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


def _fetch_messages(conn, complaint_id: int, include_internal: bool, include_sender: bool = True) -> list[dict]:
    sql = """
        SELECT id, complaint_id, sender_username, sender_role, is_internal, body, created_at
        FROM complaint_messages
        WHERE complaint_id = %s
    """
    if not include_internal:
        sql += " AND is_internal = FALSE"
    sql += " ORDER BY id ASC"
    rows = conn.execute(sql, (complaint_id,)).fetchall()
    return [
        {
            "id": r[0],
            "complaint_id": r[1],
            "sender_username": r[2] if include_sender else ("City Staff" if r[3] != "applicant" else "Resident"),
            "sender_role": r[3],
            "is_internal": bool(r[4]),
            "body": r[5],
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


def _serialize_public(
    row,
    docs: list[dict] | None = None,
    activity: list[dict] | None = None,
    messages: list[dict] | None = None,
) -> dict:
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
        "messages": messages if messages is not None else [],
    }


def _serialize_private(
    row,
    docs: list[dict] | None = None,
    activity: list[dict] | None = None,
    messages: list[dict] | None = None,
    include_internal: bool = True,
    include_complainant_private: bool = True,
) -> dict:
    """Representation for staff (with complainant private data gated on complaints.view_private)
    or the complainant viewing their own filing.
    """
    base = _serialize_public(row, docs=docs, activity=activity, messages=messages)
    base.update(
        {
            "complainant_user_id": row[5] if include_complainant_private else None,
            "complainant_username": row[6] if include_complainant_private else "",
            "complainant_name": row[7] if include_complainant_private else "",
            "complainant_email": row[8] if include_complainant_private else "",
            "complainant_phone": row[9] if include_complainant_private else "",
            "complainant_address": row[10] if include_complainant_private else "",
            "assigned_to": row[17],
            "internal_notes": row[20] if include_internal else "",
            "can_view_private": include_complainant_private,
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


class ComplaintMessageIn(BaseModel):
    body: str
    is_internal: bool = False


def _create_complaint_row(
    body: ComplaintCreateIn,
    user: dict | None,
    allow_staff_channel: bool,
    request: Request | None = None,
) -> dict:
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

    staff_on_behalf = (
        allow_staff_channel
        and (
            channel == "oral"
            or (bool(cname) and user is not None and cname.lower() != user["username"].lower())
        )
    )
    if is_anon or staff_on_behalf or not user:
        uid = None
        uname = ""
    else:
        uid = user["id"]
        uname = user["username"]

    year = date.today().year
    temp_cnum = f"CMP-{year}-{secrets.token_hex(6)}"

    with pool.connection() as conn:
        with conn.transaction():
            inserted = conn.execute(
                """
                INSERT INTO complaints (
                    complaint_number, intake_channel, is_anonymous, is_real_property_complaint,
                    complainant_user_id, complainant_username,
                    complainant_name, complainant_email, complainant_phone, complainant_address,
                    subject_property_address, subject_person_name, ordinance_section,
                    conduct_description, date_observed
                )
                VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
                RETURNING id
                """,
                (
                    temp_cnum,
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
            cid = inserted[0]
            cnum = f"CMP-{year}-{cid:04d}"
            row = conn.execute(
                f"UPDATE complaints SET complaint_number = %s WHERE id = %s RETURNING {_SELECT_COLS}",
                (cnum, cid),
            ).fetchone()
            actor = "anonymous" if is_anon else (user["username"] if user else "public")
            conn.execute(
                """
                INSERT INTO complaint_activity_log (complaint_id, action, actor_username, is_internal, note)
                VALUES (%s, 'submitted', %s, FALSE, %s)
                """,
                (
                    cid,
                    actor,
                    f"Complaint {cnum} filed ({'anonymous' if is_anon else channel}). No filing fee.",
                ),
            )
            docs = _fetch_docs(conn, cid, include_confidential=True)
            act = _fetch_activity(conn, cid, include_internal=False)
    send_notification_email(
        "complaints_submitted",
        f"[CivicDesk] New Complaint {cnum}",
        f"Complaint {cnum} ({'anonymous' if is_anon else channel}) was filed"
        + (f" regarding {body.subject_property_address.strip()}" if body.subject_property_address.strip() else "")
        + ".\n\n(Complainant identity is kept confidential in CivicDesk per applicable public-records law.)",
        link_path=f"/app#complaints-manage/{cid}",
        request=request,
    )
    return _serialize_private(row, docs=docs, activity=act, include_internal=False)


class ComplaintSettingsIn(BaseModel):
    code_citation: str = ""
    privacy_statute: str = ""
    max_compliance_days: int = 60
    ordinance_presets: list[str] = list(_DEFAULT_ORDINANCE_PRESETS)


@router.get("/settings")
def get_complaint_settings():
    with pool.connection() as conn:
        return _load_complaint_settings(conn)


@router.put("/settings")
def update_complaint_settings(
    body: ComplaintSettingsIn,
    user: dict = Depends(require_permission("complaints.manage")),
):
    from psycopg.types.json import Jsonb

    max_days = max(0, min(3650, int(body.max_compliance_days)))
    presets = [str(p).strip() for p in (body.ordinance_presets or []) if str(p).strip()]
    if not presets:
        presets = list(_DEFAULT_ORDINANCE_PRESETS)
    with pool.connection() as conn:
        conn.execute(
            "INSERT INTO complaint_settings "
            "(id, code_citation, privacy_statute, max_compliance_days, ordinance_presets, updated_at) "
            "VALUES (1, %s, %s, %s, %s, now()) "
            "ON CONFLICT (id) DO UPDATE SET "
            "code_citation = EXCLUDED.code_citation, "
            "privacy_statute = EXCLUDED.privacy_statute, "
            "max_compliance_days = EXCLUDED.max_compliance_days, "
            "ordinance_presets = EXCLUDED.ordinance_presets, "
            "updated_at = now()",
            (body.code_citation.strip(), body.privacy_statute.strip(), max_days, Jsonb(presets)),
        )
        res = _load_complaint_settings(conn)
    record_audit(user["username"], "complaints.settings.update", "complaint_settings", "1", "Updated complaint settings")
    return res


@router.post("/public")
def file_public_complaint(body: ComplaintCreateIn, request: Request):
    """Public / anonymous complaint filing endpoint (no fee, confidential complainant protection)."""
    user = current_user(request)
    return _create_complaint_row(body, user, allow_staff_channel=False, request=request)


@router.post("")
def file_complaint(
    body: ComplaintCreateIn,
    request: Request,
    user: dict = Depends(require_permission("complaints.submit", "complaints.manage")),
):
    """Authenticated complaint filing (resident/applicant or staff logging an oral complaint)."""
    is_staff = has_permission(user, "complaints.manage")
    return _create_complaint_row(body, user, allow_staff_channel=is_staff, request=request)


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


@router.get("/public-lookup")
def public_complaint_lookup(number: str = Query(..., min_length=3)):
    """Public status lookup by COM-YYYY-XXXX tracking number (MN Stat. 13.44 compliant)."""
    num = number.strip().upper()
    with pool.connection() as conn:
        row = conn.execute(
            f"SELECT {_SELECT_COLS} FROM complaints WHERE UPPER(complaint_number) = %s",
            (num,),
        ).fetchone()
        if not row:
            raise HTTPException(status_code=404, detail=f"Complaint '{num}' not found")
        docs = _fetch_docs(conn, row[0], include_confidential=False)
        act = _fetch_activity(conn, row[0], include_internal=False)
        msgs = _fetch_messages(conn, row[0], include_internal=False, include_sender=False)
    return _serialize_public(row, docs=docs, activity=act, messages=msgs)


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
            docs = _fetch_docs(conn, r[0], include_confidential=True)
            act = _fetch_activity(conn, r[0], include_internal=False)
            msgs = _fetch_messages(conn, r[0], include_internal=False, include_sender=True)
            items.append(_serialize_private(r, docs=docs, activity=act, messages=msgs, include_internal=False))
    return {"items": items}


@router.get("")
def list_complaints_staff(
    q: str = Query(""),
    status: str = Query(""),
    user: dict = Depends(require_permission("complaints.manage")),
):
    """Staff complaint queue; confidential complainant fields require complaints.view_private."""
    can_view_private = has_permission(user, "complaints.view_private")
    clauses = ["1=1"]
    params: list = []
    if q.strip():
        like = f"%{q.strip()}%"
        if can_view_private:
            clauses.append(
                "(complaint_number ILIKE %s OR subject_property_address ILIKE %s "
                "OR subject_person_name ILIKE %s OR complainant_name ILIKE %s "
                "OR ordinance_section ILIKE %s OR conduct_description ILIKE %s)"
            )
            params.extend([like, like, like, like, like, like])
        else:
            clauses.append(
                "(complaint_number ILIKE %s OR subject_property_address ILIKE %s "
                "OR subject_person_name ILIKE %s "
                "OR ordinance_section ILIKE %s OR conduct_description ILIKE %s)"
            )
            params.extend([like, like, like, like, like])
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
            docs = _fetch_docs(conn, r[0], include_confidential=can_view_private)
            act = _fetch_activity(conn, r[0], include_internal=True)
            msgs = _fetch_messages(conn, r[0], include_internal=True, include_sender=True)
            items.append(
                _serialize_private(
                    r,
                    docs=docs,
                    activity=act,
                    messages=msgs,
                    include_internal=True,
                    include_complainant_private=can_view_private,
                )
            )
        all_rows = conn.execute(
            "SELECT status, nov_compliance_deadline, created_at, resolved_at, updated_at FROM complaints"
        ).fetchall()

    today_str = date.today().isoformat()
    total = len(all_rows)
    open_count = sum(1 for ar in all_rows if ar[0] not in ("resolved", "dismissed"))
    overdue_nov_count = sum(
        1 for ar in all_rows
        if ar[0] == "notice_of_violation" and (ar[1] or "").strip() and ar[1].strip() < today_str
    )
    res_days = []
    for ar in all_rows:
        if ar[0] in ("resolved", "dismissed") and ar[2]:
            end_dt = ar[3] or ar[4]
            if end_dt:
                res_days.append(max(0.0, (end_dt - ar[2]).total_seconds() / 86400.0))
    avg_resolution_days = round(sum(res_days) / len(res_days), 1) if res_days else None
    return {
        "items": items,
        "stats": {
            "total": total,
            "open_count": open_count,
            "overdue_nov_count": overdue_nov_count,
            "avg_resolution_days": avg_resolution_days,
        },
    }


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
            can_view_private = bool(user and has_permission(user, "complaints.view_private"))
            docs = _fetch_docs(conn, complaint_id, include_confidential=can_view_private)
            act = _fetch_activity(conn, complaint_id, include_internal=True)
    return _serialize_private(
        row,
        docs=docs,
        activity=act,
        include_internal=True,
        include_complainant_private=can_view_private,
    )


@router.post("/{complaint_id}/nov")
def issue_notice_of_violation(
    complaint_id: int,
    body: NoticeOfViolationIn,
    request: Request,
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

    with pool.connection() as conn:
        settings = _load_complaint_settings(conn)
        max_days = settings["max_compliance_days"]
        if max_days > 0 and dl > today + timedelta(days=max_days):
            raise HTTPException(
                status_code=400,
                detail=f"Compliance deadline cannot exceed {max_days} days from the Notice date",
            )
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
            can_view_private = bool(user and has_permission(user, "complaints.view_private"))
            docs = _fetch_docs(conn, complaint_id, include_confidential=can_view_private)
            act = _fetch_activity(conn, complaint_id, include_internal=True)
    res = _serialize_private(
        row,
        docs=docs,
        activity=act,
        include_internal=True,
        include_complainant_private=can_view_private,
    )
    send_notification_email(
        "complaints_escalated",
        f"[CivicDesk] Notice of Violation Issued: {res['complaint_number']}",
        f"A Notice of Violation was issued for complaint {res['complaint_number']} by {official}. Compliance deadline: {deadline_str}.",
        link_path=f"/app#complaints-manage/{complaint_id}",
        request=request,
    )
    return res


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
        exists = conn.execute(
            "SELECT id, complainant_user_id, (created_at > now() - interval '10 minutes') "
            "FROM complaints WHERE id = %s",
            (complaint_id,),
        ).fetchone()
        if not exists:
            raise HTTPException(status_code=404, detail="Complaint not found")

    is_staff = bool(user and has_permission(user, "complaints.manage"))
    is_owner = bool(user and exists[1] is not None and user["id"] == exists[1])
    is_recent_public = bool(exists[1] is None and exists[2])
    if not (is_staff or is_owner or is_recent_public):
        raise HTTPException(status_code=403, detail="Not authorized to upload documents to this complaint")

    raw = await file.read(MAX_COMPLAINT_DOC_BYTES + 1)
    if len(raw) > MAX_COMPLAINT_DOC_BYTES:
        raise HTTPException(status_code=413, detail="File exceeds 25 MB limit")
    if not raw:
        raise HTTPException(status_code=400, detail="Uploaded file is empty")

    sha = hashlib.sha256(raw).hexdigest()
    safe_name = _SAFE_FILENAME_RE.sub("_", os.path.basename(file.filename or "attachment")).strip("._") or "attachment"
    object_key = tenant_object_key(f"complaints/{complaint_id}/{secrets.token_hex(8)}_{safe_name}")
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
            can_view_private = bool(user and has_permission(user, "complaints.view_private"))
            docs = _fetch_docs(conn, complaint_id, include_confidential=(can_view_private or is_owner))
            act = _fetch_activity(conn, complaint_id, include_internal=is_staff)

    if is_staff or is_owner:
        return _serialize_private(
            row,
            docs=docs,
            activity=act,
            include_internal=is_staff,
            include_complainant_private=(can_view_private or is_owner),
        )
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
        can_view_private = bool(user and has_permission(user, "complaints.view_private"))
        is_owner = bool(user and owner_uid and user["id"] == owner_uid)
        if not (can_view_private or is_owner):
            raise HTTPException(status_code=403, detail="Confidential document requires complaints.view_private")

    obj = _minio().get_object(_bucket(), object_key)
    try:
        data = obj.read()
    finally:
        obj.close()
        obj.release_conn()
    safe_fn = _SAFE_FILENAME_RE.sub("_", filename or "attachment").strip("._") or "attachment"
    raw_ctype = (ctype or "application/octet-stream").split(";")[0].strip().lower()
    safe_inline = raw_ctype in _SAFE_INLINE_TYPES
    disp = "inline" if safe_inline else "attachment"
    return Response(
        content=data,
        media_type=raw_ctype if safe_inline else "application/octet-stream",
        headers={
            "Content-Disposition": f'{disp}; filename="{safe_fn}"',
            "X-Content-Type-Options": "nosniff",
        },
    )


@router.post("/{complaint_id}/messages", status_code=201)
def post_complaint_message(
    complaint_id: int,
    body: ComplaintMessageIn,
    request: Request,
    user: dict = Depends(require_permission("complaints.submit", "complaints.manage")),
):
    """Post a two-way message on a complaint (or internal staff note)."""
    text = body.body.strip()
    if not text:
        raise HTTPException(status_code=400, detail="Message text is required")
    is_mgr = has_permission(user, "complaints.manage")
    internal = bool(body.is_internal and is_mgr)
    can_view_private = has_permission(user, "complaints.view_private")

    with pool.connection() as conn:
        row = conn.execute(
            f"SELECT {_SELECT_COLS} FROM complaints WHERE id = %s",
            (complaint_id,),
        ).fetchone()
        if not row:
            raise HTTPException(status_code=404, detail="Complaint not found")
        if not is_mgr and row[5] != user["id"]:
            raise HTTPException(status_code=403, detail="Access denied")

        recipient_email = (row[8] or "").strip()
        if not recipient_email and row[5]:
            u_row = conn.execute("SELECT email FROM users WHERE id = %s", (row[5],)).fetchone()
            if u_row and u_row[0]:
                recipient_email = u_row[0].strip()

        conn.execute(
            "INSERT INTO complaint_messages (complaint_id, sender_username, sender_role, is_internal, body) "
            "VALUES (%s, %s, %s, %s, %s)",
            (complaint_id, user["username"], user["role"], internal, text),
        )
        conn.execute(
            "INSERT INTO complaint_activity_log (complaint_id, action, actor_username, is_internal, note) "
            "VALUES (%s, %s, %s, %s, %s)",
            (
                complaint_id,
                "internal_note" if internal else "message",
                user["username"],
                internal,
                text[:120],
            ),
        )
        docs = _fetch_docs(conn, complaint_id, include_confidential=(can_view_private or row[5] == user["id"]))
        act = _fetch_activity(conn, complaint_id, include_internal=is_mgr)
        msgs = _fetch_messages(conn, complaint_id, include_internal=is_mgr, include_sender=True)

    if is_mgr and not internal and recipient_email and "@" in recipient_email and user["id"] != row[5]:
        from .integrations import send_direct_email

        send_direct_email(
            [recipient_email],
            f"[CivicDesk] Update on Complaint {row[1]}",
            f"City staff posted an update regarding complaint {row[1]}:\n\n{text}",
            link_path="/app#my-complaints" if row[5] else "/#complaints",
            request=request,
        )
    elif not is_mgr:
        send_notification_email(
            "complaints_submitted",
            f"[CivicDesk] Resident Reply on Complaint {row[1]}",
            f"The complainant posted a reply on complaint {row[1]}:\n\n{text}",
            link_path=f"/app#complaints-manage/{complaint_id}",
            request=request,
        )

    return _serialize_private(
        row,
        docs=docs,
        activity=act,
        messages=msgs,
        include_internal=is_mgr,
        include_complainant_private=(can_view_private or row[5] == user["id"]),
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
            row = conn.execute("DELETE FROM complaints WHERE id = %s RETURNING id, complaint_number", (complaint_id,)).fetchone()
            if not row:
                raise HTTPException(status_code=404, detail="Complaint not found")
    mc = _minio()
    bkt = _bucket()
    for k in keys:
        try:
            mc.remove_object(bkt, k)
        except Exception:
            pass
    record_audit(user["username"], "complaint.deleted", "complaints", row[1], f"Deleted complaint {row[1]}")
    return {"deleted": True, "id": complaint_id}
