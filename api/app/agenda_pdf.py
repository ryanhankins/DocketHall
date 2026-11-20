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

"""Generate a combined PDF agenda packet (Table of Contents + items + supporting docs)."""
import csv
import io
import re
import xml.etree.ElementTree as ET
import zipfile
from typing import Callable

from openpyxl import load_workbook
from PIL import Image as PILImage
from pypdf import PdfReader, PdfWriter
from pypdf.annotations import Link
from pypdf.generic import BooleanObject, DictionaryObject, NameObject, TextStringObject
from reportlab.lib.pagesizes import letter
from reportlab.lib.styles import ParagraphStyle, getSampleStyleSheet
from reportlab.lib.units import inch
from reportlab.pdfgen import canvas
from reportlab.platypus import Flowable, Image, Paragraph, SimpleDocTemplate, Spacer, Table, TableStyle
from reportlab.lib import colors

_W_NS = "{http://schemas.openxmlformats.org/wordprocessingml/2006/main}"


def _extract_docx_paragraphs(data: bytes) -> list[str]:
    """Extract plain text paragraphs from a .docx ZIP archive."""
    with zipfile.ZipFile(io.BytesIO(data)) as zf:
        xml_bytes = zf.read("word/document.xml")
    root = ET.fromstring(xml_bytes)
    paragraphs: list[str] = []
    for p in root.iter(f"{_W_NS}p"):
        texts = [t.text for t in p.iter(f"{_W_NS}t") if t.text]
        line = "".join(texts).strip()
        if line:
            paragraphs.append(line)
    return paragraphs


def _esc(text: str) -> str:
    return text.replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;")


def _esc_multiline(text: str) -> str:
    return "<br/>".join(_esc(line) for line in text.splitlines())


def _format_time(val: str | None) -> str:
    s = (val or "").strip()
    if len(s) == 5 and s[2] == ":" and s[:2].isdigit() and s[3:].isdigit():
        hh, mm = int(s[:2]), int(s[3:])
        if 0 <= hh <= 23 and 0 <= mm <= 59:
            ampm = "AM" if hh < 12 else "PM"
            h12 = hh % 12 or 12
            return f"{h12}:{mm:02d} {ampm}"
    return s


def apply_pdf_accessibility_metadata(writer: PdfWriter, title: str, lang: str = "en-US") -> None:
    """Attach PDF /Title, /DisplayDocTitle, and /Lang metadata for WCAG 2.4.2 & 3.1.1."""
    clean_title = (title or "CivicDesk Document").strip()
    writer.add_metadata({"/Title": clean_title})
    writer._root_object.update({
        NameObject("/Lang"): TextStringObject(lang),
        NameObject("/ViewerPreferences"): DictionaryObject({
            NameObject("/DisplayDocTitle"): BooleanObject(True),
        }),
    })


def _render_flowables(flowables: list, title: str = "CivicDesk Document") -> bytes:
    buf = io.BytesIO()
    doc = SimpleDocTemplate(
        buf,
        pagesize=letter,
        title=title,
        leftMargin=0.75 * inch,
        rightMargin=0.75 * inch,
        topMargin=0.75 * inch,
        bottomMargin=0.75 * inch,
    )
    doc.build(flowables)
    return buf.getvalue()


def _render_item_cover(agenda: dict, item: dict, prefs: dict) -> bytes:
    styles = getSampleStyleSheet()
    kicker_style = ParagraphStyle(
        "ItemKicker",
        parent=styles["Normal"],
        fontSize=11,
        textColor=colors.HexColor("#475569"),
        spaceAfter=8,
    )
    title_style = ParagraphStyle(
        "ItemTitle", parent=styles["Heading1"], fontSize=22, leading=26, spaceAfter=14
    )
    body_style = ParagraphStyle(
        "ItemBody", parent=styles["Normal"], fontSize=11, leading=15, spaceAfter=12
    )
    sub_style = ParagraphStyle(
        "ItemSub", parent=styles["Heading3"], fontSize=12, leading=16, spaceAfter=6
    )

    prefix_parts = [p for p in [prefs.get("city_name"), agenda.get("body")] if p]
    if item.get("section"):
        prefix_parts.append(item["section"])
    prefix = " — ".join(_esc(p) for p in prefix_parts)
    kicker = f"{prefix} — AGENDA ITEM {item['position']}" if prefix else f"AGENDA ITEM {item['position']}"
    rev_tag = ""
    if item.get("revision_status") == "revised":
        rev_tag = ' <font color="#b45309">[REVISED]</font>'
    elif item.get("revision_status") == "addendum":
        rev_tag = ' <font color="#1d4ed8">[ADDENDUM]</font>'
    flow = [
        Spacer(1, 0.8 * inch),
        Paragraph(kicker, kicker_style),
        Paragraph(_esc(item["title"]) + rev_tag, title_style),
    ]
    if item.get("description"):
        flow.append(Paragraph(_esc(item["description"]), body_style))

    staff_fields = [
        ("Presenter", item.get("presenter")),
        ("Recommended Motion", item.get("recommended_motion")),
        ("Fiscal Impact", item.get("fiscal_impact")),
    ]
    for lbl, val in staff_fields:
        if val:
            flow.append(Paragraph(f"<b>{_esc(lbl)}:</b> {_esc(val)}", body_style))

    docs = item.get("documents", [])
    if docs:
        flow.append(Spacer(1, 8))
        flow.append(Paragraph("Supporting Documents", sub_style))
        for d in docs:
            flow.append(
                Paragraph(
                    f"&bull; {item['position']}.{d['position']} {_esc(d['title'])} "
                    f"[{_esc(d['doc_type'])}]",
                    body_style,
                )
            )
    else:
        flow.append(Paragraph("No supporting documents attached.", body_style))

    return _render_flowables(flow)


def _render_docx_pdf(item: dict, doc: dict, data: bytes) -> bytes:
    styles = getSampleStyleSheet()
    hdr_style = ParagraphStyle(
        "DocHdr", parent=styles["Heading2"], fontSize=14, leading=18, spaceAfter=4
    )
    meta_style = ParagraphStyle(
        "DocMeta", parent=styles["Normal"], fontSize=9, textColor=colors.grey, spaceAfter=14
    )
    p_style = ParagraphStyle(
        "DocPara", parent=styles["Normal"], fontSize=10.5, leading=14.5, spaceAfter=8
    )

    flow = [
        Paragraph(f"{item['position']}.{doc['position']} {_esc(doc['title'])}", hdr_style),
        Paragraph(f"Source file: {_esc(doc['filename'])}", meta_style),
    ]
    try:
        paras = _extract_docx_paragraphs(data)
    except Exception as exc:
        paras = [f"[Unable to read DOCX contents: {exc}]"]

    if not paras:
        flow.append(Paragraph("(Empty document)", p_style))
    else:
        for p in paras:
            flow.append(Paragraph(_esc(p), p_style))
    return _render_flowables(flow)


def _render_text_pdf(item: dict, doc: dict, data: bytes) -> bytes:
    styles = getSampleStyleSheet()
    hdr_style = ParagraphStyle(
        "TxtHdr", parent=styles["Heading2"], fontSize=14, leading=18, spaceAfter=10
    )
    p_style = ParagraphStyle(
        "TxtPara", parent=styles["Normal"], fontSize=10.5, leading=14.5, spaceAfter=8
    )
    text = data.decode("utf-8", errors="replace")
    blocks = [b.strip() for b in text.split("\n\n") if b.strip()]
    flow = [Paragraph(f"{item['position']}.{doc['position']} {_esc(doc['title'])}", hdr_style)]
    if not blocks:
        flow.append(Paragraph("(Empty text attachment)", p_style))
    else:
        for block in blocks:
            flow.append(Paragraph(_esc_multiline(block), p_style))
    return _render_flowables(flow)


def _render_table_rows(flow: list, rows: list[list[str]], empty_msg: str) -> None:
    styles = getSampleStyleSheet()
    cell_s = ParagraphStyle("TblCell", parent=styles["Normal"], fontSize=8.5, leading=10.5)
    hdr_s = ParagraphStyle("TblHdr", parent=styles["Normal"], fontSize=8.5, leading=10.5, fontName="Helvetica-Bold")
    trimmed = [r for r in rows if any(str(c or "").strip() for c in r)]
    if not trimmed:
        flow.append(Paragraph(empty_msg, styles["Normal"]))
        return
    max_cols = max(len(r) for r in trimmed)
    max_cols = min(max_cols, 10)  # keep columns readable on letter width
    col_w = (7.0 * inch) / max(1, max_cols)
    tbl_data = []
    for r_idx, row in enumerate(trimmed):
        st = hdr_s if r_idx == 0 else cell_s
        padded = list(row[:max_cols]) + [""] * max(0, max_cols - len(row))
        tbl_data.append([Paragraph(_esc(str(c if c is not None else "")), st) for c in padded])
    tbl = Table(tbl_data, colWidths=[col_w] * max_cols, repeatRows=1)
    tbl.setStyle(TableStyle([
        ("BACKGROUND", (0, 0), (-1, 0), colors.HexColor("#f1f5f9")),
        ("GRID", (0, 0), (-1, -1), 0.35, colors.HexColor("#cbd5e1")),
        ("VALIGN", (0, 0), (-1, -1), "TOP"),
        ("TOPPADDING", (0, 0), (-1, -1), 3),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 3),
        ("LEFTPADDING", (0, 0), (-1, -1), 4),
        ("RIGHTPADDING", (0, 0), (-1, -1), 4),
    ]))
    flow.append(tbl)


def _render_xlsx_pdf(item: dict, doc: dict, data: bytes) -> bytes:
    styles = getSampleStyleSheet()
    hdr = ParagraphStyle("XlsHdr", parent=styles["Heading2"], fontSize=14, leading=18, spaceAfter=4)
    meta = ParagraphStyle("XlsMeta", parent=styles["Normal"], fontSize=9, textColor=colors.grey, spaceAfter=10)
    sh_s = ParagraphStyle("XlsSheet", parent=styles["Heading3"], fontSize=11, spaceBefore=10, spaceAfter=6)
    flow = [
        Paragraph(f"{item['position']}.{doc['position']} {_esc(doc['title'])}", hdr),
        Paragraph(f"Spreadsheet: {_esc(doc['filename'])}", meta),
    ]
    try:
        wb = load_workbook(io.BytesIO(data), data_only=True, read_only=True)
        for sheet_name in wb.sheetnames:
            flow.append(Paragraph(_esc(sheet_name), sh_s))
            ws = wb[sheet_name]
            rows = [list(r) for r in ws.iter_rows(values_only=True)]
            _render_table_rows(flow, rows, "(Empty sheet)")
        wb.close()
    except Exception as exc:
        flow.append(Paragraph(_esc(f"[Unable to read XLSX: {exc}]"), styles["Normal"]))
    return _render_flowables(flow)


def _render_csv_pdf(item: dict, doc: dict, data: bytes) -> bytes:
    styles = getSampleStyleSheet()
    hdr = ParagraphStyle("CsvHdr", parent=styles["Heading2"], fontSize=14, leading=18, spaceAfter=4)
    meta = ParagraphStyle("CsvMeta", parent=styles["Normal"], fontSize=9, textColor=colors.grey, spaceAfter=10)
    flow = [
        Paragraph(f"{item['position']}.{doc['position']} {_esc(doc['title'])}", hdr),
        Paragraph(f"CSV file: {_esc(doc['filename'])}", meta),
    ]
    text = data.decode("utf-8", errors="replace")
    rows = list(csv.reader(io.StringIO(text)))
    _render_table_rows(flow, rows, "(Empty CSV)")
    return _render_flowables(flow)


def _render_pptx_pdf(item: dict, doc: dict, data: bytes) -> bytes:
    _A_NS = "{http://schemas.openxmlformats.org/drawingml/2006/main}"
    styles = getSampleStyleSheet()
    hdr = ParagraphStyle("PptHdr", parent=styles["Heading2"], fontSize=14, leading=18, spaceAfter=4)
    meta = ParagraphStyle("PptMeta", parent=styles["Normal"], fontSize=9, textColor=colors.grey, spaceAfter=12)
    sl_h = ParagraphStyle("PptSlide", parent=styles["Heading3"], fontSize=11.5, spaceBefore=10, spaceAfter=4)
    p_s = ParagraphStyle("PptPara", parent=styles["Normal"], fontSize=10, leading=14, leftIndent=12, spaceAfter=4)
    flow = [
        Paragraph(f"{item['position']}.{doc['position']} {_esc(doc['title'])}", hdr),
        Paragraph(f"Presentation: {_esc(doc['filename'])}", meta),
    ]
    try:
        with zipfile.ZipFile(io.BytesIO(data)) as zf:
            slides = sorted(
                (n for n in zf.namelist() if re.match(r"^ppt/slides/slide\d+\.xml$", n)),
                key=lambda s: int(re.search(r"(\d+)\.xml$", s).group(1)),
            )
            if not slides:
                flow.append(Paragraph("(No slides found)", styles["Normal"]))
            for idx, name in enumerate(slides, start=1):
                flow.append(Paragraph(f"Slide {idx}", sl_h))
                root = ET.fromstring(zf.read(name))
                lines = []
                for p in root.iter(f"{_A_NS}p"):
                    txt = "".join(t.text for t in p.iter(f"{_A_NS}t") if t.text).strip()
                    if txt:
                        lines.append(txt)
                if not lines:
                    flow.append(Paragraph("(No text on slide)", p_s))
                else:
                    for ln in lines:
                        flow.append(Paragraph(_esc(ln), p_s))
    except Exception as exc:
        flow.append(Paragraph(_esc(f"[Unable to read PPTX: {exc}]"), styles["Normal"]))
    return _render_flowables(flow)


def _render_image_pdf(item: dict, doc: dict, data: bytes) -> bytes:
    styles = getSampleStyleSheet()
    hdr = ParagraphStyle("ImgHdr", parent=styles["Heading2"], fontSize=14, leading=18, spaceAfter=4)
    meta = ParagraphStyle("ImgMeta", parent=styles["Normal"], fontSize=9, textColor=colors.grey, spaceAfter=12)
    flow = [
        Paragraph(f"{item['position']}.{doc['position']} {_esc(doc['title'])}", hdr),
        Paragraph(f"Image: {_esc(doc['filename'])}", meta),
    ]
    try:
        with PILImage.open(io.BytesIO(data)) as im:
            w_px, h_px = im.size
        max_w, max_h = 6.8 * inch, 8.2 * inch
        scale = min(max_w / max(1, w_px), max_h / max(1, h_px))
        flow.append(Image(io.BytesIO(data), width=w_px * scale, height=h_px * scale))
    except Exception as exc:
        flow.append(Paragraph(_esc(f"[Unable to embed image: {exc}]"), styles["Normal"]))
    return _render_flowables(flow)


def _render_note_pdf(heading: str, message: str) -> bytes:
    styles = getSampleStyleSheet()
    return _render_flowables([
        Paragraph(_esc(heading), styles["Heading2"]),
        Spacer(1, 8),
        Paragraph(_esc(message), styles["Normal"]),
    ])


class _TocLinkFlowable(Flowable):
    """Wrap a single-row TOC Table and record its exact PDF page + rect for pypdf links."""

    def __init__(self, tbl: Table, target_page_0idx: int, records: list):
        super().__init__()
        self.tbl = tbl
        self.target_page_0idx = target_page_0idx
        self.records = records

    def wrap(self, availWidth, availHeight):
        self.width, self.height = self.tbl.wrap(availWidth, availHeight)
        return self.width, self.height

    def draw(self):
        self.tbl.drawOn(self.canv, 0, 0)
        m = getattr(self.canv, "_currentMatrix", (1, 0, 0, 1, 0, 0))
        tx, ty = float(m[4]), float(m[5])
        page_0idx = int(getattr(self.canv, "_pageNumber", 1)) - 1
        self.records.append((
            page_0idx,
            (tx, ty, tx + float(self.width), ty + float(self.height)),
            self.target_page_0idx,
        ))


def _rev_badge_markup(revision_status: str | None) -> str:
    if revision_status == "revised":
        return ' <font color="#b45309"><b>[REVISED]</b></font>'
    if revision_status == "addendum":
        return ' <font color="#1d4ed8"><b>[ADDENDUM]</b></font>'
    return ""


def _append_agenda_header(flow: list, agenda: dict, prefs: dict, logo_bytes: bytes | None, styles) -> None:
    city_s = ParagraphStyle("TocCity", parent=styles["Normal"], fontSize=12, fontName="Helvetica-Bold", textColor=colors.HexColor("#1e293b"), spaceAfter=4)
    h1 = ParagraphStyle("TocH1", parent=styles["Heading1"], fontSize=20, leading=24, spaceAfter=6)
    meta = ParagraphStyle("TocMeta", parent=styles["Normal"], fontSize=10.5, leading=14, textColor=colors.HexColor("#475569"), spaceAfter=4)
    notes_s = ParagraphStyle("TocNotes", parent=styles["Normal"], fontSize=10, leading=13.5, textColor=colors.HexColor("#334155"), spaceBefore=6, spaceAfter=12)

    if logo_bytes:
        try:
            with PILImage.open(io.BytesIO(logo_bytes)) as im:
                w_px, h_px = im.size
            max_w, max_h = 2.2 * inch, 1.1 * inch
            scale = min(max_w / max(1, w_px), max_h / max(1, h_px))
            logo_img = Image(io.BytesIO(logo_bytes), width=w_px * scale, height=h_px * scale)
            logo_img.hAlign = "LEFT"
            flow.append(logo_img)
            flow.append(Spacer(1, 8))
        except Exception:
            pass
    header_parts = [p for p in [prefs.get("city_name"), agenda.get("body")] if p]
    if header_parts:
        flow.append(Paragraph(_esc(" — ".join(header_parts)), city_s))
    flow.append(Paragraph(_esc(agenda["title"]), h1))

    meta_parts = []
    if agenda.get("meeting_date"):
        meta_parts.append(f"<b>Date:</b> {_esc(agenda['meeting_date'])}")
    mtime = _format_time(agenda.get("meeting_time") or prefs.get("meeting_time"))
    if mtime:
        meta_parts.append(f"<b>Time:</b> {_esc(mtime)}")
    if prefs.get("meeting_location"):
        meta_parts.append(f"<b>Location:</b> {_esc(prefs['meeting_location'])}")
    if agenda.get("finalized_at"):
        meta_parts.append(f"<b>Finalized:</b> {_esc(agenda['finalized_at'][:10])}")
    if meta_parts:
        flow.append(Paragraph(" &nbsp;|&nbsp; ".join(meta_parts), meta))
    else:
        flow.append(Paragraph("Agenda Packet", meta))

    if prefs.get("other_notes"):
        flow.append(Paragraph(_esc_multiline(prefs["other_notes"]), notes_s))


def _render_toc(
    agenda: dict,
    toc_entries: list[dict],
    prefs: dict,
    logo_bytes: bytes | None = None,
    link_records: list | None = None,
) -> bytes:
    styles = getSampleStyleSheet()
    h2 = ParagraphStyle("TocH2", parent=styles["Heading2"], fontSize=14, leading=18, spaceBefore=10, spaceAfter=10)
    sec_p = ParagraphStyle("TocSec", parent=styles["Normal"], fontSize=10, leading=13, fontName="Helvetica-Bold", textColor=colors.HexColor("#1e3a8a"), spaceBefore=10, spaceAfter=3)
    item_p = ParagraphStyle("TocItem", parent=styles["Normal"], fontSize=10.5, leading=13.5, fontName="Helvetica-Bold")
    doc_p = ParagraphStyle("TocDoc", parent=styles["Normal"], fontSize=9.5, leading=12.5, leftIndent=16, textColor=colors.HexColor("#334155"))
    pg_p = ParagraphStyle("TocPg", parent=styles["Normal"], fontSize=10, alignment=2)
    disc_h = ParagraphStyle("TocDiscH", parent=styles["Heading3"], fontSize=11, leading=14, textColor=colors.HexColor("#334155"), spaceBefore=18, spaceAfter=4)
    disc_p = ParagraphStyle("TocDiscP", parent=styles["Normal"], fontSize=9.5, leading=13, textColor=colors.HexColor("#475569"))

    flow = []
    _append_agenda_header(flow, agenda, prefs, logo_bytes, styles)
    flow.append(Paragraph("Table of Contents", h2))

    if not toc_entries:
        flow.append(Paragraph("No agenda items.", styles["Normal"]))
    else:
        last_section = None
        for entry in toc_entries:
            if entry["kind"] == "item":
                sec = (entry.get("section") or "").strip()
                if sec and sec != last_section:
                    flow.append(Paragraph(_esc(sec.upper()), sec_p))
                last_section = sec
            style = item_p if entry["kind"] == "item" else doc_p
            badge = _rev_badge_markup(entry.get("revision_status")) if entry["kind"] == "item" else ""
            pg_label = f"p. {entry['page']}" if entry.get("page") else "—"
            row_tbl = Table(
                [[Paragraph(_esc(entry["label"]) + badge, style), Paragraph(pg_label, pg_p)]],
                colWidths=[6.15 * inch, 0.85 * inch],
            )
            row_tbl.setStyle(TableStyle([
                ("VALIGN", (0, 0), (-1, -1), "TOP"),
                ("LEFTPADDING", (0, 0), (-1, -1), 2),
                ("RIGHTPADDING", (0, 0), (-1, -1), 2),
                ("TOPPADDING", (0, 0), (-1, -1), 4),
                ("BOTTOMPADDING", (0, 0), (-1, -1), 4),
                ("LINEBELOW", (0, 0), (-1, -1), 0.25, colors.HexColor("#e2e8f0")),
            ]))
            if link_records is not None and (entry.get("page") or 0) >= 1:
                flow.append(_TocLinkFlowable(row_tbl, entry["page"] - 1, link_records))
            else:
                flow.append(row_tbl)

    if prefs.get("footer_disclosures"):
        flow.append(Paragraph("Additional Notes &amp; Disclosures", disc_h))
        flow.append(Paragraph(_esc_multiline(prefs["footer_disclosures"]), disc_p))

    return _render_flowables(flow)


def _render_agenda_summary(
    agenda: dict,
    prefs: dict,
    logo_bytes: bytes | None = None,
) -> bytes:
    """Render an Agenda-Only Summary PDF (cover/header + items + staff fields, no doc pages)."""
    styles = getSampleStyleSheet()
    sec_p = ParagraphStyle("SumSec", parent=styles["Normal"], fontSize=11, leading=14, fontName="Helvetica-Bold", textColor=colors.HexColor("#1e3a8a"), spaceBefore=12, spaceAfter=4)
    item_h = ParagraphStyle("SumItem", parent=styles["Normal"], fontSize=11, leading=15, fontName="Helvetica-Bold", spaceBefore=6, spaceAfter=2)
    body_p = ParagraphStyle("SumBody", parent=styles["Normal"], fontSize=9.5, leading=13, leftIndent=14, textColor=colors.HexColor("#334155"), spaceAfter=2)
    doc_p = ParagraphStyle("SumDoc", parent=styles["Normal"], fontSize=9, leading=12, leftIndent=24, textColor=colors.HexColor("#475569"), spaceAfter=1)
    disc_h = ParagraphStyle("SumDiscH", parent=styles["Heading3"], fontSize=11, leading=14, textColor=colors.HexColor("#334155"), spaceBefore=18, spaceAfter=4)
    disc_p = ParagraphStyle("SumDiscP", parent=styles["Normal"], fontSize=9.5, leading=13, textColor=colors.HexColor("#475569"))

    flow = []
    _append_agenda_header(flow, agenda, prefs, logo_bytes, styles)
    flow.append(Spacer(1, 8))

    items = agenda.get("items", [])
    if not items:
        flow.append(Paragraph("No agenda items.", styles["Normal"]))
    else:
        last_sec = None
        for item in items:
            sec = (item.get("section") or "").strip()
            if sec and sec != last_sec:
                flow.append(Paragraph(_esc(sec.upper()), sec_p))
            last_sec = sec
            badge = _rev_badge_markup(item.get("revision_status"))
            flow.append(Paragraph(f"{item['position']}. {_esc(item['title'])}{badge}", item_h))
            if item.get("description"):
                flow.append(Paragraph(_esc(item["description"]), body_p))
            for lbl, key in (
                ("Presenter", "presenter"),
                ("Recommended Motion", "recommended_motion"),
                ("Fiscal Impact", "fiscal_impact"),
            ):
                if item.get(key):
                    flow.append(Paragraph(f"<b>{lbl}:</b> {_esc(item[key])}", body_p))
            for d in item.get("documents", []):
                flow.append(Paragraph(f"&bull; {item['position']}.{d['position']} {_esc(d['title'])} [{_esc(d['doc_type'])}]", doc_p))

    if prefs.get("footer_disclosures"):
        flow.append(Paragraph("Additional Notes &amp; Disclosures", disc_h))
        flow.append(Paragraph(_esc_multiline(prefs["footer_disclosures"]), disc_p))

    return _render_flowables(flow)


def _stamp_page_number(page, page_num: int, total_pages: int) -> None:
    """Overlay 'Page X of Y' onto the bottom-right corner of a PDF page."""
    w = float(page.mediabox.width)
    h = float(page.mediabox.height)
    buf = io.BytesIO()
    c = canvas.Canvas(buf, pagesize=(w, h))
    c.setFont("Helvetica", 9)
    c.setFillColor(colors.HexColor("#475569"))
    c.drawRightString(w - 36, 20, f"Page {page_num} of {total_pages}")
    c.save()
    overlay = PdfReader(io.BytesIO(buf.getvalue())).pages[0]
    page.merge_page(overlay)


def _stamp_draft_watermark(page) -> None:
    """Overlay a diagonal semi-transparent red 'DRAFT' watermark onto a PDF page."""
    w = float(page.mediabox.width)
    h = float(page.mediabox.height)
    buf = io.BytesIO()
    c = canvas.Canvas(buf, pagesize=(w, h))
    c.saveState()
    c.translate(w / 2.0, h / 2.0)
    c.rotate(42)
    c.setFont("Helvetica-Bold", 78)
    c.setFillColorRGB(0.86, 0.15, 0.15, alpha=0.18)
    c.drawCentredString(0, -24, "DRAFT")
    c.restoreState()
    c.save()
    overlay = PdfReader(io.BytesIO(buf.getvalue())).pages[0]
    page.merge_page(overlay)


def render_single_document_pdf(item: dict, doc: dict, data: bytes) -> bytes:
    """Render any supported supporting document as a standalone PDF."""
    dtype = doc["doc_type"]
    if dtype == "PDF":
        return data
    if dtype == "TEXT":
        return _render_text_pdf(item, doc, data)
    if dtype == "XLSX":
        return _render_xlsx_pdf(item, doc, data)
    if dtype == "CSV":
        return _render_csv_pdf(item, doc, data)
    if dtype == "PPTX":
        return _render_pptx_pdf(item, doc, data)
    if dtype in ("PNG", "JPG"):
        return _render_image_pdf(item, doc, data)
    return _render_docx_pdf(item, doc, data)


def build_agenda_packet_pdf(
    agenda: dict,
    fetch_doc_bytes: Callable[[str], bytes],
    include_item_cover_sheets: bool = True,
    include_page_numbers: bool = True,
    preferences: dict | None = None,
    summary_only: bool = False,
) -> bytes:
    """Build a single PDF containing the Table of Contents and all items + docs in order."""
    prefs = preferences or {}
    logo_bytes: bytes | None = None
    if prefs.get("city_logo_key"):
        try:
            logo_bytes = fetch_doc_bytes(prefs["city_logo_key"])
        except Exception:
            logo_bytes = None

    if summary_only:
        sum_reader = PdfReader(io.BytesIO(_render_agenda_summary(agenda, prefs, logo_bytes)))
        final_writer = PdfWriter()
        for page in sum_reader.pages:
            final_writer.add_page(page)
        if include_page_numbers:
            total_pages = len(final_writer.pages)
            for idx, page in enumerate(final_writer.pages, start=1):
                _stamp_page_number(page, idx, total_pages)
        sum_title = f"{agenda.get('title') or 'Meeting Agenda'} — Summary"
        if len(final_writer.pages) > 1:
            final_writer.add_outline_item(sum_title, 0)
        apply_pdf_accessibility_metadata(final_writer, sum_title)
        out = io.BytesIO()
        final_writer.write(out)
        return out.getvalue()

    # 1. Build each item's pages and record relative page offsets.
    body_writer = PdfWriter()
    rel_entries: list[dict] = []  # {kind, label, rel_page, is_doc, section, revision_status}

    for item in agenda.get("items", []):
        docs = item.get("documents", [])
        rel_item_page = len(body_writer.pages) if (include_item_cover_sheets or docs) else None
        rel_entries.append({
            "kind": "item",
            "label": f"{item['position']}. {item['title']}",
            "rel_page": rel_item_page,
            "is_doc": False,
            "section": item.get("section", ""),
            "revision_status": item.get("revision_status", ""),
        })

        if include_item_cover_sheets:
            cover_reader = PdfReader(io.BytesIO(_render_item_cover(agenda, item, prefs)))
            for page in cover_reader.pages:
                body_writer.add_page(page)

        for doc in docs:
            rel_doc_page = len(body_writer.pages)
            rel_entries.append({
                "kind": "doc",
                "label": f"{item['position']}.{doc['position']} {doc['title']} [{doc['doc_type']}]",
                "rel_page": rel_doc_page,
                "is_doc": True,
            })

            try:
                raw = fetch_doc_bytes(doc["object_key"])
                if doc["doc_type"] == "PDF":
                    r = PdfReader(io.BytesIO(raw))
                    if len(r.pages) == 0:
                        raise ValueError("PDF has 0 pages")
                    for page in r.pages:
                        body_writer.add_page(page)
                elif doc["doc_type"] == "TEXT":
                    sub_pdf = _render_text_pdf(item, doc, raw)
                    for page in PdfReader(io.BytesIO(sub_pdf)).pages:
                        body_writer.add_page(page)
                elif doc["doc_type"] == "XLSX":
                    sub_pdf = _render_xlsx_pdf(item, doc, raw)
                    for page in PdfReader(io.BytesIO(sub_pdf)).pages:
                        body_writer.add_page(page)
                elif doc["doc_type"] == "CSV":
                    sub_pdf = _render_csv_pdf(item, doc, raw)
                    for page in PdfReader(io.BytesIO(sub_pdf)).pages:
                        body_writer.add_page(page)
                elif doc["doc_type"] == "PPTX":
                    sub_pdf = _render_pptx_pdf(item, doc, raw)
                    for page in PdfReader(io.BytesIO(sub_pdf)).pages:
                        body_writer.add_page(page)
                elif doc["doc_type"] in ("PNG", "JPG"):
                    sub_pdf = _render_image_pdf(item, doc, raw)
                    for page in PdfReader(io.BytesIO(sub_pdf)).pages:
                        body_writer.add_page(page)
                else:
                    docx_pdf = _render_docx_pdf(item, doc, raw)
                    for page in PdfReader(io.BytesIO(docx_pdf)).pages:
                        body_writer.add_page(page)
            except Exception as exc:
                err_r = PdfReader(io.BytesIO(_render_note_pdf(
                    f"{item['position']}.{doc['position']} {doc['title']}",
                    f"Could not embed {doc['doc_type']} ({doc['filename']}): {exc}",
                )))
                for page in err_r.pages:
                    body_writer.add_page(page)

    # 2. Measure TOC page count, then render TOC with exact 1-based page numbers and clickable links.
    dummy_toc = [
        {
            "kind": e["kind"],
            "label": e["label"],
            "page": 999,
            "section": e.get("section", ""),
            "revision_status": e.get("revision_status", ""),
        }
        for e in rel_entries
    ]
    toc_page_count = len(PdfReader(io.BytesIO(_render_toc(agenda, dummy_toc, prefs, logo_bytes))).pages)

    final_toc_entries = [
        {
            "kind": e["kind"],
            "label": e["label"],
            "page": (toc_page_count + e["rel_page"] + 1) if e["rel_page"] is not None else None,
            "section": e.get("section", ""),
            "revision_status": e.get("revision_status", ""),
        }
        for e in rel_entries
    ]
    link_records: list = []
    toc_bytes = _render_toc(agenda, final_toc_entries, prefs, logo_bytes, link_records)
    toc_reader = PdfReader(io.BytesIO(toc_bytes))
    actual_toc_pages = len(toc_reader.pages)
    if actual_toc_pages != toc_page_count:
        final_toc_entries = [
            {
                "kind": e["kind"],
                "label": e["label"],
                "page": (actual_toc_pages + e["rel_page"] + 1) if e["rel_page"] is not None else None,
                "section": e.get("section", ""),
                "revision_status": e.get("revision_status", ""),
            }
            for e in rel_entries
        ]
        link_records = []
        toc_reader = PdfReader(io.BytesIO(_render_toc(agenda, final_toc_entries, prefs, logo_bytes, link_records)))

    # 3. Combine TOC + body pages, stamp page numbers if enabled, add bookmarks and TOC links.
    final_writer = PdfWriter()
    for page in toc_reader.pages:
        final_writer.add_page(page)
    for page in body_writer.pages:
        final_writer.add_page(page)

    if include_page_numbers:
        total_pages = len(final_writer.pages)
        for idx, page in enumerate(final_writer.pages, start=1):
            _stamp_page_number(page, idx, total_pages)

    for src_pg, rect, dst_pg in link_records:
        if 0 <= src_pg < len(final_writer.pages) and 0 <= dst_pg < len(final_writer.pages):
            final_writer.add_annotation(
                page_number=src_pg,
                annotation=Link(rect=rect, target_page_index=dst_pg),
            )

    parent_bookmark = None
    for e in rel_entries:
        page_idx = (len(toc_reader.pages) + e["rel_page"]) if e["rel_page"] is not None else 0
        if not e["is_doc"]:
            parent_bookmark = final_writer.add_outline_item(e["label"], page_idx)
        else:
            final_writer.add_outline_item(e["label"], page_idx, parent=parent_bookmark)

    apply_pdf_accessibility_metadata(final_writer, f"{agenda.get('title') or 'Meeting Agenda'} — Packet")
    out = io.BytesIO()
    final_writer.write(out)
    return out.getvalue()


def build_minutes_pdf(
    agenda: dict,
    fetch_doc_bytes: Callable[[str], bytes],
    include_page_numbers: bool = True,
    preferences: dict | None = None,
    watermark_draft: bool = False,
) -> bytes:
    """Build a formatted Meeting Minutes PDF from the agenda, attendance, votes, and notes."""
    prefs = preferences or {}
    logo_bytes: bytes | None = None
    if prefs.get("city_logo_key"):
        try:
            logo_bytes = fetch_doc_bytes(prefs["city_logo_key"])
        except Exception:
            logo_bytes = None

    styles = getSampleStyleSheet()
    kicker = ParagraphStyle("MinKicker", parent=styles["Normal"], fontSize=11, fontName="Helvetica-Bold", textColor=colors.HexColor("#1d4ed8"), spaceAfter=4)
    sec_p = ParagraphStyle("MinSec", parent=styles["Normal"], fontSize=11, leading=14, fontName="Helvetica-Bold", textColor=colors.HexColor("#1e3a8a"), spaceBefore=12, spaceAfter=4)
    sub_h = ParagraphStyle("MinSubH", parent=styles["Heading3"], fontSize=11.5, leading=15, spaceBefore=10, spaceAfter=4)
    item_h = ParagraphStyle("MinItem", parent=styles["Normal"], fontSize=11, leading=15, fontName="Helvetica-Bold", spaceBefore=8, spaceAfter=2)
    body_p = ParagraphStyle("MinBody", parent=styles["Normal"], fontSize=9.5, leading=13, leftIndent=14, textColor=colors.HexColor("#334155"), spaceAfter=3)

    kicker_text = "DRAFT MEETING MINUTES (PENDING APPROVAL)" if watermark_draft else "MEETING MINUTES (APPROVED)"
    flow = [Paragraph(kicker_text, kicker)]
    _append_agenda_header(flow, agenda, prefs, logo_bytes, styles)

    if agenda.get("minutes_attendance"):
        flow.append(Paragraph("Attendance &amp; Roll Call", sub_h))
        flow.append(Paragraph(_esc_multiline(agenda["minutes_attendance"]), body_p))
    if agenda.get("minutes_notes"):
        flow.append(Paragraph("General Meeting Notes", sub_h))
        flow.append(Paragraph(_esc_multiline(agenda["minutes_notes"]), body_p))

    flow.append(Spacer(1, 6))
    items = agenda.get("items", [])
    if not items:
        flow.append(Paragraph("No agenda items recorded.", styles["Normal"]))
    else:
        last_sec = None
        for item in items:
            sec = (item.get("section") or "").strip()
            if sec and sec != last_sec:
                flow.append(Paragraph(_esc(sec.upper()), sec_p))
            last_sec = sec
            flow.append(Paragraph(f"{item['position']}. {_esc(item['title'])}", item_h))

            parts = []
            if item.get("minutes_action"):
                parts.append(f"<b>Action:</b> {_esc(item['minutes_action'])}")
            if item.get("minutes_motion_by"):
                m_str = _esc(item["minutes_motion_by"])
                if item.get("minutes_second_by"):
                    m_str += f" (Second: {_esc(item['minutes_second_by'])})"
                parts.append(f"<b>Motion:</b> {m_str}")
            elif item.get("minutes_second_by"):
                parts.append(f"<b>Second:</b> {_esc(item['minutes_second_by'])}")
            if item.get("minutes_vote"):
                parts.append(f"<b>Vote:</b> {_esc(item['minutes_vote'])}")
            if parts:
                flow.append(Paragraph(" &nbsp;|&nbsp; ".join(parts), body_p))
            if item.get("minutes_notes"):
                flow.append(Paragraph(_esc_multiline(item["minutes_notes"]), body_p))
            elif not parts:
                flow.append(Paragraph("<i>No action or notes recorded.</i>", body_p))

    min_title = f"{agenda.get('title') or 'Meeting'} — Minutes"
    pdf_bytes = _render_flowables(flow, title=min_title)
    reader = PdfReader(io.BytesIO(pdf_bytes))
    writer = PdfWriter()
    for page in reader.pages:
        writer.add_page(page)
    total = len(writer.pages)
    for idx, page in enumerate(writer.pages, start=1):
        if include_page_numbers:
            _stamp_page_number(page, idx, total)
        if watermark_draft:
            _stamp_draft_watermark(page)
    if total > 1:
        writer.add_outline_item(min_title, 0)
    apply_pdf_accessibility_metadata(writer, min_title)
    out = io.BytesIO()
    writer.write(out)
    return out.getvalue()
