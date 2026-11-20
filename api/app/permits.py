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
from datetime import date, datetime, timedelta, timezone
import csv
import hashlib
import io
import json
import os
import re
from typing import Any, Literal
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
from .audit import record_audit
from .auth import has_permission, require_permission
from .db import pool
from .integrations import send_direct_email, send_notification_email
from .tenancy import tenant_object_key

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
    id              BIGSERIAL PRIMARY KEY,
    name            TEXT NOT NULL UNIQUE,
    description     TEXT NOT NULL DEFAULT '',
    sort_order      INTEGER NOT NULL DEFAULT 0,
    is_active       BOOLEAN NOT NULL DEFAULT TRUE,
    kind            TEXT NOT NULL DEFAULT 'construction',
    expiration_rule TEXT NOT NULL DEFAULT 'none',
    required_fields JSONB NOT NULL DEFAULT '["property_address"]'::jsonb,
    custom_fields   JSONB NOT NULL DEFAULT '[]'::jsonb
);
ALTER TABLE permit_types ADD COLUMN IF NOT EXISTS kind TEXT NOT NULL DEFAULT 'construction';
ALTER TABLE permit_types ADD COLUMN IF NOT EXISTS expiration_rule TEXT NOT NULL DEFAULT 'none';
ALTER TABLE permit_types ADD COLUMN IF NOT EXISTS required_fields JSONB NOT NULL DEFAULT '["property_address"]'::jsonb;
ALTER TABLE permit_types ADD COLUMN IF NOT EXISTS custom_fields JSONB NOT NULL DEFAULT '[]'::jsonb;
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
    expires_at          DATE,
    permit_kind         TEXT NOT NULL DEFAULT 'construction',
    renewed_from_id     BIGINT REFERENCES permits(id) ON DELETE SET NULL,
    project_name        TEXT NOT NULL DEFAULT '',
    custom_data         JSONB NOT NULL DEFAULT '{}'::jsonb,
    planning_data       JSONB NOT NULL DEFAULT '{}'::jsonb
);
ALTER TABLE permits ADD COLUMN IF NOT EXISTS expires_at DATE;
ALTER TABLE permits ADD COLUMN IF NOT EXISTS permit_kind TEXT NOT NULL DEFAULT 'construction';
ALTER TABLE permits ADD COLUMN IF NOT EXISTS renewed_from_id BIGINT REFERENCES permits(id) ON DELETE SET NULL;
ALTER TABLE permits ADD COLUMN IF NOT EXISTS project_name TEXT NOT NULL DEFAULT '';
ALTER TABLE permits ADD COLUMN IF NOT EXISTS custom_data JSONB NOT NULL DEFAULT '{}'::jsonb;
ALTER TABLE permits ADD COLUMN IF NOT EXISTS planning_data JSONB NOT NULL DEFAULT '{}'::jsonb;
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
    inspection_id BIGINT,
    created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE permit_documents ADD COLUMN IF NOT EXISTS inspection_id BIGINT;
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
CREATE TABLE IF NOT EXISTS permit_links (
    id               BIGSERIAL PRIMARY KEY,
    source_permit_id BIGINT NOT NULL REFERENCES permits(id) ON DELETE CASCADE,
    target_permit_id BIGINT NOT NULL REFERENCES permits(id) ON DELETE CASCADE,
    link_type        TEXT NOT NULL DEFAULT 'related',
    notes            TEXT NOT NULL DEFAULT '',
    created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (source_permit_id, target_permit_id, link_type)
);
CREATE INDEX IF NOT EXISTS permit_links_source_idx ON permit_links(source_permit_id);
CREATE INDEX IF NOT EXISTS permit_links_target_idx ON permit_links(target_permit_id);
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
    block           TEXT NOT NULL DEFAULT '',
    section         TEXT NOT NULL DEFAULT '',
    notes           TEXT NOT NULL DEFAULT '',
    latitude        DOUBLE PRECISION,
    longitude       DOUBLE PRECISION,
    zoning_district TEXT NOT NULL DEFAULT '',
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE permit_parcels ADD COLUMN IF NOT EXISTS latitude DOUBLE PRECISION;
ALTER TABLE permit_parcels ADD COLUMN IF NOT EXISTS longitude DOUBLE PRECISION;
ALTER TABLE permit_parcels ADD COLUMN IF NOT EXISTS zoning_district TEXT NOT NULL DEFAULT '';
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
    id               BIGSERIAL PRIMARY KEY,
    permit_id        BIGINT NOT NULL REFERENCES permits(id) ON DELETE CASCADE,
    inspection_type  TEXT NOT NULL,
    scheduled_date   TEXT NOT NULL DEFAULT '',
    requested_window TEXT NOT NULL DEFAULT '',
    inspector        TEXT NOT NULL DEFAULT '',
    result           TEXT NOT NULL DEFAULT 'scheduled',
    notes            TEXT NOT NULL DEFAULT '',
    checklist        JSONB NOT NULL DEFAULT '[]'::jsonb,
    completed_at     TIMESTAMPTZ,
    created_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE permit_inspections ADD COLUMN IF NOT EXISTS requested_window TEXT NOT NULL DEFAULT '';
ALTER TABLE permit_inspections ADD COLUMN IF NOT EXISTS checklist JSONB NOT NULL DEFAULT '[]'::jsonb;
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
CREATE TABLE IF NOT EXISTS contractor_licenses (
    id                   BIGSERIAL PRIMARY KEY,
    license_number       TEXT NOT NULL UNIQUE,
    business_name        TEXT NOT NULL,
    license_type         TEXT NOT NULL DEFAULT 'General Contractor',
    contact_name         TEXT NOT NULL DEFAULT '',
    email                TEXT NOT NULL DEFAULT '',
    phone                TEXT NOT NULL DEFAULT '',
    address              TEXT NOT NULL DEFAULT '',
    license_expires_at   DATE,
    insurance_carrier    TEXT NOT NULL DEFAULT '',
    insurance_policy_no  TEXT NOT NULL DEFAULT '',
    insurance_expires_at DATE,
    bond_amount          TEXT NOT NULL DEFAULT '',
    bond_expires_at      DATE,
    status               TEXT NOT NULL DEFAULT 'active',
    notes                TEXT NOT NULL DEFAULT '',
    created_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at           TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS contractor_licenses_status_idx ON contractor_licenses(status, business_name);
CREATE TABLE IF NOT EXISTS permit_fee_entries (
    id               BIGSERIAL PRIMARY KEY,
    permit_id        BIGINT NOT NULL REFERENCES permits(id) ON DELETE CASCADE,
    entry_type       TEXT NOT NULL DEFAULT 'fee',
    description      TEXT NOT NULL,
    amount_cents     INTEGER NOT NULL DEFAULT 0,
    payment_method   TEXT NOT NULL DEFAULT '',
    reference_number TEXT NOT NULL DEFAULT '',
    recorded_by      TEXT NOT NULL DEFAULT '',
    notes            TEXT NOT NULL DEFAULT '',
    created_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS permit_fee_entries_permit_idx ON permit_fee_entries(permit_id, id);
CREATE TABLE IF NOT EXISTS recurring_compliance_programs (
    id                   BIGSERIAL PRIMARY KEY,
    program_type         TEXT NOT NULL DEFAULT 'Rental Housing',
    property_address     TEXT NOT NULL,
    parcel_id            TEXT NOT NULL DEFAULT '',
    unit_count           INTEGER NOT NULL DEFAULT 1,
    owner_name           TEXT NOT NULL DEFAULT '',
    local_agent_name     TEXT NOT NULL DEFAULT '',
    local_agent_phone    TEXT NOT NULL DEFAULT '',
    local_agent_email    TEXT NOT NULL DEFAULT '',
    cycle_months         INTEGER NOT NULL DEFAULT 12,
    last_inspected_date  DATE,
    next_inspection_date DATE,
    last_result          TEXT NOT NULL DEFAULT 'pending',
    inspector            TEXT NOT NULL DEFAULT '',
    certificate_number   TEXT NOT NULL DEFAULT '',
    status               TEXT NOT NULL DEFAULT 'active',
    notes                TEXT NOT NULL DEFAULT '',
    created_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at           TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS recurring_comp_next_idx ON recurring_compliance_programs(status, next_inspection_date);
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
    "fee_schedule_url": os.environ.get("DEFAULT_FEE_SCHEDULE_URL", ""),
    "fee_schedule_label": os.environ.get("DEFAULT_FEE_SCHEDULE_LABEL", ""),
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

        # Seed an example annual non-zoning permit type if not already present
        conn.execute(
            "INSERT INTO permit_types (name, description, sort_order, kind, expiration_rule, required_fields) "
            "VALUES ('Small Craft Permits', 'Annual beach kayak/canoe rack & small craft permits.', %s, 'annual_license', 'calendar_year', '[\"applicant_email\", \"applicant_phone\"]'::jsonb) "
            "ON CONFLICT (name) DO NOTHING",
            (len(_SEED_CATALOG) + 1,),
        )
        sc_id = conn.execute(
            "SELECT id FROM permit_types WHERE name = 'Small Craft Permits'"
        ).fetchone()[0]
        conn.execute(
            "INSERT INTO permit_uses "
            "(permit_type_id, name, fee_amount, requires_plans, requires_coi, requires_survey, sort_order) "
            "VALUES (%s, 'Kayak / Canoe Beach Rack (Annual)', '$50.00', FALSE, FALSE, FALSE, 1) "
            "ON CONFLICT (permit_type_id, name) DO NOTHING",
            (sc_id,),
        )
        # Seed Birchwood's Variance Application custom fields only when SEED_CITY_PROFILE=birchwood
        if os.environ.get("SEED_CITY_PROFILE", "").strip().lower() == "birchwood":
            conn.execute(
                "UPDATE permit_types SET custom_fields = %s::jsonb "
                "WHERE name = 'Variance Application' AND (custom_fields IS NULL OR custom_fields = '[]'::jsonb)",
                (json.dumps(VARIANCE_CUSTOM_FIELDS),),
            )

        if conn.execute("SELECT COUNT(*) FROM contractor_licenses").fetchone()[0] == 0:
            today = date.today()
            next_year = (today + timedelta(days=365)).isoformat()
            six_mos = (today + timedelta(days=180)).isoformat()
            past_exp = (today - timedelta(days=30)).isoformat()
            for row in (
                (
                    "MN-GC-40821", "Northshore Builders LLC", "General Contractor",
                    "Alex Jensen", "permits@northshorebuilders.example", "(555) 234-5501",
                    "1200 County Road 12", next_year,
                    "Northland Mutual", "GL-884920", next_year, "$50,000", next_year, "active",
                    "Preferred residential & shoreline general contractor.",
                ),
                (
                    "MN-EL-21904", "Birchwood Electric Co.", "Electrical",
                    "Samira Patel", "dispatch@birchwoodelectric.example", "(555) 234-5502",
                    "445 Commerce Blvd", six_mos,
                    "Civic Shield Insurance", "EL-441022", six_mos, "$25,000", six_mos, "active",
                    "Master electrical license on file.",
                ),
                (
                    "MN-PL-10482", "Lakeside Plumbing & Heating", "Plumbing",
                    "Greg Miller", "office@lakesideplumbing.example", "(555) 234-5503",
                    "78 Riverview Dr", past_exp,
                    "Harbor Casualty", "PL-100931", past_exp, "$25,000", next_year, "expired",
                    "License & liability COI expired — requires renewal before permit issuance.",
                ),
            ):
                conn.execute(
                    "INSERT INTO contractor_licenses "
                    "(license_number, business_name, license_type, contact_name, email, phone, address, "
                    " license_expires_at, insurance_carrier, insurance_policy_no, insurance_expires_at, "
                    " bond_amount, bond_expires_at, status, notes) "
                    "VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s) "
                    "ON CONFLICT (license_number) DO NOTHING",
                    row,
                )

        if conn.execute("SELECT COUNT(*) FROM recurring_compliance_programs").fetchone()[0] == 0:
            today = date.today()
            due_soon = (today + timedelta(days=20)).isoformat()
            past_ok = (today - timedelta(days=120)).isoformat()
            future_ok = (today + timedelta(days=245)).isoformat()
            overdue_d = (today - timedelta(days=15)).isoformat()
            past_yr = (today - timedelta(days=380)).isoformat()
            for row in (
                (
                    "Rental Housing", "312 Cedar Lane (4-Plex)", "12-030-21-01", 4,
                    "Cedar Properties LLC", "Morgan Lee", "(555) 234-6610", "morgan@cedarprops.example",
                    12, past_yr, due_soon, "passed", "Building Official", "RNT-2025-0014", "active",
                    "Annual 4-unit rental housing safety & egress inspection.",
                ),
                (
                    "Short-Term Rental (STR)", "108 Lakeshore Drive", "12-030-14-08", 1,
                    "Jordan Taylor", "Jordan Taylor", "(555) 234-6622", "jordan@lakeshorestr.example",
                    12, past_ok, future_ok, "passed", "Fire Marshal", "STR-2026-0007", "active",
                    "Verified smoke/CO alarms, posted parking rules, and emergency contact.",
                ),
                (
                    "Commercial Fire Safety", "500 Main Street", "12-030-05-02", 2,
                    "Main Street Mercantile", "Pat Alvarez", "(555) 234-6699", "pat@mainstreet.example",
                    12, past_yr, overdue_d, "conditional", "Fire Marshal", "", "active",
                    "Annual sprinkler, extinguisher, and exit signage inspection overdue.",
                ),
            ):
                conn.execute(
                    "INSERT INTO recurring_compliance_programs "
                    "(program_type, property_address, parcel_id, unit_count, owner_name, "
                    " local_agent_name, local_agent_phone, local_agent_email, cycle_months, "
                    " last_inspected_date, next_inspection_date, last_result, inspector, "
                    " certificate_number, status, notes) "
                    "VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)",
                    row,
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


_REQUIRED_FIELD_LABELS = {
    "applicant_email": "Email Address",
    "applicant_phone": "Phone Number",
    "property_address": "Location / Land Address",
    "building_name": "Building / Beach / Zone",
    "suite_name": "Suite / Rack / Slot #",
    "parcel_id": "Parcel Number",
    "owner_name": "Owner Name",
    "contractor_name": "Contractor Name",
    "contractor_license": "Contractor License #",
    "estimated_value": "Estimated Value",
    "project_description": "Description / Vessel Details",
}


VARIANCE_CUSTOM_FIELDS: list[dict[str, Any]] = [
    {
        "key": "legal_description",
        "section": "E. Legal Description",
        "label": "Legal Description of Property",
        "type": "textarea",
        "required": False,
        "help_text": "Lot, Block, Subdivision, or metes & bounds from deed/survey.",
    },
    {
        "key": "city_code_sections",
        "section": "G. Applicable City Code Sections",
        "label": "City Code Section(s) from which variance is requested",
        "type": "text",
        "required": True,
        "help_text": "List the specific zoning or city code section numbers (e.g., Section 302.040 Setbacks).",
    },
    {
        "key": "variance_request_details",
        "section": "H. Variance Request",
        "label": "State how you wish to vary from the City Code",
        "type": "textarea",
        "required": True,
        "help_text": "Describe exact dimensions, setbacks, height, or impervious surface relief requested.",
    },
    {
        "key": "practical_difficulties_unique",
        "section": "J. Variance Criteria",
        "label": "1. Are there practical difficulties or particular hardships due to unique circumstances of the property?",
        "type": "yes_no_explain",
        "required": True,
        "help_text": "Explain why the lot shape, topography, wetlands, or existing conditions make compliance difficult.",
    },
    {
        "key": "strict_interpretation_hardship",
        "section": "J. Variance Criteria",
        "label": "2. Would strict interpretation of the Zoning Ordinance deprive the property of reasonable use?",
        "type": "yes_no_explain",
        "required": True,
        "help_text": "Explain how the variance puts the property to use in a reasonable manner permitted by the ordinance.",
    },
    {
        "key": "not_self_created",
        "section": "J. Variance Criteria",
        "label": "3. Are the unique circumstances NOT created by the landowner?",
        "type": "yes_no_explain",
        "required": True,
        "help_text": "Confirm the plight is due to circumstances unique to the property and not created by the owner.",
    },
    {
        "key": "no_special_privilege",
        "section": "J. Variance Criteria",
        "label": "4. Will granting the variance avoid conferring a special privilege denied to neighboring properties?",
        "type": "yes_no_explain",
        "required": True,
        "help_text": "Economic considerations alone do not constitute practical difficulties.",
    },
    {
        "key": "essential_character_preserved",
        "section": "J. Variance Criteria",
        "label": "5. Is the variance in harmony with the Zoning Ordinance and will it preserve the essential character of the locality?",
        "type": "yes_no_explain",
        "required": True,
        "help_text": "Address neighborhood character, views, drainage, and public health/safety.",
    },
    {
        "key": "other_gov_permits",
        "section": "K. Other Governmental Permits",
        "label": "Are other governmental permits required (DNR, Watershed District, County, State)?",
        "type": "yes_no_explain",
        "required": False,
        "help_text": "If Yes, list the agency and permit status or attach copies.",
    },
    {
        "key": "exceeds_25_impervious",
        "section": "L. Impervious Surface",
        "label": "Does the proposed project exceed 25% total impervious surface on the lot?",
        "type": "yes_no_explain",
        "required": False,
        "help_text": "Explain mitigation or stormwater plan if exceeding 25%.",
    },
    {
        "key": "impervious_surface_table",
        "section": "L. Impervious Surface",
        "label": "Impervious Surface Breakdown (sq ft)",
        "type": "impervious_table",
        "required": False,
        "help_text": "Enter Existing, Proposed, and Change (sq ft) for each applicable surface.",
        "rows": [
            "Home Footprint",
            "Garage",
            "Deck / Porch / Patio",
            "Driveway / Parking",
            "Sidewalks / Walkways",
            "Shed / Accessory Structures",
            "Pool / Spa",
            "Retaining Walls / Other",
            "Total Impervious Surface (sq ft)",
            "Lot Area / % Impervious",
        ],
    },
]

_VALID_CUSTOM_FIELD_TYPES = {"text", "textarea", "number", "date", "yes_no_explain", "impervious_table"}


def _clean_custom_fields(fields: list[dict[str, Any]] | None) -> list[dict[str, Any]] | None:
    if fields is None:
        return None
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
        if ftype not in _VALID_CUSTOM_FIELD_TYPES:
            ftype = "text"
        item: dict[str, Any] = {
            "key": key,
            "section": str(raw.get("section") or "").strip(),
            "label": label,
            "type": ftype,
            "required": bool(raw.get("required", False)),
            "help_text": str(raw.get("help_text") or "").strip(),
        }
        if ftype == "impervious_table":
            raw_rows = raw.get("rows")
            if isinstance(raw_rows, list):
                rows = [str(r).strip() for r in raw_rows if str(r).strip()]
            else:
                rows = []
            item["rows"] = rows or [
                "Home Footprint",
                "Garage",
                "Deck / Porch / Patio",
                "Driveway / Parking",
                "Total Impervious Surface (sq ft)",
            ]
        out.append(item)
    return out


def _clean_custom_data(data: Any) -> dict[str, Any]:
    if not isinstance(data, dict):
        return {}
    return {str(k): v for k, v in data.items() if str(k).strip()}


def _validate_custom_data(custom_fields: list[dict[str, Any]], custom_data: dict[str, Any], type_name: str) -> None:
    for f in custom_fields:
        if not f.get("required"):
            continue
        key = f["key"]
        label = f.get("label") or key
        ftype = f.get("type") or "text"
        val = custom_data.get(key)
        if ftype == "yes_no_explain":
            ans = str(val.get("answer") or "").strip().lower() if isinstance(val, dict) else ""
            exp = str(val.get("explanation") or "").strip() if isinstance(val, dict) else ""
            if ans not in ("yes", "no") or not exp:
                raise HTTPException(
                    status_code=400,
                    detail=f"'{label}' requires a Yes/No selection and explanation for {type_name}",
                )
        elif ftype == "impervious_table":
            has_any = False
            if isinstance(val, dict):
                for row_vals in val.values():
                    if isinstance(row_vals, dict) and any(str(row_vals.get(col) or "").strip() for col in ("existing", "proposed", "change")):
                        has_any = True
                        break
            if not has_any:
                raise HTTPException(
                    status_code=400,
                    detail=f"'{label}' requires at least one entry for {type_name}",
                )
        else:
            if not str(val or "").strip():
                raise HTTPException(
                    status_code=400,
                    detail=f"'{label}' is required for {type_name}",
                )


def _clean_required_fields(fields: list[str] | None) -> list[str] | None:
    if fields is None:
        return None
    out: list[str] = []
    seen: set[str] = set()
    for f in fields:
        k = str(f or "").strip()
        if k in _REQUIRED_FIELD_LABELS and k not in seen:
            out.append(k)
            seen.add(k)
    return out


class PermitTypeIn(BaseModel):
    name: str
    description: str = ""
    sort_order: int = 0
    is_active: bool = True
    kind: Literal["construction", "annual_license"] = "construction"
    expiration_rule: Literal["none", "calendar_year", "one_year"] = "none"
    required_fields: list[str] = ["property_address"]
    custom_fields: list[dict[str, Any]] = []


class PermitTypePatch(BaseModel):
    name: str | None = None
    description: str | None = None
    sort_order: int | None = None
    is_active: bool | None = None
    kind: Literal["construction", "annual_license"] | None = None
    expiration_rule: Literal["none", "calendar_year", "one_year"] | None = None
    required_fields: list[str] | None = None
    custom_fields: list[dict[str, Any]] | None = None


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
    property_address: str = ""
    building_name: str = ""
    suite_name: str = ""
    parcel_id: str = ""
    owner_name: str = ""
    contractor_name: str = ""
    contractor_license: str = ""
    project_description: str = ""
    estimated_value: str = ""
    accepted_terms: bool = False
    project_name: str = ""
    custom_data: dict[str, Any] = {}
    prerequisite_permit_id: int | None = None
    related_permit_id: int | None = None


class PermitLinkIn(BaseModel):
    related_permit_id: int
    relationship: Literal["enabled_by", "enables", "related"] = "enabled_by"
    notes: str = ""


class PermitPatchIn(BaseModel):
    status: str | None = None
    fee_amount: str | None = None
    payment_status: str | None = None
    review_notes: str | None = None
    assigned_to: str | None = None
    expires_at: str | None = None
    applicant_name: str | None = None
    applicant_email: str | None = None
    applicant_phone: str | None = None
    property_address: str | None = None
    building_name: str | None = None
    suite_name: str | None = None
    parcel_id: str | None = None
    owner_name: str | None = None
    contractor_name: str | None = None
    contractor_license: str | None = None
    project_description: str | None = None
    estimated_value: str | None = None
    project_name: str | None = None
    custom_data: dict[str, Any] | None = None
    planning_data: dict[str, Any] | None = None
    override_compliance: bool = False


CONTRACTOR_STATUSES = ("active", "pending", "suspended", "expired")


class ContractorIn(BaseModel):
    license_number: str
    business_name: str
    license_type: str = "General Contractor"
    contact_name: str = ""
    email: str = ""
    phone: str = ""
    address: str = ""
    license_expires_at: str = ""
    insurance_carrier: str = ""
    insurance_policy_no: str = ""
    insurance_expires_at: str = ""
    bond_amount: str = ""
    bond_expires_at: str = ""
    status: str = "active"
    notes: str = ""


class ContractorPatch(BaseModel):
    license_number: str | None = None
    business_name: str | None = None
    license_type: str | None = None
    contact_name: str | None = None
    email: str | None = None
    phone: str | None = None
    address: str | None = None
    license_expires_at: str | None = None
    insurance_carrier: str | None = None
    insurance_policy_no: str | None = None
    insurance_expires_at: str | None = None
    bond_amount: str | None = None
    bond_expires_at: str | None = None
    status: str | None = None
    notes: str | None = None


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
    requested_window: str = ""
    inspector: str = ""
    result: str = "scheduled"
    notes: str = ""
    checklist: list[dict[str, Any]] | None = None


class InspectionPatch(BaseModel):
    scheduled_date: str | None = None
    requested_window: str | None = None
    inspector: str | None = None
    result: str | None = None
    notes: str | None = None
    checklist: list[dict[str, Any]] | None = None


_INSPECTION_CHECKLIST_TEMPLATES: dict[str, list[str]] = {
    "footing": [
        "Property lines / setbacks verified against site plan",
        "Excavation depth below frost line & undisturbed soil",
        "Formwork, rebar size/spacing, and anchor bolts verified",
    ],
    "framing": [
        "Load-bearing headers, beams, and joist spans match approved plans",
        "Fireblocking, draftstopping, and hurricane ties installed",
        "Egress window dimensions & sill heights compliant",
    ],
    "electrical": [
        "Service panel grounding, bonding, and GFCI/AFCI protection",
        "Box fill, wire gauge, and nail-plate protection verified",
        "Smoke / CO interconnected detectors installed",
    ],
    "plumbing": [
        "DWV water/air pressure test holding without leaks",
        "Proper pipe slope, venting, and cleanout access",
        "Backflow preventer & water heater T&P relief installed",
    ],
    "erosion": [
        "Silt fence / perimeter sediment controls properly trenched",
        "Construction entrance stabilized & street free of sediment",
        "Stormwater/wetland buffer stakes intact",
    ],
    "final": [
        "All prior rough/trade inspections passed",
        "Address numbers visible from street",
        "Handrails, guardrails, and safety glazing compliant",
        "Site grading & erosion stabilization complete",
    ],
}


def _default_checklist_for(inspection_type: str) -> list[dict[str, str]]:
    low = inspection_type.strip().lower()
    for key, items in _INSPECTION_CHECKLIST_TEMPLATES.items():
        if key in low:
            return [{"item": txt, "status": "pending", "note": ""} for txt in items]
    return [
        {"item": "Work matches approved permit plans & conditions", "status": "pending", "note": ""},
        {"item": "Safety & Municipal Code requirements verified", "status": "pending", "note": ""},
    ]


def _clean_checklist(raw: list[dict[str, Any]] | None) -> list[dict[str, str]]:
    if not isinstance(raw, list):
        return []
    out: list[dict[str, str]] = []
    for entry in raw:
        if not isinstance(entry, dict):
            continue
        item = str(entry.get("item") or "").strip()
        if not item:
            continue
        st = str(entry.get("status") or "pending").strip().lower()
        if st not in ("pending", "pass", "fail", "na"):
            st = "pending"
        out.append({"item": item, "status": st, "note": str(entry.get("note") or "").strip()})
    return out


class PermitMessageIn(BaseModel):
    body: str
    is_internal: bool = False


FEE_ENTRY_TYPES = ("fee", "payment", "waiver", "escrow_deposit", "escrow_refund")


class FeeEntryIn(BaseModel):
    entry_type: str = "fee"
    description: str
    amount_dollars: float
    payment_method: str = ""
    reference_number: str = ""
    notes: str = ""


COMPLIANCE_PROGRAM_STATUSES = ("active", "non_compliant", "suspended", "inactive")
COMPLIANCE_RESULTS = ("pending", "passed", "failed", "conditional")


class ComplianceProgramIn(BaseModel):
    program_type: str = "Rental Housing"
    property_address: str
    parcel_id: str = ""
    unit_count: int = 1
    owner_name: str = ""
    local_agent_name: str = ""
    local_agent_phone: str = ""
    local_agent_email: str = ""
    cycle_months: int = 12
    last_inspected_date: str = ""
    next_inspection_date: str = ""
    last_result: str = "pending"
    inspector: str = ""
    certificate_number: str = ""
    status: str = "active"
    notes: str = ""


class ComplianceProgramPatch(BaseModel):
    program_type: str | None = None
    property_address: str | None = None
    parcel_id: str | None = None
    unit_count: int | None = None
    owner_name: str | None = None
    local_agent_name: str | None = None
    local_agent_phone: str | None = None
    local_agent_email: str | None = None
    cycle_months: int | None = None
    last_inspected_date: str | None = None
    next_inspection_date: str | None = None
    last_result: str | None = None
    inspector: str | None = None
    certificate_number: str | None = None
    status: str | None = None
    notes: str | None = None


class ComplianceRecordInspectionIn(BaseModel):
    result: str = "passed"
    inspected_date: str = ""
    inspector: str = ""
    notes: str = ""


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
        f"SELECT id, name, description, sort_order, is_active, kind, expiration_rule, required_fields, custom_fields "
        f"FROM permit_types {where} ORDER BY sort_order ASC, name ASC"
    ).fetchall()
    u_rows = conn.execute(
        f"SELECT id, permit_type_id, name, description, fee_amount, "
        f"       requires_plans, requires_coi, requires_survey, sort_order, is_active "
        f"FROM permit_uses {where} ORDER BY sort_order ASC, name ASC"
    ).fetchall()
    types = [
        {
            "id": r[0],
            "name": r[1],
            "description": r[2],
            "sort_order": r[3],
            "is_active": bool(r[4]),
            "kind": r[5] or "construction",
            "expiration_rule": r[6] or "none",
            "required_fields": list(r[7]) if isinstance(r[7], list) else ["property_address"],
            "custom_fields": list(r[8]) if isinstance(r[8], list) else [],
        }
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


_SATISFIED_PREREQ_STATUSES = {"approved", "issued", "completed"}


def _hydrate_links(conn, ids: list[int]) -> dict[int, list[dict]]:
    link_rows = conn.execute(
        "SELECT l.id, l.source_permit_id, l.target_permit_id, l.link_type, l.notes, "
        "       sp.permit_number, sp.permit_type_name, sp.permit_use_name, sp.status, sp.property_address, sp.project_name, "
        "       tp.permit_number, tp.permit_type_name, tp.permit_use_name, tp.status, tp.property_address, tp.project_name "
        "FROM permit_links l "
        "JOIN permits sp ON sp.id = l.source_permit_id "
        "JOIN permits tp ON tp.id = l.target_permit_id "
        "WHERE l.source_permit_id = ANY(%s) OR l.target_permit_id = ANY(%s) "
        "ORDER BY l.id ASC",
        (ids, ids),
    ).fetchall()
    links_by_permit: dict[int, list[dict]] = {}
    id_set = set(ids)
    for lr in link_rows:
        lid, src_id, tgt_id, ltype, notes = lr[0], lr[1], lr[2], lr[3], lr[4]
        if src_id in id_set:
            links_by_permit.setdefault(src_id, []).append({
                "link_id": lid,
                "permit_id": tgt_id,
                "permit_number": lr[11],
                "permit_type_name": lr[12],
                "permit_use_name": lr[13],
                "status": lr[14],
                "property_address": lr[15],
                "project_name": lr[16],
                "direction": "enables" if ltype == "enables" else "related",
                "link_type": ltype,
                "notes": notes,
            })
        if tgt_id in id_set:
            links_by_permit.setdefault(tgt_id, []).append({
                "link_id": lid,
                "permit_id": src_id,
                "permit_number": lr[5],
                "permit_type_name": lr[6],
                "permit_use_name": lr[7],
                "status": lr[8],
                "property_address": lr[9],
                "project_name": lr[10],
                "direction": "prerequisite" if ltype == "enables" else "related",
                "link_type": ltype,
                "notes": notes,
            })
    return links_by_permit


def _hydrate_permits(conn, rows: list[tuple], include_internal: bool = True) -> list[dict]:
    if not rows:
        return []
    ids = [r[0] for r in rows]
    doc_rows = conn.execute(
        "SELECT id, permit_id, doc_category, title, filename, content_type, "
        "       size_bytes, uploaded_by, created_at, inspection_id "
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
            "inspection_id": d[9],
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
        "SELECT id, permit_id, inspection_type, scheduled_date, requested_window, inspector, result, notes, checklist, completed_at, created_at "
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
            "requested_window": ins[4] or "",
            "inspector": ins[5],
            "result": ins[6],
            "notes": ins[7],
            "checklist": ins[8] if isinstance(ins[8], list) else [],
            "completed_at": ins[9].isoformat() if ins[9] else None,
            "created_at": ins[10].isoformat() if ins[10] else None,
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

    links_by_permit = _hydrate_links(conn, ids)

    fee_rows = conn.execute(
        "SELECT id, permit_id, entry_type, description, amount_cents, payment_method, "
        "       reference_number, recorded_by, notes, created_at "
        "FROM permit_fee_entries WHERE permit_id = ANY(%s) ORDER BY id ASC",
        (ids,),
    ).fetchall()
    fees_by_permit: dict[int, list[dict]] = {}
    for fe in fee_rows:
        fees_by_permit.setdefault(fe[1], []).append({
            "id": fe[0],
            "permit_id": fe[1],
            "entry_type": fe[2],
            "description": fe[3],
            "amount_cents": fe[4],
            "payment_method": fe[5] or "",
            "reference_number": fe[6] or "",
            "recorded_by": fe[7] or "",
            "notes": fe[8] or "",
            "created_at": fe[9].isoformat() if fe[9] else None,
        })

    out = []
    for r in rows:
        permit_links = links_by_permit.get(r[0], [])
        unmet_prereqs = [
            lp for lp in permit_links
            if lp["direction"] == "prerequisite" and lp["status"] not in _SATISFIED_PREREQ_STATUSES
        ]
        f_entries = fees_by_permit.get(r[0], [])
        fees_assessed = sum(e["amount_cents"] for e in f_entries if e["entry_type"] == "fee")
        waivers = sum(e["amount_cents"] for e in f_entries if e["entry_type"] == "waiver")
        payments = sum(e["amount_cents"] for e in f_entries if e["entry_type"] == "payment")
        escrow_dep = sum(e["amount_cents"] for e in f_entries if e["entry_type"] == "escrow_deposit")
        escrow_ref = sum(e["amount_cents"] for e in f_entries if e["entry_type"] == "escrow_refund")
        fee_summary = {
            "fees_assessed_cents": fees_assessed,
            "waivers_cents": waivers,
            "payments_cents": payments,
            "balance_due_cents": max(0, fees_assessed - waivers - payments),
            "escrow_deposited_cents": escrow_dep,
            "escrow_refunded_cents": escrow_ref,
            "escrow_held_cents": max(0, escrow_dep - escrow_ref),
        }
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
            "permit_kind": r[32] or "construction",
            "renewed_from_id": r[33],
            "project_name": r[34] or "",
            "custom_data": dict(r[35]) if isinstance(r[35], dict) else {},
            "planning_data": dict(r[36]) if len(r) > 36 and isinstance(r[36], dict) else {},
            "statutory_clock": _compute_statutory_clock(r[36] if len(r) > 36 else {}, r[21]),
            "linked_permits": permit_links,
            "unmet_prerequisites": unmet_prereqs,
            "documents": docs_by_permit.get(r[0], []),
            "workflow_steps": wf_by_permit.get(r[0], []),
            "inspections": insp_by_permit.get(r[0], []),
            "messages": msgs_by_permit.get(r[0], []),
            "activity_log": logs_by_permit.get(r[0], []),
            "fee_entries": f_entries,
            "fee_summary": fee_summary,
        })
    return out


def _compute_statutory_clock(planning_data: dict | None, status: str = "") -> dict:
    pd = planning_data if isinstance(planning_data, dict) else {}
    comp_raw = str(pd.get("complete_date") or "").strip()
    if not comp_raw:
        return {"started": False, "statutory_days": 60, "deadline_date": "", "days_remaining": None, "urgency": "not_started"}
    try:
        comp_d = date.fromisoformat(comp_raw)
    except ValueError:
        return {"started": False, "statutory_days": 60, "deadline_date": "", "days_remaining": None, "urgency": "not_started"}
    extended = bool(pd.get("extended_60_days"))
    stat_days = 120 if extended else 60
    deadline = comp_d + timedelta(days=stat_days)
    is_final = status in ("issued", "denied", "closed")
    days_rem = (deadline - date.today()).days
    if is_final:
        urgency = "completed"
    elif days_rem < 0:
        urgency = "overdue"
    elif days_rem <= 14:
        urgency = "warning"
    else:
        urgency = "ok"
    return {
        "started": True,
        "complete_date": comp_raw,
        "extended_60_days": extended,
        "statutory_days": stat_days,
        "deadline_date": deadline.isoformat(),
        "days_remaining": days_rem,
        "urgency": urgency,
    }


def _clean_planning_data(raw: dict[str, Any] | None) -> dict[str, Any]:
    if not isinstance(raw, dict):
        return {}
    out: dict[str, Any] = {}
    for k in (
        "complete_date", "extension_notice_date", "zoning_district",
        "planning_commission_date", "public_hearing_date",
        "neighbor_notice_sent_date", "council_hearing_date", "conditions_of_approval",
    ):
        v = str(raw.get(k) or "").strip()
        if k.endswith("_date") and v:
            try:
                date.fromisoformat(v)
            except ValueError:
                raise HTTPException(status_code=400, detail=f"{k.replace('_', ' ').title()} must be YYYY-MM-DD")
        out[k] = v
    out["extended_60_days"] = bool(raw.get("extended_60_days"))
    if raw.get("agenda_backlog_id"):
        out["agenda_backlog_id"] = int(raw["agenda_backlog_id"])
    abut = []
    if isinstance(raw.get("abutting_owners"), list):
        for entry in raw["abutting_owners"]:
            if not isinstance(entry, dict):
                continue
            nm = str(entry.get("name") or "").strip()
            ad = str(entry.get("address") or "").strip()
            pid = str(entry.get("parcel_id") or "").strip()
            if nm or ad:
                abut.append({"name": nm, "address": ad, "parcel_id": pid})
    out["abutting_owners"] = abut
    return out


_PERMIT_COLS = (
    "id, permit_number, applicant_user_id, applicant_username, "
    "permit_type_id, permit_use_id, permit_type_name, permit_use_name, "
    "applicant_name, applicant_email, applicant_phone, "
    "property_address, building_name, suite_name, parcel_id, owner_name, "
    "contractor_name, contractor_license, project_description, estimated_value, "
    "accepted_terms, status, fee_amount, payment_status, review_notes, reviewed_by, "
    "assigned_to, created_at, updated_at, issued_at, closed_at, expires_at, "
    "permit_kind, renewed_from_id, project_name, custom_data, planning_data"
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


@router.get("/public/lookup")
def public_permit_lookup(q: str = ""):
    term = q.strip()
    if len(term) < 2:
        return []
    like = f"%{term}%"
    with pool.connection() as conn:
        rows = conn.execute(
            "SELECT permit_number, permit_type_name, permit_use_name, property_address, status, created_at, issued_at "
            "FROM permits "
            "WHERE permit_number ILIKE %s OR property_address ILIKE %s "
            "ORDER BY id DESC LIMIT 25",
            (like, like),
        ).fetchall()
    return [
        {
            "permit_number": r[0],
            "permit_type_name": r[1],
            "permit_use_name": r[2],
            "property_address": r[3],
            "status": r[4],
            "created_at": r[5].isoformat() if r[5] else None,
            "issued_at": r[6].isoformat() if r[6] else None,
        }
        for r in rows
    ]


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
    if not body.applicant_name.strip():
        raise HTTPException(status_code=400, detail="Applicant name is required")

    with pool.connection() as conn:
        t_row = conn.execute(
            "SELECT id, name, kind, required_fields, custom_fields FROM permit_types WHERE id = %s AND is_active = TRUE",
            (body.permit_type_id,),
        ).fetchone()
        if not t_row:
            raise HTTPException(status_code=400, detail="Selected permit type not found")
        permit_kind = t_row[2] or "construction"
        req_fields = list(t_row[3]) if isinstance(t_row[3], list) else ["property_address"]
        for fld in req_fields:
            val = str(getattr(body, fld, "") or "").strip()
            if not val:
                lbl = _REQUIRED_FIELD_LABELS.get(fld, fld)
                raise HTTPException(status_code=400, detail=f"{lbl} is required for {t_row[1]}")
        custom_fields = list(t_row[4]) if isinstance(t_row[4], list) else []
        custom_data = _clean_custom_data(body.custom_data)
        _validate_custom_data(custom_fields, custom_data, t_row[1])
        u_row = conn.execute(
            "SELECT id, name, fee_amount FROM permit_uses "
            "WHERE id = %s AND permit_type_id = %s AND is_active = TRUE",
            (body.permit_use_id, body.permit_type_id),
        ).fetchone()
        if not u_row:
            raise HTTPException(status_code=400, detail="Selected permit use not found")

        project_name = body.project_name.strip()
        if body.contractor_license.strip():
            comp = _check_contractor_compliance(conn, body.contractor_license.strip())
            if comp["matched"] and not comp["compliant"]:
                raise HTTPException(
                    status_code=400,
                    detail="Contractor Compliance Gate failed: " + "; ".join(comp["issues"]),
                )
        is_mgr = has_permission(user, "permits.manage")
        for ref_id in (body.prerequisite_permit_id, body.related_permit_id):
            if ref_id is not None:
                ref_row = conn.execute(
                    "SELECT id, applicant_user_id, project_name FROM permits WHERE id = %s",
                    (ref_id,),
                ).fetchone()
                if not ref_row:
                    raise HTTPException(status_code=400, detail="Linked permit not found")
                if not is_mgr and ref_row[1] != user["id"]:
                    raise HTTPException(status_code=403, detail="Cannot link to another applicant's permit")
                if not project_name and ref_row[2]:
                    project_name = ref_row[2]

        year = datetime.now(timezone.utc).year
        temp_num = f"PRM-{year}-{uuid.uuid4().hex[:8].upper()}"
        row = conn.execute(
            "INSERT INTO permits "
            "(permit_number, applicant_user_id, applicant_username, "
            " permit_type_id, permit_use_id, permit_type_name, permit_use_name, "
            " applicant_name, applicant_email, applicant_phone, "
            " property_address, building_name, suite_name, parcel_id, owner_name, "
            " contractor_name, contractor_license, project_description, estimated_value, "
            " accepted_terms, status, fee_amount, permit_kind, project_name, custom_data) "
            "VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, TRUE, 'submitted', %s, %s, %s, %s::jsonb) "
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
                permit_kind,
                project_name,
                json.dumps(custom_data),
            ),
        ).fetchone()
        permit_id = row[0]
        final_num = f"PRM-{year}-{permit_id:04d}"
        conn.execute(
            "UPDATE permits SET permit_number = %s WHERE id = %s",
            (final_num, permit_id),
        )
        if body.prerequisite_permit_id is not None and body.prerequisite_permit_id != permit_id:
            conn.execute(
                "INSERT INTO permit_links (source_permit_id, target_permit_id, link_type) "
                "VALUES (%s, %s, 'enables') ON CONFLICT DO NOTHING",
                (body.prerequisite_permit_id, permit_id),
            )
        if body.related_permit_id is not None and body.related_permit_id != permit_id and body.related_permit_id != body.prerequisite_permit_id:
            conn.execute(
                "INSERT INTO permit_links (source_permit_id, target_permit_id, link_type) "
                "VALUES (%s, %s, 'related') ON CONFLICT DO NOTHING",
                (body.related_permit_id, permit_id),
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


@router.get("/contractors/check")
def check_contractor_license(
    license: str = "",
    _: dict = Depends(require_permission("permits.submit", "permits.manage")),
):
    with pool.connection() as conn:
        return _check_contractor_compliance(conn, license)


@router.get("/contractors")
def list_contractors(
    q: str = "",
    status: str = "",
    _: dict = Depends(require_permission("permits.manage")),
):
    ql = f"%{q.strip()}%"
    st = status.strip().lower()
    with pool.connection() as conn:
        rows = conn.execute(
            f"SELECT {_CONTRACTOR_COLS} FROM contractor_licenses "
            "WHERE (%s = '' OR status = %s) "
            "AND (%s = '%%' OR license_number ILIKE %s OR business_name ILIKE %s OR contact_name ILIKE %s OR license_type ILIKE %s) "
            "ORDER BY business_name ASC, id ASC",
            (st, st, ql, ql, ql, ql, ql),
        ).fetchall()
    return [_row_to_contractor(r) for r in rows]


@router.post("/contractors", status_code=201)
def create_contractor(body: ContractorIn, user: dict = Depends(require_permission("permits.manage"))):
    lic = body.license_number.strip()
    biz = body.business_name.strip()
    if not lic or not biz:
        raise HTTPException(status_code=400, detail="License number and business name are required")
    status = body.status.strip().lower()
    if status not in CONTRACTOR_STATUSES:
        raise HTTPException(status_code=400, detail="Invalid contractor status")
    lic_exp = _parse_optional_date(body.license_expires_at, "License expiration date")
    ins_exp = _parse_optional_date(body.insurance_expires_at, "Insurance expiration date")
    bond_exp = _parse_optional_date(body.bond_expires_at, "Bond expiration date")
    with pool.connection() as conn:
        exists = conn.execute(
            "SELECT id FROM contractor_licenses WHERE LOWER(license_number) = LOWER(%s)",
            (lic,),
        ).fetchone()
        if exists:
            raise HTTPException(status_code=409, detail=f"License number {lic} already exists")
        row = conn.execute(
            "INSERT INTO contractor_licenses "
            "(license_number, business_name, license_type, contact_name, email, phone, address, "
            " license_expires_at, insurance_carrier, insurance_policy_no, insurance_expires_at, "
            " bond_amount, bond_expires_at, status, notes) "
            "VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s) "
            f"RETURNING {_CONTRACTOR_COLS}",
            (
                lic,
                biz,
                body.license_type.strip() or "General Contractor",
                body.contact_name.strip(),
                body.email.strip(),
                body.phone.strip(),
                body.address.strip(),
                lic_exp,
                body.insurance_carrier.strip(),
                body.insurance_policy_no.strip(),
                ins_exp,
                body.bond_amount.strip(),
                bond_exp,
                status,
                body.notes.strip(),
            ),
        ).fetchone()
    record_audit(user["username"], "permits.contractor_create", f"{lic} ({biz})")
    return _row_to_contractor(row)


@router.patch("/contractors/{contractor_id}")
def update_contractor(
    contractor_id: int,
    body: ContractorPatch,
    user: dict = Depends(require_permission("permits.manage")),
):
    if body.status is not None and body.status.strip().lower() not in CONTRACTOR_STATUSES:
        raise HTTPException(status_code=400, detail="Invalid contractor status")
    with pool.connection() as conn:
        cur = conn.execute(
            f"SELECT {_CONTRACTOR_COLS} FROM contractor_licenses WHERE id = %s",
            (contractor_id,),
        ).fetchone()
        if not cur:
            raise HTTPException(status_code=404, detail="Contractor license not found")
        lic_exp = _parse_optional_date(body.license_expires_at, "License expiration date") if body.license_expires_at is not None else cur[8]
        ins_exp = _parse_optional_date(body.insurance_expires_at, "Insurance expiration date") if body.insurance_expires_at is not None else cur[11]
        bond_exp = _parse_optional_date(body.bond_expires_at, "Bond expiration date") if body.bond_expires_at is not None else cur[13]
        row = conn.execute(
            "UPDATE contractor_licenses SET "
            "license_number = COALESCE(%s, license_number), "
            "business_name = COALESCE(%s, business_name), "
            "license_type = COALESCE(%s, license_type), "
            "contact_name = COALESCE(%s, contact_name), "
            "email = COALESCE(%s, email), "
            "phone = COALESCE(%s, phone), "
            "address = COALESCE(%s, address), "
            "license_expires_at = %s, "
            "insurance_carrier = COALESCE(%s, insurance_carrier), "
            "insurance_policy_no = COALESCE(%s, insurance_policy_no), "
            "insurance_expires_at = %s, "
            "bond_amount = COALESCE(%s, bond_amount), "
            "bond_expires_at = %s, "
            "status = COALESCE(%s, status), "
            "notes = COALESCE(%s, notes), "
            "updated_at = now() "
            "WHERE id = %s "
            f"RETURNING {_CONTRACTOR_COLS}",
            (
                body.license_number.strip() if body.license_number is not None else None,
                body.business_name.strip() if body.business_name is not None else None,
                body.license_type.strip() if body.license_type is not None else None,
                body.contact_name.strip() if body.contact_name is not None else None,
                body.email.strip() if body.email is not None else None,
                body.phone.strip() if body.phone is not None else None,
                body.address.strip() if body.address is not None else None,
                lic_exp,
                body.insurance_carrier.strip() if body.insurance_carrier is not None else None,
                body.insurance_policy_no.strip() if body.insurance_policy_no is not None else None,
                ins_exp,
                body.bond_amount.strip() if body.bond_amount is not None else None,
                bond_exp,
                body.status.strip().lower() if body.status is not None else None,
                body.notes.strip() if body.notes is not None else None,
                contractor_id,
            ),
        ).fetchone()
    record_audit(user["username"], "permits.contractor_update", f"Updated contractor #{contractor_id}")
    return _row_to_contractor(row)


@router.delete("/contractors/{contractor_id}")
def delete_contractor(contractor_id: int, user: dict = Depends(require_permission("permits.manage"))):
    with pool.connection() as conn:
        row = conn.execute(
            "DELETE FROM contractor_licenses WHERE id = %s RETURNING id, license_number, business_name",
            (contractor_id,),
        ).fetchone()
        if not row:
            raise HTTPException(status_code=404, detail="Contractor license not found")
    record_audit(user["username"], "permits.contractor_delete", f"Deleted {row[1]} ({row[2]})")
    return {"deleted": True, "id": contractor_id}


# ------------------------------------------------------------------ recurring compliance / rental & fire programs

_COMP_COLS = (
    "id, program_type, property_address, parcel_id, unit_count, owner_name, "
    "local_agent_name, local_agent_phone, local_agent_email, cycle_months, "
    "last_inspected_date, next_inspection_date, last_result, inspector, "
    "certificate_number, status, notes, created_at, updated_at"
)


def _add_months(d: date, months: int) -> date:
    m_idx = (d.month - 1) + max(1, months)
    yr = d.year + (m_idx // 12)
    mo = (m_idx % 12) + 1
    day = min(d.day, [31, 29 if yr % 4 == 0 and (yr % 100 != 0 or yr % 400 == 0) else 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][mo - 1])
    return date(yr, mo, day)


def _row_to_comp_program(r) -> dict:
    today = date.today()
    next_d = r[11]
    days_until = (next_d - today).days if next_d else None
    if r[15] != "active":
        due_status = r[15]
    elif days_until is None:
        due_status = "unscheduled"
    elif days_until < 0:
        due_status = "overdue"
    elif days_until <= 30:
        due_status = "due_soon"
    else:
        due_status = "ok"
    return {
        "id": r[0],
        "program_type": r[1],
        "property_address": r[2],
        "parcel_id": r[3],
        "unit_count": r[4],
        "owner_name": r[5],
        "local_agent_name": r[6],
        "local_agent_phone": r[7],
        "local_agent_email": r[8],
        "cycle_months": r[9],
        "last_inspected_date": r[10].isoformat() if r[10] else "",
        "next_inspection_date": next_d.isoformat() if next_d else "",
        "last_result": r[12],
        "inspector": r[13],
        "certificate_number": r[14],
        "status": r[15],
        "notes": r[16],
        "due_status": due_status,
        "days_until_due": days_until,
        "created_at": r[17].isoformat() if r[17] else None,
        "updated_at": r[18].isoformat() if r[18] else None,
    }


@router.get("/compliance-programs")
def list_compliance_programs(
    q: str = "",
    program_type: str = "",
    status: str = "",
    _: dict = Depends(require_permission("permits.manage")),
):
    ql = f"%{q.strip()}%"
    pt = program_type.strip()
    st = status.strip().lower()
    with pool.connection() as conn:
        rows = conn.execute(
            f"SELECT {_COMP_COLS} FROM recurring_compliance_programs "
            "WHERE (%s = '' OR program_type = %s) "
            "AND (%s = '' OR status = %s) "
            "AND (%s = '%%' OR property_address ILIKE %s OR owner_name ILIKE %s OR local_agent_name ILIKE %s OR parcel_id ILIKE %s OR certificate_number ILIKE %s) "
            "ORDER BY next_inspection_date ASC NULLS LAST, id DESC",
            (pt, pt, st, st, ql, ql, ql, ql, ql, ql),
        ).fetchall()
    return [_row_to_comp_program(r) for r in rows]


@router.post("/compliance-programs", status_code=201)
def create_compliance_program(body: ComplianceProgramIn, user: dict = Depends(require_permission("permits.manage"))):
    addr = body.property_address.strip()
    if not addr:
        raise HTTPException(status_code=400, detail="Property address is required")
    st = body.status.strip().lower()
    if st not in COMPLIANCE_PROGRAM_STATUSES:
        raise HTTPException(status_code=400, detail="Invalid status")
    res = body.last_result.strip().lower()
    if res not in COMPLIANCE_RESULTS:
        raise HTTPException(status_code=400, detail="Invalid inspection result")
    last_d = _parse_optional_date(body.last_inspected_date, "Last inspected date")
    next_d = _parse_optional_date(body.next_inspection_date, "Next inspection date")
    with pool.connection() as conn:
        row = conn.execute(
            "INSERT INTO recurring_compliance_programs "
            "(program_type, property_address, parcel_id, unit_count, owner_name, "
            " local_agent_name, local_agent_phone, local_agent_email, cycle_months, "
            " last_inspected_date, next_inspection_date, last_result, inspector, "
            " certificate_number, status, notes) "
            "VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s) "
            f"RETURNING {_COMP_COLS}",
            (
                body.program_type.strip() or "Rental Housing",
                addr,
                body.parcel_id.strip(),
                max(1, body.unit_count),
                body.owner_name.strip(),
                body.local_agent_name.strip(),
                body.local_agent_phone.strip(),
                body.local_agent_email.strip(),
                max(1, body.cycle_months),
                last_d,
                next_d,
                res,
                body.inspector.strip(),
                body.certificate_number.strip(),
                st,
                body.notes.strip(),
            ),
        ).fetchone()
    record_audit(user["username"], "permits.compliance_create", f"{body.program_type}: {addr}")
    return _row_to_comp_program(row)


@router.patch("/compliance-programs/{prog_id}")
def update_compliance_program(
    prog_id: int,
    body: ComplianceProgramPatch,
    user: dict = Depends(require_permission("permits.manage")),
):
    if body.status is not None and body.status.strip().lower() not in COMPLIANCE_PROGRAM_STATUSES:
        raise HTTPException(status_code=400, detail="Invalid status")
    if body.last_result is not None and body.last_result.strip().lower() not in COMPLIANCE_RESULTS:
        raise HTTPException(status_code=400, detail="Invalid inspection result")
    with pool.connection() as conn:
        cur = conn.execute(f"SELECT {_COMP_COLS} FROM recurring_compliance_programs WHERE id = %s", (prog_id,)).fetchone()
        if not cur:
            raise HTTPException(status_code=404, detail="Compliance program not found")
        last_d = _parse_optional_date(body.last_inspected_date, "Last inspected date") if body.last_inspected_date is not None else cur[10]
        next_d = _parse_optional_date(body.next_inspection_date, "Next inspection date") if body.next_inspection_date is not None else cur[11]
        row = conn.execute(
            "UPDATE recurring_compliance_programs SET "
            "program_type = COALESCE(%s, program_type), "
            "property_address = COALESCE(%s, property_address), "
            "parcel_id = COALESCE(%s, parcel_id), "
            "unit_count = COALESCE(%s, unit_count), "
            "owner_name = COALESCE(%s, owner_name), "
            "local_agent_name = COALESCE(%s, local_agent_name), "
            "local_agent_phone = COALESCE(%s, local_agent_phone), "
            "local_agent_email = COALESCE(%s, local_agent_email), "
            "cycle_months = COALESCE(%s, cycle_months), "
            "last_inspected_date = %s, "
            "next_inspection_date = %s, "
            "last_result = COALESCE(%s, last_result), "
            "inspector = COALESCE(%s, inspector), "
            "certificate_number = COALESCE(%s, certificate_number), "
            "status = COALESCE(%s, status), "
            "notes = COALESCE(%s, notes), "
            "updated_at = now() "
            f"WHERE id = %s RETURNING {_COMP_COLS}",
            (
                body.program_type.strip() if body.program_type is not None else None,
                body.property_address.strip() if body.property_address is not None else None,
                body.parcel_id.strip() if body.parcel_id is not None else None,
                max(1, body.unit_count) if body.unit_count is not None else None,
                body.owner_name.strip() if body.owner_name is not None else None,
                body.local_agent_name.strip() if body.local_agent_name is not None else None,
                body.local_agent_phone.strip() if body.local_agent_phone is not None else None,
                body.local_agent_email.strip() if body.local_agent_email is not None else None,
                max(1, body.cycle_months) if body.cycle_months is not None else None,
                last_d,
                next_d,
                body.last_result.strip().lower() if body.last_result is not None else None,
                body.inspector.strip() if body.inspector is not None else None,
                body.certificate_number.strip() if body.certificate_number is not None else None,
                body.status.strip().lower() if body.status is not None else None,
                body.notes.strip() if body.notes is not None else None,
                prog_id,
            ),
        ).fetchone()
    record_audit(user["username"], "permits.compliance_update", f"Updated compliance program #{prog_id}")
    return _row_to_comp_program(row)


@router.post("/compliance-programs/{prog_id}/record-inspection")
def record_compliance_inspection(
    prog_id: int,
    body: ComplianceRecordInspectionIn,
    user: dict = Depends(require_permission("permits.manage")),
):
    res = body.result.strip().lower()
    if res not in ("passed", "failed", "conditional"):
        raise HTTPException(status_code=400, detail="Result must be passed, failed, or conditional")
    insp_d = _parse_optional_date(body.inspected_date, "Inspection date") or date.today()
    with pool.connection() as conn:
        cur = conn.execute(f"SELECT {_COMP_COLS} FROM recurring_compliance_programs WHERE id = %s", (prog_id,)).fetchone()
        if not cur:
            raise HTTPException(status_code=404, detail="Compliance program not found")
        cycle_months = cur[9] or 12
        next_d = _add_months(insp_d, cycle_months) if res == "passed" else (insp_d + timedelta(days=30))
        next_status = "active" if res == "passed" else ("non_compliant" if res == "failed" else cur[15])
        cert_no = cur[14] or (f"CMP-{insp_d.year}-{prog_id:04d}" if res == "passed" else "")
        notes_val = body.notes.strip() if body.notes.strip() else cur[16]
        row = conn.execute(
            "UPDATE recurring_compliance_programs SET "
            "last_inspected_date = %s, next_inspection_date = %s, last_result = %s, "
            "inspector = %s, status = %s, certificate_number = %s, notes = %s, updated_at = now() "
            f"WHERE id = %s RETURNING {_COMP_COLS}",
            (insp_d, next_d, res, body.inspector.strip() or user["username"], next_status, cert_no, notes_val, prog_id),
        ).fetchone()
    record_audit(user["username"], "permits.compliance_inspect", f"Program #{prog_id} -> {res}")
    return _row_to_comp_program(row)


@router.get("/compliance-programs/{prog_id}/certificate")
def get_compliance_certificate_pdf(
    prog_id: int,
    _: dict = Depends(require_permission("permits.manage")),
):
    with pool.connection() as conn:
        row = conn.execute(f"SELECT {_COMP_COLS} FROM recurring_compliance_programs WHERE id = %s", (prog_id,)).fetchone()
        if not row:
            raise HTTPException(status_code=404, detail="Compliance program not found")
    p = _row_to_comp_program(row)
    buf = io.BytesIO()
    doc = SimpleDocTemplate(buf, pagesize=letter, leftMargin=54, rightMargin=54, topMargin=54, bottomMargin=54)
    styles = getSampleStyleSheet()
    cert_num = p["certificate_number"] or f"PROG-{p['id']}"
    story = [
        Paragraph(f"<b>CERTIFICATE OF COMPLIANCE — {_xml_escape(p['program_type'].upper())}</b>", styles["Title"]),
        Paragraph(f"Certificate Number: <b>{_xml_escape(cert_num)}</b>", styles["Normal"]),
        Spacer(1, 12),
    ]
    tbl_rows = [
        ["Program Type", p["program_type"]],
        ["Property Address", p["property_address"]],
        ["Parcel ID / Units", f"{p['parcel_id'] or '—'} / {p['unit_count']} unit(s)"],
        ["Property Owner", p["owner_name"] or "—"],
        ["Local Agent", f"{p['local_agent_name'] or '—'} ({p['local_agent_phone'] or '—'})"],
        ["Last Inspection", f"{p['last_inspected_date'] or '—'} ({p['last_result'].title()})"],
        ["Inspector", p["inspector"] or "—"],
        ["Next Inspection Due", p["next_inspection_date"] or "—"],
        ["Status", p["status"].replace("_", " ").title()],
    ]
    tbl = Table(tbl_rows, colWidths=[150, 350])
    tbl.setStyle(TableStyle([
        ("GRID", (0, 0), (-1, -1), 0.5, colors.grey),
        ("BACKGROUND", (0, 0), (0, -1), colors.HexColor("#eef2f6")),
        ("FONTNAME", (0, 0), (0, -1), "Helvetica-Bold"),
        ("PADDING", (0, 0), (-1, -1), 6),
    ]))
    story.extend([tbl, Spacer(1, 18), Paragraph("Authorized Municipal Inspector: _______________________________", styles["Normal"])])
    doc.build(story)
    return Response(
        content=buf.getvalue(),
        media_type="application/pdf",
        headers={"Content-Disposition": f'inline; filename="compliance-{p["id"]}.pdf"'},
    )


@router.delete("/compliance-programs/{prog_id}")
def delete_compliance_program(prog_id: int, user: dict = Depends(require_permission("permits.manage"))):
    with pool.connection() as conn:
        row = conn.execute(
            "DELETE FROM recurring_compliance_programs WHERE id = %s RETURNING id, property_address",
            (prog_id,),
        ).fetchone()
        if not row:
            raise HTTPException(status_code=404, detail="Compliance program not found")
    record_audit(user["username"], "permits.compliance_delete", f"Deleted compliance program #{prog_id}: {row[1]}")
    return {"deleted": True, "id": prog_id}


def _parse_money_dollars(raw: str) -> float:
    cleaned = re.sub(r"[^0-9.]", "", str(raw or ""))
    if not cleaned:
        return 0.0
    try:
        return float(cleaned)
    except ValueError:
        return 0.0


def _build_operational_report(conn) -> dict:
    p_rows = conn.execute(
        "SELECT id, status, permit_type_name, estimated_value, created_at, issued_at, planning_data "
        "FROM permits ORDER BY id ASC"
    ).fetchall()
    by_status: dict[str, int] = {}
    by_type: dict[str, int] = {}
    by_month: dict[str, dict[str, Any]] = {}
    turnaround_days: list[float] = []
    total_est_value = 0.0
    stat_overdue = 0
    stat_warning = 0

    for pr in p_rows:
        st = pr[1] or "submitted"
        by_status[st] = by_status.get(st, 0) + 1
        pt = pr[2] or "Other"
        by_type[pt] = by_type.get(pt, 0) + 1
        val = _parse_money_dollars(pr[3])
        total_est_value += val
        if pr[4]:
            ym = pr[4].strftime("%Y-%m")
            bucket = by_month.setdefault(ym, {"month": ym, "count": 0, "estimated_value": 0.0})
            bucket["count"] += 1
            bucket["estimated_value"] += val
        if pr[4] and pr[5]:
            turnaround_days.append(max(0.0, (pr[5] - pr[4]).total_seconds() / 86400.0))
        sc = _compute_statutory_clock(pr[6] if isinstance(pr[6], dict) else {}, st)
        if sc["urgency"] == "overdue":
            stat_overdue += 1
        elif sc["urgency"] == "warning":
            stat_warning += 1

    fee_rows = conn.execute("SELECT entry_type, amount_cents FROM permit_fee_entries").fetchall()
    fees_assessed = sum(r[1] for r in fee_rows if r[0] == "fee")
    waivers = sum(r[1] for r in fee_rows if r[0] == "waiver")
    payments = sum(r[1] for r in fee_rows if r[0] == "payment")
    escrow_dep = sum(r[1] for r in fee_rows if r[0] == "escrow_deposit")
    escrow_ref = sum(r[1] for r in fee_rows if r[0] == "escrow_refund")

    insp_rows = conn.execute("SELECT result, COUNT(*) FROM permit_inspections GROUP BY result").fetchall()
    insp_by_result = {r[0]: int(r[1]) for r in insp_rows}

    ctr_rows = conn.execute(f"SELECT {_CONTRACTOR_COLS} FROM contractor_licenses").fetchall()
    ctrs = [_row_to_contractor(r) for r in ctr_rows]

    comp_rows = conn.execute(f"SELECT {_COMP_COLS} FROM recurring_compliance_programs").fetchall()
    comps = [_row_to_comp_program(r) for r in comp_rows]

    code_enf = {"total": 0, "open": 0, "overdue": 0}
    try:
        today_s = date.today().isoformat()
        ce_rows = conn.execute(
            "SELECT status, nov_compliance_deadline, reinspection_date FROM complaints"
        ).fetchall()
        code_enf["total"] = len(ce_rows)
        for cr in ce_rows:
            if cr[0] not in ("resolved", "dismissed"):
                code_enf["open"] += 1
                if (cr[1] and cr[1] < today_s) or (cr[2] and cr[2] < today_s):
                    code_enf["overdue"] += 1
    except Exception:
        pass

    return {
        "permits": {
            "total": len(p_rows),
            "open": sum(v for k, v in by_status.items() if k not in ("issued", "denied", "closed")),
            "issued": by_status.get("issued", 0) + by_status.get("closed", 0),
            "avg_turnaround_days": round(sum(turnaround_days) / len(turnaround_days), 1) if turnaround_days else None,
            "total_estimated_value": round(total_est_value, 2),
            "by_status": [{"status": k, "count": v} for k, v in sorted(by_status.items())],
            "by_type": [{"type": k, "count": v} for k, v in sorted(by_type.items(), key=lambda x: -x[1])],
            "by_month": [by_month[k] for k in sorted(by_month.keys())[-12:]],
            "statutory_overdue": stat_overdue,
            "statutory_warning": stat_warning,
        },
        "revenue": {
            "fees_assessed_cents": fees_assessed,
            "waivers_cents": waivers,
            "payments_cents": payments,
            "balance_due_cents": max(0, fees_assessed - waivers - payments),
            "escrow_deposited_cents": escrow_dep,
            "escrow_refunded_cents": escrow_ref,
            "escrow_held_cents": max(0, escrow_dep - escrow_ref),
        },
        "inspections": {
            "scheduled": insp_by_result.get("scheduled", 0),
            "passed": insp_by_result.get("passed", 0),
            "failed": insp_by_result.get("failed", 0),
            "partial": insp_by_result.get("partial", 0),
        },
        "contractors": {
            "total": len(ctrs),
            "compliant": sum(1 for c in ctrs if c["compliant"]),
            "blocked": sum(1 for c in ctrs if not c["compliant"]),
            "expiring_soon": sum(1 for c in ctrs if c["expiring_soon"]),
        },
        "compliance_programs": {
            "total": len(comps),
            "overdue": sum(1 for c in comps if c["due_status"] == "overdue"),
            "due_soon": sum(1 for c in comps if c["due_status"] == "due_soon"),
            "ok": sum(1 for c in comps if c["due_status"] == "ok"),
        },
        "code_enforcement": code_enf,
    }


@router.get("/reports/summary")
def get_operational_report(_: dict = Depends(require_permission("permits.manage"))):
    with pool.connection() as conn:
        return _build_operational_report(conn)


@router.get("/reports/summary.csv")
def export_operational_report_csv(_: dict = Depends(require_permission("permits.manage"))):
    with pool.connection() as conn:
        rep = _build_operational_report(conn)
    buf = io.StringIO()
    w = csv.writer(buf)
    w.writerow(["Category", "Metric", "Value"])
    p = rep["permits"]
    w.writerow(["Permits", "Total Permits", p["total"]])
    w.writerow(["Permits", "Open Permits", p["open"]])
    w.writerow(["Permits", "Issued / Closed Permits", p["issued"]])
    w.writerow(["Permits", "Avg Turnaround (Days)", p["avg_turnaround_days"] if p["avg_turnaround_days"] is not None else ""])
    w.writerow(["Permits", "Total Estimated Valuation ($)", f"{p['total_estimated_value']:.2f}"])
    rv = rep["revenue"]
    w.writerow(["Revenue", "Fees Assessed ($)", f"{rv['fees_assessed_cents'] / 100:.2f}"])
    w.writerow(["Revenue", "Payments Collected ($)", f"{rv['payments_cents'] / 100:.2f}"])
    w.writerow(["Revenue", "Waivers ($)", f"{rv['waivers_cents'] / 100:.2f}"])
    w.writerow(["Revenue", "Balance Due ($)", f"{rv['balance_due_cents'] / 100:.2f}"])
    w.writerow(["Revenue", "Escrow Held ($)", f"{rv['escrow_held_cents'] / 100:.2f}"])
    ins = rep["inspections"]
    w.writerow(["Inspections", "Scheduled", ins["scheduled"]])
    w.writerow(["Inspections", "Passed", ins["passed"]])
    w.writerow(["Inspections", "Failed", ins["failed"]])
    ct = rep["contractors"]
    w.writerow(["Contractors", "Compliant", ct["compliant"]])
    w.writerow(["Contractors", "Blocked / Non-Compliant", ct["blocked"]])
    cp = rep["compliance_programs"]
    w.writerow(["Recurring Compliance", "Overdue", cp["overdue"]])
    w.writerow(["Recurring Compliance", "Due <= 30d", cp["due_soon"]])
    ce = rep["code_enforcement"]
    w.writerow(["Code Enforcement", "Open Cases", ce["open"]])
    w.writerow(["Code Enforcement", "Overdue Deadlines", ce["overdue"]])
    return Response(
        content=buf.getvalue(),
        media_type="text/csv; charset=utf-8",
        headers={"Content-Disposition": 'attachment; filename="civicdesk-operational-report.csv"'},
    )


@router.get("/parcels/profile")
def get_property_profile(
    parcel_id: str = "",
    address: str = "",
    _: dict = Depends(require_permission("permits.manage")),
):
    """Unified Property / Parcel 360° view linking Permits, Inspections, Compliance Programs, and Code Enforcement."""
    pid = parcel_id.strip()
    addr = address.strip()
    if not pid and not addr:
        raise HTTPException(status_code=400, detail="Provide parcel_id or address")

    addr_like = f"%{addr}%" if addr else ""
    with pool.connection() as conn:
        parcel_row = None
        if pid:
            parcel_row = conn.execute(
                "SELECT id, parcel_id, address, building_name, suite_name, owner_name, lot, block, section, notes "
                "FROM permit_parcels WHERE LOWER(parcel_id) = LOWER(%s) LIMIT 1",
                (pid,),
            ).fetchone()
        if not parcel_row and addr:
            parcel_row = conn.execute(
                "SELECT id, parcel_id, address, building_name, suite_name, owner_name, lot, block, section, notes "
                "FROM permit_parcels WHERE address ILIKE %s ORDER BY id ASC LIMIT 1",
                (addr_like,),
            ).fetchone()

        eff_pid = pid or (parcel_row[1] if parcel_row else "")
        eff_addr = addr or (parcel_row[2] if parcel_row else "")
        eff_addr_like = f"%{eff_addr}%" if eff_addr else ""

        p_clauses = []
        p_params: list = []
        if eff_pid:
            p_clauses.append("LOWER(parcel_id) = LOWER(%s)")
            p_params.append(eff_pid)
        if eff_addr_like:
            p_clauses.append("property_address ILIKE %s")
            p_params.append(eff_addr_like)

        permits_rows = conn.execute(
            "SELECT id, permit_number, permit_type_name, permit_use_name, status, "
            "       applicant_name, contractor_name, contractor_license, property_address, "
            "       parcel_id, estimated_value, fee_amount, payment_status, created_at, issued_at "
            f"FROM permits WHERE ({' OR '.join(p_clauses)}) ORDER BY id DESC",
            p_params,
        ).fetchall() if p_clauses else []

        permit_ids = [r[0] for r in permits_rows]
        insp_rows = conn.execute(
            "SELECT i.id, i.permit_id, p.permit_number, i.inspection_type, i.scheduled_date, "
            "       i.inspector, i.result, i.notes, i.completed_at "
            "FROM permit_inspections i JOIN permits p ON p.id = i.permit_id "
            "WHERE i.permit_id = ANY(%s) ORDER BY i.id DESC",
            (permit_ids,),
        ).fetchall() if permit_ids else []

        comp_clauses = []
        comp_params: list = []
        if eff_pid:
            comp_clauses.append("LOWER(parcel_id) = LOWER(%s)")
            comp_params.append(eff_pid)
        if eff_addr_like:
            comp_clauses.append("property_address ILIKE %s")
            comp_params.append(eff_addr_like)
        comp_rows = conn.execute(
            f"SELECT {_COMP_COLS} FROM recurring_compliance_programs "
            f"WHERE ({' OR '.join(comp_clauses)}) ORDER BY id DESC",
            comp_params,
        ).fetchall() if comp_clauses else []

        code_cases: list[dict] = []
        if eff_addr_like:
            try:
                ce_rows = conn.execute(
                    "SELECT id, complaint_number, subject_property_address, ordinance_section, "
                    "       status, enforcement_stage, nov_compliance_deadline, reinspection_date, "
                    "       citation_amount, conduct_description, created_at "
                    "FROM complaints WHERE subject_property_address ILIKE %s ORDER BY id DESC",
                    (eff_addr_like,),
                ).fetchall()
                for cr in ce_rows:
                    code_cases.append({
                        "id": cr[0],
                        "complaint_number": cr[1],
                        "subject_property_address": cr[2],
                        "ordinance_section": cr[3],
                        "status": cr[4],
                        "enforcement_stage": cr[5] or "intake",
                        "nov_compliance_deadline": cr[6] or "",
                        "reinspection_date": cr[7] or "",
                        "citation_amount": cr[8] or "",
                        "conduct_description": cr[9] or "",
                        "created_at": cr[10].isoformat() if cr[10] else None,
                    })
            except Exception:
                pass

    return {
        "parcel": (
            {
                "id": parcel_row[0],
                "parcel_id": parcel_row[1],
                "address": parcel_row[2],
                "building_name": parcel_row[3],
                "suite_name": parcel_row[4],
                "owner_name": parcel_row[5],
                "lot": parcel_row[6],
                "block": parcel_row[7],
                "section": parcel_row[8],
                "notes": parcel_row[9],
            }
            if parcel_row
            else {
                "id": None,
                "parcel_id": eff_pid,
                "address": eff_addr,
                "building_name": "",
                "suite_name": "",
                "owner_name": "",
                "lot": "",
                "block": "",
                "section": "",
                "notes": "",
            }
        ),
        "permits": [
            {
                "id": r[0],
                "permit_number": r[1],
                "permit_type_name": r[2],
                "permit_use_name": r[3],
                "status": r[4],
                "applicant_name": r[5],
                "contractor_name": r[6],
                "contractor_license": r[7],
                "property_address": r[8],
                "parcel_id": r[9],
                "estimated_value": r[10],
                "fee_amount": r[11],
                "payment_status": r[12],
                "created_at": r[13].isoformat() if r[13] else None,
                "issued_at": r[14].isoformat() if r[14] else None,
            }
            for r in permits_rows
        ],
        "inspections": [
            {
                "id": r[0],
                "permit_id": r[1],
                "permit_number": r[2],
                "inspection_type": r[3],
                "scheduled_date": r[4],
                "inspector": r[5],
                "result": r[6],
                "notes": r[7],
                "completed_at": r[8].isoformat() if r[8] else None,
            }
            for r in insp_rows
        ],
        "compliance_programs": [_row_to_comp_program(r) for r in comp_rows],
        "code_enforcement": code_cases,
    }


@router.post("/contractors/send-reminders")
def send_contractor_renewal_reminders(
    request: Request,
    user: dict = Depends(require_permission("permits.manage")),
):
    """Send renewal reminder emails to contractors whose license, COI, or bond expires within 30 days or is expired."""
    with pool.connection() as conn:
        rows = conn.execute(f"SELECT {_CONTRACTOR_COLS} FROM contractor_licenses").fetchall()
    ctrs = [_row_to_contractor(r) for r in rows]
    sent: list[str] = []
    skipped = 0
    for c in ctrs:
        if c["compliant"] and not c["expiring_soon"]:
            continue
        email = (c.get("email") or "").strip()
        if not email:
            skipped += 1
            continue
        issues_txt = "; ".join(c["compliance_issues"]) if c["compliance_issues"] else "Credential expiring within 30 days"
        send_direct_email(
            [email],
            f"[CivicDesk] Contractor License / COI Renewal Reminder ({c['license_number']})",
            f"Hello {c['contact_name'] or c['business_name']},\n\n"
            f"Our municipal licensing records show an upcoming or expired credential for {c['business_name']} ({c['license_number']}):\n"
            f"- Status: {issues_txt}\n"
            f"- License Expiration: {c['license_expires_at'] or '—'}\n"
            f"- Insurance Expiration: {c['insurance_expires_at'] or '—'}\n\n"
            "Please submit updated documentation to City Hall to maintain permit eligibility.",
            link_path="/portal",
            request=request,
        )
        sent.append(email)
    record_audit(user["username"], "permits.contractor_reminders", f"Sent {len(sent)} contractor reminder(s)")
    return {"sent_count": len(sent), "skipped_count": skipped, "recipients": sent}


@router.post("/compliance-programs/send-reminders")
def send_compliance_program_reminders(
    request: Request,
    user: dict = Depends(require_permission("permits.manage")),
):
    """Send inspection renewal reminders to property owners/agents due within 30 days or overdue."""
    with pool.connection() as conn:
        rows = conn.execute(f"SELECT {_COMP_COLS} FROM recurring_compliance_programs WHERE status = 'active'").fetchall()
    progs = [_row_to_comp_program(r) for r in rows]
    sent: list[str] = []
    skipped = 0
    for p in progs:
        if p["due_status"] not in ("overdue", "due_soon"):
            continue
        email = (p.get("local_agent_email") or "").strip()
        if not email:
            skipped += 1
            continue
        send_direct_email(
            [email],
            f"[CivicDesk] {p['program_type']} Inspection Due — {p['property_address']}",
            f"Hello {p['local_agent_name'] or p['owner_name'] or 'Property Representative'},\n\n"
            f"This is a reminder that your {p['program_type']} compliance inspection for {p['property_address']} "
            f"is {p['due_status'].replace('_', ' ')} (Due Date: {p['next_inspection_date'] or 'TBD'}).\n\n"
            "Please contact City Hall to schedule your inspection.",
            link_path="/portal",
            request=request,
        )
        sent.append(email)
    record_audit(user["username"], "permits.compliance_reminders", f"Sent {len(sent)} compliance reminder(s)")
    return {"sent_count": len(sent), "skipped_count": skipped, "recipients": sent}


@router.get("/parcels/map")
def get_parcels_map(_: dict = Depends(require_permission("permits.manage"))):
    """Return registered parcels with coordinates, zoning, and permit/code counts for the interactive SVG GIS viewer."""
    with pool.connection() as conn:
        rows = conn.execute(
            "SELECT id, parcel_id, address, owner_name, zoning_district, latitude, longitude "
            "FROM permit_parcels ORDER BY id ASC"
        ).fetchall()
        p_counts: dict[str, int] = {}
        for pr in conn.execute("SELECT parcel_id, property_address FROM permits WHERE status NOT IN ('closed','denied')").fetchall():
            if pr[0]:
                p_counts[pr[0].lower()] = p_counts.get(pr[0].lower(), 0) + 1
            if pr[1]:
                p_counts[pr[1].lower()] = p_counts.get(pr[1].lower(), 0) + 1
        ce_counts: dict[str, int] = {}
        try:
            for cr in conn.execute("SELECT subject_property_address FROM complaints WHERE status NOT IN ('resolved','dismissed')").fetchall():
                if cr[0]:
                    ce_counts[cr[0].lower()] = ce_counts.get(cr[0].lower(), 0) + 1
        except Exception:
            pass
    out = []
    for r in rows:
        pid = r[1] or ""
        addr = r[2] or ""
        out.append({
            "id": r[0],
            "parcel_id": pid,
            "address": addr,
            "owner_name": r[3] or "",
            "zoning_district": r[4] or "",
            "latitude": r[5],
            "longitude": r[6],
            "active_permits": p_counts.get(pid.lower(), 0) or p_counts.get(addr.lower(), 0),
            "open_code_cases": ce_counts.get(addr.lower(), 0),
        })
    return out


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
    inspection_id: int | None = Form(None),
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
    obj_key = tenant_object_key(f"permits/{permit_id}/{uuid.uuid4().hex[:12]}_{safe_name}")
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
            "(permit_id, doc_category, title, filename, content_type, size_bytes, sha256, object_key, uploaded_by, inspection_id) "
            "VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s)",
            (permit_id, clean_cat, clean_title, orig_name, ctype, len(raw), sha, obj_key, user["username"], inspection_id),
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
        ["Project Name", permit.get("project_name") or "—"],
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
    custom_data = permit.get("custom_data") or {}
    if custom_data:
        with pool.connection() as conn:
            cf_row = conn.execute("SELECT custom_fields FROM permit_types WHERE id = %s", (permit["permit_type_id"],)).fetchone()
        cf_defs = list(cf_row[0]) if cf_row and isinstance(cf_row[0], list) else []
        cf_by_key = {f.get("key"): f for f in cf_defs if isinstance(f, dict) and f.get("key")}
        ordered_keys = [f["key"] for f in cf_defs if isinstance(f, dict) and f.get("key") in custom_data]
        for k in custom_data:
            if k not in ordered_keys:
                ordered_keys.append(k)
        if ordered_keys:
            story.extend([Spacer(1, 12), Paragraph("<b>Supplemental Application Details</b>", styles["Heading3"])])
            for k in ordered_keys:
                fdef = cf_by_key.get(k, {})
                lbl = fdef.get("label") or k.replace("_", " ").title()
                ftype = fdef.get("type") or "text"
                val = custom_data.get(k)
                if ftype == "yes_no_explain" and isinstance(val, dict):
                    ans = str(val.get("answer") or "—").upper()
                    exp = str(val.get("explanation") or "").strip()
                    story.append(Paragraph(f"<b>{_xml_escape(lbl)}:</b> {_xml_escape(ans)}", styles["Normal"]))
                    if exp:
                        story.append(Paragraph(_xml_escape(exp), styles["Normal"]))
                    story.append(Spacer(1, 4))
                elif ftype == "impervious_table" and isinstance(val, dict):
                    story.append(Paragraph(f"<b>{_xml_escape(lbl)}</b>", styles["Normal"]))
                    row_names = fdef.get("rows") or list(val.keys())
                    t_rows = [["Surface", "Existing (sq ft)", "Proposed (sq ft)", "Change (sq ft)"]]
                    for rname in row_names:
                        rv = val.get(rname) if isinstance(val.get(rname), dict) else {}
                        t_rows.append([
                            str(rname),
                            str(rv.get("existing") or "—"),
                            str(rv.get("proposed") or "—"),
                            str(rv.get("change") or "—"),
                        ])
                    ct = Table(t_rows, colWidths=[200, 100, 100, 100])
                    ct.setStyle(TableStyle([
                        ("GRID", (0, 0), (-1, -1), 0.5, colors.grey),
                        ("BACKGROUND", (0, 0), (-1, 0), colors.HexColor("#f1f5f9")),
                        ("FONTNAME", (0, 0), (-1, 0), "Helvetica-Bold"),
                        ("PADDING", (0, 0), (-1, -1), 4),
                    ]))
                    story.append(ct)
                    story.append(Spacer(1, 6))
                else:
                    story.append(Paragraph(f"<b>{_xml_escape(lbl)}:</b> {_xml_escape(str(val or '—'))}", styles["Normal"]))
                    story.append(Spacer(1, 4))
    if permit.get("linked_permits"):
        story.extend([Spacer(1, 12), Paragraph("<b>Linked / Project Permits</b>", styles["Heading3"])])
        for lp in permit["linked_permits"]:
            rel_lbl = "Prerequisite" if lp["direction"] == "prerequisite" else ("Enables" if lp["direction"] == "enables" else "Related")
            story.append(Paragraph(
                f"• [{rel_lbl}] {_xml_escape(str(lp['permit_number']))} — {_xml_escape(str(lp['permit_type_name']))} ({_xml_escape(str(lp['status']))})",
                styles["Normal"],
            ))
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


@router.get("/{permit_id}/certificate-of-occupancy")
def get_certificate_of_occupancy(
    permit_id: int,
    force: bool = False,
    user: dict = Depends(require_permission("permits.submit", "permits.manage")),
):
    with pool.connection() as conn:
        permit = _get_permit_or_404(conn, permit_id)
    _check_permit_access(permit, user)
    if permit["status"] not in ("issued", "closed"):
        raise HTTPException(
            status_code=400,
            detail="Certificate of Occupancy / Completion is only available after a permit is Issued or Closed.",
        )
    insps = permit.get("inspections") or []
    is_mgr = has_permission(user, "permits.manage")
    open_or_failed = [i for i in insps if i["result"] in ("failed", "scheduled", "partial")]
    if open_or_failed and not (is_mgr and force):
        raise HTTPException(
            status_code=400,
            detail="All active inspections must pass before issuing Certificate of Occupancy / Completion.",
        )

    buf = io.BytesIO()
    doc = SimpleDocTemplate(buf, pagesize=letter, leftMargin=54, rightMargin=54, topMargin=54, bottomMargin=54)
    styles = getSampleStyleSheet()
    story = [
        Paragraph("<b>CERTIFICATE OF OCCUPANCY &amp; COMPLETION</b>", styles["Title"]),
        Paragraph(f"Permit Number: <b>{_xml_escape(str(permit['permit_number'] or ''))}</b>", styles["Normal"]),
        Spacer(1, 10),
        Paragraph(
            "This certifies that the work described under the permit below has been inspected and found to be in "
            "substantial compliance with applicable municipal ordinances and building codes.",
            styles["Normal"],
        ),
        Spacer(1, 12),
    ]
    rows = [
        ["Property Address", permit["property_address"] or "—"],
        ["Parcel ID / Owner", f"{permit['parcel_id'] or '—'} / {permit['owner_name'] or '—'}"],
        ["Applicant", permit["applicant_name"] or "—"],
        ["Permit Type / Use", f"{permit['permit_type_name']} — {permit['permit_use_name']}"],
        ["Contractor", f"{permit['contractor_name'] or '—'} (Lic: {permit['contractor_license'] or '—'})"],
        ["Permit Issued", (permit["issued_at"] or "")[:10] or "—"],
        ["Certificate Date", date.today().isoformat()],
    ]
    tbl = Table(rows, colWidths=[145, 355])
    tbl.setStyle(TableStyle([
        ("GRID", (0, 0), (-1, -1), 0.5, colors.grey),
        ("BACKGROUND", (0, 0), (0, -1), colors.HexColor("#eef2f6")),
        ("FONTNAME", (0, 0), (0, -1), "Helvetica-Bold"),
        ("VALIGN", (0, 0), (-1, -1), "TOP"),
        ("PADDING", (0, 0), (-1, -1), 6),
    ]))
    story.extend([tbl, Spacer(1, 14)])

    passed = [i for i in insps if i["result"] == "passed"]
    if passed:
        story.append(Paragraph("<b>Completed &amp; Passed Inspections</b>", styles["Heading2"]))
        insp_tbl_rows = [["Inspection Type", "Date", "Inspector", "Notes"]]
        for i in passed:
            insp_tbl_rows.append([
                i["inspection_type"],
                (i["completed_at"] or i["scheduled_date"] or "—")[:10],
                i["inspector"] or "—",
                i["notes"] or "Passed",
            ])
        itbl = Table(insp_tbl_rows, colWidths=[150, 85, 110, 155])
        itbl.setStyle(TableStyle([
            ("GRID", (0, 0), (-1, -1), 0.5, colors.grey),
            ("BACKGROUND", (0, 0), (-1, 0), colors.HexColor("#1e3a5f")),
            ("TEXTCOLOR", (0, 0), (-1, 0), colors.white),
            ("FONTNAME", (0, 0), (-1, 0), "Helvetica-Bold"),
            ("VALIGN", (0, 0), (-1, -1), "TOP"),
            ("PADDING", (0, 0), (-1, -1), 5),
        ]))
        story.extend([itbl, Spacer(1, 18)])

    story.append(Paragraph("Authorized Municipal Official: _______________________________   Date: _______________", styles["Normal"]))
    doc.build(story)
    return Response(
        content=buf.getvalue(),
        media_type="application/pdf",
        headers={"Content-Disposition": f'inline; filename="{permit["permit_number"]}-certificate.pdf"'},
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
        eff_license = (
            body.contractor_license.strip()
            if body.contractor_license is not None
            else (cur.get("contractor_license") or "").strip()
        )
        if next_status == "issued" and eff_license and not body.override_compliance:
            comp = _check_contractor_compliance(conn, eff_license)
            if comp["matched"] and not comp["compliant"]:
                raise HTTPException(
                    status_code=400,
                    detail="Contractor Compliance Gate failed before issuance: " + "; ".join(comp["issues"]),
                )
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
        elif next_status == "issued" and not cur.get("expires_at") and cur.get("permit_type_id"):
            rule_row = conn.execute(
                "SELECT expiration_rule FROM permit_types WHERE id = %s",
                (cur["permit_type_id"],),
            ).fetchone()
            rule = rule_row[0] if rule_row else "none"
            if rule == "calendar_year":
                exp_clause = ", expires_at = %s"
                exp_params = (f"{date.today().year}-12-31",)
            elif rule == "one_year":
                exp_clause = ", expires_at = %s"
                exp_params = ((date.today() + timedelta(days=365)).isoformat(),)
        conn.execute(
            f"UPDATE permits SET "
            f"status = COALESCE(%s, status), "
            f"fee_amount = COALESCE(%s, fee_amount), "
            f"payment_status = COALESCE(%s, payment_status), "
            f"review_notes = COALESCE(%s, review_notes), "
            f"assigned_to = COALESCE(%s, assigned_to), "
            f"applicant_name = COALESCE(%s, applicant_name), "
            f"applicant_email = COALESCE(%s, applicant_email), "
            f"applicant_phone = COALESCE(%s, applicant_phone), "
            f"property_address = COALESCE(%s, property_address), "
            f"building_name = COALESCE(%s, building_name), "
            f"suite_name = COALESCE(%s, suite_name), "
            f"parcel_id = COALESCE(%s, parcel_id), "
            f"owner_name = COALESCE(%s, owner_name), "
            f"contractor_name = COALESCE(%s, contractor_name), "
            f"contractor_license = COALESCE(%s, contractor_license), "
            f"project_description = COALESCE(%s, project_description), "
            f"estimated_value = COALESCE(%s, estimated_value), "
            f"project_name = COALESCE(%s, project_name), "
            f"custom_data = COALESCE(%s::jsonb, custom_data), "
            f"planning_data = COALESCE(%s::jsonb, planning_data), "
            f"reviewed_by = %s, "
            f"updated_at = now(){issued_clause}{closed_clause}{exp_clause} "
            f"WHERE id = %s",
            (
                body.status,
                body.fee_amount.strip() if body.fee_amount is not None else None,
                body.payment_status,
                body.review_notes.strip() if body.review_notes is not None else None,
                body.assigned_to.strip() if body.assigned_to is not None else None,
                body.applicant_name.strip() if body.applicant_name is not None else None,
                body.applicant_email.strip() if body.applicant_email is not None else None,
                body.applicant_phone.strip() if body.applicant_phone is not None else None,
                body.property_address.strip() if body.property_address is not None else None,
                body.building_name.strip() if body.building_name is not None else None,
                body.suite_name.strip() if body.suite_name is not None else None,
                body.parcel_id.strip() if body.parcel_id is not None else None,
                body.owner_name.strip() if body.owner_name is not None else None,
                body.contractor_name.strip() if body.contractor_name is not None else None,
                body.contractor_license.strip() if body.contractor_license is not None else None,
                body.project_description.strip() if body.project_description is not None else None,
                body.estimated_value.strip() if body.estimated_value is not None else None,
                body.project_name.strip() if body.project_name is not None else None,
                json.dumps(_clean_custom_data(body.custom_data)) if body.custom_data is not None else None,
                json.dumps(_clean_planning_data(body.planning_data)) if body.planning_data is not None else None,
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
        if any(
            getattr(body, fld) is not None and getattr(body, fld).strip() != (cur.get(fld) or "")
            for fld in (
                "applicant_name", "applicant_email", "applicant_phone", "property_address",
                "building_name", "suite_name", "parcel_id", "owner_name",
                "contractor_name", "contractor_license", "project_description", "estimated_value",
            )
        ):
            changes.append("Application Details Updated")
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
        record_audit(user["username"], "permit.status_changed", "permits", cur["permit_number"], f"{cur['permit_number']}: {cur['status']} -> {body.status}")
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
@router.get("/inspections/queue")
def list_inspection_queue(
    result: str = "scheduled",
    inspector: str = "",
    _: dict = Depends(require_permission("permits.manage")),
):
    res_filter = result.strip().lower()
    insp_filter = f"%{inspector.strip()}%"
    with pool.connection() as conn:
        rows = conn.execute(
            "SELECT i.id, i.permit_id, p.permit_number, p.property_address, p.permit_type_name, "
            "       i.inspection_type, i.scheduled_date, i.requested_window, i.inspector, "
            "       i.result, i.notes, i.checklist, i.completed_at, i.created_at "
            "FROM permit_inspections i "
            "JOIN permits p ON p.id = i.permit_id "
            "WHERE (%s = '' OR i.result = %s) "
            "AND (%s = '%%' OR i.inspector ILIKE %s) "
            "ORDER BY CASE WHEN i.scheduled_date = '' THEN 1 ELSE 0 END, i.scheduled_date ASC, i.id ASC",
            (res_filter, res_filter, insp_filter, insp_filter),
        ).fetchall()
    return [
        {
            "id": r[0],
            "permit_id": r[1],
            "permit_number": r[2],
            "property_address": r[3],
            "permit_type_name": r[4],
            "inspection_type": r[5],
            "scheduled_date": r[6],
            "requested_window": r[7] or "",
            "inspector": r[8],
            "result": r[9],
            "notes": r[10],
            "checklist": r[11] if isinstance(r[11], list) else [],
            "completed_at": r[12].isoformat() if r[12] else None,
            "created_at": r[13].isoformat() if r[13] else None,
        }
        for r in rows
    ]


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
    checklist = _clean_checklist(body.checklist)
    if not checklist:
        checklist = _default_checklist_for(body.inspection_type)
    with pool.connection() as conn:
        permit = _get_permit_or_404(conn, permit_id)
        _check_permit_access(permit, user)
        if not is_mgr and permit["status"] not in ("approved", "issued"):
            raise HTTPException(
                status_code=400,
                detail="Self-service inspection scheduling is available once a permit is Approved or Issued.",
            )
        applicant_email = _resolve_applicant_email(conn, permit)
        comp_val = "now()" if result in ("passed", "failed", "partial") else "NULL"
        conn.execute(
            f"INSERT INTO permit_inspections (permit_id, inspection_type, scheduled_date, requested_window, inspector, result, notes, checklist, completed_at) "
            f"VALUES (%s, %s, %s, %s, %s, %s, %s, %s::jsonb, {comp_val})",
            (
                permit_id,
                body.inspection_type.strip(),
                body.scheduled_date.strip(),
                body.requested_window.strip(),
                body.inspector.strip() if is_mgr else "",
                result,
                body.notes.strip(),
                json.dumps(checklist),
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
    checklist_json = json.dumps(_clean_checklist(body.checklist)) if body.checklist is not None else None
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
            f"requested_window = COALESCE(%s, requested_window), "
            f"inspector = COALESCE(%s, inspector), "
            f"result = COALESCE(%s, result), "
            f"notes = COALESCE(%s, notes), "
            f"checklist = COALESCE(%s::jsonb, checklist){comp_clause} "
            f"WHERE id = %s AND permit_id = %s RETURNING inspection_type, result",
            (
                body.scheduled_date.strip() if body.scheduled_date is not None else None,
                body.requested_window.strip() if body.requested_window is not None else None,
                body.inspector.strip() if body.inspector is not None else None,
                body.result,
                body.notes.strip() if body.notes is not None else None,
                checklist_json,
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


@router.post("/{permit_id}/renew", status_code=201)
def renew_permit(
    permit_id: int,
    request: Request,
    user: dict = Depends(require_permission("permits.submit", "permits.manage")),
):
    """Clone an existing permit or annual license into a fresh renewal application."""
    with pool.connection() as conn:
        src = _get_permit_or_404(conn, permit_id)
        _check_permit_access(src, user)
        fee_val = src["fee_amount"]
        if src.get("permit_use_id"):
            u_row = conn.execute(
                "SELECT fee_amount FROM permit_uses WHERE id = %s",
                (src["permit_use_id"],),
            ).fetchone()
            if u_row and u_row[0]:
                fee_val = u_row[0]

        year = datetime.now(timezone.utc).year
        temp_num = f"PRM-{year}-{uuid.uuid4().hex[:8].upper()}"
        row = conn.execute(
            "INSERT INTO permits "
            "(permit_number, applicant_user_id, applicant_username, "
            " permit_type_id, permit_use_id, permit_type_name, permit_use_name, "
            " applicant_name, applicant_email, applicant_phone, "
            " property_address, building_name, suite_name, parcel_id, owner_name, "
            " contractor_name, contractor_license, project_description, estimated_value, "
            " accepted_terms, status, fee_amount, permit_kind, renewed_from_id) "
            "VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, TRUE, 'submitted', %s, %s, %s) "
            "RETURNING id",
            (
                temp_num,
                src["applicant_user_id"] or user["id"],
                src["applicant_username"] or user["username"],
                src["permit_type_id"],
                src["permit_use_id"],
                src["permit_type_name"],
                src["permit_use_name"],
                src["applicant_name"],
                src["applicant_email"],
                src["applicant_phone"],
                src["property_address"],
                src["building_name"],
                src["suite_name"],
                src["parcel_id"],
                src["owner_name"],
                src["contractor_name"],
                src["contractor_license"],
                src["project_description"],
                src["estimated_value"],
                fee_val or "",
                src.get("permit_kind") or "construction",
                permit_id,
            ),
        ).fetchone()
        new_id = row[0]
        final_num = f"PRM-{year}-{new_id:04d}"
        conn.execute("UPDATE permits SET permit_number = %s WHERE id = %s", (final_num, new_id))
        conn.execute(
            "INSERT INTO permit_activity_log (permit_id, action, actor_username, note) "
            "VALUES (%s, 'Renewal Submitted', %s, %s)",
            (new_id, user["username"], f"Renewed from {src['permit_number']}"),
        )
        result = _get_permit_or_404(conn, new_id, include_internal=has_permission(user, "permits.manage"))
    send_notification_email(
        "permits_submitted",
        f"[CivicDesk] Renewal Application {final_num} (from {src['permit_number']})",
        f"Renewal {final_num} ({src['permit_type_name']} — {src['permit_use_name']}) was submitted by {user['username']}.",
        link_path=f"/app#permits-review/{new_id}",
        request=request,
    )
    return result


@router.delete("/{permit_id}")
def delete_permit(permit_id: int, admin: dict = Depends(require_permission("permits.manage"))):
    with pool.connection() as conn:
        keys = [
            r[0]
            for r in conn.execute(
                "SELECT object_key FROM permit_documents WHERE permit_id = %s", (permit_id,)
            ).fetchall()
        ]
        row = conn.execute("DELETE FROM permits WHERE id = %s RETURNING id, permit_number", (permit_id,)).fetchone()
        if not row:
            raise HTTPException(status_code=404, detail="Permit not found")
    _remove_minio_objects(keys)
    record_audit(admin["username"], "permit.deleted", "permits", row[1], f"Deleted permit {row[1]}")
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


@router.get("/link-candidates")
def list_link_candidates(
    q: str = "",
    user: dict = Depends(require_permission("permits.submit", "permits.manage")),
):
    is_mgr = has_permission(user, "permits.manage")
    ql = f"%{q.strip()}%"
    with pool.connection() as conn:
        if is_mgr:
            if q.strip():
                rows = conn.execute(
                    "SELECT id, permit_number, permit_type_name, permit_use_name, property_address, project_name, status "
                    "FROM permits WHERE permit_number ILIKE %s OR property_address ILIKE %s OR project_name ILIKE %s OR permit_type_name ILIKE %s "
                    "ORDER BY id DESC LIMIT 50",
                    (ql, ql, ql, ql),
                ).fetchall()
            else:
                rows = conn.execute(
                    "SELECT id, permit_number, permit_type_name, permit_use_name, property_address, project_name, status "
                    "FROM permits ORDER BY id DESC LIMIT 50"
                ).fetchall()
        else:
            if q.strip():
                rows = conn.execute(
                    "SELECT id, permit_number, permit_type_name, permit_use_name, property_address, project_name, status "
                    "FROM permits WHERE applicant_user_id = %s AND (permit_number ILIKE %s OR property_address ILIKE %s OR project_name ILIKE %s OR permit_type_name ILIKE %s) "
                    "ORDER BY id DESC LIMIT 50",
                    (user["id"], ql, ql, ql, ql),
                ).fetchall()
            else:
                rows = conn.execute(
                    "SELECT id, permit_number, permit_type_name, permit_use_name, property_address, project_name, status "
                    "FROM permits WHERE applicant_user_id = %s ORDER BY id DESC LIMIT 50",
                    (user["id"],),
                ).fetchall()
    return [
        {
            "id": r[0],
            "permit_number": r[1],
            "permit_type_name": r[2],
            "permit_use_name": r[3],
            "property_address": r[4],
            "project_name": r[5],
            "status": r[6],
        }
        for r in rows
    ]


@router.post("/{permit_id}/links")
def add_permit_link(
    permit_id: int,
    body: PermitLinkIn,
    user: dict = Depends(require_permission("permits.submit", "permits.manage")),
):
    if body.related_permit_id == permit_id:
        raise HTTPException(status_code=400, detail="Cannot link a permit to itself")
    is_mgr = has_permission(user, "permits.manage")
    with pool.connection() as conn:
        cur = _get_permit_or_404(conn, permit_id, include_internal=is_mgr)
        _check_permit_access(cur, user)
        other = conn.execute(
            "SELECT id, applicant_user_id, permit_number FROM permits WHERE id = %s",
            (body.related_permit_id,),
        ).fetchone()
        if not other:
            raise HTTPException(status_code=404, detail="Related permit not found")
        if not is_mgr and other[1] != user["id"]:
            raise HTTPException(status_code=403, detail="Cannot link to another applicant's permit")
        if body.relationship == "enabled_by":
            src_id, tgt_id, ltype = body.related_permit_id, permit_id, "enables"
        elif body.relationship == "enables":
            src_id, tgt_id, ltype = permit_id, body.related_permit_id, "enables"
        else:
            src_id, tgt_id, ltype = permit_id, body.related_permit_id, "related"
        conn.execute(
            "INSERT INTO permit_links (source_permit_id, target_permit_id, link_type, notes) "
            "VALUES (%s, %s, %s, %s) ON CONFLICT (source_permit_id, target_permit_id, link_type) DO NOTHING",
            (src_id, tgt_id, ltype, body.notes.strip()),
        )
        conn.execute(
            "INSERT INTO permit_activity_log (permit_id, action, actor_username, note) "
            "VALUES (%s, 'Linked Permit', %s, %s)",
            (permit_id, user["username"], f"{body.relationship} -> {other[2]}"),
        )
        return _get_permit_or_404(conn, permit_id, include_internal=is_mgr)


@router.delete("/{permit_id}/links/{link_id}")
def delete_permit_link(
    permit_id: int,
    link_id: int,
    user: dict = Depends(require_permission("permits.submit", "permits.manage")),
):
    is_mgr = has_permission(user, "permits.manage")
    with pool.connection() as conn:
        cur = _get_permit_or_404(conn, permit_id, include_internal=is_mgr)
        _check_permit_access(cur, user)
        row = conn.execute(
            "DELETE FROM permit_links WHERE id = %s AND (source_permit_id = %s OR target_permit_id = %s) RETURNING id",
            (link_id, permit_id, permit_id),
        ).fetchone()
        if not row:
            raise HTTPException(status_code=404, detail="Permit link not found")
        return _get_permit_or_404(conn, permit_id, include_internal=is_mgr)


@router.post("/admin/types", status_code=201)
def create_permit_type(body: PermitTypeIn, _: dict = Depends(require_permission("permits.manage"))):
    name = body.name.strip()
    if not name:
        raise HTTPException(status_code=400, detail="Permit type name is required")
    req_fields = _clean_required_fields(body.required_fields) or []
    c_fields = _clean_custom_fields(body.custom_fields) or []
    with pool.connection() as conn:
        row = conn.execute(
            "INSERT INTO permit_types (name, description, sort_order, is_active, kind, expiration_rule, required_fields, custom_fields) "
            "VALUES (%s, %s, %s, %s, %s, %s, %s::jsonb, %s::jsonb) "
            "RETURNING id, name, description, sort_order, is_active, kind, expiration_rule, required_fields, custom_fields",
            (name, body.description.strip(), body.sort_order, body.is_active, body.kind, body.expiration_rule, json.dumps(req_fields), json.dumps(c_fields)),
        ).fetchone()
    return {
        "id": row[0],
        "name": row[1],
        "description": row[2],
        "sort_order": row[3],
        "is_active": bool(row[4]),
        "kind": row[5],
        "expiration_rule": row[6],
        "required_fields": list(row[7]) if isinstance(row[7], list) else [],
        "custom_fields": list(row[8]) if isinstance(row[8], list) else [],
    }


@router.patch("/admin/types/{type_id}")
def update_permit_type(type_id: int, body: PermitTypePatch, _: dict = Depends(require_permission("permits.manage"))):
    clean_req = _clean_required_fields(body.required_fields)
    clean_custom = _clean_custom_fields(body.custom_fields)
    with pool.connection() as conn:
        row = conn.execute(
            "UPDATE permit_types SET "
            "name = COALESCE(%s, name), "
            "description = COALESCE(%s, description), "
            "sort_order = COALESCE(%s, sort_order), "
            "is_active = COALESCE(%s, is_active), "
            "kind = COALESCE(%s, kind), "
            "expiration_rule = COALESCE(%s, expiration_rule), "
            "required_fields = COALESCE(%s::jsonb, required_fields), "
            "custom_fields = COALESCE(%s::jsonb, custom_fields) "
            "WHERE id = %s RETURNING id, name, description, sort_order, is_active, kind, expiration_rule, required_fields, custom_fields",
            (
                body.name.strip() if body.name is not None else None,
                body.description.strip() if body.description is not None else None,
                body.sort_order,
                body.is_active,
                body.kind,
                body.expiration_rule,
                json.dumps(clean_req) if clean_req is not None else None,
                json.dumps(clean_custom) if clean_custom is not None else None,
                type_id,
            ),
        ).fetchone()
        if not row:
            raise HTTPException(status_code=404, detail="Permit type not found")
    return {
        "id": row[0],
        "name": row[1],
        "description": row[2],
        "sort_order": row[3],
        "is_active": bool(row[4]),
        "kind": row[5],
        "expiration_rule": row[6],
        "required_fields": list(row[7]) if isinstance(row[7], list) else [],
        "custom_fields": list(row[8]) if isinstance(row[8], list) else [],
    }


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


# ------------------------------------------------------------------ contractor & business licensing + compliance gate

_CONTRACTOR_COLS = (
    "id, license_number, business_name, license_type, contact_name, email, phone, address, "
    "license_expires_at, insurance_carrier, insurance_policy_no, insurance_expires_at, "
    "bond_amount, bond_expires_at, status, notes, created_at, updated_at"
)


def _parse_optional_date(raw: str | None, label: str) -> date | None:
    if raw is None:
        return None
    val = raw.strip()
    if not val:
        return None
    try:
        return date.fromisoformat(val)
    except ValueError:
        raise HTTPException(status_code=400, detail=f"{label} must be YYYY-MM-DD")


def _row_to_contractor(r) -> dict:
    today = date.today()
    issues: list[str] = []
    status = r[14] or "active"
    lic_exp = r[8]
    ins_exp = r[11]
    bond_exp = r[13]
    if status != "active":
        issues.append(f"License status is '{status}'")
    if lic_exp is not None and lic_exp < today:
        issues.append(f"License expired on {lic_exp.isoformat()}")
    if ins_exp is not None and ins_exp < today:
        issues.append(f"Liability insurance expired on {ins_exp.isoformat()}")
    if bond_exp is not None and bond_exp < today:
        issues.append(f"Surety bond expired on {bond_exp.isoformat()}")
    expiring_soon = False
    for d in (lic_exp, ins_exp, bond_exp):
        if d is not None and today <= d <= today + timedelta(days=30):
            expiring_soon = True
    return {
        "id": r[0],
        "license_number": r[1],
        "business_name": r[2],
        "license_type": r[3],
        "contact_name": r[4],
        "email": r[5],
        "phone": r[6],
        "address": r[7],
        "license_expires_at": lic_exp.isoformat() if lic_exp else "",
        "insurance_carrier": r[9],
        "insurance_policy_no": r[10],
        "insurance_expires_at": ins_exp.isoformat() if ins_exp else "",
        "bond_amount": r[12],
        "bond_expires_at": bond_exp.isoformat() if bond_exp else "",
        "status": status,
        "notes": r[15],
        "compliant": len(issues) == 0,
        "expiring_soon": expiring_soon,
        "compliance_issues": issues,
        "created_at": r[16].isoformat() if r[16] else None,
        "updated_at": r[17].isoformat() if r[17] else None,
    }


def _check_contractor_compliance(conn, license_number: str) -> dict:
    lic = license_number.strip()
    if not lic:
        return {"matched": False, "compliant": True, "issues": [], "contractor": None}
    row = conn.execute(
        f"SELECT {_CONTRACTOR_COLS} FROM contractor_licenses WHERE LOWER(license_number) = LOWER(%s)",
        (lic,),
    ).fetchone()
    if not row:
        return {
            "matched": False,
            "compliant": True,
            "issues": [],
            "message": "Not found in local city contractor registry (will be verified by staff during review).",
            "contractor": None,
        }
    c = _row_to_contractor(row)
    return {
        "matched": True,
        "compliant": c["compliant"],
        "issues": c["compliance_issues"],
        "contractor": c,
    }


# ------------------------------------------------------------------ itemized fee ledger, escrow & receipts

def _sync_permit_fee_totals(conn, permit_id: int) -> None:
    rows = conn.execute(
        "SELECT entry_type, amount_cents FROM permit_fee_entries WHERE permit_id = %s",
        (permit_id,),
    ).fetchall()
    if not rows:
        return
    fees = sum(r[1] for r in rows if r[0] == "fee")
    waivers = sum(r[1] for r in rows if r[0] == "waiver")
    payments = sum(r[1] for r in rows if r[0] == "payment")
    bal = fees - waivers - payments
    if fees > 0:
        pay_status = "paid" if (bal <= 0 and payments > 0) else ("waived" if (bal <= 0 and waivers > 0) else "unpaid")
        conn.execute(
            "UPDATE permits SET fee_amount = %s, payment_status = %s, updated_at = now() WHERE id = %s",
            (f"${fees / 100:,.2f}", pay_status, permit_id),
        )


@router.post("/{permit_id}/fees", status_code=201)
def add_fee_entry(
    permit_id: int,
    body: FeeEntryIn,
    user: dict = Depends(require_permission("permits.manage")),
):
    etype = body.entry_type.strip().lower()
    if etype not in FEE_ENTRY_TYPES:
        raise HTTPException(status_code=400, detail="Invalid fee entry type")
    desc = body.description.strip()
    if not desc:
        raise HTTPException(status_code=400, detail="Description is required")
    cents = int(round(body.amount_dollars * 100))
    if cents <= 0:
        raise HTTPException(status_code=400, detail="Amount must be greater than zero")
    with pool.connection() as conn:
        _get_permit_or_404(conn, permit_id)
        conn.execute(
            "INSERT INTO permit_fee_entries "
            "(permit_id, entry_type, description, amount_cents, payment_method, reference_number, recorded_by, notes) "
            "VALUES (%s, %s, %s, %s, %s, %s, %s, %s)",
            (
                permit_id,
                etype,
                desc,
                cents,
                body.payment_method.strip(),
                body.reference_number.strip(),
                user["username"],
                body.notes.strip(),
            ),
        )
        _sync_permit_fee_totals(conn, permit_id)
        conn.execute(
            "INSERT INTO permit_activity_log (permit_id, action, actor_username, note) "
            "VALUES (%s, %s, %s, %s)",
            (permit_id, f"Ledger: {etype.replace('_', ' ').title()}", user["username"], f"{desc} (${cents / 100:,.2f})"),
        )
        return _get_permit_or_404(conn, permit_id, include_internal=True)


@router.delete("/{permit_id}/fees/{entry_id}")
def delete_fee_entry(
    permit_id: int,
    entry_id: int,
    user: dict = Depends(require_permission("permits.manage")),
):
    with pool.connection() as conn:
        row = conn.execute(
            "DELETE FROM permit_fee_entries WHERE id = %s AND permit_id = %s RETURNING description, amount_cents",
            (entry_id, permit_id),
        ).fetchone()
        if not row:
            raise HTTPException(status_code=404, detail="Fee ledger entry not found")
        _sync_permit_fee_totals(conn, permit_id)
        conn.execute(
            "INSERT INTO permit_activity_log (permit_id, action, actor_username, note) "
            "VALUES (%s, 'Ledger Entry Removed', %s, %s)",
            (permit_id, user["username"], f"{row[0]} (${row[1] / 100:,.2f})"),
        )
        return _get_permit_or_404(conn, permit_id, include_internal=True)


@router.get("/{permit_id}/receipt")
def get_permit_receipt_pdf(
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
        Paragraph("<b>FEE &amp; ESCROW PAYMENT RECEIPT</b>", styles["Title"]),
        Paragraph(f"Permit Number: <b>{_xml_escape(str(permit['permit_number'] or ''))}</b>", styles["Normal"]),
        Paragraph(f"Receipt Generated: {date.today().isoformat()}", styles["Normal"]),
        Spacer(1, 10),
    ]
    meta_rows = [
        ["Applicant", permit["applicant_name"] or "—"],
        ["Property Address", permit["property_address"] or "—"],
        ["Permit Type / Use", f"{permit['permit_type_name']} — {permit['permit_use_name']}"],
        ["Overall Payment Status", str(permit["payment_status"] or "unpaid").title()],
    ]
    mtbl = Table(meta_rows, colWidths=[145, 355])
    mtbl.setStyle(TableStyle([
        ("GRID", (0, 0), (-1, -1), 0.5, colors.grey),
        ("BACKGROUND", (0, 0), (0, -1), colors.HexColor("#eef2f6")),
        ("FONTNAME", (0, 0), (0, -1), "Helvetica-Bold"),
        ("PADDING", (0, 0), (-1, -1), 5),
    ]))
    story.extend([mtbl, Spacer(1, 14)])

    entries = permit.get("fee_entries") or []
    summary = permit.get("fee_summary") or {}
    if entries:
        story.append(Paragraph("<b>Itemized Fee &amp; Escrow Ledger</b>", styles["Heading2"]))
        t_rows = [["Date", "Type", "Description", "Method / Ref", "Amount"]]
        for e in entries:
            t_rows.append([
                (e.get("created_at") or "")[:10] or "—",
                e["entry_type"].replace("_", " ").title(),
                e["description"],
                " / ".join(x for x in (e.get("payment_method"), e.get("reference_number")) if x) or "—",
                f"${e['amount_cents'] / 100:,.2f}",
            ])
        etbl = Table(t_rows, colWidths=[72, 92, 168, 98, 70])
        etbl.setStyle(TableStyle([
            ("GRID", (0, 0), (-1, -1), 0.5, colors.grey),
            ("BACKGROUND", (0, 0), (-1, 0), colors.HexColor("#1e3a5f")),
            ("TEXTCOLOR", (0, 0), (-1, 0), colors.white),
            ("FONTNAME", (0, 0), (-1, 0), "Helvetica-Bold"),
            ("ALIGN", (4, 1), (4, -1), "RIGHT"),
            ("PADDING", (0, 0), (-1, -1), 5),
        ]))
        story.extend([etbl, Spacer(1, 14)])

    sum_rows = [
        ["Total Fees Assessed", f"${summary.get('fees_assessed_cents', 0) / 100:,.2f}"],
        ["Waivers / Credits", f"${summary.get('waivers_cents', 0) / 100:,.2f}"],
        ["Payments Received", f"${summary.get('payments_cents', 0) / 100:,.2f}"],
        ["Balance Due", f"${summary.get('balance_due_cents', 0) / 100:,.2f}"],
        ["Escrow Deposited", f"${summary.get('escrow_deposited_cents', 0) / 100:,.2f}"],
        ["Escrow Refunded / Released", f"${summary.get('escrow_refunded_cents', 0) / 100:,.2f}"],
        ["Current Escrow Held", f"${summary.get('escrow_held_cents', 0) / 100:,.2f}"],
    ]
    stbl = Table(sum_rows, colWidths=[220, 120])
    stbl.setStyle(TableStyle([
        ("GRID", (0, 0), (-1, -1), 0.5, colors.grey),
        ("BACKGROUND", (0, 0), (0, -1), colors.HexColor("#f8fafc")),
        ("FONTNAME", (0, 0), (0, -1), "Helvetica-Bold"),
        ("ALIGN", (1, 0), (1, -1), "RIGHT"),
        ("PADDING", (0, 0), (-1, -1), 5),
    ]))
    story.append(stbl)
    doc.build(story)
    return Response(
        content=buf.getvalue(),
        media_type="application/pdf",
        headers={"Content-Disposition": f'inline; filename="{permit["permit_number"]}-receipt.pdf"'},
    )


class FeeCalculateIn(BaseModel):
    valuation_dollars: float = 0.0
    square_feet: float = 0.0
    rate_per_sqft: float = 0.25
    plan_review_pct: float = 65.0
    add_to_ledger: bool = False


@router.post("/{permit_id}/fees/calculate")
def calculate_permit_fees(
    permit_id: int,
    body: FeeCalculateIn,
    user: dict = Depends(require_permission("permits.manage")),
):
    """Calculate building permit + plan review fees from construction valuation or square footage."""
    val = max(0.0, body.valuation_dollars)
    sqft = max(0.0, body.square_feet)
    if val <= 0 and sqft <= 0:
        raise HTTPException(status_code=400, detail="Enter construction valuation or square footage")

    if val > 0:
        if val <= 2000:
            base_fee = 75.0
        elif val <= 25000:
            base_fee = 75.0 + ((val - 2000.0) / 1000.0) * 12.0
        elif val <= 100000:
            base_fee = 351.0 + ((val - 25000.0) / 1000.0) * 9.0
        else:
            base_fee = 1026.0 + ((val - 100000.0) / 1000.0) * 6.0
        basis_label = f"Valuation ${val:,.0f}"
    else:
        base_fee = round(sqft * max(0.01, body.rate_per_sqft), 2)
        basis_label = f"{sqft:,.0f} sq ft @ ${body.rate_per_sqft:.2f}/sq ft"

    base_fee = round(base_fee, 2)
    plan_review_fee = round(base_fee * (max(0.0, body.plan_review_pct) / 100.0), 2)
    total_fee = round(base_fee + plan_review_fee, 2)

    if not body.add_to_ledger:
        return {
            "base_fee_dollars": base_fee,
            "plan_review_fee_dollars": plan_review_fee,
            "total_fee_dollars": total_fee,
            "basis": basis_label,
        }

    with pool.connection() as conn:
        _get_permit_or_404(conn, permit_id)
        conn.execute(
            "INSERT INTO permit_fee_entries (permit_id, entry_type, description, amount_cents, recorded_by) "
            "VALUES (%s, 'fee', %s, %s, %s)",
            (permit_id, f"Calculated Permit Fee ({basis_label})", int(round(base_fee * 100)), user["username"]),
        )
        if plan_review_fee > 0:
            conn.execute(
                "INSERT INTO permit_fee_entries (permit_id, entry_type, description, amount_cents, recorded_by) "
                "VALUES (%s, 'fee', %s, %s, %s)",
                (permit_id, f"Plan Review Fee ({body.plan_review_pct:.0f}%)", int(round(plan_review_fee * 100)), user["username"]),
            )
        _sync_permit_fee_totals(conn, permit_id)
        conn.execute(
            "INSERT INTO permit_activity_log (permit_id, action, actor_username, note) "
            "VALUES (%s, 'Calculated Fees Added', %s, %s)",
            (permit_id, user["username"], f"Total ${total_fee:,.2f} ({basis_label})"),
        )
        return _get_permit_or_404(conn, permit_id, include_internal=True)


@router.get("/{permit_id}/neighbor-notices-pdf")
def get_neighbor_notices_pdf(
    permit_id: int,
    _: dict = Depends(require_permission("permits.manage")),
):
    """Generate printable abutting neighbor Public Hearing Notice letters & mailing roster PDF."""
    from reportlab.platypus import PageBreak

    with pool.connection() as conn:
        permit = _get_permit_or_404(conn, permit_id)
    pd = permit.get("planning_data") or {}
    owners = pd.get("abutting_owners") or []
    if not owners:
        raise HTTPException(status_code=400, detail="Add at least one abutting neighbor in Planning & Zoning before generating notice letters.")

    hearing_dt = pd.get("public_hearing_date") or pd.get("planning_commission_date") or pd.get("council_hearing_date") or "TBD"
    buf = io.BytesIO()
    doc = SimpleDocTemplate(buf, pagesize=letter, leftMargin=54, rightMargin=54, topMargin=54, bottomMargin=54)
    styles = getSampleStyleSheet()
    story = []
    for idx, ow in enumerate(owners):
        if idx > 0:
            story.append(PageBreak())
        story.extend([
            Paragraph("<b>NOTICE OF PUBLIC HEARING — ZONING &amp; LAND USE</b>", styles["Title"]),
            Paragraph(f"Date: {date.today().isoformat()}", styles["Normal"]),
            Spacer(1, 10),
            Paragraph(f"<b>To:</b> {_xml_escape(ow.get('name') or 'Property Owner')}", styles["Normal"]),
            Paragraph(f"{_xml_escape(ow.get('address') or '')}" + (f" (Parcel: {_xml_escape(ow['parcel_id'])})" if ow.get("parcel_id") else ""), styles["Normal"]),
            Spacer(1, 14),
            Paragraph(
                f"Dear {_xml_escape(ow.get('name') or 'Neighbor')},<br/><br/>"
                f"Please take notice that an application (<b>{_xml_escape(permit['permit_number'])}</b> — "
                f"{_xml_escape(permit['permit_type_name'])}: {_xml_escape(permit['permit_use_name'])}) "
                f"has been filed for the property located at <b>{_xml_escape(permit['property_address'] or '—')}</b> "
                f"(Zoning District: {_xml_escape(pd.get('zoning_district') or '—')}).",
                styles["Normal"],
            ),
            Spacer(1, 10),
            Paragraph(
                f"<b>Public Hearing Date:</b> {_xml_escape(hearing_dt)}<br/>"
                f"<b>Applicant:</b> {_xml_escape(permit['applicant_name'] or '—')}",
                styles["Normal"],
            ),
            Spacer(1, 12),
            Paragraph(
                "All interested residents and abutting property owners are invited to attend and be heard, "
                "or submit written comments to City Hall prior to the hearing date.",
                styles["Normal"],
            ),
            Spacer(1, 20),
            Paragraph("Sincerely,<br/><b>Planning &amp; Zoning Administration</b>", styles["Normal"]),
        ])

    story.extend([PageBreak(), Paragraph("<b>ABUTTING PROPERTY OWNERS MAILING ROSTER</b>", styles["Heading2"]), Spacer(1, 8)])
    r_rows = [["Owner Name", "Mailing / Property Address", "Parcel ID"]]
    for ow in owners:
        r_rows.append([ow.get("name") or "—", ow.get("address") or "—", ow.get("parcel_id") or "—"])
    rtbl = Table(r_rows, colWidths=[165, 225, 110])
    rtbl.setStyle(TableStyle([
        ("GRID", (0, 0), (-1, -1), 0.5, colors.grey),
        ("BACKGROUND", (0, 0), (-1, 0), colors.HexColor("#1e3a5f")),
        ("TEXTCOLOR", (0, 0), (-1, 0), colors.white),
        ("FONTNAME", (0, 0), (-1, 0), "Helvetica-Bold"),
        ("PADDING", (0, 0), (-1, -1), 5),
    ]))
    story.append(rtbl)
    doc.build(story)
    return Response(
        content=buf.getvalue(),
        media_type="application/pdf",
        headers={"Content-Disposition": f'inline; filename="{permit["permit_number"]}-neighbor-notices.pdf"'},
    )


@router.post("/{permit_id}/push-to-agenda")
def push_permit_to_agenda_backlog(
    permit_id: int,
    user: dict = Depends(require_permission("permits.manage")),
):
    """Create a Council/Commission Agenda Backlog item for a Planning & Zoning hearing."""
    with pool.connection() as conn:
        permit = _get_permit_or_404(conn, permit_id)
        pd = dict(permit.get("planning_data") or {})
        title = f"Public Hearing: {permit['permit_number']} — {permit['permit_type_name']} ({permit['property_address'] or permit['applicant_name']})"
        desc_parts = [
            f"Applicant: {permit['applicant_name']}",
            f"Property: {permit['property_address'] or '—'} (Parcel: {permit['parcel_id'] or '—'})",
            f"Zoning District: {pd.get('zoning_district') or '—'}",
            f"Request: {permit['permit_use_name']}",
        ]
        if pd.get("conditions_of_approval"):
            desc_parts.append(f"Proposed Conditions: {pd['conditions_of_approval']}")
        target_date = pd.get("council_hearing_date") or pd.get("public_hearing_date") or pd.get("planning_commission_date") or None
        target_body = "City Council" if pd.get("council_hearing_date") else "Planning Commission"
        try:
            row = conn.execute(
                "INSERT INTO agenda_items (agenda_id, position, title, description, section, target_body, target_date) "
                "VALUES (NULL, COALESCE((SELECT MAX(position) FROM agenda_items WHERE agenda_id IS NULL), 0) + 1, %s, %s, 'Public Hearings', %s, %s) "
                "RETURNING id",
                (title, "\n".join(desc_parts), target_body, target_date),
            ).fetchone()
        except Exception as exc:
            raise HTTPException(status_code=400, detail=f"Agenda backlog unavailable: {exc}")
        pd["agenda_backlog_id"] = row[0]
        conn.execute(
            "UPDATE permits SET planning_data = %s::jsonb, updated_at = now() WHERE id = %s",
            (json.dumps(pd), permit_id),
        )
        conn.execute(
            "INSERT INTO permit_activity_log (permit_id, action, actor_username, note) "
            "VALUES (%s, 'Pushed to Agenda Backlog', %s, %s)",
            (permit_id, user["username"], f"Backlog item #{row[0]} ({target_body})"),
        )
        return _get_permit_or_404(conn, permit_id, include_internal=True)
