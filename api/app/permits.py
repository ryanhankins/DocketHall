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

"""City Permitting module: public catalog, applications, documents, review, and Permit PDFs."""
from datetime import date, datetime, timezone
import csv
import hashlib
import io
import os
import re
import uuid
from xml.sax.saxutils import escape as _xml_escape

from fastapi import APIRouter, Depends, File, Form, HTTPException, Request, UploadFile
from fastapi.responses import Response
from pydantic import BaseModel
from reportlab.lib import colors
from reportlab.lib.pagesizes import letter
from reportlab.lib.styles import getSampleStyleSheet
from reportlab.platypus import Paragraph, SimpleDocTemplate, Spacer, Table, TableStyle

from .agendas import _bucket, _minio, _remove_minio_objects
from .auth import has_permission, require_permission
from .db import pool
from .integrations import send_direct_email, send_notification_email

MAX_PERMIT_DOC_BYTES = int(os.environ.get("MAX_PERMIT_DOC_BYTES", str(50 * 1024 * 1024)))
_SAFE_FILENAME_RE = re.compile(r"[^A-Za-z0-9._-]+")
PERMIT_STATUSES = ("submitted", "under_review", "needs_info", "approved", "issued", "denied", "closed")
PAYMENT_STATUSES = ("unpaid", "paid", "waived")
WORKFLOW_STATUSES = ("pending", "in_progress", "approved", "revisions_required", "na")
INSPECTION_RESULTS = ("scheduled", "passed", "failed", "partial", "cancelled")

SCHEMA = """
CREATE TABLE IF NOT EXISTS permit_portal_settings (
    id                      INTEGER PRIMARY KEY CHECK (id = 1),
    general_instructions    TEXT NOT NULL DEFAULT '',
    required_documents_note TEXT NOT NULL DEFAULT '',
    fee_schedule_url        TEXT NOT NULL DEFAULT '',
    fee_schedule_label      TEXT NOT NULL DEFAULT '',
    payment_instructions    TEXT NOT NULL DEFAULT '',
    payment_url             TEXT NOT NULL DEFAULT '',
    updated_at              TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS permit_types (
    id          BIGSERIAL PRIMARY KEY,
    name        TEXT NOT NULL UNIQUE,
    description TEXT NOT NULL DEFAULT '',
    sort_order  INTEGER NOT NULL DEFAULT 0,
    is_active   BOOLEAN NOT NULL DEFAULT TRUE
);
CREATE TABLE IF NOT EXISTS permit_uses (
    id              BIGSERIAL PRIMARY KEY,
    permit_type_id  BIGINT NOT NULL REFERENCES permit_types(id) ON DELETE CASCADE,
    name            TEXT NOT NULL,
    description     TEXT NOT NULL DEFAULT '',
    fee_amount      TEXT NOT NULL DEFAULT '',
    requires_plans  BOOLEAN NOT NULL DEFAULT FALSE,
    requires_coi    BOOLEAN NOT NULL DEFAULT TRUE,
    requires_survey BOOLEAN NOT NULL DEFAULT FALSE,
    sort_order      INTEGER NOT NULL DEFAULT 0,
    is_active       BOOLEAN NOT NULL DEFAULT TRUE,
    UNIQUE (permit_type_id, name)
);
CREATE INDEX IF NOT EXISTS permit_uses_type_idx ON permit_uses(permit_type_id, sort_order, id);
CREATE TABLE IF NOT EXISTS permits (
    id                  BIGSERIAL PRIMARY KEY,
    permit_number       TEXT NOT NULL UNIQUE,
    applicant_user_id   BIGINT REFERENCES users(id) ON DELETE SET NULL,
    applicant_username  TEXT NOT NULL DEFAULT '',
    permit_type_id      BIGINT REFERENCES permit_types(id) ON DELETE SET NULL,
    permit_use_id       BIGINT REFERENCES permit_uses(id) ON DELETE SET NULL,
    permit_type_name    TEXT NOT NULL DEFAULT '',
    permit_use_name     TEXT NOT NULL DEFAULT '',
    applicant_name      TEXT NOT NULL DEFAULT '',
    applicant_email     TEXT NOT NULL DEFAULT '',
    applicant_phone     TEXT NOT NULL DEFAULT '',
    property_address    TEXT NOT NULL DEFAULT '',
    building_name       TEXT NOT NULL DEFAULT '',
    suite_name          TEXT NOT NULL DEFAULT '',
    parcel_id           TEXT NOT NULL DEFAULT '',
    owner_name          TEXT NOT NULL DEFAULT '',
    contractor_name     TEXT NOT NULL DEFAULT '',
    contractor_license  TEXT NOT NULL DEFAULT '',
    project_description TEXT NOT NULL DEFAULT '',
    estimated_value     TEXT NOT NULL DEFAULT '',
    accepted_terms      BOOLEAN NOT NULL DEFAULT FALSE,
    status              TEXT NOT NULL DEFAULT 'submitted',
    fee_amount          TEXT NOT NULL DEFAULT '',
    payment_status      TEXT NOT NULL DEFAULT 'unpaid',
    review_notes        TEXT NOT NULL DEFAULT '',
    reviewed_by         TEXT NOT NULL DEFAULT '',
    created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
    issued_at           TIMESTAMPTZ,
    expires_at          DATE
);
ALTER TABLE permits ADD COLUMN IF NOT EXISTS expires_at DATE;
CREATE INDEX IF NOT EXISTS permits_user_idx ON permits(applicant_user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS permits_status_idx ON permits(status, created_at DESC);
CREATE TABLE IF NOT EXISTS permit_documents (
    id            BIGSERIAL PRIMARY KEY,
    permit_id     BIGINT NOT NULL REFERENCES permits(id) ON DELETE CASCADE,
    doc_category  TEXT NOT NULL DEFAULT 'Other',
    title         TEXT NOT NULL DEFAULT '',
    filename      TEXT NOT NULL,
    content_type  TEXT NOT NULL DEFAULT 'application/octet-stream',
    size_bytes    BIGINT NOT NULL DEFAULT 0,
    sha256        TEXT NOT NULL DEFAULT '',
    object_key    TEXT NOT NULL,
    uploaded_by   TEXT NOT NULL DEFAULT '',
    created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS permit_documents_permit_idx ON permit_documents(permit_id, id);
CREATE TABLE IF NOT EXISTS permit_activity_log (
    id              BIGSERIAL PRIMARY KEY,
    permit_id       BIGINT NOT NULL REFERENCES permits(id) ON DELETE CASCADE,
    action          TEXT NOT NULL,
    actor_username  TEXT NOT NULL DEFAULT '',
    note            TEXT NOT NULL DEFAULT '',
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS permit_activity_permit_idx ON permit_activity_log(permit_id, id);
ALTER TABLE permits ADD COLUMN IF NOT EXISTS building_name TEXT NOT NULL DEFAULT '';
ALTER TABLE permits ADD COLUMN IF NOT EXISTS suite_name TEXT NOT NULL DEFAULT '';
ALTER TABLE permits ADD COLUMN IF NOT EXISTS owner_name TEXT NOT NULL DEFAULT '';
ALTER TABLE permits ADD COLUMN IF NOT EXISTS assigned_to TEXT NOT NULL DEFAULT '';
ALTER TABLE permits ADD COLUMN IF NOT EXISTS closed_at TIMESTAMPTZ;
CREATE TABLE IF NOT EXISTS permit_parcels (
    id            BIGSERIAL PRIMARY KEY,
    parcel_id     TEXT NOT NULL UNIQUE,
    address       TEXT NOT NULL DEFAULT '',
    building_name TEXT NOT NULL DEFAULT '',
    suite_name    TEXT NOT NULL DEFAULT '',
    owner_name    TEXT NOT NULL DEFAULT '',
    lot           TEXT NOT NULL DEFAULT '',
    block         TEXT NOT NULL DEFAULT '',
    section       TEXT NOT NULL DEFAULT '',
    notes         TEXT NOT NULL DEFAULT '',
    created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS permit_workflow_steps (
    id           BIGSERIAL PRIMARY KEY,
    permit_id    BIGINT NOT NULL REFERENCES permits(id) ON DELETE CASCADE,
    step_name    TEXT NOT NULL,
    department   TEXT NOT NULL DEFAULT '',
    assigned_to  TEXT NOT NULL DEFAULT '',
    status       TEXT NOT NULL DEFAULT 'pending',
    notes        TEXT NOT NULL DEFAULT '',
    completed_at TIMESTAMPTZ,
    created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS permit_workflow_permit_idx ON permit_workflow_steps(permit_id, id);
CREATE TABLE IF NOT EXISTS permit_inspections (
    id              BIGSERIAL PRIMARY KEY,
    permit_id       BIGINT NOT NULL REFERENCES permits(id) ON DELETE CASCADE,
    inspection_type TEXT NOT NULL,
    scheduled_date  TEXT NOT NULL DEFAULT '',
    inspector       TEXT NOT NULL DEFAULT '',
    result          TEXT NOT NULL DEFAULT 'scheduled',
    notes           TEXT NOT NULL DEFAULT '',
    completed_at    TIMESTAMPTZ,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS permit_inspections_permit_idx ON permit_inspections(permit_id, id);
CREATE TABLE IF NOT EXISTS permit_messages (
    id              BIGSERIAL PRIMARY KEY,
    permit_id       BIGINT NOT NULL REFERENCES permits(id) ON DELETE CASCADE,
    sender_username TEXT NOT NULL DEFAULT '',
    sender_role     TEXT NOT NULL DEFAULT '',
    is_internal     BOOLEAN NOT NULL DEFAULT FALSE,
    body            TEXT NOT NULL,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS permit_messages_permit_idx ON permit_messages(permit_id, id);
"""

_DEFAULT_PORTAL_SETTINGS = {
    "general_instructions": (
        "Each permit requires the applicant to complete all required information fields and upload "
        "copies of plans and other required documentation. Please ensure you have all required "
        "information and documents ready to upload prior to beginning the online application process. "
        "Applications submitted without required documentation may delay review or be returned."
    ),
    "required_documents_note": (
        "1. Certificate of Insurance from your Contractor (include the City as additionally insured; "
        "all contractors must hold a valid state license).\n"
        "2. Design Plans: Provide before and after design plans when appropriate.\n"
        "3. Land surveys or photos may be needed for some permit types."
    ),
    "fee_schedule_url": "https://cityofbirchwood.com/wp-content/uploads/2024/08/2024-Fee-Schedule-UPDATED-WITH-CHANGES-081224-4.pdf",
    "fee_schedule_label": "2024 Fee Schedule (PDF)",
    "payment_instructions": (
        "Payment may be made online via the City website payment portal or at City Hall once "
        "your application is reviewed and fees are assessed."
    ),
    "payment_url": "",
}

_SEED_CATALOG: list[tuple[str, str, list[tuple[str, bool, bool, bool]]]] = [
    ("Conditional Use Permit", "Conditional use review applications.", [
        ("Home Occupation", False, False, False),
        ("Land Disturbance (greater than 400 sq ft or more than 50 cubic yds)", True, True, True),
        ("Land Disturbance (slopes toward a lake, pond, wetland, watercourse)", True, True, True),
        ("Solar Energy System", True, True, True),
        ("Swimming Pool", True, True, True),
        ("Tennis / Pickleball / Sports Courts", True, True, True),
    ]),
    ("Plumbing Permit", "Plumbing installations and alterations.", [
        ("Tub, Dishwasher, Garbage Disposal, Shower, Roof Drain, etc", False, True, False),
    ]),
    ("Sewer and Water Permit", "Municipal sewer and water connections.", [
        ("Sewer and Water Permit", True, True, True),
    ]),
    ("Variance Application", "Zoning variance requests.", [
        ("Variance Application", True, False, True),
    ]),
    ("Zoning and Conditional Use Permit", "General zoning and CUP applications.", [
        ("General", True, False, True),
    ]),
    ("Animal", "Animal keeping licenses.", [
        ("Chicken License", False, False, True),
        ("Dog License", False, False, False),
        ("Pig License", False, False, True),
    ]),
    ("Building Permit", "Residential and commercial building projects.", [
        ("Fence (over 7 feet)", True, True, True),
        ("General", True, True, True),
        ("Home Demolition", True, True, True),
        ("Interior Remodel", True, True, False),
        ("New Home", True, True, True),
        ("Reroof", False, True, False),
        ("Residential Addition", True, True, True),
        ("Residential Deck", True, True, True),
        ("Residential Garage", True, True, True),
        ("Residential Porch", True, True, True),
        ("Residential Shed", True, True, True),
        ("Window Replacement", False, True, False),
    ]),
    ("Zoning Permit", "Zoning compliance permits.", [
        ("Beach Sand Replacement", False, True, True),
        ("Decks / Platforms (less than 30 inches above grade or attached to structure with frost ftg)", True, True, True),
        ("Driveway / Sidewalk / Patio (area greater than 100 sq ft)", True, True, True),
        ("Fence (over 7 feet)", True, True, True),
        ("Fence (under 7 feet)", False, False, True),
        ("Land Disturbance (greater than 110 sq ft / 50 cubic yds)", True, True, True),
        ("Retaining Walls", True, True, True),
        ("Sheds (144 sq feet)", False, False, True),
        ("Stairs / Lifts to Lake or Body of Water", True, True, True),
    ]),
    ("Right of Way Permit", "Right-of-way and excavation work.", [
        ("Excavation Permit", True, True, True),
    ]),
    ("Recreational", "Public property limited access licenses.", [
        ("Public Property Access Limited License - Construction (including demolition)", True, True, True),
        ("Public Property Access Limited License - Landscaping (including excavating, filling, grading, tree work)", True, True, True),
    ]),
    ("Mechanical Permit", "HVAC, boilers, fireplaces, and mechanical equipment.", [
        ("A/C, Boilers, Fireplace, Hot Water Heater, Furnace, etc", False, True, False),
    ]),
]


def bootstrap() -> None:
    with pool.connection() as conn:
        conn.execute("SELECT pg_advisory_xact_lock(424244)")
        conn.execute(SCHEMA)
        existing_settings = conn.execute(
            "SELECT id FROM permit_portal_settings WHERE id = 1"
        ).fetchone()
        if not existing_settings:
            conn.execute(
                "INSERT INTO permit_portal_settings "
                "(id, general_instructions, required_documents_note, fee_schedule_url, "
                " fee_schedule_label, payment_instructions, payment_url) "
                "VALUES (1, %s, %s, %s, %s, %s, %s)",
                (
                    _DEFAULT_PORTAL_SETTINGS["general_instructions"],
                    _DEFAULT_PORTAL_SETTINGS["required_documents_note"],
                    _DEFAULT_PORTAL_SETTINGS["fee_schedule_url"],
                    _DEFAULT_PORTAL_SETTINGS["fee_schedule_label"],
                    _DEFAULT_PORTAL_SETTINGS["payment_instructions"],
                    _DEFAULT_PORTAL_SETTINGS["payment_url"],
                ),
            )
        for t_idx, (t_name, t_desc, uses) in enumerate(_SEED_CATALOG):
            conn.execute(
                "INSERT INTO permit_types (name, description, sort_order) "
                "VALUES (%s, %s, %s) ON CONFLICT (name) DO NOTHING",
                (t_name, t_desc, t_idx + 1),
            )
            t_id = conn.execute(
                "SELECT id FROM permit_types WHERE name = %s", (t_name,)
            ).fetchone()[0]
            for u_idx, (u_name, req_plans, req_coi, req_survey) in enumerate(uses):
                conn.execute(
                    "INSERT INTO permit_uses "
                    "(permit_type_id, name, requires_plans, requires_coi, requires_survey, sort_order) "
                    "VALUES (%s, %s, %s, %s, %s, %s) "
                    "ON CONFLICT (permit_type_id, name) DO NOTHING",
                    (t_id, u_name, req_plans, req_coi, req_survey, u_idx + 1),
                )
        # Clean up initial pre-expansion sample uses if no permits reference them
        conn.execute(
            "DELETE FROM permit_uses u WHERE u.name = ANY(%s) "
            "AND NOT EXISTS (SELECT 1 FROM permits p WHERE p.permit_use_id = u.id)",
            ([
                "Deck / Porch",
                "Fence",
                "Re-roofing / Siding / Windows",
                "Addition / Remodel",
                "Tub, Dishwasher, Garbage Disposal, Shower, Roof Drain, etc.",
            ],),
        )


router = APIRouter(prefix="/api/permits", tags=["permits"])


# ------------------------------------------------------------------ models
class PortalSettingsIn(BaseModel):
    general_instructions: str = ""
    required_documents_note: str = ""
    fee_schedule_url: str = ""
    fee_schedule_label: str = ""
    payment_instructions: str = ""
    payment_url: str = ""


class PermitTypeIn(BaseModel):
    name: str
    description: str = ""
    sort_order: int = 0
    is_active: bool = True


class PermitTypePatch(BaseModel):
    name: str | None = None
    description: str | None = None
    sort_order: int | None = None
    is_active: bool | None = None


class PermitUseIn(BaseModel):
    permit_type_id: int
    name: str
    description: str = ""
    fee_amount: str = ""
    requires_plans: bool = False
    requires_coi: bool = True
    requires_survey: bool = False
    sort_order: int = 0
    is_active: bool = True


class PermitUsePatch(BaseModel):
    permit_type_id: int | None = None
    name: str | None = None
    description: str | None = None
    fee_amount: str | None = None
    requires_plans: bool | None = None
    requires_coi: bool | None = None
    requires_survey: bool | None = None
    sort_order: int | None = None
    is_active: bool | None = None


class PermitCreateIn(BaseModel):
    permit_type_id: int
    permit_use_id: int
    applicant_name: str
    applicant_email: str = ""
    applicant_phone: str = ""
    property_address: str
    building_name: str = ""
    suite_name: str = ""
    parcel_id: str = ""
    owner_name: str = ""
    contractor_name: str = ""
    contractor_license: str = ""
    project_description: str = ""
    estimated_value: str = ""
    accepted_terms: bool = False


class PermitPatchIn(BaseModel):
    status: str | None = None
    fee_amount: str | None = None
    payment_status: str | None = None
    review_notes: str | None = None
    assigned_to: str | None = None
    expires_at: str | None = None


class ParcelIn(BaseModel):
    parcel_id: str
    address: str = ""
    building_name: str = ""
    suite_name: str = ""
    owner_name: str = ""
    lot: str = ""
    block: str = ""
    section: str = ""
    notes: str = ""


class WorkflowStepIn(BaseModel):
    step_name: str
    department: str = ""
    assigned_to: str = ""
    status: str = "pending"
    notes: str = ""


class WorkflowStepPatch(BaseModel):
    status: str | None = None
    assigned_to: str | None = None
    notes: str | None = None


class InspectionIn(BaseModel):
    inspection_type: str
    scheduled_date: str = ""
    inspector: str = ""
    result: str = "scheduled"
    notes: str = ""


class InspectionPatch(BaseModel):
    scheduled_date: str | None = None
    inspector: str | None = None
    result: str | None = None
    notes: str | None = None


class PermitMessageIn(BaseModel):
    body: str
    is_internal: bool = False


# ------------------------------------------------------------------ helpers
def _load_settings(conn) -> dict:
    row = conn.execute(
        "SELECT general_instructions, required_documents_note, fee_schedule_url, "
        "       fee_schedule_label, payment_instructions, payment_url "
        "FROM permit_portal_settings WHERE id = 1"
    ).fetchone()
    if not row:
        return dict(_DEFAULT_PORTAL_SETTINGS)
    return {
        "general_instructions": row[0],
        "required_documents_note": row[1],
        "fee_schedule_url": row[2],
        "fee_schedule_label": row[3],
        "payment_instructions": row[4],
        "payment_url": row[5],
    }


def _load_catalog(conn, active_only: bool) -> dict:
    where = "WHERE is_active = TRUE" if active_only else ""
    t_rows = conn.execute(
        f"SELECT id, name, description, sort_order, is_active "
        f"FROM permit_types {where} ORDER BY sort_order ASC, name ASC"
    ).fetchall()
    u_rows = conn.execute(
        f"SELECT id, permit_type_id, name, description, fee_amount, "
        f"       requires_plans, requires_coi, requires_survey, sort_order, is_active "
        f"FROM permit_uses {where} ORDER BY sort_order ASC, name ASC"
    ).fetchall()
    types = [
        {"id": r[0], "name": r[1], "description": r[2], "sort_order": r[3], "is_active": bool(r[4])}
        for r in t_rows
    ]
    uses = [
        {
            "id": r[0],
            "permit_type_id": r[1],
            "name": r[2],
            "description": r[3],
            "fee_amount": r[4],
            "requires_plans": bool(r[5]),
            "requires_coi": bool(r[6]),
            "requires_survey": bool(r[7]),
            "sort_order": r[8],
            "is_active": bool(r[9]),
        }
        for r in u_rows
    ]
    return {"settings": _load_settings(conn), "types": types, "uses": uses}


def _hydrate_permits(conn, rows: list[tuple], include_internal: bool = True) -> list[dict]:
    if not rows:
        return []
    ids = [r[0] for r in rows]
    doc_rows = conn.execute(
        "SELECT id, permit_id, doc_category, title, filename, content_type, "
        "       size_bytes, uploaded_by, created_at "
        "FROM permit_documents WHERE permit_id = ANY(%s) ORDER BY id ASC",
        (ids,),
    ).fetchall()
    docs_by_permit: dict[int, list[dict]] = {}
    for d in doc_rows:
        docs_by_permit.setdefault(d[1], []).append({
            "id": d[0],
            "permit_id": d[1],
            "doc_category": d[2],
            "title": d[3],
            "filename": d[4],
            "content_type": d[5],
            "size_bytes": d[6],
            "uploaded_by": d[7],
            "created_at": d[8].isoformat() if d[8] else None,
        })

    wf_rows = conn.execute(
        "SELECT id, permit_id, step_name, department, assigned_to, status, notes, completed_at, created_at "
        "FROM permit_workflow_steps WHERE permit_id = ANY(%s) ORDER BY id ASC",
        (ids,),
    ).fetchall()
    wf_by_permit: dict[int, list[dict]] = {}
    for w in wf_rows:
        wf_by_permit.setdefault(w[1], []).append({
            "id": w[0],
            "permit_id": w[1],
            "step_name": w[2],
            "department": w[3],
            "assigned_to": w[4],
            "status": w[5],
            "notes": w[6],
            "completed_at": w[7].isoformat() if w[7] else None,
            "created_at": w[8].isoformat() if w[8] else None,
        })

    insp_rows = conn.execute(
        "SELECT id, permit_id, inspection_type, scheduled_date, inspector, result, notes, completed_at, created_at "
        "FROM permit_inspections WHERE permit_id = ANY(%s) ORDER BY id ASC",
        (ids,),
    ).fetchall()
    insp_by_permit: dict[int, list[dict]] = {}
    for ins in insp_rows:
        insp_by_permit.setdefault(ins[1], []).append({
            "id": ins[0],
            "permit_id": ins[1],
            "inspection_type": ins[2],
            "scheduled_date": ins[3],
            "inspector": ins[4],
            "result": ins[5],
            "notes": ins[6],
            "completed_at": ins[7].isoformat() if ins[7] else None,
            "created_at": ins[8].isoformat() if ins[8] else None,
        })

    msg_rows = conn.execute(
        "SELECT id, permit_id, sender_username, sender_role, is_internal, body, created_at "
        "FROM permit_messages WHERE permit_id = ANY(%s) ORDER BY id ASC",
        (ids,),
    ).fetchall()
    msgs_by_permit: dict[int, list[dict]] = {}
    for m in msg_rows:
        if m[4] and not include_internal:
            continue
        msgs_by_permit.setdefault(m[1], []).append({
            "id": m[0],
            "permit_id": m[1],
            "sender_username": m[2],
            "sender_role": m[3],
            "is_internal": bool(m[4]),
            "body": m[5],
            "created_at": m[6].isoformat() if m[6] else None,
        })

    log_rows = conn.execute(
        "SELECT id, permit_id, action, actor_username, note, created_at "
        "FROM permit_activity_log WHERE permit_id = ANY(%s) ORDER BY id ASC",
        (ids,),
    ).fetchall()
    logs_by_permit: dict[int, list[dict]] = {}
    for l in log_rows:
        logs_by_permit.setdefault(l[1], []).append({
            "id": l[0],
            "action": l[2],
            "actor": l[3],
            "note": l[4],
            "created_at": l[5].isoformat() if l[5] else None,
        })

    out = []
    for r in rows:
        out.append({
            "id": r[0],
            "permit_number": r[1],
            "applicant_user_id": r[2],
            "applicant_username": r[3],
            "permit_type_id": r[4],
            "permit_use_id": r[5],
            "permit_type_name": r[6],
            "permit_use_name": r[7],
            "applicant_name": r[8],
            "applicant_email": r[9],
            "applicant_phone": r[10],
            "property_address": r[11],
            "building_name": r[12],
            "suite_name": r[13],
            "parcel_id": r[14],
            "owner_name": r[15],
            "contractor_name": r[16],
            "contractor_license": r[17],
            "project_description": r[18],
            "estimated_value": r[19],
            "accepted_terms": bool(r[20]),
            "status": r[21],
            "fee_amount": r[22],
            "payment_status": r[23],
            "review_notes": r[24],
            "reviewed_by": r[25],
            "assigned_to": r[26],
            "created_at": r[27].isoformat() if r[27] else None,
            "updated_at": r[28].isoformat() if r[28] else None,
            "issued_at": r[29].isoformat() if r[29] else None,
            "closed_at": r[30].isoformat() if r[30] else None,
            "expires_at": r[31].isoformat() if r[31] else None,
            "documents": docs_by_permit.get(r[0], []),
            "workflow_steps": wf_by_permit.get(r[0], []),
            "inspections": insp_by_permit.get(r[0], []),
            "messages": msgs_by_permit.get(r[0], []),
            "activity_log": logs_by_permit.get(r[0], []),
        })
    return out


_PERMIT_COLS = (
    "id, permit_number, applicant_user_id, applicant_username, "
    "permit_type_id, permit_use_id, permit_type_name, permit_use_name, "
    "applicant_name, applicant_email, applicant_phone, "
    "property_address, building_name, suite_name, parcel_id, owner_name, "
    "contractor_name, contractor_license, project_description, estimated_value, "
    "accepted_terms, status, fee_amount, payment_status, review_notes, reviewed_by, "
    "assigned_to, created_at, updated_at, issued_at, closed_at, expires_at"
)


def _get_permit_or_404(conn, permit_id: int, include_internal: bool = True) -> dict:
    row = conn.execute(
        f"SELECT {_PERMIT_COLS} FROM permits WHERE id = %s", (permit_id,)
    ).fetchone()
    if not row:
        raise HTTPException(status_code=404, detail="Permit not found")
    return _hydrate_permits(conn, [row], include_internal=include_internal)[0]


def _check_permit_access(permit: dict, user: dict) -> None:
    if has_permission(user, "permits.manage"):
        return
    if permit["applicant_user_id"] == user["id"]:
        return
    raise HTTPException(status_code=403, detail="Access denied")


# ------------------------------------------------------------------ public catalog
@router.get("/public/catalog")
def get_public_catalog():
    with pool.connection() as conn:
        return _load_catalog(conn, active_only=True)


# ------------------------------------------------------------------ applicant endpoints
@router.get("/mine")
def list_my_permits(user: dict = Depends(require_permission("permits.submit", "permits.manage"))):
    with pool.connection() as conn:
        rows = conn.execute(
            f"SELECT {_PERMIT_COLS} FROM permits "
            "WHERE applicant_user_id = %s ORDER BY created_at DESC, id DESC",
            (user["id"],),
        ).fetchall()
        return _hydrate_permits(conn, rows, include_internal=has_permission(user, "permits.manage"))


# ------------------------------------------------------------------ parcel lookup
@router.get("/parcels")
def list_parcels(
    q: str = "",
    _: dict = Depends(require_permission("permits.submit", "permits.manage")),
):
    like = f"%{q.strip()}%"
    with pool.connection() as conn:
        if q.strip():
            rows = conn.execute(
                "SELECT id, parcel_id, address, building_name, suite_name, owner_name, lot, block, section, notes "
                "FROM permit_parcels "
                "WHERE parcel_id ILIKE %s OR address ILIKE %s OR owner_name ILIKE %s OR building_name ILIKE %s "
                "ORDER BY parcel_id ASC LIMIT 100",
                (like, like, like, like),
            ).fetchall()
        else:
            rows = conn.execute(
                "SELECT id, parcel_id, address, building_name, suite_name, owner_name, lot, block, section, notes "
                "FROM permit_parcels ORDER BY parcel_id ASC LIMIT 100"
            ).fetchall()
    return [
        {
            "id": r[0], "parcel_id": r[1], "address": r[2], "building_name": r[3],
            "suite_name": r[4], "owner_name": r[5], "lot": r[6], "block": r[7],
            "section": r[8], "notes": r[9],
        }
        for r in rows
    ]


@router.post("/parcels", status_code=201)
def create_or_update_parcel(body: ParcelIn, _: dict = Depends(require_permission("permits.manage"))):
    pid = body.parcel_id.strip()
    if not pid:
        raise HTTPException(status_code=400, detail="Parcel ID is required")
    with pool.connection() as conn:
        row = conn.execute(
            "INSERT INTO permit_parcels (parcel_id, address, building_name, suite_name, owner_name, lot, block, section, notes) "
            "VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s) "
            "ON CONFLICT (parcel_id) DO UPDATE SET "
            "address = EXCLUDED.address, building_name = EXCLUDED.building_name, "
            "suite_name = EXCLUDED.suite_name, owner_name = EXCLUDED.owner_name, "
            "lot = EXCLUDED.lot, block = EXCLUDED.block, section = EXCLUDED.section, notes = EXCLUDED.notes "
            "RETURNING id, parcel_id, address, building_name, suite_name, owner_name, lot, block, section, notes",
            (pid, body.address.strip(), body.building_name.strip(), body.suite_name.strip(),
             body.owner_name.strip(), body.lot.strip(), body.block.strip(), body.section.strip(), body.notes.strip()),
        ).fetchone()
    return {
        "id": row[0], "parcel_id": row[1], "address": row[2], "building_name": row[3],
        "suite_name": row[4], "owner_name": row[5], "lot": row[6], "block": row[7],
        "section": row[8], "notes": row[9],
    }


@router.delete("/parcels/{parcel_pk}")
def delete_parcel(parcel_pk: int, _: dict = Depends(require_permission("permits.manage"))):
    with pool.connection() as conn:
        row = conn.execute("DELETE FROM permit_parcels WHERE id = %s RETURNING id", (parcel_pk,)).fetchone()
        if not row:
            raise HTTPException(status_code=404, detail="Parcel not found")
    return {"deleted": True, "id": parcel_pk}


@router.post("", status_code=201)
def create_permit(
    body: PermitCreateIn,
    request: Request,
    user: dict = Depends(require_permission("permits.submit", "permits.manage")),
):
    if not body.accepted_terms:
        raise HTTPException(status_code=400, detail="You must accept the application terms")
    if not body.applicant_name.strip() or not body.property_address.strip():
        raise HTTPException(status_code=400, detail="Applicant name and property address are required")

    with pool.connection() as conn:
        t_row = conn.execute(
            "SELECT id, name FROM permit_types WHERE id = %s AND is_active = TRUE",
            (body.permit_type_id,),
        ).fetchone()
        if not t_row:
            raise HTTPException(status_code=400, detail="Selected permit type not found")
        u_row = conn.execute(
            "SELECT id, name, fee_amount FROM permit_uses "
            "WHERE id = %s AND permit_type_id = %s AND is_active = TRUE",
            (body.permit_use_id, body.permit_type_id),
        ).fetchone()
        if not u_row:
            raise HTTPException(status_code=400, detail="Selected permit use not found")

        year = datetime.now(timezone.utc).year
        temp_num = f"PRM-{year}-{uuid.uuid4().hex[:8].upper()}"
        row = conn.execute(
            "INSERT INTO permits "
            "(permit_number, applicant_user_id, applicant_username, "
            " permit_type_id, permit_use_id, permit_type_name, permit_use_name, "
            " applicant_name, applicant_email, applicant_phone, "
            " property_address, building_name, suite_name, parcel_id, owner_name, "
            " contractor_name, contractor_license, project_description, estimated_value, "
            " accepted_terms, status, fee_amount) "
            "VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, TRUE, 'submitted', %s) "
            "RETURNING id",
            (
                temp_num,
                user["id"],
                user["username"],
                t_row[0],
                u_row[0],
                t_row[1],
                u_row[1],
                body.applicant_name.strip(),
                body.applicant_email.strip(),
                body.applicant_phone.strip(),
                body.property_address.strip(),
                body.building_name.strip(),
                body.suite_name.strip(),
                body.parcel_id.strip(),
                body.owner_name.strip(),
                body.contractor_name.strip(),
                body.contractor_license.strip(),
                body.project_description.strip(),
                body.estimated_value.strip(),
                u_row[2] or "",
            ),
        ).fetchone()
        permit_id = row[0]
        final_num = f"PRM-{year}-{permit_id:04d}"
        conn.execute(
            "UPDATE permits SET permit_number = %s WHERE id = %s",
            (final_num, permit_id),
        )
        conn.execute(
            "INSERT INTO permit_activity_log (permit_id, action, actor_username, note) "
            "VALUES (%s, 'Submitted', %s, %s)",
            (permit_id, user["username"], f"{t_row[1]} — {u_row[1]}"),
        )
        result = _get_permit_or_404(conn, permit_id, include_internal=has_permission(user, "permits.manage"))
    send_notification_email(
        "permits_submitted",
        f"[CivicDesk] New Permit Application {final_num}",
        f"Permit {final_num} ({t_row[1]} — {u_row[1]}) was submitted by {user['username']} for {body.property_address.strip()}.",
        link_path=f"/app#permits-review/{permit_id}",
        request=request,
    )
    return result


def _resolve_applicant_email(conn, permit: dict) -> str:
    em = (permit.get("applicant_email") or "").strip()
    if em and "@" in em:
        return em
    uid = permit.get("applicant_user_id")
    if uid:
        row = conn.execute("SELECT email FROM users WHERE id = %s", (uid,)).fetchone()
        if row and row[0] and "@" in row[0]:
            return row[0].strip()
    return ""


@router.get("/export.csv")
def export_permits_csv(
    status: str | None = None,
    q: str = "",
    _: dict = Depends(require_permission("permits.manage")),
):
    with pool.connection() as conn:
        rows = conn.execute(
            f"SELECT {_PERMIT_COLS} FROM permits ORDER BY created_at DESC, id DESC"
        ).fetchall()
        permits = _hydrate_permits(conn, rows, include_internal=False)

    ql = q.strip().lower()
    buf = io.StringIO()
    w = csv.writer(buf)
    w.writerow([
        "Permit Number", "Status", "Permit Type", "Permit Use",
        "Applicant Name", "Applicant Email", "Property Address", "Parcel ID",
        "Fee Amount", "Payment Status", "Assigned To", "Issued At", "Expires At", "Created At",
    ])
    for p in permits:
        if status and status != "all" and p["status"] != status:
            continue
        if ql:
            hay = f"{p['permit_number']} {p['permit_type_name']} {p['permit_use_name']} {p['applicant_name']} {p['property_address']} {p['parcel_id']}".lower()
            if ql not in hay:
                continue
        w.writerow([
            p["permit_number"], p["status"], p["permit_type_name"], p["permit_use_name"],
            p["applicant_name"], p["applicant_email"], p["property_address"], p["parcel_id"],
            p["fee_amount"], p["payment_status"], p["assigned_to"],
            p["issued_at"] or "", p["expires_at"] or "", p["created_at"] or "",
        ])
    return Response(
        content=buf.getvalue(),
        media_type="text/csv; charset=utf-8",
        headers={"Content-Disposition": 'attachment; filename="permits_export.csv"'},
    )


@router.get("/{permit_id}")
def get_permit(
    permit_id: int,
    user: dict = Depends(require_permission("permits.submit", "permits.manage")),
):
    with pool.connection() as conn:
        permit = _get_permit_or_404(conn, permit_id, include_internal=has_permission(user, "permits.manage"))
    _check_permit_access(permit, user)
    return permit


@router.post("/{permit_id}/documents", status_code=201)
async def upload_permit_document(
    permit_id: int,
    file: UploadFile = File(...),
    doc_category: str = Form("Other"),
    title: str = Form(""),
    user: dict = Depends(require_permission("permits.submit", "permits.manage")),
):
    with pool.connection() as conn:
        permit = _get_permit_or_404(conn, permit_id)
    _check_permit_access(permit, user)

    raw = await file.read(MAX_PERMIT_DOC_BYTES + 1)
    if len(raw) > MAX_PERMIT_DOC_BYTES:
        raise HTTPException(status_code=413, detail="Uploaded file exceeds 50 MB limit")
    if not raw:
        raise HTTPException(status_code=400, detail="Uploaded file is empty")

    orig_name = (file.filename or "document").strip() or "document"
    safe_name = _SAFE_FILENAME_RE.sub("_", orig_name).strip("._") or "document"
    obj_key = f"permits/{permit_id}/{uuid.uuid4().hex[:12]}_{safe_name}"
    sha = hashlib.sha256(raw).hexdigest()
    ctype = file.content_type or "application/octet-stream"
    clean_title = title.strip() or orig_name
    clean_cat = doc_category.strip() or "Other"

    _minio().put_object(
        _bucket(),
        obj_key,
        io.BytesIO(raw),
        length=len(raw),
        content_type=ctype,
    )

    with pool.connection() as conn:
        conn.execute(
            "INSERT INTO permit_documents "
            "(permit_id, doc_category, title, filename, content_type, size_bytes, sha256, object_key, uploaded_by) "
            "VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s)",
            (permit_id, clean_cat, clean_title, orig_name, ctype, len(raw), sha, obj_key, user["username"]),
        )
        conn.execute("UPDATE permits SET updated_at = now() WHERE id = %s", (permit_id,))
        conn.execute(
            "INSERT INTO permit_activity_log (permit_id, action, actor_username, note) "
            "VALUES (%s, 'Document Uploaded', %s, %s)",
            (permit_id, user["username"], f"{clean_cat}: {orig_name}"),
        )
        return _get_permit_or_404(conn, permit_id, include_internal=has_permission(user, "permits.manage"))


@router.get("/{permit_id}/documents/{doc_id}/download")
def download_permit_document(
    permit_id: int,
    doc_id: int,
    user: dict = Depends(require_permission("permits.submit", "permits.manage")),
):
    with pool.connection() as conn:
        permit = _get_permit_or_404(conn, permit_id)
        _check_permit_access(permit, user)
        row = conn.execute(
            "SELECT filename, content_type, object_key FROM permit_documents "
            "WHERE id = %s AND permit_id = %s",
            (doc_id, permit_id),
        ).fetchone()
        if not row:
            raise HTTPException(status_code=404, detail="Document not found")

    obj = _minio().get_object(_bucket(), row[2])
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


@router.delete("/{permit_id}/documents/{doc_id}")
def delete_permit_document(
    permit_id: int,
    doc_id: int,
    user: dict = Depends(require_permission("permits.submit", "permits.manage")),
):
    with pool.connection() as conn:
        permit = _get_permit_or_404(conn, permit_id)
        _check_permit_access(permit, user)
        if not has_permission(user, "permits.manage") and permit["status"] not in ("submitted", "needs_info"):
            raise HTTPException(status_code=400, detail="Documents cannot be removed after review approval")
        row = conn.execute(
            "DELETE FROM permit_documents WHERE id = %s AND permit_id = %s RETURNING object_key",
            (doc_id, permit_id),
        ).fetchone()
        if not row:
            raise HTTPException(status_code=404, detail="Document not found")
        _remove_minio_objects([row[0]])
        return _get_permit_or_404(conn, permit_id, include_internal=has_permission(user, "permits.manage"))


@router.get("/{permit_id}/pdf")
def get_permit_pdf(
    permit_id: int,
    user: dict = Depends(require_permission("permits.submit", "permits.manage")),
):
    with pool.connection() as conn:
        permit = _get_permit_or_404(conn, permit_id)
    _check_permit_access(permit, user)

    buf = io.BytesIO()
    doc = SimpleDocTemplate(buf, pagesize=letter, leftMargin=54, rightMargin=54, topMargin=54, bottomMargin=54)
    styles = getSampleStyleSheet()
    story = [
        Paragraph(f"<b>PERMIT {_xml_escape(str(permit['permit_number'] or ''))}</b>", styles["Title"]),
        Paragraph(f"Status: <b>{_xml_escape(str(permit['status'] or '').replace('_', ' ').title())}</b>", styles["Normal"]),
        Spacer(1, 12),
    ]
    rows = [
        ["Permit Type", permit["permit_type_name"]],
        ["Permit Use", permit["permit_use_name"]],
        ["Applicant", permit["applicant_name"]],
        ["Email / Phone", f"{permit['applicant_email'] or '—'} / {permit['applicant_phone'] or '—'}"],
        ["Property Address", permit["property_address"]],
        ["Building / Suite", f"{permit['building_name'] or '—'} / {permit['suite_name'] or '—'}"],
        ["Parcel ID / Owner", f"{permit['parcel_id'] or '—'} / {permit['owner_name'] or '—'}"],
        ["Contractor", f"{permit['contractor_name'] or '—'} (Lic: {permit['contractor_license'] or '—'})"],
        ["Estimated Value", permit["estimated_value"] or "—"],
        ["Fee / Payment", f"{permit['fee_amount'] or 'TBD'} ({permit['payment_status']})"],
        ["Submitted", permit["created_at"] or "—"],
        ["Issued / Closed", f"{permit['issued_at'] or '—'} / {permit['closed_at'] or '—'}"],
    ]
    tbl = Table(rows, colWidths=[140, 360])
    tbl.setStyle(TableStyle([
        ("GRID", (0, 0), (-1, -1), 0.5, colors.grey),
        ("BACKGROUND", (0, 0), (0, -1), colors.HexColor("#f1f5f9")),
        ("FONTNAME", (0, 0), (0, -1), "Helvetica-Bold"),
        ("VALIGN", (0, 0), (-1, -1), "TOP"),
        ("PADDING", (0, 0), (-1, -1), 6),
    ]))
    story.append(tbl)
    if permit["project_description"]:
        story.extend([Spacer(1, 12), Paragraph("<b>Project Description</b>", styles["Heading3"]), Paragraph(_xml_escape(str(permit["project_description"])), styles["Normal"])])
    if permit["review_notes"]:
        story.extend([Spacer(1, 12), Paragraph("<b>Staff Review Notes</b>", styles["Heading3"]), Paragraph(_xml_escape(str(permit["review_notes"])), styles["Normal"])])
    if permit.get("workflow_steps"):
        story.extend([Spacer(1, 12), Paragraph("<b>Workflow Reviews</b>", styles["Heading3"])])
        for w in permit["workflow_steps"]:
            notes_part = f" — {_xml_escape(str(w['notes']))}" if w["notes"] else ""
            story.append(Paragraph(
                f"• {_xml_escape(str(w['step_name'] or ''))} ({_xml_escape(str(w['department'] or 'General'))}): {_xml_escape(str(w['status'] or ''))}{notes_part}",
                styles["Normal"],
            ))
    if permit.get("inspections"):
        story.extend([Spacer(1, 12), Paragraph("<b>Inspections</b>", styles["Heading3"])])
        for ins in permit["inspections"]:
            notes_part = f" — {_xml_escape(str(ins['notes']))}" if ins["notes"] else ""
            story.append(Paragraph(
                f"• {_xml_escape(str(ins['inspection_type'] or ''))} ({_xml_escape(str(ins['scheduled_date'] or 'unscheduled'))}): {_xml_escape(str(ins['result'] or ''))}{notes_part}",
                styles["Normal"],
            ))
    doc.build(story)
    return Response(
        content=buf.getvalue(),
        media_type="application/pdf",
        headers={"Content-Disposition": f'inline; filename="{permit["permit_number"]}.pdf"'},
    )


# ------------------------------------------------------------------ staff endpoints
@router.get("")
def list_all_permits(_: dict = Depends(require_permission("permits.manage"))):
    with pool.connection() as conn:
        rows = conn.execute(
            f"SELECT {_PERMIT_COLS} FROM permits ORDER BY created_at DESC, id DESC"
        ).fetchall()
        return _hydrate_permits(conn, rows)


@router.patch("/{permit_id}")
def update_permit(
    permit_id: int,
    body: PermitPatchIn,
    request: Request,
    user: dict = Depends(require_permission("permits.manage")),
):
    if body.status is not None and body.status not in PERMIT_STATUSES:
        raise HTTPException(status_code=400, detail="Invalid permit status")
    if body.payment_status is not None and body.payment_status not in PAYMENT_STATUSES:
        raise HTTPException(status_code=400, detail="Invalid payment status")

    with pool.connection() as conn:
        cur = _get_permit_or_404(conn, permit_id)
        applicant_email = _resolve_applicant_email(conn, cur)
        next_status = body.status if body.status is not None else cur["status"]
        issued_clause = ", issued_at = COALESCE(issued_at, now())" if next_status == "issued" else ""
        closed_clause = ", closed_at = COALESCE(closed_at, now())" if next_status == "closed" else ""
        exp_clause = ""
        exp_params: tuple = ()
        if body.expires_at is not None:
            exp_val = body.expires_at.strip()
            if exp_val == "":
                exp_clause = ", expires_at = NULL"
            else:
                try:
                    date.fromisoformat(exp_val)
                except ValueError:
                    raise HTTPException(status_code=400, detail="Expiration date must be YYYY-MM-DD")
                exp_clause = ", expires_at = %s"
                exp_params = (exp_val,)
        conn.execute(
            f"UPDATE permits SET "
            f"status = COALESCE(%s, status), "
            f"fee_amount = COALESCE(%s, fee_amount), "
            f"payment_status = COALESCE(%s, payment_status), "
            f"review_notes = COALESCE(%s, review_notes), "
            f"assigned_to = COALESCE(%s, assigned_to), "
            f"reviewed_by = %s, "
            f"updated_at = now(){issued_clause}{closed_clause}{exp_clause} "
            f"WHERE id = %s",
            (
                body.status,
                body.fee_amount.strip() if body.fee_amount is not None else None,
                body.payment_status,
                body.review_notes.strip() if body.review_notes is not None else None,
                body.assigned_to.strip() if body.assigned_to is not None else None,
                user["username"],
                *exp_params,
                permit_id,
            ),
        )
        changes = []
        if body.status is not None and body.status != cur["status"]:
            changes.append(f"Status -> {body.status}")
        if body.payment_status is not None and body.payment_status != cur["payment_status"]:
            changes.append(f"Payment -> {body.payment_status}")
        if body.fee_amount is not None and body.fee_amount.strip() != cur["fee_amount"]:
            changes.append(f"Fee -> {body.fee_amount.strip()}")
        if body.assigned_to is not None and body.assigned_to.strip() != cur["assigned_to"]:
            changes.append(f"Assigned -> {body.assigned_to.strip()}")
        if changes or (body.review_notes is not None and body.review_notes.strip() != cur["review_notes"]):
            conn.execute(
                "INSERT INTO permit_activity_log (permit_id, action, actor_username, note) "
                "VALUES (%s, %s, %s, %s)",
                (
                    permit_id,
                    ", ".join(changes) if changes else "Review Updated",
                    user["username"],
                    (body.review_notes or "").strip(),
                ),
            )
        status_changed = body.status is not None and body.status != cur["status"]
        result = _get_permit_or_404(conn, permit_id, include_internal=has_permission(user, "permits.manage"))
    if status_changed:
        send_notification_email(
            "permits_updated",
            f"[CivicDesk] Permit {cur['permit_number']} Status: {body.status}",
            f"Permit {cur['permit_number']} ({cur['property_address']}) status changed from {cur['status']} to {body.status} by {user['username']}.",
            link_path=f"/app#permits-review/{permit_id}",
            request=request,
        )
        if applicant_email:
            send_direct_email(
                [applicant_email],
                f"[CivicDesk] Permit {cur['permit_number']} Status Updated: {body.status.replace('_', ' ').title()}",
                f"Your permit application {cur['permit_number']} ({cur['property_address']}) status was updated to '{body.status.replace('_', ' ')}'.",
                link_path="/app#my-permits",
                request=request,
            )
    return result


# ------------------------------------------------------------------ workflow steps
@router.post("/{permit_id}/workflow", status_code=201)
def add_workflow_step(
    permit_id: int,
    body: WorkflowStepIn,
    user: dict = Depends(require_permission("permits.manage")),
):
    if body.status not in WORKFLOW_STATUSES:
        raise HTTPException(status_code=400, detail="Invalid workflow status")
    if not body.step_name.strip():
        raise HTTPException(status_code=400, detail="Step name is required")
    with pool.connection() as conn:
        _get_permit_or_404(conn, permit_id)
        done_at = "now()" if body.status in ("approved", "na") else "NULL"
        conn.execute(
            f"INSERT INTO permit_workflow_steps (permit_id, step_name, department, assigned_to, status, notes, completed_at) "
            f"VALUES (%s, %s, %s, %s, %s, %s, {done_at})",
            (permit_id, body.step_name.strip(), body.department.strip(), body.assigned_to.strip(), body.status, body.notes.strip()),
        )
        conn.execute(
            "INSERT INTO permit_activity_log (permit_id, action, actor_username, note) "
            "VALUES (%s, 'Workflow Step Added', %s, %s)",
            (permit_id, user["username"], body.step_name.strip()),
        )
        return _get_permit_or_404(conn, permit_id, include_internal=has_permission(user, "permits.manage"))


@router.patch("/{permit_id}/workflow/{step_id}")
def update_workflow_step(
    permit_id: int,
    step_id: int,
    body: WorkflowStepPatch,
    user: dict = Depends(require_permission("permits.manage")),
):
    if body.status is not None and body.status not in WORKFLOW_STATUSES:
        raise HTTPException(status_code=400, detail="Invalid workflow status")
    with pool.connection() as conn:
        comp_clause = ""
        if body.status in ("approved", "na"):
            comp_clause = ", completed_at = COALESCE(completed_at, now())"
        elif body.status in ("pending", "in_progress", "revisions_required"):
            comp_clause = ", completed_at = NULL"
        row = conn.execute(
            f"UPDATE permit_workflow_steps SET "
            f"status = COALESCE(%s, status), "
            f"assigned_to = COALESCE(%s, assigned_to), "
            f"notes = COALESCE(%s, notes){comp_clause} "
            f"WHERE id = %s AND permit_id = %s RETURNING step_name, status",
            (
                body.status,
                body.assigned_to.strip() if body.assigned_to is not None else None,
                body.notes.strip() if body.notes is not None else None,
                step_id,
                permit_id,
            ),
        ).fetchone()
        if not row:
            raise HTTPException(status_code=404, detail="Workflow step not found")
        conn.execute(
            "INSERT INTO permit_activity_log (permit_id, action, actor_username, note) "
            "VALUES (%s, 'Workflow Updated', %s, %s)",
            (permit_id, user["username"], f"{row[0]} -> {row[1]}"),
        )
        return _get_permit_or_404(conn, permit_id, include_internal=has_permission(user, "permits.manage"))


@router.delete("/{permit_id}/workflow/{step_id}")
def delete_workflow_step(
    permit_id: int,
    step_id: int,
    _: dict = Depends(require_permission("permits.manage")),
):
    with pool.connection() as conn:
        conn.execute("DELETE FROM permit_workflow_steps WHERE id = %s AND permit_id = %s", (step_id, permit_id))
        return _get_permit_or_404(conn, permit_id, include_internal=has_permission(user, "permits.manage"))


# ------------------------------------------------------------------ inspections
@router.post("/{permit_id}/inspections", status_code=201)
def add_inspection(
    permit_id: int,
    body: InspectionIn,
    request: Request,
    user: dict = Depends(require_permission("permits.submit", "permits.manage")),
):
    if not body.inspection_type.strip():
        raise HTTPException(status_code=400, detail="Inspection type is required")
    is_mgr = has_permission(user, "permits.manage")
    result = body.result if (is_mgr and body.result in INSPECTION_RESULTS) else "scheduled"
    with pool.connection() as conn:
        permit = _get_permit_or_404(conn, permit_id)
        _check_permit_access(permit, user)
        applicant_email = _resolve_applicant_email(conn, permit)
        comp_val = "now()" if result in ("passed", "failed", "partial") else "NULL"
        conn.execute(
            f"INSERT INTO permit_inspections (permit_id, inspection_type, scheduled_date, inspector, result, notes, completed_at) "
            f"VALUES (%s, %s, %s, %s, %s, %s, {comp_val})",
            (
                permit_id,
                body.inspection_type.strip(),
                body.scheduled_date.strip(),
                body.inspector.strip() if is_mgr else "",
                result,
                body.notes.strip(),
            ),
        )
        conn.execute(
            "INSERT INTO permit_activity_log (permit_id, action, actor_username, note) "
            "VALUES (%s, %s, %s, %s)",
            (permit_id, "Inspection Scheduled" if result == "scheduled" else f"Inspection {result}", user["username"], body.inspection_type.strip()),
        )
        updated = _get_permit_or_404(conn, permit_id, include_internal=is_mgr)
    if is_mgr and applicant_email:
        send_direct_email(
            [applicant_email],
            f"[CivicDesk] Inspection {result.title()} — Permit {permit['permit_number']}",
            f"An inspection ({body.inspection_type.strip()}) for permit {permit['permit_number']} ({permit['property_address']}) is {result}"
            + (f" for {body.scheduled_date.strip()}" if body.scheduled_date.strip() else "")
            + ".",
            link_path="/app#my-permits",
            request=request,
        )
    return updated


@router.patch("/{permit_id}/inspections/{insp_id}")
def update_inspection(
    permit_id: int,
    insp_id: int,
    body: InspectionPatch,
    request: Request,
    user: dict = Depends(require_permission("permits.manage")),
):
    if body.result is not None and body.result not in INSPECTION_RESULTS:
        raise HTTPException(status_code=400, detail="Invalid inspection result")
    with pool.connection() as conn:
        permit = _get_permit_or_404(conn, permit_id)
        applicant_email = _resolve_applicant_email(conn, permit)
        comp_clause = ""
        if body.result in ("passed", "failed", "partial"):
            comp_clause = ", completed_at = COALESCE(completed_at, now())"
        elif body.result in ("scheduled", "cancelled"):
            comp_clause = ", completed_at = NULL"
        row = conn.execute(
            f"UPDATE permit_inspections SET "
            f"scheduled_date = COALESCE(%s, scheduled_date), "
            f"inspector = COALESCE(%s, inspector), "
            f"result = COALESCE(%s, result), "
            f"notes = COALESCE(%s, notes){comp_clause} "
            f"WHERE id = %s AND permit_id = %s RETURNING inspection_type, result",
            (
                body.scheduled_date.strip() if body.scheduled_date is not None else None,
                body.inspector.strip() if body.inspector is not None else None,
                body.result,
                body.notes.strip() if body.notes is not None else None,
                insp_id,
                permit_id,
            ),
        ).fetchone()
        if not row:
            raise HTTPException(status_code=404, detail="Inspection not found")
        conn.execute(
            "INSERT INTO permit_activity_log (permit_id, action, actor_username, note) "
            "VALUES (%s, 'Inspection Updated', %s, %s)",
            (permit_id, user["username"], f"{row[0]} -> {row[1]}"),
        )
        updated = _get_permit_or_404(conn, permit_id, include_internal=has_permission(user, "permits.manage"))
    if applicant_email:
        send_direct_email(
            [applicant_email],
            f"[CivicDesk] Inspection Updated ({row[1].title()}) — Permit {permit['permit_number']}",
            f"Inspection '{row[0]}' for permit {permit['permit_number']} ({permit['property_address']}) is now marked '{row[1]}'.",
            link_path="/app#my-permits",
            request=request,
        )
    return updated


@router.delete("/{permit_id}/inspections/{insp_id}")
def delete_inspection(
    permit_id: int,
    insp_id: int,
    _: dict = Depends(require_permission("permits.manage")),
):
    with pool.connection() as conn:
        conn.execute("DELETE FROM permit_inspections WHERE id = %s AND permit_id = %s", (insp_id, permit_id))
        return _get_permit_or_404(conn, permit_id, include_internal=has_permission(user, "permits.manage"))


# ------------------------------------------------------------------ messages
@router.post("/{permit_id}/messages", status_code=201)
def post_permit_message(
    permit_id: int,
    body: PermitMessageIn,
    request: Request,
    user: dict = Depends(require_permission("permits.submit", "permits.manage")),
):
    text = body.body.strip()
    if not text:
        raise HTTPException(status_code=400, detail="Message text is required")
    is_mgr = has_permission(user, "permits.manage")
    internal = bool(body.is_internal and is_mgr)
    with pool.connection() as conn:
        permit = _get_permit_or_404(conn, permit_id)
        _check_permit_access(permit, user)
        applicant_email = _resolve_applicant_email(conn, permit)
        conn.execute(
            "INSERT INTO permit_messages (permit_id, sender_username, sender_role, is_internal, body) "
            "VALUES (%s, %s, %s, %s, %s)",
            (permit_id, user["username"], user["role"], internal, text),
        )
        conn.execute(
            "INSERT INTO permit_activity_log (permit_id, action, actor_username, note) "
            "VALUES (%s, %s, %s, %s)",
            (permit_id, "Internal Note Added" if internal else "Message Sent", user["username"], text[:120]),
        )
        updated = _get_permit_or_404(conn, permit_id, include_internal=is_mgr)
    if is_mgr and not internal and applicant_email and user["id"] != permit.get("applicant_user_id"):
        send_direct_email(
            [applicant_email],
            f"[CivicDesk] New Message on Permit {permit['permit_number']}",
            f"{user['username']} sent a message regarding permit {permit['permit_number']} ({permit['property_address']}):\n\n{text}",
            link_path="/app#my-permits",
            request=request,
        )
    return updated


@router.delete("/{permit_id}")
def delete_permit(permit_id: int, _: dict = Depends(require_permission("permits.manage"))):
    with pool.connection() as conn:
        keys = [
            r[0]
            for r in conn.execute(
                "SELECT object_key FROM permit_documents WHERE permit_id = %s", (permit_id,)
            ).fetchall()
        ]
        row = conn.execute("DELETE FROM permits WHERE id = %s RETURNING id", (permit_id,)).fetchone()
        if not row:
            raise HTTPException(status_code=404, detail="Permit not found")
    _remove_minio_objects(keys)
    return {"deleted": True, "id": permit_id}


# ------------------------------------------------------------------ catalog & portal settings admin
@router.get("/admin/catalog")
def get_admin_catalog(_: dict = Depends(require_permission("permits.manage"))):
    with pool.connection() as conn:
        return _load_catalog(conn, active_only=False)


@router.put("/admin/settings")
def update_portal_settings(
    body: PortalSettingsIn,
    _: dict = Depends(require_permission("permits.manage")),
):
    with pool.connection() as conn:
        conn.execute(
            "INSERT INTO permit_portal_settings "
            "(id, general_instructions, required_documents_note, fee_schedule_url, "
            " fee_schedule_label, payment_instructions, payment_url, updated_at) "
            "VALUES (1, %s, %s, %s, %s, %s, %s, now()) "
            "ON CONFLICT (id) DO UPDATE SET "
            "general_instructions = EXCLUDED.general_instructions, "
            "required_documents_note = EXCLUDED.required_documents_note, "
            "fee_schedule_url = EXCLUDED.fee_schedule_url, "
            "fee_schedule_label = EXCLUDED.fee_schedule_label, "
            "payment_instructions = EXCLUDED.payment_instructions, "
            "payment_url = EXCLUDED.payment_url, "
            "updated_at = now()",
            (
                body.general_instructions.strip(),
                body.required_documents_note.strip(),
                body.fee_schedule_url.strip(),
                body.fee_schedule_label.strip(),
                body.payment_instructions.strip(),
                body.payment_url.strip(),
            ),
        )
        return _load_settings(conn)


@router.post("/admin/types", status_code=201)
def create_permit_type(body: PermitTypeIn, _: dict = Depends(require_permission("permits.manage"))):
    name = body.name.strip()
    if not name:
        raise HTTPException(status_code=400, detail="Permit type name is required")
    with pool.connection() as conn:
        row = conn.execute(
            "INSERT INTO permit_types (name, description, sort_order, is_active) "
            "VALUES (%s, %s, %s, %s) RETURNING id, name, description, sort_order, is_active",
            (name, body.description.strip(), body.sort_order, body.is_active),
        ).fetchone()
    return {"id": row[0], "name": row[1], "description": row[2], "sort_order": row[3], "is_active": bool(row[4])}


@router.patch("/admin/types/{type_id}")
def update_permit_type(type_id: int, body: PermitTypePatch, _: dict = Depends(require_permission("permits.manage"))):
    with pool.connection() as conn:
        row = conn.execute(
            "UPDATE permit_types SET "
            "name = COALESCE(%s, name), "
            "description = COALESCE(%s, description), "
            "sort_order = COALESCE(%s, sort_order), "
            "is_active = COALESCE(%s, is_active) "
            "WHERE id = %s RETURNING id, name, description, sort_order, is_active",
            (
                body.name.strip() if body.name is not None else None,
                body.description.strip() if body.description is not None else None,
                body.sort_order,
                body.is_active,
                type_id,
            ),
        ).fetchone()
        if not row:
            raise HTTPException(status_code=404, detail="Permit type not found")
    return {"id": row[0], "name": row[1], "description": row[2], "sort_order": row[3], "is_active": bool(row[4])}


@router.delete("/admin/types/{type_id}")
def delete_permit_type(type_id: int, _: dict = Depends(require_permission("permits.manage"))):
    with pool.connection() as conn:
        row = conn.execute("DELETE FROM permit_types WHERE id = %s RETURNING id", (type_id,)).fetchone()
        if not row:
            raise HTTPException(status_code=404, detail="Permit type not found")
    return {"deleted": True, "id": type_id}


@router.post("/admin/uses", status_code=201)
def create_permit_use(body: PermitUseIn, _: dict = Depends(require_permission("permits.manage"))):
    name = body.name.strip()
    if not name:
        raise HTTPException(status_code=400, detail="Permit use name is required")
    with pool.connection() as conn:
        row = conn.execute(
            "INSERT INTO permit_uses "
            "(permit_type_id, name, description, fee_amount, requires_plans, requires_coi, requires_survey, sort_order, is_active) "
            "VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s) "
            "RETURNING id, permit_type_id, name, description, fee_amount, requires_plans, requires_coi, requires_survey, sort_order, is_active",
            (
                body.permit_type_id,
                name,
                body.description.strip(),
                body.fee_amount.strip(),
                body.requires_plans,
                body.requires_coi,
                body.requires_survey,
                body.sort_order,
                body.is_active,
            ),
        ).fetchone()
    return {
        "id": row[0], "permit_type_id": row[1], "name": row[2], "description": row[3],
        "fee_amount": row[4], "requires_plans": bool(row[5]), "requires_coi": bool(row[6]),
        "requires_survey": bool(row[7]), "sort_order": row[8], "is_active": bool(row[9]),
    }


@router.patch("/admin/uses/{use_id}")
def update_permit_use(use_id: int, body: PermitUsePatch, _: dict = Depends(require_permission("permits.manage"))):
    with pool.connection() as conn:
        row = conn.execute(
            "UPDATE permit_uses SET "
            "permit_type_id = COALESCE(%s, permit_type_id), "
            "name = COALESCE(%s, name), "
            "description = COALESCE(%s, description), "
            "fee_amount = COALESCE(%s, fee_amount), "
            "requires_plans = COALESCE(%s, requires_plans), "
            "requires_coi = COALESCE(%s, requires_coi), "
            "requires_survey = COALESCE(%s, requires_survey), "
            "sort_order = COALESCE(%s, sort_order), "
            "is_active = COALESCE(%s, is_active) "
            "WHERE id = %s "
            "RETURNING id, permit_type_id, name, description, fee_amount, requires_plans, requires_coi, requires_survey, sort_order, is_active",
            (
                body.permit_type_id,
                body.name.strip() if body.name is not None else None,
                body.description.strip() if body.description is not None else None,
                body.fee_amount.strip() if body.fee_amount is not None else None,
                body.requires_plans,
                body.requires_coi,
                body.requires_survey,
                body.sort_order,
                body.is_active,
                use_id,
            ),
        ).fetchone()
        if not row:
            raise HTTPException(status_code=404, detail="Permit use not found")
    return {
        "id": row[0], "permit_type_id": row[1], "name": row[2], "description": row[3],
        "fee_amount": row[4], "requires_plans": bool(row[5]), "requires_coi": bool(row[6]),
        "requires_survey": bool(row[7]), "sort_order": row[8], "is_active": bool(row[9]),
    }


@router.delete("/admin/uses/{use_id}")
def delete_permit_use(use_id: int, _: dict = Depends(require_permission("permits.manage"))):
    with pool.connection() as conn:
        row = conn.execute("DELETE FROM permit_uses WHERE id = %s RETURNING id", (use_id,)).fetchone()
        if not row:
            raise HTTPException(status_code=404, detail="Permit use not found")
    return {"deleted": True, "id": use_id}
