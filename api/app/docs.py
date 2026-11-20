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

"""Built-in and admin-editable software user documentation."""
import re
from typing import Literal

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel

from .audit import record_audit
from .auth import current_user, has_permission, require_permission
from .db import pool

router = APIRouter(prefix="/api/docs", tags=["docs"])

_SLUG_RE = re.compile(r"^[a-z0-9][a-z0-9-]{1,63}$")
AUDIENCE_VALUES = ("all", "public", "council", "staff", "admin")

SCHEMA = """
CREATE TABLE IF NOT EXISTS core_help_docs (
    id           BIGSERIAL PRIMARY KEY,
    slug         TEXT NOT NULL UNIQUE,
    title        TEXT NOT NULL,
    category     TEXT NOT NULL DEFAULT 'General',
    audience     TEXT NOT NULL DEFAULT 'all',
    sort_order   INTEGER NOT NULL DEFAULT 100,
    body         TEXT NOT NULL DEFAULT '',
    is_published BOOLEAN NOT NULL DEFAULT TRUE,
    updated_by   TEXT NOT NULL DEFAULT '',
    created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS core_help_docs_order_idx ON core_help_docs(sort_order, id);
"""

_SEED_DOCS: list[tuple[str, str, str, str, int, str]] = [
    (
        "getting-started",
        "Getting Started with DocketHall",
        "General",
        "all",
        10,
        """## Overview
DocketHall brings meeting agendas, permits, city code, public records, complaints, and calendar reservations into one portal.

## Public Portal vs. Workspace
- **Public Portal (`/`)**: Anyone can browse finalized meeting agendas, City Code, public records, permit fee schedules, the public calendar, and submit complaints or subscribe to email alerts.
- **Workspace (`/app`)**: Sign in with your account to access role-specific tools in the left navigation menu.

## Account Basics
- Use **Change Password** in the top-right bar at any time to update your password.
- Click **? Help** in the top-right bar from any page to return to these instructions.""",
    ),
    (
        "council-guide",
        "Council Members: Packets & Proposing Agenda Items",
        "Agendas & Meetings",
        "council",
        20,
        """## Viewing Finalized Agendas & Packets
1. Open **Member → Agendas → Finalized Agendas** in the left menu.
2. For any finalized meeting, use:
   - **Summary** for a quick cover-sheet & item overview PDF.
   - **Full Packet** to open the complete combined packet PDF in your browser.
   - **Download** to save the packet PDF offline.
   - **Minutes / Minutes (Draft)** to review meeting minutes.

## Proposing an Agenda Item
1. Open **Member → Agendas → Propose Agenda Item**.
2. Enter an **Item Title**, optional **Suggested Section**, **Target Meeting** (or target date), **Recommended Motion**, **Fiscal Impact**, and **Description**.
3. Attach supporting PDFs or documents by dragging them into the upload area or clicking to browse.
4. Click **Submit Agenda Item**. Staff will review and place it on the appropriate agenda. You can track approval status under **My Proposed Items** on the same page.""",
    ),
    (
        "staff-agendas",
        "Staff: Building Agendas, Packets & Minutes",
        "Agendas & Meetings",
        "staff",
        30,
        """## Creating & Organizing an Agenda
1. Go to **Staff → Agenda Management → Manage Agendas**.
2. Click **New Agenda** (or start from a saved template) and set the meeting title, body, date, and time.
3. Open the agenda to add items, attach supporting files (PDF, Word, Excel, images, or text), and **drag and drop** items or attachments to reorder them.
4. Use **Todos & Backlog** to queue future or recurring items and move them onto an upcoming agenda when ready.

## Finalizing & Publishing
- Click **Finalize Agenda** to lock the packet and publish it to council members and the Public Portal.
- Use **Summary PDF** or **Full Packet PDF** to verify page numbering, cover sheets, and table of contents.
- After the meeting, open the **Minutes** tab to record attendance, motions, seconds, and votes, then mark minutes **Approved** when adopted.""",
    ),
    (
        "permits-guide",
        "Permits & Licensing Workflow",
        "Permits & Licensing",
        "all",
        40,
        """## Applying for a Permit (Applicants)
1. Open **Apply for Permit** (or visit `/portal` from the Public Portal).
2. Select the **Permit Type** and **Use / Category** to see required documents and fees.
3. Fill out the application fields (required fields are marked with `*`), attach plans/COI/surveys if needed, and submit.
4. Track application status, staff messages, inspections, and payment status under **My Permits**.

## Reviewing Permits (Staff)
- Open **Review Permits** to filter applications, assign reviewers, manage workflow steps and inspections, message applicants, update payment status, and issue or close permits.
- Configure permit types, uses, fees, and required fields under **Permit Catalog & Settings**.""",
    ),
    (
        "complaints-guide",
        "Filing & Managing Complaints",
        "Complaints",
        "all",
        50,
        """## Filing a Complaint
- Residents can file a complaint from the Public Portal or under **File a Complaint** when signed in.
- Use **My Complaints** to check status updates and exchange messages with staff.

## Staff Investigation & Enforcement
- Open **Manage Complaints** to assign an investigator, log confidential or public activity notes, issue Notices of Violation, schedule hearings/council review, and record final resolutions.
- Open **Complaint Log Book** for the public-facing log (confidential complainant details are withheld automatically).""",
    ),
    (
        "records-code-calendar",
        "City Code, Public Records & Calendar",
        "Records, Code & Calendar",
        "all",
        60,
        """## City Code
- Browse chapters and sections or search full text from **Public Portal → City Code** (or `/code`).
- Staff with codification permissions can add/edit sections, upload official PDFs, and track ordinance revision history.

## Public Records & Contracts
- Staff can catalog contracts, resolutions, easements, and insurance certificates with expiration alerts, and publish public documents to the portal.

## Calendar & Reservations
- Finalized meetings appear automatically on the Public Calendar.
- Staff can add community events and manage reservable municipal facilities and reservation requests.""",
    ),
    (
        "admin-setup",
        "Administrators: Users, Branding, Theme & Backups",
        "Administration",
        "admin",
        70,
        """## Users & Permissions
- Manage accounts, roles (`admin`, `admin_staff`, `non_admin_staff`, `council_member`, `applicant`), and per-user module permissions under **Administration → Manage Users**.

## General Preferences & Color Theme
- Set the **City Title**, **City Logo**, **Urgent Public Alert Banner**, **Footer**, **Contact / Directory** header link, and **Color Theme** presets/colors under **Administration → General Preferences**.

## Modules, Email Alerts & Backups
- Enable or disable modules under **Manage Modules**.
- Configure SMTP email delivery under **Integrations**.
- Download a complete `.zip` archive (database JSON + human-readable Markdown/CSV + all uploaded files) or restore from an archive under **Backup & Restore**.""",
    ),
]


def bootstrap() -> None:
    with pool.connection() as conn:
        conn.execute("SELECT pg_advisory_xact_lock(424298)")
        conn.execute(SCHEMA)
        for slug, title, category, audience, sort_order, body in _SEED_DOCS:
            conn.execute(
                "INSERT INTO core_help_docs "
                "(slug, title, category, audience, sort_order, body, is_published, updated_by) "
                "VALUES (%s, %s, %s, %s, %s, %s, TRUE, 'system') "
                "ON CONFLICT (slug) DO NOTHING",
                (slug, title, category, audience, sort_order, body),
            )


class DocIn(BaseModel):
    slug: str = ""
    title: str
    category: str = "General"
    audience: Literal["all", "public", "council", "staff", "admin"] = "all"
    sort_order: int = 100
    body: str = ""
    is_published: bool = True


def _slugify(text: str) -> str:
    s = re.sub(r"[^a-z0-9]+", "-", (text or "").strip().lower()).strip("-")
    return s[:64] or "guide"


def _row_to_dict(r) -> dict:
    return {
        "id": r[0],
        "slug": r[1],
        "title": r[2],
        "category": r[3],
        "audience": r[4],
        "sort_order": r[5],
        "body": r[6],
        "is_published": bool(r[7]),
        "updated_by": r[8],
        "created_at": r[9].isoformat() if r[9] else None,
        "updated_at": r[10].isoformat() if r[10] else None,
    }


def _allowed_audiences_for_user(user: dict) -> tuple[str, ...]:
    role = (user or {}).get("role") or ""
    if role == "admin" or has_permission(user, "settings.manage"):
        return AUDIENCE_VALUES
    if role in ("admin_staff", "non_admin_staff"):
        return ("all", "public", "council", "staff")
    if role == "council_member":
        return ("all", "public", "council")
    return ("all", "public")


@router.get("/public")
def list_public_docs():
    with pool.connection() as conn:
        rows = conn.execute(
            "SELECT id, slug, title, category, audience, sort_order, body, "
            "       is_published, updated_by, created_at, updated_at "
            "FROM core_help_docs "
            "WHERE is_published = TRUE AND audience IN ('all', 'public') "
            "ORDER BY sort_order ASC, id ASC"
        ).fetchall()
    return [_row_to_dict(r) for r in rows]


@router.get("")
def list_docs(user: dict = Depends(current_user)):
    can_manage = has_permission(user, "settings.manage")
    audiences = _allowed_audiences_for_user(user)
    with pool.connection() as conn:
        if can_manage:
            rows = conn.execute(
                "SELECT id, slug, title, category, audience, sort_order, body, "
                "       is_published, updated_by, created_at, updated_at "
                "FROM core_help_docs ORDER BY sort_order ASC, id ASC"
            ).fetchall()
        else:
            rows = conn.execute(
                "SELECT id, slug, title, category, audience, sort_order, body, "
                "       is_published, updated_by, created_at, updated_at "
                "FROM core_help_docs "
                "WHERE is_published = TRUE AND audience = ANY(%s) "
                "ORDER BY sort_order ASC, id ASC",
                (list(audiences),),
            ).fetchall()
    return [_row_to_dict(r) for r in rows]


@router.post("", status_code=201)
def create_doc(
    body: DocIn,
    user: dict = Depends(require_permission("settings.manage")),
):
    title = (body.title or "").strip()
    if not title:
        raise HTTPException(status_code=400, detail="Title is required")
    slug = _slugify(body.slug or title)
    if not _SLUG_RE.match(slug):
        raise HTTPException(status_code=400, detail="Slug must be 2-64 lowercase letters, digits, or hyphens")
    category = (body.category or "").strip() or "General"
    with pool.connection() as conn:
        exists = conn.execute("SELECT 1 FROM core_help_docs WHERE slug = %s", (slug,)).fetchone()
        if exists:
            raise HTTPException(status_code=409, detail=f"A documentation page with slug '{slug}' already exists")
        row = conn.execute(
            "INSERT INTO core_help_docs "
            "(slug, title, category, audience, sort_order, body, is_published, updated_by) "
            "VALUES (%s, %s, %s, %s, %s, %s, %s, %s) "
            "RETURNING id, slug, title, category, audience, sort_order, body, "
            "          is_published, updated_by, created_at, updated_at",
            (slug, title, category, body.audience, int(body.sort_order), body.body or "", bool(body.is_published), user["username"]),
        ).fetchone()
    record_audit(user["username"], "doc.create", "help_doc", str(row[0]), f"Created doc '{title}'")
    return _row_to_dict(row)


@router.put("/{doc_id}")
def update_doc(
    doc_id: int,
    body: DocIn,
    user: dict = Depends(require_permission("settings.manage")),
):
    title = (body.title or "").strip()
    if not title:
        raise HTTPException(status_code=400, detail="Title is required")
    category = (body.category or "").strip() or "General"
    with pool.connection() as conn:
        cur = conn.execute("SELECT slug FROM core_help_docs WHERE id = %s", (doc_id,)).fetchone()
        if not cur:
            raise HTTPException(status_code=404, detail="Documentation page not found")
        slug = _slugify(body.slug) if (body.slug or "").strip() else cur[0]
        if not _SLUG_RE.match(slug):
            raise HTTPException(status_code=400, detail="Slug must be 2-64 lowercase letters, digits, or hyphens")
        conflict = conn.execute("SELECT 1 FROM core_help_docs WHERE slug = %s AND id <> %s", (slug, doc_id)).fetchone()
        if conflict:
            raise HTTPException(status_code=409, detail=f"A documentation page with slug '{slug}' already exists")
        row = conn.execute(
            "UPDATE core_help_docs "
            "SET slug = %s, title = %s, category = %s, audience = %s, sort_order = %s, "
            "    body = %s, is_published = %s, updated_by = %s, updated_at = now() "
            "WHERE id = %s "
            "RETURNING id, slug, title, category, audience, sort_order, body, "
            "          is_published, updated_by, created_at, updated_at",
            (slug, title, category, body.audience, int(body.sort_order), body.body or "", bool(body.is_published), user["username"], doc_id),
        ).fetchone()
    record_audit(user["username"], "doc.update", "help_doc", str(doc_id), f"Updated doc '{title}'")
    return _row_to_dict(row)


@router.delete("/{doc_id}", status_code=204)
def delete_doc(
    doc_id: int,
    user: dict = Depends(require_permission("settings.manage")),
):
    with pool.connection() as conn:
        row = conn.execute("DELETE FROM core_help_docs WHERE id = %s RETURNING title", (doc_id,)).fetchone()
    if not row:
        raise HTTPException(status_code=404, detail="Documentation page not found")
    record_audit(user["username"], "doc.delete", "help_doc", str(doc_id), f"Deleted doc '{row[0]}'")
