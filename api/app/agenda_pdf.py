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
import base64
import csv
import io
import os
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
from weasyprint import HTML

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
    clean_title = (title or "DocketHall Document").strip()
    writer.add_metadata({"/Title": clean_title})
    writer._root_object.update({
        NameObject("/Lang"): TextStringObject(lang),
        NameObject("/ViewerPreferences"): DictionaryObject({
            NameObject("/DisplayDocTitle"): BooleanObject(True),
        }),
    })


def _html_to_pdf_bytes(
    body_html: str,
    title: str = "DocketHall Document",
    include_page_numbers: bool = True,
    watermark_draft: bool = False,
    lang: str = "en-US",
) -> bytes:
    """Render semantic HTML to a Tagged PDF/UA-1 document using WeasyPrint."""
    clean_title = _esc((title or "DocketHall Document").strip())
    page_footer = (
        '@bottom-right { content: "Page " counter(page) " of " counter(pages); font-size: 9pt; color: #475569; }'
        if include_page_numbers else ""
    )
    watermark_html = '<div class="draft-watermark">DRAFT — UNAPPROVED MINUTES</div>' if watermark_draft else ""
    full_html = f"""<!DOCTYPE html>
<html lang="{_esc(lang)}">
<head>
  <meta charset="utf-8" />
  <title>{clean_title}</title>
  <style>
    @page {{
      size: letter;
      margin: 0.75in;
      {page_footer}
    }}
    body {{
      font-family: "Liberation Sans", "DejaVu Sans", Arial, sans-serif;
      font-size: 10.5pt;
      line-height: 1.45;
      color: #1f2933;
      margin: 0;
    }}
    h1 {{ font-size: 18pt; line-height: 1.25; margin: 0 0 6pt; color: #0f172a; }}
    h2 {{ font-size: 12.5pt; line-height: 1.3; margin: 14pt 0 4pt; color: #1e3a8a; border-bottom: 1px solid #cbd5e1; padding-bottom: 2pt; }}
    h3 {{ font-size: 11pt; line-height: 1.3; margin: 9pt 0 3pt; color: #0f172a; }}
    p {{ margin: 0 0 6pt; }}
    ul {{ margin: 4pt 0 8pt 16pt; padding: 0; }}
    li {{ margin-bottom: 2pt; }}
    .kicker {{ font-size: 10.5pt; font-weight: bold; color: #1e293b; margin-bottom: 4pt; }}
    .meta {{ font-size: 9.5pt; color: #475569; margin-bottom: 10pt; }}
    .notes {{ font-size: 9.5pt; color: #334155; margin-bottom: 10pt; }}
    .item-block {{ margin-bottom: 10pt; }}
    .item-meta {{ margin-left: 12pt; font-size: 9.5pt; color: #334155; }}
    .doc-list {{ margin-left: 20pt; font-size: 9pt; color: #475569; }}
    .badge-rev {{ color: #b45309; font-weight: bold; }}
    .badge-add {{ color: #1d4ed8; font-weight: bold; }}
    .logo {{ max-width: 2.2in; max-height: 1.1in; margin-bottom: 6pt; }}
    .draft-watermark {{
      position: fixed;
      top: 42%;
      left: 8%;
      width: 84%;
      text-align: center;
      font-size: 26pt;
      font-weight: bold;
      color: rgba(185, 28, 28, 0.22);
      transform: rotate(-32deg);
      z-index: -1;
    }}
  </style>
</head>
<body>
  {watermark_html}
  {body_html}
</body>
</html>"""
    return HTML(string=full_html).write_pdf(pdf_variant="pdf/ua-1")


def _logo_html(logo_bytes: bytes | None) -> str:
    if not logo_bytes:
        return ""
    try:
        with PILImage.open(io.BytesIO(logo_bytes)) as im:
            buf = io.BytesIO()
            im.convert("RGBA").save(buf, format="PNG")
            b64 = base64.b64encode(buf.getvalue()).decode("ascii")
        return f'<img class="logo" src="data:image/png;base64,{b64}" alt="City Logo" />'
    except Exception:
        return ""


def _agenda_header_html(agenda: dict, prefs: dict, logo_bytes: bytes | None) -> str:
    parts = [_logo_html(logo_bytes)]
    header_parts = [p for p in [prefs.get("city_name"), agenda.get("body")] if p]
    if header_parts:
        parts.append(f'<div class="kicker">{_esc(" — ".join(header_parts))}</div>')
    parts.append(f'<h1>{_esc(agenda["title"])}</h1>')
    meta_parts = []
    if agenda.get("meeting_date"):
        meta_parts.append(f"<strong>Date:</strong> {_esc(agenda['meeting_date'])}")
    mtime = _format_time(agenda.get("meeting_time") or prefs.get("meeting_time"))
    if mtime:
        meta_parts.append(f"<strong>Time:</strong> {_esc(mtime)}")
    if prefs.get("meeting_location"):
        meta_parts.append(f"<strong>Location:</strong> {_esc(prefs['meeting_location'])}")
    if agenda.get("finalized_at"):
        meta_parts.append(f"<strong>Finalized:</strong> {_esc(agenda['finalized_at'][:10])}")
    parts.append(f'<p class="meta">{" &nbsp;|&nbsp; ".join(meta_parts) if meta_parts else "Agenda Packet"}</p>')
    if prefs.get("other_notes"):
        parts.append(f'<p class="notes">{_esc_multiline(prefs["other_notes"])}</p>')
    return "\n".join(p for p in parts if p)


def _render_flowables(flowables: list, title: str = "DocketHall Document") -> bytes:
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
    prefix_parts = [p for p in [prefs.get("city_name"), agenda.get("body")] if p]
    if item.get("section"):
        prefix_parts.append(item["section"])
    prefix = " — ".join(_esc(p) for p in prefix_parts)
    kicker = f"{prefix} — AGENDA ITEM {item['position']}" if prefix else f"AGENDA ITEM {item['position']}"
    rev_tag = ""
    if item.get("revision_status") == "revised":
        rev_tag = ' <span class="badge-rev">[REVISED]</span>'
    elif item.get("revision_status") == "addendum":
        rev_tag = ' <span class="badge-add">[ADDENDUM]</span>'
    parts = [
        f'<p class="kicker" style="margin-top: 0.6in;">{kicker}</p>',
        f'<h1>{_esc(item["title"])}{rev_tag}</h1>',
    ]
    if item.get("description"):
        parts.append(f'<p>{_esc(item["description"])}</p>')
    for lbl, key in (
        ("Presenter", "presenter"),
        ("Recommended Motion", "recommended_motion"),
        ("Fiscal Impact", "fiscal_impact"),
    ):
        if item.get(key):
            parts.append(f'<p><strong>{_esc(lbl)}:</strong> {_esc(item[key])}</p>')
    docs = item.get("documents", [])
    if docs:
        parts.append("<h2>Supporting Documents</h2><ul>")
        for d in docs:
            parts.append(f'<li>{item["position"]}.{d["position"]} {_esc(d["title"])} [{_esc(d["doc_type"])}]</li>')
        parts.append("</ul>")
    else:
        parts.append("<p>No supporting documents attached.</p>")
    return _html_to_pdf_bytes("\n".join(parts), title=f"Item {item['position']}: {item['title']}", include_page_numbers=False)


def _render_docx_pdf(item: dict, doc: dict, data: bytes) -> bytes:
    parts = [
        f'<h1>{item["position"]}.{doc["position"]} {_esc(doc["title"])}</h1>',
        f'<p class="meta">Source file: {_esc(doc["filename"])}</p>',
    ]
    try:
        paras = _extract_docx_paragraphs(data)
    except Exception as exc:
        paras = [f"[Unable to read DOCX contents: {exc}]"]
    if not paras:
        parts.append("<p>(Empty document)</p>")
    else:
        for p in paras:
            parts.append(f"<p>{_esc(p)}</p>")
    return _html_to_pdf_bytes("\n".join(parts), title=doc["title"], include_page_numbers=False)


def _render_text_pdf(item: dict, doc: dict, data: bytes) -> bytes:
    text = data.decode("utf-8", errors="replace")
    blocks = [b.strip() for b in text.split("\n\n") if b.strip()]
    parts = [f'<h1>{item["position"]}.{doc["position"]} {_esc(doc["title"])}</h1>']
    if not blocks:
        parts.append("<p>(Empty text attachment)</p>")
    else:
        for block in blocks:
            parts.append(f"<p>{_esc_multiline(block)}</p>")
    return _html_to_pdf_bytes("\n".join(parts), title=doc["title"], include_page_numbers=False)


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
    include_page_numbers: bool = True,
) -> bytes:
    """Render an Agenda-Only Summary PDF as Tagged PDF/UA via WeasyPrint."""
    parts = [_agenda_header_html(agenda, prefs, logo_bytes)]
    items = agenda.get("items", [])
    if not items:
        parts.append("<p>No agenda items.</p>")
    else:
        last_sec = None
        for item in items:
            sec = (item.get("section") or "").strip()
            if sec and sec != last_sec:
                parts.append(f'<h2>{_esc(sec)}</h2>')
            last_sec = sec
            rev_html = ""
            if item.get("revision_status") == "revised":
                rev_html = ' <span class="badge-rev">[REVISED]</span>'
            elif item.get("revision_status") == "addendum":
                rev_html = ' <span class="badge-add">[ADDENDUM]</span>'
            parts.append(f'<div class="item-block">')
            parts.append(f'<h3>{item["position"]}. {_esc(item["title"])}{rev_html}</h3>')
            if item.get("description"):
                parts.append(f'<p class="item-meta">{_esc(item["description"])}</p>')
            for lbl, key in (
                ("Presenter", "presenter"),
                ("Recommended Motion", "recommended_motion"),
                ("Fiscal Impact", "fiscal_impact"),
            ):
                if item.get(key):
                    parts.append(f'<p class="item-meta"><strong>{lbl}:</strong> {_esc(item[key])}</p>')
            docs = item.get("documents", [])
            if docs:
                parts.append('<ul class="doc-list">')
                for d in docs:
                    parts.append(f'<li>{item["position"]}.{d["position"]} {_esc(d["title"])} [{_esc(d["doc_type"])}]</li>')
                parts.append("</ul>")
            parts.append("</div>")

    if prefs.get("footer_disclosures"):
        parts.append("<h2>Additional Notes &amp; Disclosures</h2>")
        parts.append(f'<p class="notes">{_esc_multiline(prefs["footer_disclosures"])}</p>')

    sum_title = f"{agenda.get('title') or 'Meeting Agenda'} — Summary"
    return _html_to_pdf_bytes("\n".join(parts), title=sum_title, include_page_numbers=include_page_numbers)


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


def _render_full_html_packet(
    agenda: dict,
    prefs: dict,
    logo_bytes: bytes | None,
    fetch_doc_bytes: Callable[[str], bytes],
    include_item_cover_sheets: bool = True,
    include_page_numbers: bool = True,
) -> bytes:
    """Render an entire Agenda Packet (TOC + item covers + non-PDF attachments) as a single Tagged PDF/UA."""
    parts = [_agenda_header_html(agenda, prefs, logo_bytes)]
    items = agenda.get("items", [])

    parts.append("<h2>Table of Contents</h2>")
    if not items:
        parts.append("<p>No agenda items.</p>")
    else:
        parts.append("<ul>")
        for item in items:
            sec = f" [{_esc(item['section'])}]" if item.get("section") else ""
            parts.append(
                f'<li><a href="#item-{item["position"]}">{item["position"]}. {_esc(item["title"])}{sec}</a>'
            )
            docs = item.get("documents", [])
            if docs:
                parts.append("<ul>")
                for d in docs:
                    parts.append(
                        f'<li><a href="#doc-{item["position"]}-{d["position"]}">'
                        f'{item["position"]}.{d["position"]} {_esc(d["title"])} [{_esc(d["doc_type"])}]</a></li>'
                    )
                parts.append("</ul>")
            parts.append("</li>")
        parts.append("</ul>")

    if prefs.get("footer_disclosures"):
        parts.append("<h2>Additional Notes &amp; Disclosures</h2>")
        parts.append(f'<p class="notes">{_esc_multiline(prefs["footer_disclosures"])}</p>')

    for item in items:
        docs = item.get("documents", [])
        if include_item_cover_sheets:
            prefix_parts = [p for p in [prefs.get("city_name"), agenda.get("body")] if p]
            if item.get("section"):
                prefix_parts.append(item["section"])
            prefix = " — ".join(_esc(p) for p in prefix_parts)
            kicker = f"{prefix} — AGENDA ITEM {item['position']}" if prefix else f"AGENDA ITEM {item['position']}"
            parts.append(f'<section id="item-{item["position"]}" style="page-break-before: always;">')
            parts.append(f'<p class="kicker">{kicker}</p>')
            parts.append(f'<h2>{item["position"]}. {_esc(item["title"])}</h2>')
            if item.get("description"):
                parts.append(f'<p>{_esc(item["description"])}</p>')
            for lbl, key in (
                ("Presenter", "presenter"),
                ("Recommended Motion", "recommended_motion"),
                ("Fiscal Impact", "fiscal_impact"),
            ):
                if item.get(key):
                    parts.append(f'<p><strong>{lbl}:</strong> {_esc(item[key])}</p>')
            parts.append("</section>")

        for doc in docs:
            parts.append(f'<section id="doc-{item["position"]}-{doc["position"]}" style="page-break-before: always;">')
            parts.append(f'<h3>{item["position"]}.{doc["position"]} {_esc(doc["title"])}</h3>')
            try:
                raw = fetch_doc_bytes(doc["object_key"])
                dtype = doc["doc_type"]
                if dtype == "TEXT":
                    txt = raw.decode("utf-8", errors="replace")
                    for blk in [b.strip() for b in txt.split("\n\n") if b.strip()] or ["(Empty text attachment)"]:
                        parts.append(f"<p>{_esc_multiline(blk)}</p>")
                elif dtype in ("PNG", "JPG"):
                    with PILImage.open(io.BytesIO(raw)) as im:
                        buf = io.BytesIO()
                        im.convert("RGBA").save(buf, format="PNG")
                        b64 = base64.b64encode(buf.getvalue()).decode("ascii")
                    parts.append(
                        f'<p><img src="data:image/png;base64,{b64}" alt="{_esc(doc["title"] or doc["filename"])}" '
                        'style="max-width: 100%; max-height: 8in;" /></p>'
                    )
                elif dtype == "CSV":
                    txt = raw.decode("utf-8", errors="replace")
                    rows = list(csv.reader(io.StringIO(txt)))
                    if rows:
                        parts.append('<table style="width: 100%; border-collapse: collapse; font-size: 8.5pt;">')
                        for r_idx, row in enumerate(rows[:200]):
                            tag = "th" if r_idx == 0 else "td"
                            cells = "".join(f'<{tag} style="border: 1px solid #cbd5e1; padding: 3pt 4pt; text-align: left;">{_esc(str(c))}</{tag}>' for c in row[:10])
                            parts.append(f"<tr>{cells}</tr>")
                        parts.append("</table>")
                else:
                    paras = _extract_docx_paragraphs(raw) if dtype == "DOCX" else []
                    if paras:
                        for p in paras:
                            parts.append(f"<p>{_esc(p)}</p>")
                    else:
                        parts.append(f'<p class="meta">Attachment: {_esc(doc["filename"])} ({_esc(dtype)})</p>')
            except Exception as exc:
                parts.append(f'<p class="meta">Could not embed {_esc(doc["doc_type"])} ({_esc(doc["filename"])}): {_esc(str(exc))}</p>')
            parts.append("</section>")

    pkt_title = f"{agenda.get('title') or 'Meeting Agenda'} — Packet"
    return _html_to_pdf_bytes("\n".join(parts), title=pkt_title, include_page_numbers=include_page_numbers)


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
        return _render_agenda_summary(
            agenda,
            prefs,
            logo_bytes,
            include_page_numbers=include_page_numbers,
        )

    has_external_pdf = any(
        d.get("doc_type") in ("PDF", "XLSX", "PPTX")
        for item in agenda.get("items", [])
        for d in item.get("documents", [])
    )
    if not has_external_pdf:
        return _render_full_html_packet(
            agenda,
            prefs,
            logo_bytes,
            fetch_doc_bytes,
            include_item_cover_sheets=include_item_cover_sheets,
            include_page_numbers=include_page_numbers,
        )

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
    """Build a formatted Meeting Minutes Tagged PDF/UA via WeasyPrint."""
    prefs = preferences or {}
    logo_bytes: bytes | None = None
    if prefs.get("city_logo_key"):
        try:
            logo_bytes = fetch_doc_bytes(prefs["city_logo_key"])
        except Exception:
            logo_bytes = None

    kicker_text = "DRAFT MEETING MINUTES (PENDING APPROVAL)" if watermark_draft else "MEETING MINUTES (APPROVED)"
    parts = [
        f'<p class="kicker" style="color: #1d4ed8;">{_esc(kicker_text)}</p>',
        _agenda_header_html(agenda, prefs, logo_bytes),
    ]

    if agenda.get("minutes_attendance"):
        parts.append("<h2>Attendance &amp; Roll Call</h2>")
        parts.append(f'<p>{_esc_multiline(agenda["minutes_attendance"])}</p>')
    if agenda.get("minutes_notes"):
        parts.append("<h2>General Meeting Notes</h2>")
        parts.append(f'<p>{_esc_multiline(agenda["minutes_notes"])}</p>')

    items = agenda.get("items", [])
    if not items:
        parts.append("<p>No agenda items recorded.</p>")
    else:
        last_sec = None
        for item in items:
            sec = (item.get("section") or "").strip()
            if sec and sec != last_sec:
                parts.append(f'<h2>{_esc(sec)}</h2>')
            last_sec = sec
            parts.append('<div class="item-block">')
            parts.append(f'<h3>{item["position"]}. {_esc(item["title"])}</h3>')

            action_parts = []
            if item.get("minutes_action"):
                action_parts.append(f"<strong>Action:</strong> {_esc(item['minutes_action'])}")
            if item.get("minutes_motion_by"):
                m_str = _esc(item["minutes_motion_by"])
                if item.get("minutes_second_by"):
                    m_str += f" (Second: {_esc(item['minutes_second_by'])})"
                action_parts.append(f"<strong>Motion:</strong> {m_str}")
            elif item.get("minutes_second_by"):
                action_parts.append(f"<strong>Second:</strong> {_esc(item['minutes_second_by'])}")
            if item.get("minutes_vote"):
                action_parts.append(f"<strong>Vote:</strong> {_esc(item['minutes_vote'])}")
            if action_parts:
                parts.append(f'<p class="item-meta">{" &nbsp;|&nbsp; ".join(action_parts)}</p>')
            if item.get("minutes_notes"):
                parts.append(f'<p class="item-meta">{_esc_multiline(item["minutes_notes"])}</p>')
            elif not action_parts:
                parts.append('<p class="item-meta"><em>No action or notes recorded.</em></p>')
            parts.append("</div>")

    if not watermark_draft:
        import base64
        from reportlab.graphics import renderSVG
        from reportlab.graphics.barcode import qr as _rl_qr
        from reportlab.graphics.shapes import Drawing

        aid = agenda.get("id")
        base_url = (os.environ.get("APP_BASE_URL") or "").strip().rstrip("/")
        verify_url = f"{base_url}/agendas/{aid}" if (base_url and aid) else (f"/agendas/{aid}" if aid else "")
        city_label = _esc(prefs.get("city_title") or "Municipality")
        qr_img_html = ""
        if verify_url:
            try:
                d = Drawing(72, 72)
                w = _rl_qr.QrCodeWidget(verify_url)
                b = w.getBounds()
                bw = max(1.0, b[2] - b[0])
                bh = max(1.0, b[3] - b[1])
                d = Drawing(72, 72, transform=[72.0 / bw, 0, 0, 72.0 / bh, 0, 0])
                d.add(w)
                svg_bytes = renderSVG.drawToString(d).encode("utf-8")
                b64 = base64.b64encode(svg_bytes).decode("ascii")
                qr_img_html = f'<img src="data:image/svg+xml;base64,{b64}" alt="Verification QR" style="width:72px;height:72px;" />'
            except Exception:
                qr_img_html = ""
        verify_line = f'<p class="item-meta">Verify online: {_esc(verify_url)}</p>' if verify_url else ""
        parts.append(
            '<div style="margin-top: 24px; padding: 12px 14px; border: 1px solid #cbd5e1; border-radius: 6px; background: #f8fafc; display: flex; justify-content: space-between; align-items: center; gap: 16px;">'
            '<div>'
            '<p style="margin: 0 0 4px;"><strong>Official Clerk Attestation</strong></p>'
            f'<p class="item-meta">Approved public minutes for {city_label} (Meeting ID #{_esc(str(aid or ""))}).</p>'
            '<p class="item-meta" style="margin-top: 8px;">Attested by Municipal Clerk: ________________________________</p>'
            f'{verify_line}'
            '</div>'
            f'{qr_img_html}'
            '</div>'
        )

    min_title = f"{agenda.get('title') or 'Meeting'} — Minutes"
    return _html_to_pdf_bytes(
        "\n".join(parts),
        title=min_title,
        include_page_numbers=include_page_numbers,
        watermark_draft=watermark_draft,
    )


def render_legislative_document_pdf(
    *,
    city_name: str,
    doc_kind: str,
    doc_number: str,
    title: str,
    body: str,
    meeting_date: str = "",
    effective_date: str = "",
    signatory_primary: str = "Mayor",
    signatory_secondary: str = "City Clerk",
) -> bytes:
    """Render a formal municipal Resolution, Ordinance, Proclamation, or Memo as a Tagged PDF."""
    kind_labels = {
        "resolution": "RESOLUTION",
        "ordinance": "ORDINANCE",
        "proclamation": "PROCLAMATION",
        "memo": "MEMORANDUM",
    }
    kind_label = kind_labels.get((doc_kind or "").lower(), "DOCUMENT")
    city_esc = _esc((city_name or "Municipality").strip())
    num_esc = _esc(doc_number.strip())
    title_esc = _esc(title.strip())

    meta_bits = []
    if meeting_date.strip():
        meta_bits.append(f"Meeting Date: {_esc(meeting_date.strip())}")
    if effective_date.strip():
        meta_bits.append(f"Effective Date: {_esc(effective_date.strip())}")
    meta_html = (
        f'<p style="color:#475569;font-size:9.5pt;margin:4pt 0 14pt;">{" &nbsp;|&nbsp; ".join(meta_bits)}</p>'
        if meta_bits
        else ""
    )

    heading_line = f"{kind_label} NO. {num_esc}" if num_esc else kind_label
    paragraphs = [p.strip() for p in re.split(r"\n\s*\n", body.strip()) if p.strip()]
    body_html = "\n".join(f'<p style="margin:0 0 10pt;text-align:justify;">{_esc_multiline(p)}</p>' for p in paragraphs)

    sig_html = ""
    if (doc_kind or "").lower() != "memo":
        sig_html = (
            '<div style="margin-top:28pt;display:flex;justify-content:space-between;gap:24pt;page-break-inside:avoid;">'
            '<div style="flex:1;">'
            '<div style="border-bottom:1px solid #334155;height:24pt;"></div>'
            f'<p style="margin:4pt 0 0;font-size:9.5pt;"><strong>{_esc(signatory_primary or "Mayor")}</strong></p>'
            '</div>'
            '<div style="flex:1;">'
            '<div style="border-bottom:1px solid #334155;height:24pt;"></div>'
            f'<p style="margin:4pt 0 0;font-size:9.5pt;"><strong>Attest: {_esc(signatory_secondary or "City Clerk")}</strong></p>'
            '</div>'
            '</div>'
        )

    parts = [
        f'<p style="text-transform:uppercase;letter-spacing:1.2px;font-size:9.5pt;color:#1e3a8a;font-weight:700;margin:0 0 4pt;">{city_esc}</p>',
        f'<h1 style="font-size:15pt;margin:0 0 4pt;">{_esc(heading_line)}</h1>',
        f'<h2 style="font-size:12pt;border-bottom:1px solid #cbd5e1;padding-bottom:6pt;margin:0 0 8pt;color:#0f172a;">{title_esc}</h2>',
        meta_html,
        body_html,
        sig_html,
    ]
    full_title = f"{heading_line} — {title.strip()}" if num_esc else title.strip()
    return _html_to_pdf_bytes("\n".join(parts), title=full_title, include_page_numbers=True)
