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

"""Smart PDF parser & legal text formatter for Municipal Codification."""
from __future__ import annotations

from collections import Counter
from datetime import datetime
import io
import os
import re

_PAGE_HDR_PATTERNS = [
    re.compile(r"^Code\s+\d+[A-Za-z]?\s*[-–—]\s*page\s+\d+.*$", re.IGNORECASE),
    re.compile(r"^Page\s+\d+(?:\s+of\s+\d+)?$", re.IGNORECASE),
    re.compile(r"^[-–—]?\s*\d{1,4}\s*[-–—]?$"),
    re.compile(r"^(?:City|Town|Village)\s+of\s+.{2,60}?(?:Code|Ordinances)\s*[-–—|]?\s*(?:Page\s*\d+)?$", re.IGNORECASE),
]

_CHAPTER_LINE_RE = re.compile(
    r"^(?:CHAPTER|TITLE)\s+([0-9IVXLCM]+[A-Za-z0-9.-]*)\b(?:\s*[-–—:.]\s*(.+))?$",
    re.IGNORECASE,
)
_ARTICLE_LINE_RE = re.compile(
    r"^(?:ARTICLE|DIVISION|PART)\s+([0-9IVXLCM]+)\b(?:\s*[-–—.:]\s*(.+))?$",
    re.IGNORECASE,
)
_MUNI_SEC_LINE_RE = re.compile(
    r"^(?:Sec(?:tion)?\.?|§)\s*([0-9]+(?:[-.][0-9A-Za-z]+)*)\.?(?:\s*[-–—.]\s*|\s+)(.*)$",
    re.IGNORECASE,
)
_DECIMAL_SUBSEC_RE = re.compile(r"^\d{2,4}\.\d{2,4}[A-Za-z]?\.?\s+[A-Z]")
_HYPHEN_SUBSEC_RE = re.compile(r"^\d{1,3}-\d{1,4}[A-Za-z]?\.?\s+[A-Z]")
_TOP_SEC_TITLE_RE = re.compile(r"^(\d{2,4}[A-Za-z]?)\.\s+([A-Z][A-Z0-9\s,&/'()-]{2,})$")
_SUBD_RE = re.compile(r"^(?:Subd(?:ivision)?\.?)\s*\d+[A-Za-z]?\.?\b", re.IGNORECASE)
_PAREN_OUTLINE_RE = re.compile(r"^(?:\([a-z]{1,2}\)|\(\d{1,3}\)|\([A-Z]{1,2}\)|\([ivxlcdm]{1,5}\))\s+")
_DOT_OUTLINE_RE = re.compile(r"^(?:[A-Z]|\d{1,3}|[a-z])\.\s+\S")
_BULLET_RE = re.compile(r"^(?:[•●▪▫◦\*]\s+|-\s+\S)")
_HISTORY_RE = re.compile(
    r"""^(?:["'(]?(?:AMENDED|ADOPTED|ENACTED|REPEALED|ADDED|UPDATED)\s+BY\s+ORD|\((?:Ord\.?|Code\s+\d{4}|Prior\s+Code|Res\.?|State\s+Law))""",
    re.IGNORECASE,
)
_ORDAINING_RE = re.compile(r"^The\s+(?:City\s+)?Council\s+of\s+.+does\s+ordain", re.IGNORECASE)
_TOC_DOTS_RE = re.compile(r"(?:\.{4,}\s*\d{1,4}|\s{3,}\d{1,4})$")

_ORD_NUM_RE = re.compile(
    r"\bOrd(?:inance)?\.?\s*(?:No\.?\s*|#\s*)?([0-9]{2,4}[-–][0-9A-Za-z]+|[0-9]+)\b",
    re.IGNORECASE,
)
_DATE_MONTH_RE = re.compile(
    r"\b(January|February|March|April|May|June|July|August|September|October|November|December)\s+(\d{1,2}),?\s+(\d{4})\b",
    re.IGNORECASE,
)
_DATE_NUM_RE = re.compile(r"(?<!\d)(\d{4}[-.]\d{2}[-.]\d{2}|\d{1,2}[/-]\d{1,2}[/-]\d{2,4})(?!\d)")

_MINOR_TITLE_WORDS = {"a", "an", "and", "as", "at", "by", "for", "from", "in", "of", "on", "or", "the", "to", "with"}


def _smart_title(text: str) -> str:
    clean = re.sub(r"\s+", " ", (text or "").strip())
    if not clean:
        return ""
    if not clean.isupper():
        return clean
    words = clean.split(" ")
    out = []
    for idx, w in enumerate(words):
        lw = w.lower()
        if idx > 0 and idx < len(words) - 1 and lw in _MINOR_TITLE_WORDS:
            out.append(lw)
        else:
            out.append(w.capitalize())
    return " ".join(out)


def _normalize_raw_text(raw: str) -> str:
    txt = (raw or "").replace("\r\n", "\n").replace("\r", "\n")
    txt = txt.replace("\xa0", " ").replace("\ufb01", "fi").replace("\ufb02", "fl").replace("\t", " ")
    return txt


def _edge_template(line: str) -> str:
    return re.sub(r"\d+", "#", re.sub(r"\s+", " ", line.strip())).lower()


def _is_boundary_line(line: str, prev_line: str = "") -> bool:
    if not line:
        return False
    for rx in (
        _CHAPTER_LINE_RE,
        _ARTICLE_LINE_RE,
        _MUNI_SEC_LINE_RE,
        _DECIMAL_SUBSEC_RE,
        _HYPHEN_SUBSEC_RE,
        _TOP_SEC_TITLE_RE,
        _SUBD_RE,
        _PAREN_OUTLINE_RE,
        _BULLET_RE,
        _HISTORY_RE,
        _ORDAINING_RE,
    ):
        if rx.match(line):
            return True
    if _DOT_OUTLINE_RE.match(line):
        prev = (prev_line or "").rstrip()
        if not prev or prev.endswith((".", ":", ";", ")", '"', "!", "?")) or len(prev) <= 72:
            return True
    return False


def _strip_page_edges(pages: list[str]) -> list[str]:
    cleaned_pages: list[list[str]] = []
    edge_counts: Counter[str] = Counter()

    for page in pages:
        lines = [_normalize_raw_text(ln).strip() for ln in _normalize_raw_text(page).splitlines()]
        cleaned_pages.append(lines)

    if len(cleaned_pages) >= 3:
        for lines in cleaned_pages:
            non_empty = [ln for ln in lines if ln]
            seen_on_page: set[str] = set()
            for candidate in non_empty[:2] + non_empty[-2:]:
                if len(candidate) < 100:
                    seen_on_page.add(_edge_template(candidate))
            for tpl in seen_on_page:
                edge_counts[tpl] += 1

    min_repeat = max(2, (len(cleaned_pages) + 1) // 2) if len(cleaned_pages) >= 3 else len(cleaned_pages) + 1
    repeated_edges = {tpl for tpl, cnt in edge_counts.items() if cnt >= min_repeat and tpl}

    result_pages: list[str] = []
    for lines in cleaned_pages:
        non_empty_indices = [i for i, ln in enumerate(lines) if ln]
        edge_idx_set = set(non_empty_indices[:2] + non_empty_indices[-2:])
        kept: list[str] = []
        for idx, ln in enumerate(lines):
            if not ln:
                kept.append("")
                continue
            if any(rx.match(ln) for rx in _PAGE_HDR_PATTERNS[:2]):
                continue
            if idx in edge_idx_set:
                if any(rx.match(ln) for rx in _PAGE_HDR_PATTERNS[2:]):
                    continue
                if len(ln) < 100 and _edge_template(ln) in repeated_edges:
                    continue
            kept.append(ln)
        result_pages.append("\n".join(kept))
    return result_pages


def clean_pdf_pages(pages_text: list[str]) -> str:
    """Clean extracted PDF pages: strip headers/footers, de-hyphenate, and reflow paragraphs."""
    if not pages_text:
        return ""
    stripped_pages = _strip_page_edges(pages_text)
    joined = "\n\n".join(p.strip() for p in stripped_pages if p.strip())
    if not joined:
        return ""

    # De-hyphenate soft line wraps across newlines
    joined = re.sub(r"([a-z]{2,})-\n([a-z]{2,})", r"\1\2", joined)

    paragraphs: list[str] = []
    cur_parts: list[str] = []
    prev_non_empty = ""
    had_blank_line = False

    def flush() -> None:
        nonlocal cur_parts
        if cur_parts:
            text = re.sub(r"[ \t]{2,}", " ", " ".join(cur_parts)).strip()
            if text:
                paragraphs.append(text)
            cur_parts = []

    for raw_line in joined.splitlines():
        line = re.sub(r"[ \t]{2,}", " ", raw_line).strip()
        if not line:
            had_blank_line = True
            continue

        if _is_boundary_line(line, prev_non_empty):
            flush()
            cur_parts.append(line)
        elif had_blank_line and cur_parts and prev_non_empty.endswith((".", ":", ";", "?", "!", '"')):
            flush()
            cur_parts.append(line)
        else:
            cur_parts.append(line)

        prev_non_empty = line
        had_blank_line = False

    flush()
    return "\n\n".join(paragraphs)


def extract_ordinance_metadata(text: str, filename: str = "") -> dict[str, str]:
    """Extract the most recent ordinance reference and ISO effective date from code text or filename."""
    ord_ref = ""
    matches = _ORD_NUM_RE.findall(text or "")
    if matches:
        num = matches[-1].replace("–", "-").strip()
        ord_ref = f"Ord. {num}"

    eff_date = ""
    # Prefer dates near an ordinance/effective/amended mention first, then any month date
    month_matches = list(_DATE_MONTH_RE.finditer(text or ""))
    if month_matches:
        m = month_matches[-1]
        try:
            dt = datetime.strptime(f"{m.group(1)} {int(m.group(2))} {m.group(3)}", "%B %d %Y")
            eff_date = dt.date().isoformat()
        except ValueError:
            pass

    if not eff_date:
        for src in (text or "", filename or ""):
            for m in _DATE_NUM_RE.finditer(src):
                token = m.group(1).replace(".", "-").replace("/", "-")
                for fmt in ("%Y-%m-%d", "%m-%d-%Y", "%m-%d-%y"):
                    try:
                        eff_date = datetime.strptime(token, fmt).date().isoformat()
                        break
                    except ValueError:
                        continue
                if eff_date:
                    break
            if eff_date:
                break

    return {"ordinance_ref": ord_ref, "effective_date": eff_date}


def count_subsections(body: str) -> int:
    """Count distinct numbered subsections or subdivisions in formatted code body text."""
    cnt = 0
    for block in re.split(r"\n\n+", body or ""):
        b = block.strip()
        if not b:
            continue
        if (
            _DECIMAL_SUBSEC_RE.match(b)
            or _HYPHEN_SUBSEC_RE.match(b)
            or _MUNI_SEC_LINE_RE.match(b)
            or _SUBD_RE.match(b)
        ):
            cnt += 1
    return cnt


def _chapter_prefix_for_section(sec_num: str) -> str:
    clean = (sec_num or "").strip()
    if "-" in clean and clean.split("-", 1)[0].isdigit():
        return f"Ch. {clean.split('-', 1)[0]}"
    m = re.match(r"^(\d)\d{2}[A-Za-z]?$", clean)
    if m:
        return f"{m.group(1)}XX"
    return "General"


def _humanize_slug(slug: str) -> str:
    txt = re.sub(r"[-_]?v?\d{4}[.-]\d{2}[.-]\d{2}(?:-\d+)?$", "", slug or "", flags=re.IGNORECASE)
    txt = re.sub(r"-\d+$", "", txt)
    txt = txt.replace("-", " ").replace("_", " ").strip()
    txt = re.sub(r"^Series\s+", "", txt, flags=re.IGNORECASE)
    txt = re.sub(r"\s+", " ", txt).strip()
    if not txt:
        return ""
    words = txt.split(" ")
    return " ".join(w.lower() if (idx > 0 and w.lower() in _MINOR_TITLE_WORDS) else w for idx, w in enumerate(words))


def infer_section_info_from_filename(filename: str) -> dict[str, str]:
    """Infer chapter prefix, section number, and human-readable title from a filename."""
    base = os.path.basename(filename or "").rsplit(".", 1)[0].strip()
    if not base:
        return {"chapter_prefix": "General", "chapter_title": "", "section_number": "", "title": ""}

    # Pattern 1: Section-101-Series-Adoption-of-Code or Sec_30-15_Parking
    m = re.match(r"^(?:Section|Sec)[_-]?(\d+(?:-\d+)?[A-Za-z]?)[_-]+(.+)$", base, re.IGNORECASE)
    if m:
        sec_num = m.group(1).upper() if m.group(1)[-1:].isalpha() else m.group(1)
        title = _humanize_slug(m.group(2))
        return {
            "chapter_prefix": _chapter_prefix_for_section(sec_num),
            "chapter_title": "",
            "section_number": sec_num,
            "title": title,
        }

    # Pattern 2: Chapter-12-Animals or Ch_12_Animals
    m = re.match(r"^(?:Chapter|Ch)[_-]?([0-9IVXLCM]+[A-Za-z]?)[_-]*(.*)$", base, re.IGNORECASE)
    if m:
        ch_num = m.group(1)
        return {
            "chapter_prefix": f"Ch. {ch_num}",
            "chapter_title": _humanize_slug(m.group(2)),
            "section_number": "",
            "title": "",
        }

    # Pattern 3: BirchwoodCityCode801
    m = re.search(r"(\d{3}[A-Za-z]?)$", base)
    if m:
        sec_num = m.group(1)
        return {
            "chapter_prefix": _chapter_prefix_for_section(sec_num),
            "chapter_title": "",
            "section_number": sec_num,
            "title": "",
        }

    return {
        "chapter_prefix": "General",
        "chapter_title": "",
        "section_number": "",
        "title": _humanize_slug(base),
    }


def _strip_toc_blocks(paragraphs: list[str]) -> list[str]:
    out: list[str] = []
    for p in paragraphs:
        if _TOC_DOTS_RE.search(p) and len(p) < 220:
            continue
        out.append(p)
    return out


def _detect_multi_section_book(paragraphs: list[str]) -> list[dict] | None:
    """Split a full Municipal Code book into Chapters -> Sections (with optional Article tracking)."""
    work = _strip_toc_blocks(paragraphs)
    chapter_hits = sum(1 for p in work if _CHAPTER_LINE_RE.match(p))
    muni_sec_hits = sum(1 for p in work if _MUNI_SEC_LINE_RE.match(p))
    if chapter_hits < 2 and muni_sec_hits < 2:
        return None

    chapters: list[dict] = []
    chap_by_prefix: dict[str, dict] = {}
    current_chapter: dict | None = None
    current_article = ""
    current_section: dict | None = None
    section_body_blocks: list[str] = []

    def ensure_chapter(prefix: str, title: str = "") -> dict:
        nonlocal current_chapter
        norm_p = prefix.strip() or "General"
        if norm_p in chap_by_prefix:
            current_chapter = chap_by_prefix[norm_p]
            if title and not current_chapter["title"]:
                current_chapter["title"] = title
            return current_chapter
        ch = {
            "code_prefix": norm_p,
            "title": title or (f"Chapter {norm_p}" if not norm_p.startswith("Ch.") else norm_p.replace("Ch. ", "Chapter ")),
            "sections": [],
        }
        chapters.append(ch)
        chap_by_prefix[norm_p] = ch
        current_chapter = ch
        return ch

    def flush_section() -> None:
        nonlocal current_section, section_body_blocks
        if not current_section:
            section_body_blocks = []
            return
        body = "\n\n".join(section_body_blocks).strip()
        meta = extract_ordinance_metadata(body)
        current_section["body"] = body
        current_section["ordinance_ref"] = meta["ordinance_ref"]
        current_section["effective_date"] = meta["effective_date"]
        current_section["subsection_count"] = count_subsections(body)
        current_chapter["sections"].append(current_section)
        current_section = None
        section_body_blocks = []

    for p in work:
        cm = _CHAPTER_LINE_RE.match(p)
        if cm:
            flush_section()
            current_article = ""
            ch_id = cm.group(1).strip()
            ch_title = _smart_title(cm.group(2) or "") or f"Chapter {ch_id}"
            ensure_chapter(f"Ch. {ch_id}", ch_title)
            continue

        am = _ARTICLE_LINE_RE.match(p)
        if am:
            flush_section()
            art_id = am.group(1).strip()
            art_name = _smart_title(am.group(2) or "")
            current_article = f"Article {art_id} — {art_name}" if art_name else f"Article {art_id}"
            continue

        sm = _MUNI_SEC_LINE_RE.match(p)
        if sm:
            flush_section()
            sec_num = sm.group(1).strip()
            sec_rest = sm.group(2).strip()
            sec_title = sec_rest
            inline_body = ""
            # Handle inline heading + body: "Sec. 1-1. How Code designated. The ordinances..."
            if len(sec_rest) > 90 or ". " in sec_rest:
                parts = re.split(r"(?<=[.:])\s+", sec_rest, maxsplit=1)
                if parts and len(parts[0]) <= 110:
                    sec_title = parts[0].rstrip(".")
                    inline_body = parts[1].strip() if len(parts) > 1 else ""
            sec_title = _smart_title(sec_title.rstrip(".")) or f"Section {sec_num}"
            if current_chapter is None:
                inferred_pref = _chapter_prefix_for_section(sec_num)
                ensure_chapter(inferred_pref, f"Chapter {inferred_pref.replace('Ch. ', '')}")
            current_section = {
                "section_number": sec_num,
                "article": current_article,
                "title": sec_title,
                "summary": "",
                "body": "",
                "ordinance_ref": "",
                "effective_date": "",
                "subsection_count": 0,
            }
            if inline_body:
                section_body_blocks.append(inline_body)
            continue

        if current_section is not None:
            section_body_blocks.append(p)

    flush_section()
    chapters = [ch for ch in chapters if ch["sections"]]
    return chapters or None


def parse_code_pdf(raw_bytes: bytes, filename: str = "") -> dict:
    """Parse a PDF (single section OR full multi-chapter Code book) into structured chapters & sections."""
    from pypdf import PdfReader

    reader = PdfReader(io.BytesIO(raw_bytes))
    pages_text = [(p.extract_text() or "").strip() for p in reader.pages]
    warnings: list[str] = []
    if not any(pages_text):
        warnings.append(f"{filename or 'PDF'}: no selectable text extracted (scanned image PDF — run OCR or view original PDF).")
        info = infer_section_info_from_filename(filename)
        return {
            "kind": "section",
            "pages": len(reader.pages),
            "chapters": [
                {
                    "code_prefix": info["chapter_prefix"],
                    "title": info["chapter_title"] or f"Chapter {info['chapter_prefix']}",
                    "sections": [
                        {
                            "section_number": info["section_number"] or "100",
                            "article": "",
                            "title": info["title"] or "Untitled Section",
                            "summary": "",
                            "body": "",
                            "ordinance_ref": "",
                            "effective_date": "",
                            "subsection_count": 0,
                        }
                    ],
                }
            ],
            "warnings": warnings,
        }

    cleaned = clean_pdf_pages(pages_text)
    paragraphs = [p for p in cleaned.split("\n\n") if p.strip()]

    book_chapters = _detect_multi_section_book(paragraphs)
    if book_chapters:
        return {
            "kind": "book",
            "pages": len(reader.pages),
            "chapters": book_chapters,
            "warnings": warnings,
        }

    # Single-section PDF
    info = infer_section_info_from_filename(filename)
    sec_num = info["section_number"]
    sec_title = info["title"]
    article = ""

    if paragraphs:
        top = _TOP_SEC_TITLE_RE.match(paragraphs[0])
        if top:
            if not sec_num:
                sec_num = top.group(1).strip()
            if not sec_title:
                sec_title = _smart_title(top.group(2))
            paragraphs = paragraphs[1:]
        elif not sec_num:
            ms = _MUNI_SEC_LINE_RE.match(paragraphs[0])
            if ms:
                sec_num = ms.group(1).strip()
                if not sec_title:
                    sec_title = _smart_title(ms.group(2).rstrip("."))
                paragraphs = paragraphs[1:]

    if paragraphs and _ARTICLE_LINE_RE.match(paragraphs[0]):
        am = _ARTICLE_LINE_RE.match(paragraphs[0])
        art_name = _smart_title(am.group(2) or "")
        article = f"Article {am.group(1).strip()} — {art_name}" if art_name else f"Article {am.group(1).strip()}"

    body = "\n\n".join(paragraphs).strip()
    meta = extract_ordinance_metadata(body, filename)
    sec_num = sec_num or "100"
    sec_title = sec_title or f"Section {sec_num}"
    ch_prefix = info["chapter_prefix"] if info["chapter_prefix"] != "General" else _chapter_prefix_for_section(sec_num)

    return {
        "kind": "section",
        "pages": len(reader.pages),
        "chapters": [
            {
                "code_prefix": ch_prefix,
                "title": info["chapter_title"] or f"Chapter {ch_prefix}",
                "sections": [
                    {
                        "section_number": sec_num,
                        "article": article,
                        "title": sec_title,
                        "summary": "",
                        "body": body,
                        "ordinance_ref": meta["ordinance_ref"],
                        "effective_date": meta["effective_date"],
                        "subsection_count": count_subsections(body),
                    }
                ],
            }
        ],
        "warnings": warnings,
    }
