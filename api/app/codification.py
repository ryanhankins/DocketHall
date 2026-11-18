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

"""Municipal Codification module: City Code chapters, sections, revisions, and public viewer."""
import io
import os
import re
import uuid
from xml.sax.saxutils import escape as _xml_escape

from fastapi import APIRouter, Depends, File, HTTPException, Request, UploadFile
from fastapi.responses import RedirectResponse, Response
from pydantic import BaseModel
from pypdf import PdfReader, PdfWriter
from reportlab.lib.pagesizes import letter
from reportlab.lib.styles import getSampleStyleSheet
from reportlab.platypus import PageBreak, Paragraph, SimpleDocTemplate, Spacer

from .agendas import _bucket, _minio, _remove_minio_objects
from .auth import require_permission
from .db import pool
from .subscriptions import notify_topic_subscribers

MAX_CODE_PDF_BYTES = int(os.environ.get("MAX_CODE_PDF_BYTES", str(50 * 1024 * 1024)))
_SAFE_FILENAME_RE = re.compile(r"[^A-Za-z0-9._-]+")

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
    section_number  TEXT NOT NULL,
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
CREATE INDEX IF NOT EXISTS code_sections_chap_idx ON code_sections(chapter_id, sort_order, id);
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
    section_number: str
    title: str
    summary: str = ""
    body: str = ""
    ordinance_ref: str = ""
    effective_date: str = ""
    source_pdf_url: str = ""
    sort_order: int = 0
    is_published: bool = True


class SectionPatch(BaseModel):
    section_number: str | None = None
    title: str | None = None
    summary: str | None = None
    body: str | None = None
    ordinance_ref: str | None = None
    effective_date: str | None = None
    source_pdf_url: str | None = None
    sort_order: int | None = None
    is_published: bool | None = None
    change_summary: str = ""


def _load_tree(conn, published_only: bool, q: str = "") -> list[dict]:
    c_where = "WHERE is_published = TRUE" if published_only else ""
    c_rows = conn.execute(
        f"SELECT id, code_prefix, title, description, sort_order, is_published "
        f"FROM code_chapters {c_where} ORDER BY sort_order ASC, code_prefix ASC"
    ).fetchall()

    s_where = "WHERE is_published = TRUE" if published_only else ""
    s_rows = conn.execute(
        f"SELECT id, chapter_id, section_number, title, summary, body, "
        f"       ordinance_ref, effective_date, source_pdf_url, object_key, "
        f"       sort_order, is_published, updated_at "
        f"FROM code_sections {s_where} ORDER BY sort_order ASC, section_number ASC"
    ).fetchall()

    ql = q.strip().lower()
    secs_by_chap: dict[int, list[dict]] = {}
    for s in s_rows:
        item = {
            "id": s[0],
            "chapter_id": s[1],
            "section_number": s[2],
            "title": s[3],
            "summary": s[4],
            "body": s[5],
            "ordinance_ref": s[6],
            "effective_date": s[7],
            "source_pdf_url": s[8],
            "has_uploaded_pdf": bool(s[9]),
            "sort_order": s[10],
            "is_published": bool(s[11]),
            "updated_at": s[12].isoformat() if s[12] else None,
        }
        if ql:
            hay = f"{item['section_number']} {item['title']} {item['summary']} {item['body']} {item['ordinance_ref']}".lower()
            if ql not in hay:
                continue
        secs_by_chap.setdefault(s[1], []).append(item)

    out = []
    for c in c_rows:
        c_secs = secs_by_chap.get(c[0], [])
        if ql and not c_secs and ql not in f"{c[1]} {c[2]}".lower():
            continue
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


@router.get("/public/full.pdf")
def get_full_code_pdf(download: bool = False):
    """Compile all published City Code chapters and sections into a single PDF with Table of Contents."""
    with pool.connection() as conn:
        chapters = _load_tree(conn, published_only=True, q="")
        b_row = conn.execute(
            "SELECT city_title FROM agenda_preferences WHERE id = 1"
        ).fetchone()
        city_title = (b_row[0] or "").strip() if b_row else ""
        sec_keys = {
            r[0]: r[1]
            for r in conn.execute(
                "SELECT id, object_key FROM code_sections WHERE object_key <> ''"
            ).fetchall()
        }

    buf = io.BytesIO()
    doc = SimpleDocTemplate(buf, pagesize=letter, leftMargin=54, rightMargin=54, topMargin=54, bottomMargin=54)
    styles = getSampleStyleSheet()
    heading_title = f"{city_title} — Municipal City Code" if city_title else "Municipal City Code"
    story = [
        Paragraph(f"<b>{_xml_escape(heading_title)}</b>", styles["Title"]),
        Spacer(1, 6),
        Paragraph("<b>Table of Contents</b>", styles["Heading2"]),
        Spacer(1, 4),
    ]
    if not chapters:
        story.append(Paragraph("No published code chapters are currently available.", styles["Normal"]))
    else:
        for ch in chapters:
            story.append(
                Paragraph(
                    f"<b>{_xml_escape(ch['code_prefix'])} — {_xml_escape(ch['title'])}</b>",
                    styles["Normal"],
                )
            )
            for sec in ch.get("sections", []):
                story.append(
                    Paragraph(
                        f"&nbsp;&nbsp;&nbsp;&nbsp;Sec. {_xml_escape(sec['section_number'])} — {_xml_escape(sec['title'])}",
                        styles["Normal"],
                    )
                )
            story.append(Spacer(1, 4))

        attached_pdfs: list[tuple[str, str, str]] = []
        for ch in chapters:
            story.append(PageBreak())
            story.append(
                Paragraph(
                    f"<b>{_xml_escape(ch['code_prefix'])} — {_xml_escape(ch['title'])}</b>",
                    styles["Heading1"],
                )
            )
            if ch.get("description"):
                story.append(Paragraph(_xml_escape(ch["description"]), styles["Normal"]))
            story.append(Spacer(1, 8))
            for sec in ch.get("sections", []):
                story.append(
                    Paragraph(
                        f"<b>Section {_xml_escape(sec['section_number'])} — {_xml_escape(sec['title'])}</b>",
                        styles["Heading2"],
                    )
                )
                if sec.get("ordinance_ref") or sec.get("effective_date"):
                    story.append(
                        Paragraph(
                            f"<i>Ordinance: {_xml_escape(sec.get('ordinance_ref') or '—')} | Effective: {_xml_escape(sec.get('effective_date') or '—')}</i>",
                            styles["Normal"],
                        )
                    )
                if sec.get("summary"):
                    story.append(Paragraph(f"<b>Summary:</b> {_xml_escape(sec['summary'])}", styles["Normal"]))
                body_txt = (sec.get("body") or "").strip()
                obj_key = sec_keys.get(sec["id"], "")
                if body_txt:
                    for para in body_txt.splitlines():
                        if para.strip():
                            story.append(Paragraph(_xml_escape(para.strip()), styles["Normal"]))
                            story.append(Spacer(1, 4))
                elif obj_key:
                    story.append(Paragraph("<i>(Full text attached in appended PDF pages.)</i>", styles["Normal"]))
                    attached_pdfs.append((sec["section_number"], sec["title"], obj_key))
                else:
                    story.append(Paragraph("<i>No body text recorded.</i>", styles["Normal"]))
                story.append(Spacer(1, 10))

    doc.build(story)
    main_bytes = buf.getvalue()

    if chapters and attached_pdfs:
        writer = PdfWriter()
        for page in PdfReader(io.BytesIO(main_bytes)).pages:
            writer.add_page(page)
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
            "       s.source_pdf_url, s.object_key, c.code_prefix, c.title "
            "FROM code_sections s JOIN code_chapters c ON c.id = s.chapter_id "
            "WHERE s.id = %s AND s.is_published = TRUE AND c.is_published = TRUE",
            (section_id,),
        ).fetchone()
        if not row:
            raise HTTPException(status_code=404, detail="Code section not found")

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
    if not row[2].strip() and src_url.lower().startswith(("http://", "https://")):
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
    for para in (row[2] or "Full text available in the official City Code PDF.").splitlines():
        if para.strip():
            story.append(Paragraph(_xml_escape(para.strip()), styles["Normal"]))
            story.append(Spacer(1, 6))
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


@router.post("/sections", status_code=201)
def create_section(body: SectionIn, request: Request, user: dict = Depends(require_permission("codification.manage"))):
    sec_num = body.section_number.strip()
    title = body.title.strip()
    if not sec_num or not title:
        raise HTTPException(status_code=400, detail="Section number and title are required")
    with pool.connection() as conn:
        row = conn.execute(
            "INSERT INTO code_sections "
            "(chapter_id, section_number, title, summary, body, ordinance_ref, effective_date, source_pdf_url, sort_order, is_published) "
            "VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s) RETURNING id",
            (
                body.chapter_id, sec_num, title, body.summary.strip(), body.body.strip(),
                body.ordinance_ref.strip(), body.effective_date.strip(), body.source_pdf_url.strip(),
                body.sort_order, body.is_published,
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
            f"[CivicDesk] City Code Added: § {sec_num} — {title}",
            f"Municipal Code Section {sec_num} ({title}) has been published.",
            link_path="/#codification",
            request=request,
        )
    return {"id": row[0], "section_number": sec_num, "title": title}


@router.patch("/sections/{section_id}")
def update_section(section_id: int, body: SectionPatch, request: Request, user: dict = Depends(require_permission("codification.manage"))):
    with pool.connection() as conn:
        cur = conn.execute(
            "SELECT body, title, ordinance_ref, effective_date FROM code_sections WHERE id = %s", (section_id,)
        ).fetchone()
        if not cur:
            raise HTTPException(status_code=404, detail="Section not found")
        row = conn.execute(
            "UPDATE code_sections SET "
            "section_number = COALESCE(%s, section_number), "
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
            "RETURNING id, chapter_id, section_number, title, summary, body, ordinance_ref, effective_date, source_pdf_url, object_key, sort_order, is_published, updated_at",
            (
                body.section_number.strip() if body.section_number is not None else None,
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
                    row[6],
                    row[7],
                    body.change_summary.strip() or "Section updated",
                    cur[0],
                    row[5],
                    user["username"],
                ),
            )
    if row[11] and (body.body is not None or body.title is not None or body.ordinance_ref is not None or body.change_summary.strip()):
        notify_topic_subscribers(
            "codification",
            f"[CivicDesk] City Code Updated: § {row[2]} — {row[3]}",
            f"Municipal Code Section {row[2]} ({row[3]}) was updated.",
            link_path="/#codification",
            request=request,
        )
    return {
        "id": row[0], "chapter_id": row[1], "section_number": row[2], "title": row[3],
        "summary": row[4], "body": row[5], "ordinance_ref": row[6], "effective_date": row[7],
        "source_pdf_url": row[8], "has_uploaded_pdf": bool(row[9]), "sort_order": row[10],
        "is_published": bool(row[11]), "updated_at": row[12].isoformat() if row[12] else None,
    }


@router.delete("/sections/{section_id}")
def delete_section(section_id: int, _: dict = Depends(require_permission("codification.manage"))):
    with pool.connection() as conn:
        row = conn.execute(
            "DELETE FROM code_sections WHERE id = %s RETURNING object_key", (section_id,)
        ).fetchone()
        if not row:
            raise HTTPException(status_code=404, detail="Section not found")
    if row[0]:
        _remove_minio_objects([row[0]])
    return {"deleted": True, "id": section_id}


@router.post("/sections/{section_id}/pdf")
async def upload_section_pdf(
    section_id: int,
    file: UploadFile = File(...),
    user: dict = Depends(require_permission("codification.manage")),
):
    raw = await file.read(MAX_CODE_PDF_BYTES + 1)
    if len(raw) > MAX_CODE_PDF_BYTES:
        raise HTTPException(status_code=413, detail="PDF exceeds 50 MB limit")
    if not raw.startswith(b"%PDF-"):
        raise HTTPException(status_code=400, detail="Uploaded file must be a valid PDF")

    orig_name = _SAFE_FILENAME_RE.sub("_", (file.filename or "section.pdf").strip()) or "section.pdf"
    obj_key = f"codification/{section_id}/{uuid.uuid4().hex[:12]}_{orig_name}"
    _minio().put_object(_bucket(), obj_key, io.BytesIO(raw), length=len(raw), content_type="application/pdf")

    with pool.connection() as conn:
        old = conn.execute("SELECT object_key FROM code_sections WHERE id = %s", (section_id,)).fetchone()
        if not old:
            _remove_minio_objects([obj_key])
            raise HTTPException(status_code=404, detail="Section not found")
        conn.execute("UPDATE code_sections SET object_key = %s, updated_at = now() WHERE id = %s", (obj_key, section_id))
        conn.execute(
            "INSERT INTO code_revisions (section_id, change_summary, edited_by) VALUES (%s, %s, %s)",
            (section_id, f"Uploaded PDF: {orig_name}", user["username"]),
        )
    if old[0]:
        _remove_minio_objects([old[0]])
    return {"ok": True, "has_uploaded_pdf": True}


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
def extract_section_pdf_text(section_id: int, _: dict = Depends(require_permission("codification.manage"))):
    import urllib.request

    with pool.connection() as conn:
        row = conn.execute(
            "SELECT object_key, source_pdf_url FROM code_sections WHERE id = %s", (section_id,)
        ).fetchone()
        if not row:
            raise HTTPException(status_code=404, detail="Section not found")
    obj_key, src_url = row[0], (row[1] or "").strip()

    raw: bytes | None = None
    if obj_key:
        obj = _minio().get_object(_bucket(), obj_key)
        try:
            raw = obj.read()
        finally:
            obj.close()
            obj.release_conn()
    elif src_url.startswith(("https://", "http://")):
        req = urllib.request.Request(src_url, headers={"User-Agent": "Mozilla/5.0"})
        with urllib.request.urlopen(req, timeout=20) as resp:
            raw = resp.read(MAX_CODE_PDF_BYTES)
    else:
        raise HTTPException(status_code=400, detail="No uploaded PDF or source PDF URL on this section")

    reader = PdfReader(io.BytesIO(raw))
    pages_text = [(p.extract_text() or "").strip() for p in reader.pages]
    combined = "\n\n".join(t for t in pages_text if t)
    return {"text": combined, "pages": len(reader.pages)}
