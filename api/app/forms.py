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

"""General-purpose Standalone Custom Forms & Opinion Polls module."""
import csv
from datetime import date
import io
import json
from typing import Any, Literal

from xml.sax.saxutils import escape as _xml_escape

from fastapi import APIRouter, Depends, HTTPException, Request
from fastapi.responses import Response
from pydantic import BaseModel
from reportlab.lib import colors
from reportlab.lib.pagesizes import letter
from reportlab.lib.styles import getSampleStyleSheet
from reportlab.platypus import Paragraph, SimpleDocTemplate, Spacer, Table, TableStyle

from .audit import record_audit
from .auth import require_permission
from .db import pool
from .integrations import send_notification_email

SCHEMA = """
CREATE TABLE IF NOT EXISTS city_forms (
    id                BIGSERIAL PRIMARY KEY,
    slug              TEXT NOT NULL UNIQUE,
    title             TEXT NOT NULL,
    form_kind         TEXT NOT NULL DEFAULT 'form',
    description       TEXT NOT NULL DEFAULT '',
    fields            JSONB NOT NULL DEFAULT '[]'::jsonb,
    allow_anonymous   BOOLEAN NOT NULL DEFAULT TRUE,
    show_poll_results BOOLEAN NOT NULL DEFAULT TRUE,
    closes_at         DATE,
    is_public         BOOLEAN NOT NULL DEFAULT TRUE,
    sort_order        INTEGER NOT NULL DEFAULT 0,
    created_by        TEXT NOT NULL DEFAULT '',
    created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS city_form_submissions (
    id              BIGSERIAL PRIMARY KEY,
    form_id         BIGINT NOT NULL REFERENCES city_forms(id) ON DELETE CASCADE,
    submitter_name  TEXT NOT NULL DEFAULT '',
    submitter_email TEXT NOT NULL DEFAULT '',
    responses       JSONB NOT NULL DEFAULT '{}'::jsonb,
    status          TEXT NOT NULL DEFAULT 'new',
    staff_notes     TEXT NOT NULL DEFAULT '',
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS city_form_subs_form_idx ON city_form_submissions(form_id, id DESC);
"""

_SEED_FORMS: list[dict[str, Any]] = [
    {
        "slug": "commission-application",
        "title": "Board, Commission & Volunteer Application",
        "form_kind": "form",
        "description": "Apply to serve on a city board, advisory commission, or volunteer committee.",
        "sort_order": 1,
        "fields": [
            {
                "key": "board_choice",
                "section": "Application Details",
                "label": "Which board, commission, or role are you applying for?",
                "type": "select",
                "required": True,
                "options": [
                    "Planning Commission",
                    "Parks & Trails Committee",
                    "Finance & Budget Advisory",
                    "Election Judge / Volunteer",
                    "Other / General Volunteer",
                ],
            },
            {
                "key": "qualifications",
                "section": "Application Details",
                "label": "Background, skills, or reason for interest",
                "type": "textarea",
                "required": True,
            },
            {
                "key": "prior_experience",
                "section": "Application Details",
                "label": "Have you previously served on a city board or community committee?",
                "type": "yes_no_explain",
                "required": False,
            },
        ],
    },
    {
        "slug": "house-watch",
        "title": "Vacation / House Watch Request",
        "form_kind": "form",
        "description": "Notify city staff or public safety when your residence will be unoccupied.",
        "sort_order": 2,
        "fields": [
            {
                "key": "property_address",
                "section": "Residence & Dates",
                "label": "Property Address",
                "type": "text",
                "required": True,
            },
            {
                "key": "departure_date",
                "section": "Residence & Dates",
                "label": "Departure Date",
                "type": "date",
                "required": True,
            },
            {
                "key": "return_date",
                "section": "Residence & Dates",
                "label": "Return Date",
                "type": "date",
                "required": True,
            },
            {
                "key": "emergency_contact",
                "section": "Emergency & Property Notes",
                "label": "Local emergency contact (name & phone)",
                "type": "text",
                "required": True,
            },
            {
                "key": "vehicles_notes",
                "section": "Emergency & Property Notes",
                "label": "Vehicles in driveway, lights on timers, or keyholder notes",
                "type": "textarea",
                "required": False,
            },
        ],
    },
    {
        "slug": "data-request",
        "title": "Public Data / Records Request",
        "form_kind": "form",
        "description": "Submit a formal request for municipal public records or government data.",
        "sort_order": 3,
        "fields": [
            {
                "key": "records_requested",
                "section": "Request Details",
                "label": "Describe the records or data you are requesting",
                "type": "textarea",
                "required": True,
            },
            {
                "key": "delivery_format",
                "section": "Request Details",
                "label": "Preferred delivery method",
                "type": "radio",
                "required": True,
                "options": [
                    "Electronic / PDF via Email",
                    "In-Person Inspection at City Hall",
                    "Paper Copies (standard copy fees may apply)",
                ],
            },
        ],
    },
    {
        "slug": "park-priorities-poll",
        "title": "Community Poll: 2026 Park & Trail Priorities",
        "form_kind": "poll",
        "description": "Share your top priority for city park and trail investments this year.",
        "sort_order": 4,
        "fields": [
            {
                "key": "top_priority",
                "section": "Cast Your Vote",
                "label": "Which park or trail improvement should the city prioritize first?",
                "type": "radio",
                "required": True,
                "options": [
                    "Playground Equipment Upgrades",
                    "Trail Repaving & Lighting",
                    "Beach / Lakefront Improvements",
                    "Dog Park / Open Space",
                ],
            },
            {
                "key": "comments",
                "section": "Cast Your Vote",
                "label": "Additional comments (optional)",
                "type": "textarea",
                "required": False,
            },
        ],
    },
]


def bootstrap() -> None:
    with pool.connection() as conn:
        conn.execute("SELECT pg_advisory_xact_lock(424250)")
        conn.execute(SCHEMA)
        existing_cnt = conn.execute("SELECT COUNT(*) FROM city_forms").fetchone()[0]
        if existing_cnt == 0:
            for item in _SEED_FORMS:
                conn.execute(
                    "INSERT INTO city_forms "
                    "(slug, title, form_kind, description, fields, sort_order, created_by) "
                    "VALUES (%s, %s, %s, %s, %s::jsonb, %s, 'system') "
                    "ON CONFLICT (slug) DO NOTHING",
                    (
                        item["slug"],
                        item["title"],
                        item["form_kind"],
                        item["description"],
                        json.dumps(item["fields"]),
                        item["sort_order"],
                    ),
                )


router = APIRouter(prefix="/api/forms", tags=["forms"])

_VALID_FIELD_TYPES = {"text", "textarea", "number", "date", "select", "radio", "yes_no_explain", "impervious_table"}


def _slugify(raw: str) -> str:
    s = "".join(c if c.isalnum() else "-" for c in (raw or "").strip().lower()).strip("-")
    while "--" in s:
        s = s.replace("--", "-")
    return s[:60] or "form"


def _clean_fields(fields: list[dict[str, Any]] | None) -> list[dict[str, Any]]:
    if not isinstance(fields, list):
        return []
    out: list[dict[str, Any]] = []
    seen: set[str] = set()
    for idx, raw in enumerate(fields):
        if not isinstance(raw, dict):
            continue
        label = str(raw.get("label") or "").strip()
        if not label:
            continue
        raw_key = str(raw.get("key") or "").strip().lower()
        key = "".join(c if (c.isalnum() or c == "_") else "_" for c in raw_key).strip("_")
        if not key:
            key = "".join(c if (c.isalnum() or c == "_") else "_" for c in label.lower()).strip("_")[:40] or f"field_{idx + 1}"
        if key in seen:
            key = f"{key}_{idx + 1}"
        seen.add(key)
        ftype = str(raw.get("type") or "text").strip()
        if ftype not in _VALID_FIELD_TYPES:
            ftype = "text"
        item: dict[str, Any] = {
            "key": key,
            "section": str(raw.get("section") or "").strip(),
            "label": label,
            "type": ftype,
            "required": bool(raw.get("required", False)),
            "help_text": str(raw.get("help_text") or "").strip(),
        }
        if ftype in ("select", "radio"):
            opts = raw.get("options")
            if isinstance(opts, str):
                opts = [o.strip() for o in opts.splitlines() if o.strip()]
            elif isinstance(opts, list):
                opts = [str(o).strip() for o in opts if str(o).strip()]
            else:
                opts = []
            item["options"] = opts
        if ftype == "impervious_table":
            rows = raw.get("rows")
            item["rows"] = [str(r).strip() for r in rows if str(r).strip()] if isinstance(rows, list) else []
        out.append(item)
    return out


def _parse_optional_date(val: str | None) -> date | None:
    if val is None or not str(val).strip():
        return None
    try:
        return date.fromisoformat(str(val).strip())
    except ValueError:
        raise HTTPException(status_code=400, detail=f"Invalid date format '{val}'; expected YYYY-MM-DD")


def _compute_poll_results(conn, form_id: int, fields: list[dict[str, Any]]) -> dict:
    rows = conn.execute(
        "SELECT responses FROM city_form_submissions WHERE form_id = %s",
        (form_id,),
    ).fetchall()
    total = len(rows)
    tallies: dict[str, dict[str, int]] = {}
    for f in fields:
        if f.get("type") in ("radio", "select") and isinstance(f.get("options"), list):
            tallies[f["key"]] = {opt: 0 for opt in f["options"]}
    for (resp,) in rows:
        if not isinstance(resp, dict):
            continue
        for k, counts in tallies.items():
            ans = str(resp.get(k) or "").strip()
            if ans in counts:
                counts[ans] += 1
    return {"total_votes": total, "tallies": tallies}


def _row_to_form(r, sub_count: int = 0, poll_results: dict | None = None) -> dict:
    return {
        "id": r[0],
        "slug": r[1],
        "title": r[2],
        "form_kind": r[3],
        "description": r[4],
        "fields": list(r[5]) if isinstance(r[5], list) else [],
        "allow_anonymous": bool(r[6]),
        "show_poll_results": bool(r[7]),
        "closes_at": r[8].isoformat() if r[8] else None,
        "is_public": bool(r[9]),
        "sort_order": r[10],
        "created_by": r[11],
        "created_at": r[12].isoformat() if r[12] else None,
        "updated_at": r[13].isoformat() if r[13] else None,
        "submission_count": sub_count,
        "poll_results": poll_results,
    }


_FORM_COLS = (
    "id, slug, title, form_kind, description, fields, allow_anonymous, "
    "show_poll_results, closes_at, is_public, sort_order, created_by, created_at, updated_at"
)


class FormIn(BaseModel):
    title: str
    slug: str = ""
    form_kind: Literal["form", "poll"] = "form"
    description: str = ""
    fields: list[dict[str, Any]] = []
    allow_anonymous: bool = True
    show_poll_results: bool = True
    closes_at: str | None = None
    is_public: bool = True
    sort_order: int = 0


class FormPatch(BaseModel):
    title: str | None = None
    form_kind: Literal["form", "poll"] | None = None
    description: str | None = None
    fields: list[dict[str, Any]] | None = None
    allow_anonymous: bool | None = None
    show_poll_results: bool | None = None
    closes_at: str | None = None
    is_public: bool | None = None
    sort_order: int | None = None


class FormSubmitIn(BaseModel):
    submitter_name: str = ""
    submitter_email: str = ""
    responses: dict[str, Any] = {}


class SubmissionPatch(BaseModel):
    status: Literal["new", "reviewed", "archived"] | None = None
    staff_notes: str | None = None


@router.get("/public")
def list_public_forms():
    with pool.connection() as conn:
        rows = conn.execute(
            f"SELECT {_FORM_COLS} FROM city_forms "
            "WHERE is_public = TRUE AND (closes_at IS NULL OR closes_at >= CURRENT_DATE) "
            "ORDER BY sort_order ASC, id ASC"
        ).fetchall()
        out = []
        for r in rows:
            fields = list(r[5]) if isinstance(r[5], list) else []
            poll_res = _compute_poll_results(conn, r[0], fields) if (r[3] == "poll" and r[7]) else None
            out.append(_row_to_form(r, poll_results=poll_res))
        return out


@router.post("/public/{form_id}/submit", status_code=201)
def submit_public_form(form_id: int, body: FormSubmitIn, request: Request):
    with pool.connection() as conn:
        f_row = conn.execute(
            f"SELECT {_FORM_COLS} FROM city_forms "
            "WHERE id = %s AND is_public = TRUE AND (closes_at IS NULL OR closes_at >= CURRENT_DATE)",
            (form_id,),
        ).fetchone()
        if not f_row:
            raise HTTPException(status_code=404, detail="Form or poll not found or closed")
        fields = list(f_row[5]) if isinstance(f_row[5], list) else []
        allow_anon = bool(f_row[6])
        sname = body.submitter_name.strip()
        semail = body.submitter_email.strip()
        if not allow_anon and (not sname or not semail):
            raise HTTPException(status_code=400, detail="Name and email are required for this form")

        resp = body.responses if isinstance(body.responses, dict) else {}
        for fld in fields:
            if not fld.get("required"):
                continue
            val = resp.get(fld["key"])
            if fld.get("type") == "yes_no_explain":
                ans = str(val.get("answer") or "").strip().lower() if isinstance(val, dict) else ""
                exp = str(val.get("explanation") or "").strip() if isinstance(val, dict) else ""
                if ans not in ("yes", "no") or not exp:
                    raise HTTPException(status_code=400, detail=f"'{fld['label']}' requires Yes/No and explanation")
            elif not str(val or "").strip():
                raise HTTPException(status_code=400, detail=f"'{fld['label']}' is required")

        s_row = conn.execute(
            "INSERT INTO city_form_submissions (form_id, submitter_name, submitter_email, responses) "
            "VALUES (%s, %s, %s, %s::jsonb) RETURNING id, created_at",
            (form_id, sname, semail, json.dumps(resp)),
        ).fetchone()
        poll_res = _compute_poll_results(conn, form_id, fields) if (f_row[3] == "poll" and f_row[7]) else None

    send_notification_email(
        "forms_submitted",
        f"[DocketHall] New Submission: {f_row[2]}",
        f"A new response was submitted for '{f_row[2]}' by {sname or 'Anonymous'}.",
        link_path="/app#forms-manage",
        request=request,
    )
    return {
        "id": s_row[0],
        "form_id": form_id,
        "created_at": s_row[1].isoformat() if s_row[1] else None,
        "poll_results": poll_res,
    }


@router.get("")
def list_all_forms(_: dict = Depends(require_permission("forms.manage"))):
    with pool.connection() as conn:
        rows = conn.execute(
            f"SELECT {_FORM_COLS} FROM city_forms ORDER BY sort_order ASC, id ASC"
        ).fetchall()
        cnt_rows = conn.execute(
            "SELECT form_id, COUNT(*) FROM city_form_submissions GROUP BY form_id"
        ).fetchall()
        counts = {r[0]: r[1] for r in cnt_rows}
        out = []
        for r in rows:
            fields = list(r[5]) if isinstance(r[5], list) else []
            poll_res = _compute_poll_results(conn, r[0], fields) if r[3] == "poll" else None
            out.append(_row_to_form(r, sub_count=counts.get(r[0], 0), poll_results=poll_res))
        return out


@router.post("", status_code=201)
def create_form(body: FormIn, user: dict = Depends(require_permission("forms.manage"))):
    title = body.title.strip()
    if not title:
        raise HTTPException(status_code=400, detail="Title is required")
    base_slug = _slugify(body.slug or title)
    fields = _clean_fields(body.fields)
    closes = _parse_optional_date(body.closes_at)
    with pool.connection() as conn:
        slug = base_slug
        if conn.execute("SELECT 1 FROM city_forms WHERE slug = %s", (slug,)).fetchone():
            slug = f"{base_slug}-{int(date.today().strftime('%m%d'))}"
        row = conn.execute(
            f"INSERT INTO city_forms "
            "(slug, title, form_kind, description, fields, allow_anonymous, show_poll_results, closes_at, is_public, sort_order, created_by) "
            "VALUES (%s, %s, %s, %s, %s::jsonb, %s, %s, %s, %s, %s, %s) "
            f"RETURNING {_FORM_COLS}",
            (
                slug, title, body.form_kind, body.description.strip(), json.dumps(fields),
                body.allow_anonymous, body.show_poll_results, closes, body.is_public, body.sort_order, user["username"],
            ),
        ).fetchone()
    record_audit(user["username"], "form.create", title)
    return _row_to_form(row)


@router.patch("/{form_id}")
def update_form(form_id: int, body: FormPatch, user: dict = Depends(require_permission("forms.manage"))):
    fields = _clean_fields(body.fields) if body.fields is not None else None
    clear_closes = body.closes_at is not None and not body.closes_at.strip()
    closes = _parse_optional_date(body.closes_at) if (body.closes_at is not None and body.closes_at.strip()) else None
    with pool.connection() as conn:
        row = conn.execute(
            f"UPDATE city_forms SET "
            "title = COALESCE(%s, title), "
            "form_kind = COALESCE(%s, form_kind), "
            "description = COALESCE(%s, description), "
            "fields = COALESCE(%s::jsonb, fields), "
            "allow_anonymous = COALESCE(%s, allow_anonymous), "
            "show_poll_results = COALESCE(%s, show_poll_results), "
            "closes_at = CASE WHEN %s THEN NULL ELSE COALESCE(%s, closes_at) END, "
            "is_public = COALESCE(%s, is_public), "
            "sort_order = COALESCE(%s, sort_order), "
            "updated_at = now() "
            f"WHERE id = %s RETURNING {_FORM_COLS}",
            (
                body.title.strip() if body.title is not None else None,
                body.form_kind,
                body.description.strip() if body.description is not None else None,
                json.dumps(fields) if fields is not None else None,
                body.allow_anonymous,
                body.show_poll_results,
                clear_closes,
                closes,
                body.is_public,
                body.sort_order,
                form_id,
            ),
        ).fetchone()
        if not row:
            raise HTTPException(status_code=404, detail="Form not found")
    record_audit(user["username"], "form.update", f"Updated form #{form_id}")
    return _row_to_form(row)


@router.delete("/{form_id}")
def delete_form(form_id: int, user: dict = Depends(require_permission("forms.manage"))):
    with pool.connection() as conn:
        row = conn.execute("DELETE FROM city_forms WHERE id = %s RETURNING id, title", (form_id,)).fetchone()
        if not row:
            raise HTTPException(status_code=404, detail="Form not found")
    record_audit(user["username"], "form.delete", f"Deleted form #{form_id}: {row[1]}")
    return {"deleted": True, "id": form_id}


@router.get("/{form_id}/submissions")
def list_form_submissions(form_id: int, _: dict = Depends(require_permission("forms.manage"))):
    with pool.connection() as conn:
        rows = conn.execute(
            "SELECT id, form_id, submitter_name, submitter_email, responses, status, staff_notes, created_at "
            "FROM city_form_submissions WHERE form_id = %s ORDER BY id DESC LIMIT 300",
            (form_id,),
        ).fetchall()
    return [
        {
            "id": r[0],
            "form_id": r[1],
            "submitter_name": r[2],
            "submitter_email": r[3],
            "responses": dict(r[4]) if isinstance(r[4], dict) else {},
            "status": r[5],
            "staff_notes": r[6],
            "created_at": r[7].isoformat() if r[7] else None,
        }
        for r in rows
    ]


@router.patch("/submissions/{sub_id}")
def update_submission(sub_id: int, body: SubmissionPatch, _: dict = Depends(require_permission("forms.manage"))):
    with pool.connection() as conn:
        row = conn.execute(
            "UPDATE city_form_submissions SET "
            "status = COALESCE(%s, status), "
            "staff_notes = COALESCE(%s, staff_notes) "
            "WHERE id = %s RETURNING id, status, staff_notes",
            (body.status, body.staff_notes.strip() if body.staff_notes is not None else None, sub_id),
        ).fetchone()
        if not row:
            raise HTTPException(status_code=404, detail="Submission not found")
    return {"id": row[0], "status": row[1], "staff_notes": row[2]}


@router.get("/{form_id}/submissions.csv")
def export_submissions_csv(form_id: int, _: dict = Depends(require_permission("forms.manage"))):
    with pool.connection() as conn:
        f_row = conn.execute("SELECT title, fields FROM city_forms WHERE id = %s", (form_id,)).fetchone()
        if not f_row:
            raise HTTPException(status_code=404, detail="Form not found")
        fields = list(f_row[1]) if isinstance(f_row[1], list) else []
        rows = conn.execute(
            "SELECT id, submitter_name, submitter_email, responses, status, created_at "
            "FROM city_form_submissions WHERE form_id = %s ORDER BY id DESC",
            (form_id,),
        ).fetchall()

    keys = [f["key"] for f in fields if isinstance(f, dict) and f.get("key")]
    buf = io.StringIO()
    w = csv.writer(buf)
    w.writerow(["ID", "Submitted", "Name", "Email", "Status", *[f.get("label", k) for f, k in zip(fields, keys)]])
    for r in rows:
        resp = r[3] if isinstance(r[3], dict) else {}
        vals = []
        for k in keys:
            v = resp.get(k, "")
            if isinstance(v, dict):
                v = f"{v.get('answer', '')}: {v.get('explanation', '')}".strip(": ")
            vals.append(str(v))
        w.writerow([r[0], r[5].isoformat() if r[5] else "", r[1], r[2], r[4], *vals])
    return Response(
        content=buf.getvalue().encode("utf-8"),
        media_type="text/csv",
        headers={"Content-Disposition": f'attachment; filename="form-{form_id}-submissions.csv"'},
    )


@router.get("/submissions/{sub_id}/pdf")
def get_submission_pdf(sub_id: int, _: dict = Depends(require_permission("forms.manage"))):
    with pool.connection() as conn:
        row = conn.execute(
            "SELECT s.id, s.submitter_name, s.submitter_email, s.responses, s.status, s.created_at, "
            "       f.title, f.form_kind, f.fields "
            "FROM city_form_submissions s JOIN city_forms f ON f.id = s.form_id WHERE s.id = %s",
            (sub_id,),
        ).fetchone()
    if not row:
        raise HTTPException(status_code=404, detail="Submission not found")
    resp = dict(row[3]) if isinstance(row[3], dict) else {}
    fields = list(row[8]) if isinstance(row[8], list) else []
    label_map = {f["key"]: f.get("label") or f["key"] for f in fields if isinstance(f, dict) and f.get("key")}

    buf = io.BytesIO()
    doc = SimpleDocTemplate(buf, pagesize=letter, title=f"Submission #{sub_id}")
    styles = getSampleStyleSheet()
    story = [
        Paragraph(f"<b>{_xml_escape(str(row[6]))}</b>", styles["Title"]),
        Paragraph(f"Submission #{sub_id} · Status: <b>{_xml_escape(str(row[4]))}</b>", styles["Normal"]),
        Spacer(1, 10),
    ]
    meta_rows = [
        ["Submitter", row[1] or "Anonymous"],
        ["Email", row[2] or "—"],
        ["Submitted At", row[5].isoformat() if row[5] else "—"],
    ]
    t = Table(meta_rows, colWidths=[130, 370])
    t.setStyle(TableStyle([
        ("GRID", (0, 0), (-1, -1), 0.5, colors.grey),
        ("BACKGROUND", (0, 0), (0, -1), colors.HexColor("#f1f5f9")),
        ("FONTNAME", (0, 0), (0, -1), "Helvetica-Bold"),
        ("PADDING", (0, 0), (-1, -1), 6),
    ]))
    story.append(t)
    story.extend([Spacer(1, 14), Paragraph("<b>Submitted Responses</b>", styles["Heading3"])])
    ordered_keys = [k for k in label_map if k in resp] + [k for k in resp if k not in label_map]
    for k in ordered_keys:
        lbl = label_map.get(k, k.replace("_", " ").title())
        val = resp.get(k)
        if isinstance(val, dict):
            if "answer" in val:
                txt = f"{str(val.get('answer') or '—').upper()} — {val.get('explanation') or ''}".strip(" —")
            else:
                txt = json.dumps(val)
        else:
            txt = str(val or "—")
        story.append(Paragraph(f"<b>{_xml_escape(str(lbl))}:</b> {_xml_escape(txt)}", styles["Normal"]))
        story.append(Spacer(1, 6))
    doc.build(story)
    return Response(
        content=buf.getvalue(),
        media_type="application/pdf",
        headers={"Content-Disposition": f'inline; filename="submission-{sub_id}.pdf"'},
    )
