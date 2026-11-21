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

"""Municipal Codification module: recursive City Code tree, revisions, OCR/PDF/URL/ZIP bulk import, & reader."""
from html.parser import HTMLParser
import io
import ipaddress
import json
import os
import re
import socket
from urllib.parse import unquote, urljoin, urlparse
import uuid
from xml.sax.saxutils import escape as _xml_escape
import zipfile

from fastapi import APIRouter, Depends, File, Form, HTTPException, Request, UploadFile
from fastapi.concurrency import run_in_threadpool
from fastapi.responses import RedirectResponse, Response
from pydantic import BaseModel
from pypdf import PdfReader, PdfWriter
from reportlab.lib.pagesizes import letter
from reportlab.lib.styles import getSampleStyleSheet
from reportlab.platypus import PageBreak, Paragraph, SimpleDocTemplate, Spacer

from .agenda_pdf import apply_pdf_accessibility_metadata
from .agendas import _bucket, _minio, _remove_minio_objects
from .auth import require_permission
from .codification_parser import (
    clean_pdf_pages,
    count_subsections,
    extract_ordinance_metadata,
    extract_pdf_document,
    infer_section_info_from_filename,
    parse_code_pdf,
    split_section_body_into_children,
)
from .db import pool
from .subscriptions import notify_topic_subscribers
from .tenancy import tenant_object_key

MAX_CODE_PDF_BYTES = int(os.environ.get("MAX_CODE_PDF_BYTES", str(50 * 1024 * 1024)))
MAX_ZIP_FILES = int(os.environ.get("MAX_CODIFICATION_ZIP_FILES", "250"))
MAX_ZIP_UNCOMPRESSED_BYTES = int(os.environ.get("MAX_CODIFICATION_ZIP_BYTES", str(250 * 1024 * 1024)))
MAX_HTML_BYTES = 5 * 1024 * 1024
_SAFE_FILENAME_RE = re.compile(r"[^A-Za-z0-9._-]+")
_ALLOWED_NODE_TYPES = {"article", "division", "series", "section"}

SCHEMA = """
CREATE TABLE IF NOT EXISTS code_chapters (
    id           BIGSERIAL PRIMARY KEY,
    code_prefix  TEXT NOT NULL UNIQUE,
    title        TEXT NOT NULL,
    description  TEXT NOT NULL DEFAULT '',
    sort_order   INTEGER NOT NULL DEFAULT 0,
    is_published BOOLEAN NOT NULL DEFAULT TRUE
);
CREATE TABLE IF NOT EXISTS code_sections (
    id              BIGSERIAL PRIMARY KEY,
    chapter_id      BIGINT NOT NULL REFERENCES code_chapters(id) ON DELETE CASCADE,
    parent_id       BIGINT REFERENCES code_sections(id) ON DELETE CASCADE,
    node_type       TEXT NOT NULL DEFAULT 'section',
    section_number  TEXT NOT NULL,
    article         TEXT NOT NULL DEFAULT '',
    title           TEXT NOT NULL,
    summary         TEXT NOT NULL DEFAULT '',
    body            TEXT NOT NULL DEFAULT '',
    ordinance_ref   TEXT NOT NULL DEFAULT '',
    effective_date  TEXT NOT NULL DEFAULT '',
    source_pdf_url  TEXT NOT NULL DEFAULT '',
    object_key      TEXT NOT NULL DEFAULT '',
    sort_order      INTEGER NOT NULL DEFAULT 0,
    is_published    BOOLEAN NOT NULL DEFAULT TRUE,
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (chapter_id, section_number)
);
ALTER TABLE code_sections ADD COLUMN IF NOT EXISTS article TEXT NOT NULL DEFAULT '';
ALTER TABLE code_sections ADD COLUMN IF NOT EXISTS parent_id BIGINT REFERENCES code_sections(id) ON DELETE CASCADE;
ALTER TABLE code_sections ADD COLUMN IF NOT EXISTS node_type TEXT NOT NULL DEFAULT 'section';
CREATE INDEX IF NOT EXISTS code_sections_chap_idx ON code_sections(chapter_id, sort_order, id);
CREATE INDEX IF NOT EXISTS code_sections_parent_idx ON code_sections(parent_id, sort_order, id);
CREATE TABLE IF NOT EXISTS code_revisions (
    id               BIGSERIAL PRIMARY KEY,
    section_id       BIGINT NOT NULL REFERENCES code_sections(id) ON DELETE CASCADE,
    ordinance_number TEXT NOT NULL DEFAULT '',
    effective_date   TEXT NOT NULL DEFAULT '',
    change_summary   TEXT NOT NULL DEFAULT '',
    previous_body    TEXT NOT NULL DEFAULT '',
    new_body         TEXT NOT NULL DEFAULT '',
    edited_by        TEXT NOT NULL DEFAULT '',
    created_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS code_revisions_sec_idx ON code_revisions(section_id, id DESC);
"""

_SEED_CODE: list[tuple[str, str, list[tuple[str, str, str]]]] = [
    ("1XX", "Application of Code", [
        ("101", "Adoption of Code", "https://cityofbirchwood.com/wp-content/uploads/2026/06/Section-101-Series-Adoption-of-Code.pdf"),
        ("102", "Rules of Construction", "https://cityofbirchwood.com/wp-content/uploads/2026/06/Section-102-Rules-of-Construction.pdf"),
        ("103", "Definitions", "https://cityofbirchwood.com/wp-content/uploads/2026/06/Section-103-Defenitions.pdf"),
    ]),
    ("2XX", "Infrastructure Services & Building Regulations", [
        ("201", "City Water System", "https://cityofbirchwood.com/wp-content/uploads/2026/06/Section-201-City-Water-Systems.pdf"),
        ("202", "City Plumbing & Sewerage Systems", "https://cityofbirchwood.com/wp-content/uploads/2026/06/Section-202-City-Plumbing-and-Sewage-System.pdf"),
        ("203", "City Building Regulations", "https://cityofbirchwood.com/wp-content/uploads/2026/06/Section-203-City-Building-Regulations.pdf"),
        ("204", "Residential Numbering", "https://cityofbirchwood.com/wp-content/uploads/2026/06/Section-204-Residential-Numbering.pdf"),
        ("205", "Contractor Licensing", "https://cityofbirchwood.com/wp-content/uploads/2026/06/Section-205-Contractor-Licensing.pdf"),
        ("206", "NSP Electrical Distribution System Maintenance", "https://cityofbirchwood.com/wp-content/uploads/2026/06/Section-206-NSP-Electrical-Distribution-System-Maintenance.pdf"),
        ("207", "NSP Gas Distribution System Maintenance", "https://cityofbirchwood.com/wp-content/uploads/2026/06/Section-207-NSP-Gas-Distribution-System-Maintenance.pdf"),
        ("208A", "Right-of-Way Management", "https://cityofbirchwood.com/wp-content/uploads/2026/06/Section-208A-Right-of-Way-Management.pdf"),
    ]),
    ("3XX", "Zoning Regulations", [
        ("300", "Land Use", "https://cityofbirchwood.com/wp-content/uploads/2026/06/Section-300-Land-Use.pdf"),
        ("301", "Zoning Code: General Provisions", "https://cityofbirchwood.com/wp-content/uploads/2026/06/Section-301-Zoning-Code-General-Provisions.pdf"),
        ("302", "Zoning Code: Requirements & Performance Standards", "https://cityofbirchwood.com/wp-content/uploads/2026/06/Section-302-Zoning-Code-Requirements-and-Performance-Standards-v2024.12.10.pdf"),
        ("303", "Zoning Code: Administration", "https://cityofbirchwood.com/wp-content/uploads/2026/06/Section-303-Zoning-Code-Planning-Commission.pdf"),
        ("304", "Zoning Code: Variances & Appeals", "https://cityofbirchwood.com/wp-content/uploads/2026/06/Section-304-Zoning-Code-Variances-v2024.09.18-1.pdf"),
        ("305", "Zoning Code: Interim Use Permits", "https://cityofbirchwood.com/wp-content/uploads/2026/06/Section-305-Zoning-Code-Interim-Use-Permits.pdf"),
        ("306", "Zoning Code: Conditional Use Permits", "https://cityofbirchwood.com/wp-content/uploads/2026/06/Section-306-Zoning-Code-Conditional-Use-Permits.pdf"),
        ("307", "Zoning Code: Zoning Permit", "https://cityofbirchwood.com/wp-content/uploads/2026/06/Section-307-Zoning-Code-Zoning-Permit.pdf"),
        ("308", "Subdivision of Land", "https://cityofbirchwood.com/wp-content/uploads/2026/06/Section-308-Subdivision-of-Land.pdf"),
        ("310", "Administrative Appeals", "https://cityofbirchwood.com/wp-content/uploads/2026/06/Section-310-Administrative-Appeals.pdf"),
    ]),
    ("4XX", "Public Welfare & Requirements", [
        ("402", "Solid & Hazardous Waste Management", "https://cityofbirchwood.com/wp-content/uploads/2026/06/Section-402-Solid-Waste-and-Recycling-v2024.12.10.pdf"),
        ("403", "Tree Diseases", "https://cityofbirchwood.com/wp-content/uploads/2026/06/Section-403-Tree-Diseases.pdf"),
        ("404", "Housing", "https://cityofbirchwood.com/wp-content/uploads/2026/06/Section-404-Housing.pdf"),
        ("405", "National Flood Insurance Program", "https://cityofbirchwood.com/wp-content/uploads/2026/06/Section-405-Floodplain-Management-Ordinance.pdf"),
        ("406", "User Charge for Excessive Consumption of Law Enforcement Services", "https://cityofbirchwood.com/wp-content/uploads/2026/06/Section-406-User-Charge-for-Excessive-Consumption-of-Law-Enforcement.pdf"),
        ("407", "Vacant Buildings", "https://cityofbirchwood.com/wp-content/uploads/2026/06/Section-407-Vacant-Buildings.pdf"),
        ("408", "Exclusion Zones & Prohibition of Certain Employee-Related Activities", "https://cityofbirchwood.com/wp-content/uploads/2026/06/Section-408-Exclusion-Zones-and-Prohibitions.pdf"),
        ("409", "Predatory Offender Residency Restrictions", "https://cityofbirchwood.com/wp-content/uploads/2026/06/Section-409-Predatory-Offender-Residency-Restrictions.pdf"),
    ]),
    ("5XX", "Motor & Recreational Vehicle Regulations", [
        ("502", "Parking", "https://cityofbirchwood.com/wp-content/uploads/2026/06/Section-502-Parking.pdf"),
        ("503", "Weight Restrictions", "https://cityofbirchwood.com/wp-content/uploads/2026/06/Section-503-Weight-Restrictions.pdf"),
        ("504", "Snowmobiles & All-Terrain Vehicles", "https://cityofbirchwood.com/wp-content/uploads/2026/06/Section-504-Snowmobile-and-All-Terrain-Vehicles-Registration.pdf"),
    ]),
    ("6XX", "Public Safety, Property & Community Standards", [
        ("601", "Signs & Billboards", "https://cityofbirchwood.com/wp-content/uploads/2026/06/Section-601-Signs.pdf"),
        ("602", "Inflammable & Explosive Materials", "https://cityofbirchwood.com/wp-content/uploads/2026/06/Section-602-Inflammable-and-Explosive-Materials.pdf"),
        ("603", "Fire Hazards", "https://cityofbirchwood.com/wp-content/uploads/2026/06/Section-603-Fire-Hazards.pdf"),
        ("604", "Open Burning", "https://cityofbirchwood.com/wp-content/uploads/2026/06/Section-604-Open-Burning.pdf"),
        ("605", "Animals", "https://cityofbirchwood.com/wp-content/uploads/2026/06/Section-605-Animals.pdf"),
        ("606", "Public Nuisances", "https://cityofbirchwood.com/wp-content/uploads/2026/06/Section-606-Public-Nuisance.pdf"),
        ("607", "Open Space, Park Areas & Facilities", "https://cityofbirchwood.com/wp-content/uploads/2026/06/Section-607-Birchwood-Park-System.pdf"),
        ("609", "Firearms", "https://cityofbirchwood.com/wp-content/uploads/2026/06/Section-609-Firearms-Hunting-and-Trapping.pdf"),
        ("610", "Curfew for Minors", "https://cityofbirchwood.com/wp-content/uploads/2026/06/Section-610-Tobacco-Cannabis-and-Cannibas-Products.pdf"),
        ("613", "Unclaimed & Abandoned Property", "https://cityofbirchwood.com/wp-content/uploads/2026/06/Section-613-Unclaimed-and-Abandoned-Property.pdf"),
        ("614", "Abandoned & Junked Motor Vehicles", "https://cityofbirchwood.com/wp-content/uploads/2026/06/Section-614-Abandoned-and-Junked-Motor-Vehicles.pdf"),
        ("615", "Exterior Storage", "https://cityofbirchwood.com/wp-content/uploads/2026/06/Section-615-Exterior-Storage.pdf"),
        ("616", "Excessive Noise", "https://cityofbirchwood.com/wp-content/uploads/2026/06/Section-616-Excessive-Noise.pdf"),
        ("617", "Public Lake Tracts", "https://cityofbirchwood.com/wp-content/uploads/2026/06/Section-617-Birchwood-Dock-Association.pdf"),
        ("618", "Complaints", "https://cityofbirchwood.com/wp-content/uploads/2026/06/Section-618-Complaints.pdf"),
        ("619", "Penalties & Enforcement", "https://cityofbirchwood.com/wp-content/uploads/2026/06/Section-619-Penalties-and-Enforcement.pdf"),
        ("620", "Feeding Deer", "https://cityofbirchwood.com/wp-content/uploads/2026/06/Section-620-Feeding-Deer.pdf"),
        ("621", "Storage of Personal Property", "https://cityofbirchwood.com/wp-content/uploads/2026/06/Section-621-Storage-of-Personal-Property.pdf"),
        ("622", "Regulation of Solicitors", "https://cityofbirchwood.com/wp-content/uploads/2026/06/Section-622-Regulation-of-Solicitors.pdf"),
        ("623", "Animal Barriers", "https://cityofbirchwood.com/wp-content/uploads/2026/06/Section-623-Animal-Barriers.pdf"),
    ]),
    ("7XX", "Fees for Services & Street Names", [
        ("701", "Fees", "https://cityofbirchwood.com/wp-content/uploads/2026/06/Section-701-Fees.pdf"),
        ("702", "Street Names", "https://cityofbirchwood.com/wp-content/uploads/2026/06/Section-702-Street-Names.pdf"),
    ]),
    ("8XX", "City Fees and Financial Agreements", [
        ("801", "Fund Balances", "https://cityofbirchwood.com/wp-content/uploads/2026/06/BirchwoodCityCode801.pdf"),
        ("802", "Public Works Reserve Fund", "https://cityofbirchwood.com/wp-content/uploads/2026/06/BirchwoodCityCode802.pdf"),
        ("803", "Capital Projects Fund", "https://cityofbirchwood.com/wp-content/uploads/2026/06/BirchwoodCityCode803.pdf"),
        ("804", "Parks Special Revenue Fund", "https://cityofbirchwood.com/wp-content/uploads/2026/06/BirchwoodCityCode804.pdf"),
        ("805", "Public Improvements Financing & Assessment", "https://cityofbirchwood.com/wp-content/uploads/2026/06/BirchwoodCityCode805.pdf"),
        ("806", "Compensation", "https://cityofbirchwood.com/wp-content/uploads/2026/06/BirchwoodCityCode806.pdf"),
    ]),
    ("9XX", "City Franchise Agreements and Definitions", [
        ("901", "Definitions", "https://cityofbirchwood.com/wp-content/uploads/2026/06/Section-901-Definitions.pdf"),
        ("902", "Cable Franchise", "https://cityofbirchwood.com/wp-content/uploads/2026/06/Section-902-Franchise.pdf"),
        ("903", "Operation in Streets and Rights of Way", "https://cityofbirchwood.com/wp-content/uploads/2026/06/Section-903-Operation-in-Streets-and-Rights-of-Way.pdf"),
        ("904", "Removal or Abandonment of System", "https://cityofbirchwood.com/wp-content/uploads/2026/06/Section-904-Removal-or-Abandonment-of-System.pdf"),
        ("905", "System Design and Capacity", "https://cityofbirchwood.com/wp-content/uploads/2026/06/Section-905-System-Design-and-Capacity.pdf"),
        ("906", "Programming and Services", "https://cityofbirchwood.com/wp-content/uploads/2026/06/Section-906-Programming-and-Services.pdf"),
        ("907", "Local PEG Programming", "https://cityofbirchwood.com/wp-content/uploads/2026/06/Section-907-Local-PEG-Programming.pdf"),
        ("908", "Regulatory Provisions", "https://cityofbirchwood.com/wp-content/uploads/2026/06/Section-908-Regulatory-Provisions.pdf"),
        ("909", "Bond", "https://cityofbirchwood.com/wp-content/uploads/2026/06/Section-909-Bond.pdf"),
        ("910", "Security Fund", "https://cityofbirchwood.com/wp-content/uploads/2026/06/Section-910-Security-Fund.pdf"),
        ("911", "Violation Procedure", "https://cityofbirchwood.com/wp-content/uploads/2026/06/Section-911-Violation-Procedure.pdf"),
        ("912", "Foreclosure and Receivership", "https://cityofbirchwood.com/wp-content/uploads/2026/06/Section-912-Foreclosure-and-Receivership.pdf"),
        ("913", "Reporting Requirements", "https://cityofbirchwood.com/wp-content/uploads/2026/06/Section-913-Reporting-Requirements.pdf"),
        ("914", "Customer Service Policies", "https://cityofbirchwood.com/wp-content/uploads/2026/06/Section-914-Customer-Service-Policies.pdf"),
        ("915", "Subscriber Practices", "https://cityofbirchwood.com/wp-content/uploads/2026/06/Section-915-Subscriber-Practices.pdf"),
        ("916", "Compensation and Financial Provisions", "https://cityofbirchwood.com/wp-content/uploads/2026/06/Section-916-Compensation-and-Financial-Provisions.pdf"),
        ("917", "Miscellaneous Provisions", "https://cityofbirchwood.com/wp-content/uploads/2026/06/Section-917-Miscellaneous-Provisions.pdf"),
    ]),
]


def bootstrap() -> None:
    with pool.connection() as conn:
        conn.execute("SELECT pg_advisory_xact_lock(424245)")
        conn.execute(SCHEMA)
        if os.environ.get("SEED_CITY_PROFILE", "").strip().lower() != "birchwood":
            return
        for c_idx, (prefix, c_title, sections) in enumerate(_SEED_CODE):
            conn.execute(
                "INSERT INTO code_chapters (code_prefix, title, sort_order) "
                "VALUES (%s, %s, %s) ON CONFLICT (code_prefix) DO NOTHING",
                (prefix, c_title, c_idx + 1),
            )
            chap_id = conn.execute(
                "SELECT id FROM code_chapters WHERE code_prefix = %s", (prefix,)
            ).fetchone()[0]
            for s_idx, (sec_num, s_title, pdf_url) in enumerate(sections):
                conn.execute(
                    "INSERT INTO code_sections "
                    "(chapter_id, section_number, title, source_pdf_url, sort_order) "
                    "VALUES (%s, %s, %s, %s, %s) "
                    "ON CONFLICT (chapter_id, section_number) DO NOTHING",
                    (chap_id, sec_num, s_title, pdf_url, s_idx + 1),
                )


router = APIRouter(prefix="/api/codification", tags=["codification"])


class ChapterIn(BaseModel):
    code_prefix: str
    title: str
    description: str = ""
    sort_order: int = 0
    is_published: bool = True


class ChapterPatch(BaseModel):
    code_prefix: str | None = None
    title: str | None = None
    description: str | None = None
    sort_order: int | None = None
    is_published: bool | None = None


class SectionIn(BaseModel):
    chapter_id: int
    parent_id: int | None = None
    node_type: str = "section"
    section_number: str
    article: str = ""
    title: str
    summary: str = ""
    body: str = ""
    ordinance_ref: str = ""
    effective_date: str = ""
    source_pdf_url: str = ""
    sort_order: int = 0
    is_published: bool = True


class SectionPatch(BaseModel):
    parent_id: int | None = None
    node_type: str | None = None
    section_number: str | None = None
    article: str | None = None
    title: str | None = None
    summary: str | None = None
    body: str | None = None
    ordinance_ref: str | None = None
    effective_date: str | None = None
    source_pdf_url: str | None = None
    sort_order: int | None = None
    is_published: bool | None = None
    change_summary: str = ""


def _norm_node_type(val: str | None) -> str:
    clean = (val or "section").strip().lower()
    return clean if clean in _ALLOWED_NODE_TYPES else "section"


def _load_tree(conn, published_only: bool, q: str = "") -> list[dict]:
    c_where = "WHERE is_published = TRUE" if published_only else ""
    c_rows = conn.execute(
        f"SELECT id, code_prefix, title, description, sort_order, is_published "
        f"FROM code_chapters {c_where} ORDER BY sort_order ASC, code_prefix ASC"
    ).fetchall()

    s_where = "WHERE is_published = TRUE" if published_only else ""
    s_rows = conn.execute(
        f"SELECT id, chapter_id, parent_id, node_type, section_number, article, title, summary, body, "
        f"       ordinance_ref, effective_date, source_pdf_url, object_key, "
        f"       sort_order, is_published, updated_at "
        f"FROM code_sections {s_where} ORDER BY sort_order ASC, section_number ASC, id ASC"
    ).fetchall()

    nodes_by_id: dict[int, dict] = {}
    ordered_nodes: list[dict] = []
    for s in s_rows:
        item = {
            "id": s[0],
            "chapter_id": s[1],
            "parent_id": s[2],
            "node_type": s[3] or "section",
            "section_number": s[4],
            "article": s[5] or "",
            "title": s[6],
            "summary": s[7],
            "body": s[8],
            "ordinance_ref": s[9],
            "effective_date": s[10],
            "source_pdf_url": s[11],
            "has_uploaded_pdf": bool(s[12]),
            "sort_order": s[13],
            "is_published": bool(s[14]),
            "updated_at": s[15].isoformat() if s[15] else None,
            "parent_pdf_section_id": None,
            "descendant_count": 0,
            "children": [],
        }
        nodes_by_id[item["id"]] = item
        ordered_nodes.append(item)

    roots_by_chap: dict[int, list[dict]] = {}
    for item in ordered_nodes:
        pid = item["parent_id"]
        if pid is None:
            roots_by_chap.setdefault(item["chapter_id"], []).append(item)
        elif pid in nodes_by_id:
            nodes_by_id[pid]["children"].append(item)
        # Orphaned children whose parent is unpublished are intentionally excluded

    def enrich_node(node: dict, inherited_pdf_id: int | None) -> int:
        own_pdf = node["has_uploaded_pdf"] or bool((node["source_pdf_url"] or "").strip())
        if not own_pdf and inherited_pdf_id is not None:
            node["parent_pdf_section_id"] = inherited_pdf_id
        next_pdf_id = node["id"] if own_pdf else inherited_pdf_id
        desc = len(node["children"])
        for ch_node in node["children"]:
            desc += enrich_node(ch_node, next_pdf_id)
        node["descendant_count"] = desc
        return desc

    ql = q.strip().lower()

    def filter_node(node: dict) -> dict | None:
        hay = (
            f"{node['section_number']} {node['article']} {node['title']} "
            f"{node['summary']} {node['body']} {node['ordinance_ref']}"
        ).lower()
        self_match = True if not ql else (ql in hay)
        kept_children: list[dict] = []
        for c in node["children"]:
            fc = filter_node(c)
            if fc is not None:
                kept_children.append(fc)
        if ql and not self_match and not kept_children:
            return None
        return {**node, "matched": self_match, "children": kept_children}

    out = []
    for c in c_rows:
        roots = roots_by_chap.get(c[0], [])
        for r in roots:
            enrich_node(r, None)
        if ql:
            filtered_roots = [fr for r in roots if (fr := filter_node(r)) is not None]
            if not filtered_roots and ql not in f"{c[1]} {c[2]}".lower():
                continue
            c_secs = filtered_roots
        else:
            c_secs = roots
        out.append({
            "id": c[0],
            "code_prefix": c[1],
            "title": c[2],
            "description": c[3],
            "sort_order": c[4],
            "is_published": bool(c[5]),
            "sections": c_secs,
        })
    return out


# ------------------------------------------------------------------ public endpoints
@router.get("/public")
def get_public_code(q: str = ""):
    with pool.connection() as conn:
        return {"chapters": _load_tree(conn, published_only=True, q=q)}


def _append_pdf_toc_and_story(
    nodes: list[dict],
    depth: int,
    toc_story: list,
    body_story: list,
    styles,
    sec_keys: dict[int, str],
    attached_pdfs: list[tuple[str, str, str]],
) -> None:
    indent = "&nbsp;" * (4 * (depth + 1))
    for sec in nodes:
        label_prefix = "Article" if sec.get("node_type") == "article" else "Sec."
        toc_story.append(
            Paragraph(
                f"{indent}{label_prefix} {_xml_escape(sec['section_number'])} — {_xml_escape(sec['title'])}",
                styles["Normal"],
            )
        )
        if sec.get("article") and depth == 0:
            body_story.append(Paragraph(f"<i>{_xml_escape(sec['article'])}</i>", styles["Normal"]))
        head_style = styles["Heading2"] if depth == 0 else styles["Heading3"]
        body_story.append(
            Paragraph(
                f"<b>{label_prefix} {_xml_escape(sec['section_number'])} — {_xml_escape(sec['title'])}</b>",
                head_style,
            )
        )
        if sec.get("ordinance_ref") or sec.get("effective_date"):
            body_story.append(
                Paragraph(
                    f"<i>Ordinance: {_xml_escape(sec.get('ordinance_ref') or '—')} | Effective: {_xml_escape(sec.get('effective_date') or '—')}</i>",
                    styles["Normal"],
                )
            )
        if sec.get("summary"):
            body_story.append(Paragraph(f"<b>Summary:</b> {_xml_escape(sec['summary'])}", styles["Normal"]))
        body_txt = (sec.get("body") or "").strip()
        obj_key = sec_keys.get(sec["id"], "")
        has_children = bool(sec.get("children"))
        if body_txt:
            for para in body_txt.splitlines():
                if para.strip():
                    body_story.append(Paragraph(_xml_escape(para.strip()), styles["Normal"]))
                    body_story.append(Spacer(1, 4))
        elif obj_key and not has_children:
            body_story.append(Paragraph("<i>(Full text attached in appended PDF pages.)</i>", styles["Normal"]))
            attached_pdfs.append((sec["section_number"], sec["title"], obj_key))
        elif not has_children:
            body_story.append(Paragraph("<i>No body text recorded.</i>", styles["Normal"]))
        body_story.append(Spacer(1, 8))

        if has_children:
            _append_pdf_toc_and_story(
                sec["children"], depth + 1, toc_story, body_story, styles, sec_keys, attached_pdfs
            )


@router.get("/public/full.pdf")
def get_full_code_pdf(download: bool = False):
    """Compile all published City Code chapters and hierarchical sections into a single PDF."""
    with pool.connection() as conn:
        chapters = _load_tree(conn, published_only=True, q="")
        b_row = conn.execute("SELECT city_title FROM agenda_preferences WHERE id = 1").fetchone()
        city_title = (b_row[0] or "").strip() if b_row else ""
        sec_keys = {
            r[0]: r[1]
            for r in conn.execute("SELECT id, object_key FROM code_sections WHERE object_key <> ''").fetchall()
        }

    buf = io.BytesIO()
    doc = SimpleDocTemplate(buf, pagesize=letter, leftMargin=54, rightMargin=54, topMargin=54, bottomMargin=54)
    styles = getSampleStyleSheet()
    heading_title = f"{city_title} — Municipal City Code" if city_title else "Municipal City Code"
    toc_story: list = [
        Paragraph(f"<b>{_xml_escape(heading_title)}</b>", styles["Title"]),
        Spacer(1, 6),
        Paragraph("<b>Table of Contents</b>", styles["Heading2"]),
        Spacer(1, 4),
    ]
    body_story: list = []
    attached_pdfs: list[tuple[str, str, str]] = []

    if not chapters:
        toc_story.append(Paragraph("No published code chapters are currently available.", styles["Normal"]))
    else:
        for ch in chapters:
            toc_story.append(
                Paragraph(f"<b>{_xml_escape(ch['code_prefix'])} — {_xml_escape(ch['title'])}</b>", styles["Normal"])
            )
            body_story.append(PageBreak())
            body_story.append(
                Paragraph(f"<b>{_xml_escape(ch['code_prefix'])} — {_xml_escape(ch['title'])}</b>", styles["Heading1"])
            )
            if ch.get("description"):
                body_story.append(Paragraph(_xml_escape(ch["description"]), styles["Normal"]))
            body_story.append(Spacer(1, 8))
            _append_pdf_toc_and_story(
                ch.get("sections", []), 0, toc_story, body_story, styles, sec_keys, attached_pdfs
            )
            toc_story.append(Spacer(1, 4))

    doc.build(toc_story + body_story)
    main_bytes = buf.getvalue()

    writer = PdfWriter()
    for page in PdfReader(io.BytesIO(main_bytes)).pages:
        writer.add_page(page)
    if chapters and attached_pdfs:
        for _, _, obj_key in attached_pdfs:
            try:
                obj = _minio().get_object(_bucket(), obj_key)
                try:
                    raw = obj.read()
                finally:
                    obj.close()
                    obj.release_conn()
                for page in PdfReader(io.BytesIO(raw)).pages:
                    writer.add_page(page)
            except Exception:
                pass
    apply_pdf_accessibility_metadata(writer, f"{city_title} — Municipal Code")
    out = io.BytesIO()
    writer.write(out)
    main_bytes = out.getvalue()

    disp = "attachment" if download else "inline"
    return Response(
        content=main_bytes,
        media_type="application/pdf",
        headers={"Content-Disposition": f'{disp}; filename="Municipal_City_Code.pdf"'},
    )


@router.get("/sections/{section_id}/pdf")
def get_section_pdf(section_id: int):
    with pool.connection() as conn:
        row = conn.execute(
            "SELECT s.section_number, s.title, s.body, s.ordinance_ref, s.effective_date, "
            "       s.source_pdf_url, s.object_key, c.code_prefix, c.title, s.chapter_id "
            "FROM code_sections s JOIN code_chapters c ON c.id = s.chapter_id "
            "WHERE s.id = %s AND s.is_published = TRUE AND c.is_published = TRUE",
            (section_id,),
        ).fetchone()
        if not row:
            raise HTTPException(status_code=404, detail="Code section not found")
        child_rows = conn.execute(
            "WITH RECURSIVE sub AS ("
            "  SELECT id, parent_id, section_number, title, body, ordinance_ref, effective_date, sort_order, 1 AS depth "
            "  FROM code_sections WHERE parent_id = %s AND is_published = TRUE "
            "  UNION ALL "
            "  SELECT cs.id, cs.parent_id, cs.section_number, cs.title, cs.body, cs.ordinance_ref, cs.effective_date, cs.sort_order, sub.depth + 1 "
            "  FROM code_sections cs JOIN sub ON cs.parent_id = sub.id WHERE cs.is_published = TRUE"
            ") SELECT section_number, title, body, ordinance_ref, effective_date, depth FROM sub ORDER BY depth, sort_order, section_number",
            (section_id,),
        ).fetchall()

    safe_sec = _SAFE_FILENAME_RE.sub("_", str(row[0] or "section")).strip("._") or "section"
    if row[6]:
        obj = _minio().get_object(_bucket(), row[6])
        try:
            data = obj.read()
        finally:
            obj.close()
            obj.release_conn()
        return Response(
            content=data,
            media_type="application/pdf",
            headers={"Content-Disposition": f'inline; filename="Section-{safe_sec}.pdf"'},
        )

    src_url = (row[5] or "").strip()
    if not (row[2] or "").strip() and not child_rows and src_url.lower().startswith(("http://", "https://")):
        return RedirectResponse(url=src_url, status_code=302)

    buf = io.BytesIO()
    doc = SimpleDocTemplate(buf, pagesize=letter, leftMargin=54, rightMargin=54, topMargin=54, bottomMargin=54)
    styles = getSampleStyleSheet()
    story = [
        Paragraph(f"<b>{_xml_escape(str(row[7] or ''))} {_xml_escape(str(row[8] or ''))}</b>", styles["Normal"]),
        Paragraph(f"<b>Section {_xml_escape(str(row[0] or ''))} — {_xml_escape(str(row[1] or ''))}</b>", styles["Title"]),
    ]
    if row[3] or row[4]:
        story.append(
            Paragraph(
                f"Ordinance: {_xml_escape(str(row[3] or '—'))} | Effective: {_xml_escape(str(row[4] or '—'))}",
                styles["Normal"],
            )
        )
    story.append(Spacer(1, 12))
    if (row[2] or "").strip():
        for para in row[2].splitlines():
            if para.strip():
                story.append(Paragraph(_xml_escape(para.strip()), styles["Normal"]))
                story.append(Spacer(1, 6))
    elif not child_rows:
        story.append(Paragraph("Full text available in the official City Code PDF.", styles["Normal"]))

    for c_num, c_title, c_body, c_ord, c_eff, _ in child_rows:
        story.append(Spacer(1, 8))
        story.append(Paragraph(f"<b>Sec. {_xml_escape(str(c_num))} — {_xml_escape(str(c_title))}</b>", styles["Heading2"]))
        if c_ord or c_eff:
            story.append(
                Paragraph(
                    f"<i>Ordinance: {_xml_escape(c_ord or '—')} | Effective: {_xml_escape(c_eff or '—')}</i>",
                    styles["Normal"],
                )
            )
        for para in (c_body or "").splitlines():
            if para.strip():
                story.append(Paragraph(_xml_escape(para.strip()), styles["Normal"]))
                story.append(Spacer(1, 4))

    doc.build(story)
    return Response(
        content=buf.getvalue(),
        media_type="application/pdf",
        headers={"Content-Disposition": f'inline; filename="Section-{safe_sec}.pdf"'},
    )


# ------------------------------------------------------------------ staff endpoints
@router.get("/admin")
def get_admin_code(q: str = "", _: dict = Depends(require_permission("codification.manage"))):
    with pool.connection() as conn:
        return {"chapters": _load_tree(conn, published_only=False, q=q)}


@router.post("/chapters", status_code=201)
def create_chapter(body: ChapterIn, _: dict = Depends(require_permission("codification.manage"))):
    prefix = body.code_prefix.strip()
    title = body.title.strip()
    if not prefix or not title:
        raise HTTPException(status_code=400, detail="Code prefix and title are required")
    with pool.connection() as conn:
        row = conn.execute(
            "INSERT INTO code_chapters (code_prefix, title, description, sort_order, is_published) "
            "VALUES (%s, %s, %s, %s, %s) "
            "RETURNING id, code_prefix, title, description, sort_order, is_published",
            (prefix, title, body.description.strip(), body.sort_order, body.is_published),
        ).fetchone()
    return {"id": row[0], "code_prefix": row[1], "title": row[2], "description": row[3], "sort_order": row[4], "is_published": bool(row[5])}


@router.patch("/chapters/{chapter_id}")
def update_chapter(chapter_id: int, body: ChapterPatch, _: dict = Depends(require_permission("codification.manage"))):
    with pool.connection() as conn:
        row = conn.execute(
            "UPDATE code_chapters SET "
            "code_prefix = COALESCE(%s, code_prefix), "
            "title = COALESCE(%s, title), "
            "description = COALESCE(%s, description), "
            "sort_order = COALESCE(%s, sort_order), "
            "is_published = COALESCE(%s, is_published) "
            "WHERE id = %s RETURNING id, code_prefix, title, description, sort_order, is_published",
            (
                body.code_prefix.strip() if body.code_prefix is not None else None,
                body.title.strip() if body.title is not None else None,
                body.description.strip() if body.description is not None else None,
                body.sort_order,
                body.is_published,
                chapter_id,
            ),
        ).fetchone()
        if not row:
            raise HTTPException(status_code=404, detail="Chapter not found")
    return {"id": row[0], "code_prefix": row[1], "title": row[2], "description": row[3], "sort_order": row[4], "is_published": bool(row[5])}


@router.delete("/chapters/{chapter_id}")
def delete_chapter(chapter_id: int, _: dict = Depends(require_permission("codification.manage"))):
    with pool.connection() as conn:
        keys = [
            r[0]
            for r in conn.execute(
                "SELECT object_key FROM code_sections WHERE chapter_id = %s AND object_key <> ''", (chapter_id,)
            ).fetchall()
        ]
        row = conn.execute("DELETE FROM code_chapters WHERE id = %s RETURNING id", (chapter_id,)).fetchone()
        if not row:
            raise HTTPException(status_code=404, detail="Chapter not found")
    if keys:
        _remove_minio_objects(keys)
    return {"deleted": True, "id": chapter_id}


def _validate_parent_ref(conn, chapter_id: int, section_id: int | None, parent_id: int | None) -> None:
    if parent_id is None:
        return
    if section_id is not None and parent_id == section_id:
        raise HTTPException(status_code=400, detail="Section cannot be its own parent")
    seen: set[int] = set()
    cur_pid: int | None = parent_id
    while cur_pid is not None:
        if cur_pid in seen or (section_id is not None and cur_pid == section_id):
            raise HTTPException(status_code=400, detail="Parent assignment would create a hierarchy cycle")
        seen.add(cur_pid)
        prow = conn.execute(
            "SELECT chapter_id, parent_id FROM code_sections WHERE id = %s", (cur_pid,)
        ).fetchone()
        if not prow:
            raise HTTPException(status_code=404, detail="Parent section not found")
        if prow[0] != chapter_id:
            raise HTTPException(status_code=400, detail="Parent section must belong to the same chapter")
        cur_pid = prow[1]


@router.post("/sections", status_code=201)
def create_section(body: SectionIn, request: Request, user: dict = Depends(require_permission("codification.manage"))):
    sec_num = body.section_number.strip()
    title = body.title.strip()
    if not sec_num or not title:
        raise HTTPException(status_code=400, detail="Section number and title are required")
    ntype = _norm_node_type(body.node_type)
    with pool.connection() as conn:
        _validate_parent_ref(conn, body.chapter_id, None, body.parent_id)
        row = conn.execute(
            "INSERT INTO code_sections "
            "(chapter_id, parent_id, node_type, section_number, article, title, summary, body, ordinance_ref, effective_date, source_pdf_url, sort_order, is_published) "
            "VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s) RETURNING id",
            (
                body.chapter_id, body.parent_id, ntype, sec_num, body.article.strip(), title, body.summary.strip(),
                body.body.strip(), body.ordinance_ref.strip(), body.effective_date.strip(),
                body.source_pdf_url.strip(), body.sort_order, body.is_published,
            ),
        ).fetchone()
        conn.execute(
            "INSERT INTO code_revisions (section_id, ordinance_number, effective_date, change_summary, new_body, edited_by) "
            "VALUES (%s, %s, %s, 'Section created', %s, %s)",
            (row[0], body.ordinance_ref.strip(), body.effective_date.strip(), body.body.strip(), user["username"]),
        )
    if body.is_published:
        notify_topic_subscribers(
            "codification",
            f"[DocketHall] City Code Added: § {sec_num} — {title}",
            f"Municipal Code Section {sec_num} ({title}) has been published.",
            link_path="/#codification",
            request=request,
        )
    return {"id": row[0], "section_number": sec_num, "title": title, "parent_id": body.parent_id, "node_type": ntype}


@router.patch("/sections/{section_id}")
def update_section(section_id: int, body: SectionPatch, request: Request, user: dict = Depends(require_permission("codification.manage"))):
    with pool.connection() as conn:
        cur = conn.execute(
            "SELECT chapter_id, parent_id, body, title, ordinance_ref, effective_date FROM code_sections WHERE id = %s",
            (section_id,),
        ).fetchone()
        if not cur:
            raise HTTPException(status_code=404, detail="Section not found")
        next_parent_id = body.parent_id if "parent_id" in body.model_fields_set else cur[1]
        if "parent_id" in body.model_fields_set:
            _validate_parent_ref(conn, cur[0], section_id, next_parent_id)
        next_ntype = _norm_node_type(body.node_type) if body.node_type is not None else None

        row = conn.execute(
            "UPDATE code_sections SET "
            "parent_id = %s, "
            "node_type = COALESCE(%s, node_type), "
            "section_number = COALESCE(%s, section_number), "
            "article = COALESCE(%s, article), "
            "title = COALESCE(%s, title), "
            "summary = COALESCE(%s, summary), "
            "body = COALESCE(%s, body), "
            "ordinance_ref = COALESCE(%s, ordinance_ref), "
            "effective_date = COALESCE(%s, effective_date), "
            "source_pdf_url = COALESCE(%s, source_pdf_url), "
            "sort_order = COALESCE(%s, sort_order), "
            "is_published = COALESCE(%s, is_published), "
            "updated_at = now() "
            "WHERE id = %s "
            "RETURNING id, chapter_id, parent_id, node_type, section_number, article, title, summary, body, ordinance_ref, effective_date, source_pdf_url, object_key, sort_order, is_published, updated_at",
            (
                next_parent_id,
                next_ntype,
                body.section_number.strip() if body.section_number is not None else None,
                body.article.strip() if body.article is not None else None,
                body.title.strip() if body.title is not None else None,
                body.summary.strip() if body.summary is not None else None,
                body.body.strip() if body.body is not None else None,
                body.ordinance_ref.strip() if body.ordinance_ref is not None else None,
                body.effective_date.strip() if body.effective_date is not None else None,
                body.source_pdf_url.strip() if body.source_pdf_url is not None else None,
                body.sort_order,
                body.is_published,
                section_id,
            ),
        ).fetchone()
        if body.body is not None or body.title is not None or body.ordinance_ref is not None or body.change_summary.strip():
            conn.execute(
                "INSERT INTO code_revisions (section_id, ordinance_number, effective_date, change_summary, previous_body, new_body, edited_by) "
                "VALUES (%s, %s, %s, %s, %s, %s, %s)",
                (
                    section_id,
                    row[9],
                    row[10],
                    body.change_summary.strip() or "Section updated",
                    cur[2],
                    row[8],
                    user["username"],
                ),
            )
    if row[14] and (body.body is not None or body.title is not None or body.ordinance_ref is not None or body.change_summary.strip()):
        notify_topic_subscribers(
            "codification",
            f"[DocketHall] City Code Updated: § {row[4]} — {row[6]}",
            f"Municipal Code Section {row[4]} ({row[6]}) was updated.",
            link_path="/#codification",
            request=request,
        )
    return {
        "id": row[0], "chapter_id": row[1], "parent_id": row[2], "node_type": row[3] or "section",
        "section_number": row[4], "article": row[5] or "", "title": row[6],
        "summary": row[7], "body": row[8], "ordinance_ref": row[9], "effective_date": row[10],
        "source_pdf_url": row[11], "has_uploaded_pdf": bool(row[12]), "sort_order": row[13],
        "is_published": bool(row[14]), "updated_at": row[15].isoformat() if row[15] else None,
    }


@router.delete("/sections/{section_id}")
def delete_section(section_id: int, _: dict = Depends(require_permission("codification.manage"))):
    with pool.connection() as conn:
        keys = [
            r[0]
            for r in conn.execute(
                "WITH RECURSIVE sub AS ("
                "  SELECT id, object_key FROM code_sections WHERE id = %s "
                "  UNION ALL "
                "  SELECT cs.id, cs.object_key FROM code_sections cs JOIN sub ON cs.parent_id = sub.id"
                ") SELECT object_key FROM sub WHERE object_key <> ''",
                (section_id,),
            ).fetchall()
        ]
        row = conn.execute("DELETE FROM code_sections WHERE id = %s RETURNING id", (section_id,)).fetchone()
        if not row:
            raise HTTPException(status_code=404, detail="Section not found")
    if keys:
        _remove_minio_objects(keys)
    return {"deleted": True, "id": section_id}


def _is_safe_public_http_url(url: str) -> bool:
    try:
        parsed = urlparse((url or "").strip())
    except Exception:
        return False
    if parsed.scheme.lower() not in ("http", "https") or not parsed.hostname:
        return False
    host = parsed.hostname.lower()
    if host in ("localhost", "localhost.localdomain") or host.endswith(".local"):
        return False
    try:
        ip_obj = ipaddress.ip_address(host)
        if ip_obj.is_private or ip_obj.is_loopback or ip_obj.is_link_local or ip_obj.is_reserved or ip_obj.is_multicast:
            return False
        return True
    except ValueError:
        pass
    try:
        infos = socket.getaddrinfo(host, parsed.port or (443 if parsed.scheme == "https" else 80), type=socket.SOCK_STREAM)
    except OSError:
        return False
    if not infos:
        return False
    for _, _, _, _, sockaddr in infos:
        addr = sockaddr[0]
        try:
            ip_obj = ipaddress.ip_address(addr)
        except ValueError:
            return False
        if ip_obj.is_private or ip_obj.is_loopback or ip_obj.is_link_local or ip_obj.is_reserved or ip_obj.is_multicast:
            return False
    return True


class _PdfLinkHTMLParser(HTMLParser):
    def __init__(self) -> None:
        super().__init__()
        self.in_title = False
        self.page_title_parts: list[str] = []
        self.in_anchor = False
        self.cur_href = ""
        self.cur_type = ""
        self.cur_text_parts: list[str] = []
        self.links: list[tuple[str, str, str]] = []

    def handle_starttag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        t = tag.lower()
        if t == "title":
            self.in_title = True
        elif t == "a":
            attr_map = {k.lower(): (v or "") for k, v in attrs}
            if "href" in attr_map:
                self.in_anchor = True
                self.cur_href = attr_map["href"]
                self.cur_type = attr_map.get("type", "")
                self.cur_text_parts = []

    def handle_data(self, data: str) -> None:
        if self.in_title:
            self.page_title_parts.append(data)
        if self.in_anchor:
            self.cur_text_parts.append(data)

    def handle_endtag(self, tag: str) -> None:
        t = tag.lower()
        if t == "title":
            self.in_title = False
        elif t == "a" and self.in_anchor:
            self.in_anchor = False
            label = re.sub(r"\s+", " ", "".join(self.cur_text_parts)).strip()
            self.links.append((self.cur_href.strip(), self.cur_type.strip(), label))


def extract_pdf_links_from_html(html: str, base_url: str) -> tuple[str, list[dict]]:
    """Extract deduplicated PDF links & inferred metadata from municipal webpage HTML."""
    parser = _PdfLinkHTMLParser()
    parser.feed(html or "")
    parser.close()
    page_title = re.sub(r"\s+", " ", "".join(parser.page_title_parts)).strip()

    items: list[dict] = []
    seen_urls: set[str] = set()
    for href, type_attr, label in parser.links:
        if not href or href.startswith(("#", "mailto:", "javascript:", "tel:")):
            continue
        abs_url = urljoin(base_url, href)
        parsed = urlparse(abs_url)
        if parsed.scheme.lower() not in ("http", "https") or not parsed.hostname:
            continue
        # Strip fragment while keeping query params if any
        clean_url = parsed._replace(fragment="").geturl()
        is_pdf_path = parsed.path.lower().endswith(".pdf") or "pdf" in type_attr.lower()
        if not is_pdf_path or clean_url in seen_urls:
            continue
        seen_urls.add(clean_url)
        fname = unquote(os.path.basename(parsed.path)) or "document.pdf"
        info = infer_section_info_from_filename(fname)
        title = info["title"] or label or fname.rsplit(".", 1)[0]
        if label and (not info["title"] or info["title"].lower() == fname.rsplit(".", 1)[0].lower()):
            title = label
        items.append({
            "url": clean_url,
            "filename": fname,
            "link_text": label,
            "chapter_prefix": info["chapter_prefix"] or "General",
            "section_number": info["section_number"] or "",
            "title": title,
        })
    return (page_title, items)


def _open_public_url(url: str, max_bytes: int, timeout: int = 25) -> tuple[str, bytes]:
    import urllib.request

    class _SafeRedirectHandler(urllib.request.HTTPRedirectHandler):
        def redirect_request(self, req, fp, code, msg, headers, newurl):
            if not _is_safe_public_http_url(newurl):
                raise ValueError("Redirect target must resolve to a public HTTP/HTTPS address")
            return super().redirect_request(req, fp, code, msg, headers, newurl)

    if not _is_safe_public_http_url(url):
        raise ValueError("URL must resolve to a public HTTP/HTTPS address")
    opener = urllib.request.build_opener(_SafeRedirectHandler())
    req = urllib.request.Request(url, headers={"User-Agent": "DocketHall-Codification/1.0"})
    with opener.open(req, timeout=timeout) as resp:
        final_url = resp.geturl() or url
        if not _is_safe_public_http_url(final_url):
            raise ValueError("Final URL must resolve to a public HTTP/HTTPS address")
        raw = resp.read(max_bytes + 1)
    if len(raw) > max_bytes:
        raise ValueError("Downloaded resource exceeds size limit")
    return (final_url, raw)


def _fetch_public_pdf_bytes(url: str) -> bytes:
    _, raw = _open_public_url(url, MAX_CODE_PDF_BYTES, timeout=25)
    if not raw.startswith(b"%PDF-"):
        raise ValueError("Downloaded resource is not a valid PDF")
    return raw


def _fetch_public_html(url: str) -> tuple[str, str]:
    final_url, raw = _open_public_url(url, MAX_HTML_BYTES, timeout=15)
    return (final_url, raw.decode("utf-8", errors="replace"))


def _unpack_pdf_zip(raw: bytes, zip_name: str, warnings: list[str]) -> list[tuple[str, bytes]]:
    """Safely extract valid PDF entries from an uploaded .zip archive."""
    out: list[tuple[str, bytes]] = []
    try:
        zf = zipfile.ZipFile(io.BytesIO(raw))
    except zipfile.BadZipFile:
        warnings.append(f"{zip_name}: skipped (not a valid .zip archive)")
        return out

    total_bytes = 0
    with zf:
        for info in sorted(zf.infolist(), key=lambda i: i.filename.lower()):
            if info.is_dir():
                continue
            parts = [p for p in info.filename.replace("\\", "/").split("/") if p]
            if not parts or any(p == "__MACOSX" or p.startswith(".") for p in parts):
                continue
            base = parts[-1]
            if not base.lower().endswith(".pdf"):
                continue
            if len(out) >= MAX_ZIP_FILES:
                warnings.append(f"{zip_name}: capped at {MAX_ZIP_FILES} PDFs per archive")
                break
            if info.file_size > MAX_CODE_PDF_BYTES or total_bytes + info.file_size > MAX_ZIP_UNCOMPRESSED_BYTES:
                warnings.append(f"{zip_name}/{base}: skipped (exceeds zip extraction size limit)")
                continue
            with zf.open(info, "r") as fh:
                data = fh.read(MAX_CODE_PDF_BYTES + 1)
            if len(data) > MAX_CODE_PDF_BYTES or total_bytes + len(data) > MAX_ZIP_UNCOMPRESSED_BYTES:
                warnings.append(f"{zip_name}/{base}: skipped (exceeds size limit)")
                continue
            if not data.startswith(b"%PDF-"):
                warnings.append(f"{zip_name}/{base}: skipped (not a valid PDF)")
                continue
            total_bytes += len(data)
            out.append((base, data))
    return out


def _upsert_section_tree(
    conn,
    chap_id: int,
    nodes: list[dict],
    parent_id: int | None,
    overwrite_existing: bool,
    user: dict,
    stats: dict,
    raw_by_key: dict[tuple[str, str], tuple[str, bytes]],
    ch_key: str,
    is_published: bool = True,
) -> None:
    next_sort = (
        conn.execute(
            "SELECT COALESCE(MAX(sort_order), 0) FROM code_sections WHERE chapter_id = %s AND parent_id IS NOT DISTINCT FROM %s",
            (chap_id, parent_id),
        ).fetchone()
        or [0]
    )[0]

    for idx, sec in enumerate(nodes):
        sec_num = str(sec.get("section_number") or "").strip()
        if not sec_num:
            continue
        title = str(sec.get("title") or "").strip() or f"Section {sec_num}"
        ntype = _norm_node_type(sec.get("node_type") or ("series" if sec.get("children") else "section"))
        art = str(sec.get("article") or "").strip()
        body = str(sec.get("body") or "").strip()
        ord_ref = str(sec.get("ordinance_ref") or "").strip()
        eff_date = str(sec.get("effective_date") or "").strip()
        summary = str(sec.get("summary") or "").strip()
        src_url = str(sec.get("source_pdf_url") or "").strip()
        child_nodes = sec.get("children") if isinstance(sec.get("children"), list) else []

        existing_sec = conn.execute(
            "SELECT id, parent_id, node_type, title, article, body, ordinance_ref, effective_date, object_key, source_pdf_url "
            "FROM code_sections WHERE chapter_id = %s AND LOWER(section_number) = LOWER(%s)",
            (chap_id, sec_num),
        ).fetchone()

        if existing_sec and existing_sec[0] == parent_id:
            sec_num = f"{sec_num}-sub"
            existing_sec = conn.execute(
                "SELECT id, parent_id, node_type, title, article, body, ordinance_ref, effective_date, object_key, source_pdf_url "
                "FROM code_sections WHERE chapter_id = %s AND LOWER(section_number) = LOWER(%s)",
                (chap_id, sec_num),
            ).fetchone()

        if existing_sec and not overwrite_existing:
            stats["sections_skipped"] += 1
            sec_id = existing_sec[0]
        elif existing_sec:
            sec_id = existing_sec[0]
            next_title = existing_sec[3] if (existing_sec[3] and title.startswith("Section ")) else (title or existing_sec[3])
            next_art = art or existing_sec[4] or ""
            next_body = body if (child_nodes or body) else (existing_sec[5] or "")
            next_ord = ord_ref or existing_sec[6] or ""
            next_eff = eff_date or existing_sec[7] or ""
            next_src = src_url or existing_sec[9] or ""
            conn.execute(
                "UPDATE code_sections SET parent_id = %s, node_type = %s, title = %s, article = %s, body = %s, "
                "ordinance_ref = %s, effective_date = %s, source_pdf_url = %s, updated_at = now() WHERE id = %s",
                (parent_id, ntype, next_title, next_art, next_body, next_ord, next_eff, next_src, sec_id),
            )
            if next_body != (existing_sec[5] or "") or next_title != existing_sec[3]:
                conn.execute(
                    "INSERT INTO code_revisions (section_id, ordinance_number, effective_date, change_summary, previous_body, new_body, edited_by) "
                    "VALUES (%s, %s, %s, %s, %s, %s, %s)",
                    (sec_id, next_ord, next_eff, f"Imported PDF ({sec.get('source_filename', 'upload.pdf')})", existing_sec[5], next_body, user["username"]),
                )
            if parent_id is None:
                stats["sections_updated"] += 1
            else:
                stats["children_updated"] += 1
        else:
            next_sort += 1
            srow = conn.execute(
                "INSERT INTO code_sections (chapter_id, parent_id, node_type, section_number, article, title, summary, body, ordinance_ref, effective_date, source_pdf_url, sort_order, is_published) "
                "VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s) RETURNING id",
                (chap_id, parent_id, ntype, sec_num, art, title, summary, body, ord_ref, eff_date, src_url, next_sort, is_published),
            ).fetchone()
            sec_id = srow[0]
            conn.execute(
                "INSERT INTO code_revisions (section_id, ordinance_number, effective_date, change_summary, new_body, edited_by) "
                "VALUES (%s, %s, %s, %s, %s, %s)",
                (sec_id, ord_ref, eff_date, f"Created from PDF ({sec.get('source_filename', 'upload.pdf')})", body, user["username"]),
            )
            if parent_id is None:
                stats["sections_created"] += 1
            else:
                stats["children_created"] += 1

        if parent_id is None:
            raw_pair = raw_by_key.get((ch_key, sec_num.lower()))
            if raw_pair:
                raw_name, raw_bytes = raw_pair
                obj_key = tenant_object_key(f"codification/{sec_id}/{uuid.uuid4().hex[:12]}_{raw_name}")
                try:
                    _minio().put_object(_bucket(), obj_key, io.BytesIO(raw_bytes), length=len(raw_bytes), content_type="application/pdf")
                    old_obj = existing_sec[8] if existing_sec else ""
                    conn.execute("UPDATE code_sections SET object_key = %s WHERE id = %s", (obj_key, sec_id))
                    if old_obj:
                        _remove_minio_objects([old_obj])
                except Exception as exc:
                    stats["warnings"].append(f"Section {sec_num}: stored text but PDF upload failed ({exc})")

        if child_nodes:
            _upsert_section_tree(
                conn, chap_id, child_nodes, sec_id, overwrite_existing, user, stats, raw_by_key, ch_key, is_published=is_published
            )


def _append_parsed_to_chapters(
    parsed: dict,
    source_label: str,
    merged_chapters: list[dict],
    chap_by_key: dict[str, dict],
    target_chap_info: dict | None,
    raw_by_key: dict[tuple[str, str], tuple[str, bytes]] | None = None,
    raw_bytes: bytes | None = None,
    safe_fname: str = "",
    source_pdf_url: str = "",
    fallback_title: str = "",
) -> None:
    is_single = parsed.get("kind") == "section"
    for ch in parsed.get("chapters", []):
        ch_prefix = target_chap_info["code_prefix"] if target_chap_info else ch["code_prefix"]
        ch_title = target_chap_info["title"] if target_chap_info else ch["title"]
        ch_key = ch_prefix.lower()
        bucket_chap = chap_by_key.get(ch_key)
        if not bucket_chap:
            bucket_chap = {"code_prefix": ch_prefix, "title": ch_title, "sections": []}
            chap_by_key[ch_key] = bucket_chap
            merged_chapters.append(bucket_chap)
        for sec in ch.get("sections", []):
            sec_title = sec.get("title") or ""
            if fallback_title and (not sec_title or sec_title.startswith(("Section ", "Untitled"))):
                sec_title = fallback_title
            sec_copy = {**sec, "title": sec_title, "source_filename": source_label}
            if source_pdf_url:
                sec_copy["source_pdf_url"] = source_pdf_url
            bucket_chap["sections"].append(sec_copy)
            if is_single and raw_by_key is not None and raw_bytes is not None and safe_fname:
                raw_by_key[(ch_key, sec_copy["section_number"].lower())] = (safe_fname, raw_bytes)


def _commit_chapters_tree(
    conn,
    merged_chapters: list[dict],
    target_chap_info: dict | None,
    overwrite_existing: bool,
    publish_immediately: bool,
    user: dict,
    stats: dict,
    raw_by_key: dict[tuple[str, str], tuple[str, bytes]],
) -> None:
    existing_chaps = {
        r[1].strip().lower(): (r[0], r[1], r[2])
        for r in conn.execute("SELECT id, code_prefix, title FROM code_chapters").fetchall()
    }
    next_chap_sort = (conn.execute("SELECT COALESCE(MAX(sort_order), 0) FROM code_chapters").fetchone() or [0])[0]

    for ch in merged_chapters:
        ch_key = str(ch.get("code_prefix") or "General").strip().lower()
        if target_chap_info is not None:
            chap_id = target_chap_info["id"]
            ch_key = target_chap_info["code_prefix"].strip().lower()
        elif ch_key in existing_chaps:
            chap_id = existing_chaps[ch_key][0]
        else:
            next_chap_sort += 1
            crow = conn.execute(
                "INSERT INTO code_chapters (code_prefix, title, sort_order, is_published) "
                "VALUES (%s, %s, %s, %s) RETURNING id",
                (ch.get("code_prefix") or "General", ch.get("title") or "City Code", next_chap_sort, publish_immediately),
            ).fetchone()
            chap_id = crow[0]
            existing_chaps[ch_key] = (chap_id, ch.get("code_prefix"), ch.get("title"))
            stats["chapters_created"] += 1

        _upsert_section_tree(
            conn,
            chap_id,
            ch.get("sections") or [],
            None,
            overwrite_existing,
            user,
            stats,
            raw_by_key,
            ch_key,
            is_published=publish_immediately,
        )


@router.post("/sections/{section_id}/pdf")
async def upload_section_pdf(
    section_id: int,
    file: UploadFile = File(...),
    auto_extract: bool = Form(True),
    split_children: bool = Form(True),
    enable_ocr: bool = Form(True),
    user: dict = Depends(require_permission("codification.manage")),
):
    raw = await file.read(MAX_CODE_PDF_BYTES + 1)
    if len(raw) > MAX_CODE_PDF_BYTES:
        raise HTTPException(status_code=413, detail="PDF exceeds 50 MB limit")
    if not raw.startswith(b"%PDF-"):
        raise HTTPException(status_code=400, detail="Uploaded file must be a valid PDF")

    orig_name = _SAFE_FILENAME_RE.sub("_", (file.filename or "section.pdf").strip()) or "section.pdf"
    obj_key = tenant_object_key(f"codification/{section_id}/{uuid.uuid4().hex[:12]}_{orig_name}")
    _minio().put_object(_bucket(), obj_key, io.BytesIO(raw), length=len(raw), content_type="application/pdf")

    parsed_body = ""
    parsed_ord = ""
    parsed_eff = ""
    parsed_art = ""
    parsed_children: list[dict] = []
    used_ocr = False
    ocr_pages: list[int] = []
    pages = 0

    if auto_extract:
        try:
            parsed = await run_in_threadpool(parse_code_pdf, raw, orig_name, split_children, enable_ocr)
            pages = int(parsed.get("pages") or 0)
            used_ocr = bool(parsed.get("used_ocr"))
            ocr_pages = list(parsed.get("ocr_pages") or [])
            all_secs = [s for ch in parsed.get("chapters", []) for s in ch.get("sections", [])]
            if len(all_secs) == 1:
                parsed_body = (all_secs[0].get("body") or "").strip()
                parsed_ord = all_secs[0].get("ordinance_ref") or ""
                parsed_eff = all_secs[0].get("effective_date") or ""
                parsed_art = all_secs[0].get("article") or ""
                parsed_children = list(all_secs[0].get("children") or [])
            else:
                doc_info = await run_in_threadpool(extract_pdf_document, raw, enable_ocr)
                pages = int(doc_info.get("page_count") or pages)
                used_ocr = bool(doc_info.get("used_ocr"))
                ocr_pages = list(doc_info.get("ocr_pages") or [])
                parsed_body = clean_pdf_pages(doc_info["pages_text"])
                meta = extract_ordinance_metadata(parsed_body, orig_name)
                parsed_ord = meta["ordinance_ref"]
                parsed_eff = meta["effective_date"]
        except Exception:
            parsed_body = ""

    children_created = 0
    with pool.connection() as conn:
        old = conn.execute(
            "SELECT chapter_id, object_key, body, ordinance_ref, effective_date, article, node_type FROM code_sections WHERE id = %s",
            (section_id,),
        ).fetchone()
        if not old:
            _remove_minio_objects([obj_key])
            raise HTTPException(status_code=404, detail="Section not found")
        chap_id = old[0]
        if parsed_body or parsed_children:
            next_ord = old[3] or parsed_ord
            next_eff = old[4] or parsed_eff
            next_art = old[5] or parsed_art
            next_ntype = "series" if parsed_children else (old[6] or "section")
            conn.execute(
                "UPDATE code_sections SET object_key = %s, node_type = %s, body = %s, ordinance_ref = %s, effective_date = %s, article = %s, updated_at = now() WHERE id = %s",
                (obj_key, next_ntype, parsed_body, next_ord, next_eff, next_art, section_id),
            )
            conn.execute(
                "INSERT INTO code_revisions (section_id, ordinance_number, effective_date, change_summary, previous_body, new_body, edited_by) "
                "VALUES (%s, %s, %s, %s, %s, %s, %s)",
                (section_id, next_ord, next_eff, f"Uploaded & auto-extracted PDF: {orig_name}", old[2], parsed_body, user["username"]),
            )
            if parsed_children:
                stats = {"sections_created": 0, "sections_updated": 0, "sections_skipped": 0, "children_created": 0, "children_updated": 0, "warnings": []}
                _upsert_section_tree(conn, chap_id, parsed_children, section_id, True, user, stats, {}, "")
                children_created = stats["children_created"]
        else:
            next_ord = old[3]
            next_eff = old[4]
            conn.execute("UPDATE code_sections SET object_key = %s, updated_at = now() WHERE id = %s", (obj_key, section_id))
            conn.execute(
                "INSERT INTO code_revisions (section_id, change_summary, edited_by) VALUES (%s, %s, %s)",
                (section_id, f"Uploaded PDF: {orig_name}", user["username"]),
            )
    if old[1]:
        _remove_minio_objects([old[1]])
    return {
        "ok": True,
        "has_uploaded_pdf": True,
        "extracted": bool(parsed_body or parsed_children),
        "pages": pages,
        "used_ocr": used_ocr,
        "ocr_pages": ocr_pages,
        "children_created": children_created,
        "body": parsed_body,
        "ordinance_ref": next_ord,
        "effective_date": next_eff,
    }


@router.get("/sections/{section_id}/revisions")
def list_section_revisions(section_id: int, _: dict = Depends(require_permission("codification.manage"))):
    with pool.connection() as conn:
        rows = conn.execute(
            "SELECT id, ordinance_number, effective_date, change_summary, previous_body, new_body, edited_by, created_at "
            "FROM code_revisions WHERE section_id = %s ORDER BY id DESC",
            (section_id,),
        ).fetchall()
    return [
        {
            "id": r[0], "ordinance_number": r[1], "effective_date": r[2],
            "change_summary": r[3], "previous_body": r[4], "new_body": r[5],
            "edited_by": r[6], "created_at": r[7].isoformat() if r[7] else None,
        }
        for r in rows
    ]


@router.post("/sections/{section_id}/extract-pdf")
async def extract_section_pdf_text(
    section_id: int,
    raw: bool = False,
    enable_ocr: bool = True,
    _: dict = Depends(require_permission("codification.manage")),
):
    with pool.connection() as conn:
        row = conn.execute(
            "SELECT object_key, source_pdf_url FROM code_sections WHERE id = %s", (section_id,)
        ).fetchone()
        if not row:
            raise HTTPException(status_code=404, detail="Section not found")
    obj_key, src_url = row[0], (row[1] or "").strip()

    def _run_extract() -> dict:
        pdf_bytes: bytes | None = None
        if obj_key:
            obj = _minio().get_object(_bucket(), obj_key)
            try:
                pdf_bytes = obj.read()
            finally:
                obj.close()
                obj.release_conn()
        elif src_url.startswith(("https://", "http://")):
            pdf_bytes = _fetch_public_pdf_bytes(src_url)
        else:
            raise ValueError("No uploaded PDF or source PDF URL on this section")

        doc_info = extract_pdf_document(pdf_bytes, enable_ocr=enable_ocr)
        pages_text = doc_info["pages_text"]
        if raw:
            combined = "\n\n".join(t for t in pages_text if t)
        else:
            combined = clean_pdf_pages(pages_text)
        meta = extract_ordinance_metadata(combined, src_url)
        return {
            "text": combined,
            "pages": doc_info["page_count"],
            "used_ocr": doc_info["used_ocr"],
            "ocr_pages": doc_info["ocr_pages"],
            "ordinance_ref": meta["ordinance_ref"],
            "effective_date": meta["effective_date"],
            "subsection_count": count_subsections(combined),
        }

    try:
        return await run_in_threadpool(_run_extract)
    except Exception as exc:
        raise HTTPException(status_code=400, detail=f"Could not extract PDF text: {exc}")


@router.post("/sections/{section_id}/reformat")
def reformat_section_body(
    section_id: int,
    apply: bool = False,
    user: dict = Depends(require_permission("codification.manage")),
):
    with pool.connection() as conn:
        row = conn.execute(
            "SELECT body, ordinance_ref, effective_date FROM code_sections WHERE id = %s",
            (section_id,),
        ).fetchone()
        if not row:
            raise HTTPException(status_code=404, detail="Section not found")
        cur_body, cur_ord, cur_eff = row[0] or "", row[1] or "", row[2] or ""
        cleaned = clean_pdf_pages([cur_body])
        meta = extract_ordinance_metadata(cleaned)
        next_ord = cur_ord or meta["ordinance_ref"]
        next_eff = cur_eff or meta["effective_date"]
        if apply and (cleaned != cur_body or next_ord != cur_ord or next_eff != cur_eff):
            conn.execute(
                "UPDATE code_sections SET body = %s, ordinance_ref = %s, effective_date = %s, updated_at = now() WHERE id = %s",
                (cleaned, next_ord, next_eff, section_id),
            )
            conn.execute(
                "INSERT INTO code_revisions (section_id, ordinance_number, effective_date, change_summary, previous_body, new_body, edited_by) "
                "VALUES (%s, %s, %s, 'Reformatted code text', %s, %s, %s)",
                (section_id, next_ord, next_eff, cur_body, cleaned, user["username"]),
            )
    return {
        "id": section_id,
        "body": cleaned,
        "ordinance_ref": next_ord,
        "effective_date": next_eff,
        "subsection_count": count_subsections(cleaned),
        "applied": apply,
    }


@router.post("/sections/{section_id}/split")
def split_section_into_children_endpoint(
    section_id: int,
    apply: bool = False,
    user: dict = Depends(require_permission("codification.manage")),
):
    with pool.connection() as conn:
        row = conn.execute(
            "SELECT chapter_id, section_number, body, ordinance_ref, effective_date FROM code_sections WHERE id = %s",
            (section_id,),
        ).fetchone()
        if not row:
            raise HTTPException(status_code=404, detail="Section not found")
        chap_id, sec_num, cur_body, cur_ord, cur_eff = row[0], row[1], row[2] or "", row[3] or "", row[4] or ""
        cleaned = clean_pdf_pages([cur_body])
        preamble, children, scheme = split_section_body_into_children(cleaned, parent_number=sec_num)

        created = 0
        updated = 0
        if apply and len(children) >= 2:
            meta = extract_ordinance_metadata(cleaned)
            next_ord = cur_ord or meta["ordinance_ref"]
            next_eff = cur_eff or meta["effective_date"]
            conn.execute(
                "UPDATE code_sections SET node_type = 'series', body = %s, ordinance_ref = %s, effective_date = %s, updated_at = now() WHERE id = %s",
                (preamble, next_ord, next_eff, section_id),
            )
            conn.execute(
                "INSERT INTO code_revisions (section_id, ordinance_number, effective_date, change_summary, previous_body, new_body, edited_by) "
                "VALUES (%s, %s, %s, %s, %s, %s, %s)",
                (section_id, next_ord, next_eff, f"Split into {len(children)} child sections ({scheme})", cur_body, preamble, user["username"]),
            )
            stats = {"sections_created": 0, "sections_updated": 0, "sections_skipped": 0, "children_created": 0, "children_updated": 0, "warnings": []}
            _upsert_section_tree(conn, chap_id, children, section_id, True, user, stats, {}, "")
            created = stats["children_created"]
            updated = stats["children_updated"]

    return {
        "id": section_id,
        "scheme": scheme,
        "preamble": preamble,
        "children_count": len(children),
        "children": [
            {"section_number": c["section_number"], "title": c["title"], "body_length": len(c.get("body") or "")}
            for c in children
        ],
        "children_created": created,
        "children_updated": updated,
        "applied": bool(apply and len(children) >= 2),
    }


def _preview_nodes(nodes: list[dict]) -> tuple[list[dict], int]:
    out = []
    count = 0
    for s in nodes:
        kids, k_cnt = _preview_nodes(s.get("children") or [])
        count += 1 + k_cnt
        item = {
            "section_number": s.get("section_number", ""),
            "node_type": s.get("node_type", "section"),
            "article": s.get("article", ""),
            "title": s.get("title", ""),
            "summary": s.get("summary", ""),
            "body": s.get("body", ""),
            "ordinance_ref": s.get("ordinance_ref", ""),
            "effective_date": s.get("effective_date", ""),
            "subsection_count": s.get("subsection_count", 0),
            "body_length": len(s.get("body") or ""),
            "body_preview": (s.get("body") or "")[:360],
            "source_filename": s.get("source_filename", ""),
            "children": kids,
        }
        if s.get("source_pdf_url"):
            item["source_pdf_url"] = s["source_pdf_url"]
        out.append(item)
    return (out, count)


def _build_preview_payload(
    merged_chapters: list[dict],
    files_processed: int,
    ocr_files: int,
    ocr_pages_total: int,
    warnings: list[str],
    failed: list[dict] | None = None,
) -> dict:
    preview_chapters = []
    total_nodes = 0
    for ch in merged_chapters:
        p_secs, n_cnt = _preview_nodes(ch.get("sections") or [])
        total_nodes += n_cnt
        preview_chapters.append({
            "code_prefix": ch["code_prefix"],
            "title": ch["title"],
            "sections": p_secs,
        })
    payload = {
        "mode": "preview",
        "files_processed": files_processed,
        "total_sections": len([s for ch in preview_chapters for s in ch["sections"]]),
        "total_nodes": total_nodes,
        "ocr_files": ocr_files,
        "ocr_pages": ocr_pages_total,
        "chapters": preview_chapters,
        "warnings": warnings,
    }
    if failed is not None:
        payload["failed"] = failed
    return payload


def _resolve_target_chapter(target_chapter_id: int | None) -> dict | None:
    if target_chapter_id is None:
        return None
    with pool.connection() as conn:
        crow = conn.execute(
            "SELECT id, code_prefix, title FROM code_chapters WHERE id = %s",
            (target_chapter_id,),
        ).fetchone()
    if not crow:
        raise HTTPException(status_code=404, detail="Target chapter not found")
    return {"id": crow[0], "code_prefix": crow[1], "title": crow[2]}


@router.post("/import-pdfs")
async def import_code_pdfs(
    files: list[UploadFile] = File(...),
    commit: bool = Form(False),
    target_chapter_id: int | None = Form(None),
    overwrite_existing: bool = Form(True),
    split_children: bool = Form(True),
    enable_ocr: bool = Form(True),
    publish_immediately: bool = Form(True),
    override_tree_json: str | None = Form(None),
    user: dict = Depends(require_permission("codification.manage")),
):
    if not files:
        raise HTTPException(status_code=400, detail="Please upload at least one PDF or .zip file")

    merged_chapters: list[dict] = []
    chap_by_key: dict[str, dict] = {}
    warnings: list[str] = []
    files_processed = 0
    ocr_files = 0
    ocr_pages_total = 0
    raw_by_key: dict[tuple[str, str], tuple[str, bytes]] = {}
    target_chap_info = _resolve_target_chapter(target_chapter_id)

    pdf_entries: list[tuple[str, str, bytes]] = []
    for up in files:
        orig_label = (up.filename or "upload.pdf").strip() or "upload.pdf"
        safe_fname = _SAFE_FILENAME_RE.sub("_", orig_label) or "upload.pdf"
        raw = await up.read(MAX_ZIP_UNCOMPRESSED_BYTES + 1 if orig_label.lower().endswith(".zip") else MAX_CODE_PDF_BYTES + 1)
        if orig_label.lower().endswith(".zip") or raw[:4] == b"PK\x03\x04":
            for inner_name, inner_bytes in _unpack_pdf_zip(raw, orig_label, warnings):
                safe_inner = _SAFE_FILENAME_RE.sub("_", inner_name) or "section.pdf"
                pdf_entries.append((inner_name, safe_inner, inner_bytes))
            continue
        if len(raw) > MAX_CODE_PDF_BYTES:
            warnings.append(f"{orig_label}: skipped (exceeds 50 MB limit)")
            continue
        if not raw.startswith(b"%PDF-"):
            warnings.append(f"{orig_label}: skipped (not a valid PDF)")
            continue
        pdf_entries.append((orig_label, safe_fname, raw))

    for orig_label, safe_fname, raw in pdf_entries:
        parsed = await run_in_threadpool(parse_code_pdf, raw, orig_label, split_children, enable_ocr)
        files_processed += 1
        if parsed.get("used_ocr"):
            ocr_files += 1
            ocr_pages_total += len(parsed.get("ocr_pages") or [])
        warnings.extend(parsed.get("warnings") or [])
        _append_parsed_to_chapters(
            parsed,
            orig_label,
            merged_chapters,
            chap_by_key,
            target_chap_info,
            raw_by_key=raw_by_key,
            raw_bytes=raw,
            safe_fname=safe_fname,
        )

    if commit and override_tree_json:
        try:
            custom_chapters = json.loads(override_tree_json)
            if not isinstance(custom_chapters, list):
                raise ValueError("override_tree_json must be a JSON array")
            merged_chapters = [ch for ch in custom_chapters if isinstance(ch, dict) and isinstance(ch.get("sections"), list)]
        except Exception as exc:
            raise HTTPException(status_code=400, detail=f"Invalid override_tree_json: {exc}")

    if not commit:
        return _build_preview_payload(merged_chapters, files_processed, ocr_files, ocr_pages_total, warnings)

    stats = {
        "chapters_created": 0,
        "sections_created": 0,
        "sections_updated": 0,
        "sections_skipped": 0,
        "children_created": 0,
        "children_updated": 0,
        "warnings": warnings,
    }
    with pool.connection() as conn:
        _commit_chapters_tree(
            conn, merged_chapters, target_chap_info, overwrite_existing, publish_immediately, user, stats, raw_by_key
        )

    return {
        "mode": "committed",
        "files_processed": files_processed,
        "ocr_files": ocr_files,
        "ocr_pages": ocr_pages_total,
        **stats,
    }


class ImportTreeIn(BaseModel):
    chapters: list[dict]
    target_chapter_id: int | None = None
    overwrite_existing: bool = True
    publish_immediately: bool = True


@router.post("/import-tree")
def import_code_tree(
    body: ImportTreeIn,
    user: dict = Depends(require_permission("codification.manage")),
):
    if not body.chapters:
        raise HTTPException(status_code=400, detail="No chapters supplied for import")
    target_chap_info = _resolve_target_chapter(body.target_chapter_id)
    cleaned_chaps = [ch for ch in body.chapters if isinstance(ch, dict) and isinstance(ch.get("sections"), list)]
    stats = {
        "chapters_created": 0,
        "sections_created": 0,
        "sections_updated": 0,
        "sections_skipped": 0,
        "children_created": 0,
        "children_updated": 0,
        "warnings": [],
    }
    with pool.connection() as conn:
        _commit_chapters_tree(
            conn, cleaned_chaps, target_chap_info, body.overwrite_existing, body.publish_immediately, user, stats, {}
        )
    return {"mode": "committed", **stats}


class DiscoverUrlsIn(BaseModel):
    page_url: str = ""
    urls_text: str = ""


def _discover_urls_worker(body: DiscoverUrlsIn) -> dict:
    page_title = ""
    items: list[dict] = []
    warnings: list[str] = []
    seen: set[str] = set()

    page_u = (body.page_url or "").strip()
    if page_u:
        if not _is_safe_public_http_url(page_u):
            raise ValueError("Webpage URL must resolve to a public HTTP/HTTPS address")
        final_url, html = _fetch_public_html(page_u)
        page_title, discovered = extract_pdf_links_from_html(html, final_url)
        for it in discovered:
            if it["url"] not in seen:
                seen.add(it["url"])
                items.append(it)

    for raw_ln in (body.urls_text or "").splitlines():
        u = raw_ln.strip()
        if not u:
            continue
        if not _is_safe_public_http_url(u):
            warnings.append(f"Skipped disallowed or invalid URL: {u}")
            continue
        if u in seen:
            continue
        seen.add(u)
        parsed = urlparse(u)
        fname = unquote(os.path.basename(parsed.path)) or "document.pdf"
        info = infer_section_info_from_filename(fname)
        items.append({
            "url": u,
            "filename": fname,
            "link_text": "",
            "chapter_prefix": info["chapter_prefix"] or "General",
            "section_number": info["section_number"] or "",
            "title": info["title"] or fname.rsplit(".", 1)[0],
        })

    return {"page_title": page_title, "items": items, "warnings": warnings}


@router.post("/discover-urls")
async def discover_code_pdf_urls(
    body: DiscoverUrlsIn,
    _: dict = Depends(require_permission("codification.manage")),
):
    if not (body.page_url or "").strip() and not (body.urls_text or "").strip():
        raise HTTPException(status_code=400, detail="Enter a webpage URL or paste PDF URLs")
    try:
        return await run_in_threadpool(_discover_urls_worker, body)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))
    except Exception as exc:
        raise HTTPException(status_code=400, detail=f"Could not scan URL: {exc}")


class ImportUrlItem(BaseModel):
    url: str
    title: str = ""
    link_text: str = ""


class ImportUrlsIn(BaseModel):
    items: list[ImportUrlItem]
    commit: bool = False
    target_chapter_id: int | None = None
    overwrite_existing: bool = True
    split_children: bool = True
    enable_ocr: bool = True
    publish_immediately: bool = True


def _import_urls_worker(body: ImportUrlsIn, user: dict) -> dict:
    target_chap_info = _resolve_target_chapter(body.target_chapter_id)
    merged_chapters: list[dict] = []
    chap_by_key: dict[str, dict] = {}
    warnings: list[str] = []
    failed: list[dict] = []
    files_processed = 0
    ocr_files = 0
    ocr_pages_total = 0

    for item in body.items:
        url = (item.url or "").strip()
        if not url:
            continue
        parsed_u = urlparse(url)
        fname = unquote(os.path.basename(parsed_u.path)) or "document.pdf"
        try:
            raw = _fetch_public_pdf_bytes(url)
            parsed = parse_code_pdf(raw, fname, split_children=body.split_children, enable_ocr=body.enable_ocr)
            files_processed += 1
            if parsed.get("used_ocr"):
                ocr_files += 1
                ocr_pages_total += len(parsed.get("ocr_pages") or [])
            warnings.extend(parsed.get("warnings") or [])
            fallback_title = (item.title or item.link_text or "").strip()
            _append_parsed_to_chapters(
                parsed,
                fname,
                merged_chapters,
                chap_by_key,
                target_chap_info,
                source_pdf_url=url,
                fallback_title=fallback_title,
            )
        except Exception as exc:
            failed.append({"url": url, "filename": fname, "error": str(exc)})

    if not body.commit:
        return _build_preview_payload(merged_chapters, files_processed, ocr_files, ocr_pages_total, warnings, failed=failed)

    stats = {
        "chapters_created": 0,
        "sections_created": 0,
        "sections_updated": 0,
        "sections_skipped": 0,
        "children_created": 0,
        "children_updated": 0,
        "warnings": warnings,
    }
    with pool.connection() as conn:
        _commit_chapters_tree(
            conn, merged_chapters, target_chap_info, body.overwrite_existing, body.publish_immediately, user, stats, {}
        )
    return {
        "mode": "committed",
        "files_processed": files_processed,
        "ocr_files": ocr_files,
        "ocr_pages": ocr_pages_total,
        "failed": failed,
        **stats,
    }


@router.post("/import-urls")
async def import_code_urls(
    body: ImportUrlsIn,
    user: dict = Depends(require_permission("codification.manage")),
):
    if not body.items:
        raise HTTPException(status_code=400, detail="Select at least one PDF URL")
    return await run_in_threadpool(_import_urls_worker, body, user)


def _reextract_single_section(
    row_tuple: tuple,
    split_children: bool,
    enable_ocr: bool,
    user: dict,
    tree_stats: dict,
) -> tuple[bool, bool]:
    """Download/read linked or uploaded PDF for a single section row and update tree. Returns (updated, used_ocr)."""
    sec_id, chap_id, sec_num, cur_art, cur_body, cur_ord, cur_eff, src_url, obj_key = row_tuple[:9]
    src = (src_url or "").strip()
    if obj_key:
        obj = _minio().get_object(_bucket(), obj_key)
        try:
            raw_bytes = obj.read()
        finally:
            obj.close()
            obj.release_conn()
        fname = obj_key.rsplit("/", 1)[-1]
    elif src.startswith(("http://", "https://")):
        raw_bytes = _fetch_public_pdf_bytes(src)
        fname = src.rsplit("/", 1)[-1]
    else:
        return (False, False)

    parsed = parse_code_pdf(raw_bytes, fname, split_children=split_children, enable_ocr=enable_ocr)
    used_ocr = bool(parsed.get("used_ocr"))
    all_secs = [s for ch in parsed.get("chapters", []) for s in ch.get("sections", [])]
    if not all_secs:
        return (False, used_ocr)

    if len(all_secs) == 1:
        sec_data = all_secs[0]
        next_body = (sec_data.get("body") or "").strip()
        next_kids = list(sec_data.get("children") or [])
        if not next_body and not next_kids:
            return (False, used_ocr)
        next_art = cur_art or sec_data.get("article") or ""
        next_ord = cur_ord or sec_data.get("ordinance_ref") or ""
        next_eff = cur_eff or sec_data.get("effective_date") or ""
        next_ntype = "series" if next_kids else "section"
    else:
        next_body = ""
        next_kids = all_secs
        next_art = cur_art or ""
        next_ord = cur_ord or ""
        next_eff = cur_eff or ""
        next_ntype = "series"

    with pool.connection() as conn:
        conn.execute(
            "UPDATE code_sections SET node_type = %s, article = %s, body = %s, ordinance_ref = %s, effective_date = %s, updated_at = now() WHERE id = %s",
            (next_ntype, next_art, next_body, next_ord, next_eff, sec_id),
        )
        conn.execute(
            "INSERT INTO code_revisions (section_id, ordinance_number, effective_date, change_summary, previous_body, new_body, edited_by) "
            "VALUES (%s, %s, %s, %s, %s, %s, %s)",
            (
                sec_id,
                next_ord,
                next_eff,
                f"Auto-imported from linked PDF ({'OCR, ' if used_ocr else ''}{len(next_kids)} child sections)",
                cur_body or "",
                next_body,
                user["username"],
            ),
        )
        if next_kids:
            _upsert_section_tree(conn, chap_id, next_kids, sec_id, True, user, tree_stats, {}, "")
    return (True, used_ocr)


def _split_or_reformat_row(
    sec_id: int,
    chap_id: int,
    sec_num: str,
    cur_body: str,
    cur_ord: str,
    cur_eff: str,
    src_url: str,
    has_children: bool,
    allow_split: bool,
    allow_reformat: bool,
    user: dict,
    tree_stats: dict,
) -> str:
    """Split monolith body into children and/or clean existing text. Returns 'split' | 'reformatted' | 'skipped'."""
    if not (cur_body or "").strip():
        return "skipped"
    cleaned = clean_pdf_pages([cur_body])
    if allow_split and not has_children:
        preamble, split_kids, scheme = split_section_body_into_children(cleaned, parent_number=sec_num)
        if len(split_kids) >= 2:
            meta = extract_ordinance_metadata(cleaned, src_url)
            next_ord = cur_ord or meta["ordinance_ref"]
            next_eff = cur_eff or meta["effective_date"]
            with pool.connection() as conn:
                conn.execute(
                    "UPDATE code_sections SET node_type = 'series', body = %s, ordinance_ref = %s, effective_date = %s, updated_at = now() WHERE id = %s",
                    (preamble, next_ord, next_eff, sec_id),
                )
                conn.execute(
                    "INSERT INTO code_revisions (section_id, ordinance_number, effective_date, change_summary, previous_body, new_body, edited_by) "
                    "VALUES (%s, %s, %s, %s, %s, %s, %s)",
                    (sec_id, next_ord, next_eff, f"Split monolith into {len(split_kids)} child sections ({scheme})", cur_body, preamble, user["username"]),
                )
                _upsert_section_tree(conn, chap_id, split_kids, sec_id, True, user, tree_stats, {}, "")
            return "split"
    if allow_reformat:
        meta = extract_ordinance_metadata(cleaned, src_url)
        next_ord = cur_ord or meta["ordinance_ref"]
        next_eff = cur_eff or meta["effective_date"]
        if cleaned != cur_body or next_ord != cur_ord or next_eff != cur_eff:
            with pool.connection() as conn:
                conn.execute(
                    "UPDATE code_sections SET body = %s, ordinance_ref = %s, effective_date = %s, updated_at = now() WHERE id = %s",
                    (cleaned, next_ord, next_eff, sec_id),
                )
                conn.execute(
                    "INSERT INTO code_revisions (section_id, ordinance_number, effective_date, change_summary, previous_body, new_body, edited_by) "
                    "VALUES (%s, %s, %s, 'Batch reformatted code text', %s, %s, %s)",
                    (sec_id, next_ord, next_eff, cur_body, cleaned, user["username"]),
                )
            return "reformatted"
    return "skipped"


class BulkImportLinkedIn(BaseModel):
    chapter_id: int | None = None
    only_empty: bool = True
    reformat_existing: bool = True
    split_children: bool = True
    enable_ocr: bool = True
    split_existing_monoliths: bool = True


def _run_bulk_linked_worker(body: BulkImportLinkedIn, user: dict) -> dict:
    where = "WHERE parent_id IS NULL" + (" AND chapter_id = %s" if body.chapter_id is not None else "")
    params = (body.chapter_id,) if body.chapter_id is not None else ()
    with pool.connection() as conn:
        rows = conn.execute(
            f"SELECT id, chapter_id, section_number, article, body, ordinance_ref, effective_date, source_pdf_url, object_key, "
            f"       (SELECT COUNT(*) FROM code_sections c WHERE c.parent_id = code_sections.id) AS child_count "
            f"FROM code_sections {where} ORDER BY sort_order ASC, id ASC",
            params,
        ).fetchall()

    imported = 0
    reformatted = 0
    ocr_used_count = 0
    skipped = 0
    failed: list[dict] = []
    tree_stats = {"sections_created": 0, "sections_updated": 0, "sections_skipped": 0, "children_created": 0, "children_updated": 0, "warnings": []}

    for row in rows:
        sec_id, chap_id, sec_num, cur_art, cur_body, cur_ord, cur_eff, src_url, obj_key, child_count = row
        has_body = bool((cur_body or "").strip())
        has_children = int(child_count or 0) > 0
        src = (src_url or "").strip()

        if (obj_key or src.startswith(("http://", "https://"))) and (not body.only_empty or (not has_body and not has_children)):
            try:
                did_imp, used_ocr = _reextract_single_section(row, body.split_children, body.enable_ocr, user, tree_stats)
                if used_ocr:
                    ocr_used_count += 1
                if did_imp:
                    imported += 1
                else:
                    skipped += 1
            except Exception as exc:
                failed.append({"id": sec_id, "section_number": sec_num, "error": str(exc)})
        else:
            outcome = _split_or_reformat_row(
                sec_id,
                chap_id,
                sec_num,
                cur_body or "",
                cur_ord or "",
                cur_eff or "",
                src,
                has_children,
                allow_split=(body.split_children and body.split_existing_monoliths),
                allow_reformat=body.reformat_existing,
                user=user,
                tree_stats=tree_stats,
            )
            if outcome in ("split", "reformatted"):
                reformatted += 1
            else:
                skipped += 1

    return {
        "imported": imported,
        "children_created": tree_stats["children_created"],
        "children_updated": tree_stats["children_updated"],
        "ocr_used_count": ocr_used_count,
        "reformatted": reformatted,
        "skipped": skipped,
        "failed": failed,
    }


@router.post("/import-linked-pdfs")
async def bulk_import_linked_pdfs(
    body: BulkImportLinkedIn,
    user: dict = Depends(require_permission("codification.manage")),
):
    return await run_in_threadpool(_run_bulk_linked_worker, body, user)


class BulkSectionActionIn(BaseModel):
    section_ids: list[int]
    action: str
    include_descendants: bool = True
    target_chapter_id: int | None = None
    enable_ocr: bool = True
    split_children: bool = True


_ALLOWED_BULK_ACTIONS = {"publish", "unpublish", "reformat", "split", "reextract", "move_chapter", "delete"}


def _bulk_section_action_worker(body: BulkSectionActionIn, user: dict) -> dict:
    action = (body.action or "").strip().lower()
    raw_ids = sorted({int(x) for x in body.section_ids if int(x) > 0})
    if not raw_ids:
        return {"action": action, "affected": 0, "skipped": 0, "children_created": 0, "children_updated": 0, "ocr_used_count": 0, "failed": []}

    with pool.connection() as conn:
        if body.include_descendants:
            target_ids = [
                r[0]
                for r in conn.execute(
                    "WITH RECURSIVE sub AS ("
                    "  SELECT id FROM code_sections WHERE id = ANY(%s) "
                    "  UNION "
                    "  SELECT cs.id FROM code_sections cs JOIN sub ON cs.parent_id = sub.id"
                    ") SELECT id FROM sub",
                    (raw_ids,),
                ).fetchall()
            ]
        else:
            target_ids = raw_ids

        if not target_ids:
            return {"action": action, "affected": 0, "skipped": 0, "children_created": 0, "children_updated": 0, "ocr_used_count": 0, "failed": []}

        if action in ("publish", "unpublish"):
            pub_val = action == "publish"
            res = conn.execute(
                "UPDATE code_sections SET is_published = %s, updated_at = now() WHERE id = ANY(%s)",
                (pub_val, target_ids),
            )
            return {"action": action, "affected": res.rowcount or 0, "skipped": 0, "children_created": 0, "children_updated": 0, "ocr_used_count": 0, "failed": []}

        if action == "delete":
            obj_keys = [
                r[0]
                for r in conn.execute(
                    "WITH RECURSIVE sub AS ("
                    "  SELECT id, object_key FROM code_sections WHERE id = ANY(%s) "
                    "  UNION "
                    "  SELECT cs.id, cs.object_key FROM code_sections cs JOIN sub ON cs.parent_id = sub.id"
                    ") SELECT object_key FROM sub WHERE object_key <> ''",
                    (raw_ids,),
                ).fetchall()
            ]
            # Deleting selected top/chosen IDs cascades to their descendants
            res = conn.execute("DELETE FROM code_sections WHERE id = ANY(%s)", (raw_ids,))
            if obj_keys:
                _remove_minio_objects(obj_keys)
            return {"action": action, "affected": res.rowcount or 0, "skipped": 0, "children_created": 0, "children_updated": 0, "ocr_used_count": 0, "failed": []}

        if action == "move_chapter":
            if body.target_chapter_id is None:
                raise ValueError("target_chapter_id is required for move_chapter")
            crow = conn.execute("SELECT id FROM code_chapters WHERE id = %s", (body.target_chapter_id,)).fetchone()
            if not crow:
                raise ValueError("Target chapter not found")
            sel_set = set(raw_ids)
            sel_rows = conn.execute(
                "SELECT id, chapter_id, parent_id, section_number FROM code_sections WHERE id = ANY(%s) ORDER BY sort_order ASC, id ASC",
                (raw_ids,),
            ).fetchall()
            # Process roots of the selected subset (nodes whose parent isn't also selected)
            roots = [(sid, cid, pid, snum) for sid, cid, pid, snum in sel_rows if pid not in sel_set]
            affected = 0
            skipped = 0
            failed: list[dict] = []
            for sid, old_cid, old_pid, snum in roots:
                if old_cid == body.target_chapter_id:
                    skipped += 1
                    continue
                subtree_ids = [
                    r[0]
                    for r in conn.execute(
                        "WITH RECURSIVE sub AS ("
                        "  SELECT id FROM code_sections WHERE id = %s "
                        "  UNION "
                        "  SELECT cs.id FROM code_sections cs JOIN sub ON cs.parent_id = sub.id"
                        ") SELECT id FROM sub",
                        (sid,),
                    ).fetchall()
                ]
                try:
                    with conn.transaction():
                        if old_pid is not None:
                            conn.execute("UPDATE code_sections SET parent_id = NULL WHERE id = %s", (sid,))
                        res = conn.execute(
                            "UPDATE code_sections SET chapter_id = %s, updated_at = now() WHERE id = ANY(%s)",
                            (body.target_chapter_id, subtree_ids),
                        )
                        affected += res.rowcount or 0
                except Exception as exc:
                    failed.append({"id": sid, "section_number": snum, "error": f"Conflict moving {snum}: {exc}"})
            return {"action": action, "affected": affected, "skipped": skipped, "children_created": 0, "children_updated": 0, "ocr_used_count": 0, "failed": failed}

        rows = conn.execute(
            "SELECT id, chapter_id, section_number, article, body, ordinance_ref, effective_date, source_pdf_url, object_key, "
            "       (SELECT COUNT(*) FROM code_sections c WHERE c.parent_id = code_sections.id) AS child_count "
            "FROM code_sections WHERE id = ANY(%s) ORDER BY sort_order ASC, id ASC",
            (target_ids,),
        ).fetchall()

    affected = 0
    skipped = 0
    ocr_used_count = 0
    failed = []
    tree_stats = {"sections_created": 0, "sections_updated": 0, "sections_skipped": 0, "children_created": 0, "children_updated": 0, "warnings": []}

    for row in rows:
        sec_id, chap_id, sec_num, cur_art, cur_body, cur_ord, cur_eff, src_url, obj_key, child_count = row
        has_children = int(child_count or 0) > 0
        src = (src_url or "").strip()
        if action == "reextract":
            if not (obj_key or src.startswith(("http://", "https://"))):
                skipped += 1
                continue
            try:
                did_imp, used_ocr = _reextract_single_section(row, body.split_children, body.enable_ocr, user, tree_stats)
                if used_ocr:
                    ocr_used_count += 1
                if did_imp:
                    affected += 1
                else:
                    skipped += 1
            except Exception as exc:
                failed.append({"id": sec_id, "section_number": sec_num, "error": str(exc)})
        else:
            outcome = _split_or_reformat_row(
                sec_id,
                chap_id,
                sec_num,
                cur_body or "",
                cur_ord or "",
                cur_eff or "",
                src,
                has_children,
                allow_split=(action == "split"),
                allow_reformat=(action == "reformat"),
                user=user,
                tree_stats=tree_stats,
            )
            if outcome == action or (action == "split" and outcome == "split") or (action == "reformat" and outcome == "reformatted"):
                affected += 1
            else:
                skipped += 1

    return {
        "action": action,
        "affected": affected,
        "skipped": skipped,
        "children_created": tree_stats["children_created"],
        "children_updated": tree_stats["children_updated"],
        "ocr_used_count": ocr_used_count,
        "failed": failed,
    }


@router.post("/sections/bulk-action")
async def bulk_section_action(
    body: BulkSectionActionIn,
    user: dict = Depends(require_permission("codification.manage")),
):
    action = (body.action or "").strip().lower()
    if action not in _ALLOWED_BULK_ACTIONS:
        raise HTTPException(status_code=400, detail=f"Unsupported bulk action: {body.action}")
    try:
        return await run_in_threadpool(_bulk_section_action_worker, body, user)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))
