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

"""Layout-aware PDF parser, local OCR fallback, & multi-city legal tree splitter."""
from __future__ import annotations

from collections import Counter
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime
import io
import os
import re
import shutil
import subprocess
import tempfile

MAX_OCR_PAGES = int(os.environ.get("MAX_OCR_PAGES", "60"))

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
    r"^(ARTICLE|DIVISION|PART)\s+([0-9IVXLCM]+)\b(?:\s*[-–—.:]\s*(.+))?$",
    re.IGNORECASE,
)
_PREFIXED_SEC_LINE_RE = re.compile(
    r"^(?:Sec(?:tion)?\.?|§+)\s*([0-9]+(?:[-.][0-9A-Za-z]+)*)\.?(?:\s*[-–—.:]\s*|\s+)(.*)$",
    re.IGNORECASE,
)
_DOTTED_3PART_LINE_RE = re.compile(r"^(\d{1,3}\.\d{1,3}\.\d{1,4}[A-Za-z]?)\.?(?:\s+(.*)|$)")
_DOTTED_SERIES_LINE_RE = re.compile(r"^(\d{1,4}[A-Za-z]?\.\d{2,4}[A-Za-z]?)\.?(?:\s+(.*)|$)")
_HYPHEN_SEC_LINE_RE = re.compile(r"^(\d{1,3}-\d{1,4}[A-Za-z]?)\.?\s+([A-Z].*)$")
_TOP_SEC_TITLE_RE = re.compile(r"^(\d{2,4}[A-Za-z]?)\.\s+([A-Z][A-Z0-9\s,&/'():-]{2,})$")
_SUBD_RE = re.compile(r"^(?:Subd(?:ivision)?\.?)\s*(\d+[A-Za-z]?)\.?(?:\s+(.*)|$)", re.IGNORECASE)
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

_PUNCT_HEAD_RE = re.compile(r"^([A-Z][A-Za-z0-9\s,&/'()–-]{1,95}?)[.:](?:\s+(.*)|$)")
_CAPS_ONLY_HEAD_RE = re.compile(r"^([A-Z][A-Z0-9\s,&/'()–-]{2,95})$")
_CAPS_INLINE_HEAD_RE = re.compile(r"^([A-Z][A-Z0-9\s,&/'()–-]{2,80}?)\s+(?=[A-Z][a-z])(.*)$")

_SLASH_GLYPH_RE = re.compile(r"/i?\d+\b")
_CID_TOKEN_RE = re.compile(r"\(cid:\d+\)")
_ENGLISH_WORD_RE = re.compile(r"\b[A-Za-z]{3,25}\b")


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
    # Collapse OCR/kerning single-letter spaces in all-caps headings like "C OMPLIANCE" -> "COMPLIANCE"
    txt = re.sub(r"\b([A-Z])\s+([A-Z]{3,})\b", r"\1\2", txt)
    return txt


def _edge_template(line: str) -> str:
    return re.sub(r"\d+", "#", re.sub(r"\s+", " ", line.strip())).lower()


def _is_standalone_heading_text(text: str) -> bool:
    s = (text or "").strip()
    if not s or len(s) > 120:
        return False
    if _TOP_SEC_TITLE_RE.match(s) or _CHAPTER_LINE_RE.match(s) or _ARTICLE_LINE_RE.match(s):
        return True
    for rx in (_DOTTED_3PART_LINE_RE, _DOTTED_SERIES_LINE_RE, _PREFIXED_SEC_LINE_RE):
        m = rx.match(s)
        if m:
            rest = (m.group(2) or "").strip() if len(m.groups()) >= 2 else ""
            if rest and _CAPS_ONLY_HEAD_RE.match(rest) and not rest.endswith("."):
                return True
    return False


def _is_structural_line(line: str) -> bool:
    for rx in (
        _CHAPTER_LINE_RE,
        _ARTICLE_LINE_RE,
        _DOTTED_3PART_LINE_RE,
        _DOTTED_SERIES_LINE_RE,
        _PREFIXED_SEC_LINE_RE,
        _TOP_SEC_TITLE_RE,
    ):
        if rx.match(line):
            return True
    return False


_PREP_WRAP_RE = re.compile(r"\b(?:in|into|of|under|to|with|by|per|from|see|than|or|and)\s*$", re.IGNORECASE)


def _is_boundary_line(line: str, prev_line: str = "") -> bool:
    if not line:
        return False
    prev = (prev_line or "").rstrip()
    prev_wrap_ref = bool(prev and _PREP_WRAP_RE.search(prev))
    for rx in (
        _CHAPTER_LINE_RE,
        _ARTICLE_LINE_RE,
        _PREFIXED_SEC_LINE_RE,
        _DOTTED_3PART_LINE_RE,
        _DOTTED_SERIES_LINE_RE,
        _HYPHEN_SEC_LINE_RE,
        _TOP_SEC_TITLE_RE,
        _SUBD_RE,
        _PAREN_OUTLINE_RE,
        _BULLET_RE,
        _HISTORY_RE,
        _ORDAINING_RE,
    ):
        m = rx.match(line)
        if m:
            if rx in (_PREFIXED_SEC_LINE_RE, _DOTTED_3PART_LINE_RE, _DOTTED_SERIES_LINE_RE, _HYPHEN_SEC_LINE_RE):
                rest = (m.group(2) or "").strip() if len(m.groups()) >= 2 else ""
                if (rest and rest[0].islower()) or (rx == _PREFIXED_SEC_LINE_RE and prev_wrap_ref):
                    return False
            return True
    if _DOT_OUTLINE_RE.match(line):
        if not prev or prev.endswith((".", ":", ";", ")", '"', "!", "?")) or len(prev) <= 72:
            return True
    return False


def page_needs_ocr(text: str) -> tuple[bool, str]:
    """Detect empty/scanned pages or broken-CMap glyph strings needing raster OCR."""
    raw = _normalize_raw_text(text)
    stripped = re.sub(r"\s+", " ", raw).strip()
    if not stripped or len(stripped) < 25:
        return (True, "empty_text")
    if len(stripped) < 120 and any(rx.match(stripped) for rx in _PAGE_HDR_PATTERNS[:3]):
        return (True, "empty_text")

    non_ws = re.sub(r"\s+", "", raw)
    n_non_ws = len(non_ws)
    tokens = stripped.split()

    slash_hits = len(_SLASH_GLYPH_RE.findall(raw))
    if slash_hits >= 6 and (slash_hits / max(1, len(tokens))) >= 0.15:
        return (True, "garbled_fonts")

    cid_hits = len(_CID_TOKEN_RE.findall(raw))
    if cid_hits >= 4:
        return (True, "garbled_fonts")

    bad_chars = sum(
        1
        for ch in non_ws
        if ord(ch) == 0xFFFD or (0xE000 <= ord(ch) <= 0xF8FF) or (ord(ch) < 32)
    )
    if n_non_ws > 0 and (bad_chars / n_non_ws) >= 0.08:
        return (True, "garbled_fonts")

    if n_non_ws >= 60:
        alpha_chars = sum(1 for ch in non_ws if ch.isalpha())
        if (alpha_chars / n_non_ws) < 0.30:
            return (True, "garbled_fonts")
        words = [
            w for w in _ENGLISH_WORD_RE.findall(stripped)
            if re.search(r"[AEIOUYaeiouy]", w)
        ]
        if n_non_ws >= 140 and len(words) < 5:
            return (True, "garbled_fonts")

    return (False, "")


def _tesseract_available() -> bool:
    return bool(shutil.which("tesseract"))


def _ocr_single_image(png_path: str) -> str:
    env = {**os.environ, "OMP_THREAD_LIMIT": "1"}
    proc = subprocess.run(
        ["tesseract", png_path, "stdout", "-l", "eng", "--psm", "6"],
        capture_output=True,
        text=True,
        timeout=45,
        env=env,
        check=False,
    )
    if proc.returncode != 0:
        return ""
    return proc.stdout or ""


def extract_pdf_document(raw_bytes: bytes, enable_ocr: bool = True) -> dict:
    """Extract per-page text, layout metadata, PDF TOC, and optional Tesseract OCR fallback."""
    pages_text: list[str] = []
    line_styles: dict[str, dict] = {}
    toc: list[list] = []
    warnings: list[str] = []
    used_ocr = False
    ocr_pages: list[int] = []
    ocr_reasons: set[str] = set()
    body_font_size = 11.0

    fitz_mod = None
    try:
        import pymupdf as _fitz  # PyMuPDF
        fitz_mod = _fitz
    except ImportError:
        fitz_mod = None

    if fitz_mod is not None:
        doc = fitz_mod.open(stream=raw_bytes, filetype="pdf")
        try:
            try:
                toc = doc.get_toc(simple=True) or []
            except Exception:
                toc = []

            font_sizes: Counter[float] = Counter()
            raw_page_lines: list[list[dict]] = []

            for page in doc:
                txt = (page.get_text("text") or "").strip()
                pages_text.append(txt)
                p_lines: list[dict] = []
                try:
                    pdata = page.get_text("dict")
                    for blk in pdata.get("blocks", []):
                        if blk.get("type") != 0:
                            continue
                        for ln in blk.get("lines", []):
                            spans = ln.get("spans", [])
                            if not spans:
                                continue
                            ltext = "".join(sp.get("text", "") for sp in spans).strip()
                            if not ltext:
                                continue
                            max_sz = max((float(sp.get("size", 0) or 0) for sp in spans), default=0.0)
                            is_bold = any(
                                bool((sp.get("flags", 0) or 0) & 16)
                                or "bold" in str(sp.get("font", "")).lower()
                                for sp in spans
                            )
                            x0 = float((ln.get("bbox") or [0])[0])
                            if len(ltext) >= 20 and max_sz > 0:
                                font_sizes[round(max_sz, 1)] += len(ltext)
                            p_lines.append({"text": ltext, "size": round(max_sz, 1), "bold": is_bold, "x0": round(x0, 1)})
                except Exception:
                    pass
                raw_page_lines.append(p_lines)

            if font_sizes:
                body_font_size = float(font_sizes.most_common(1)[0][0])

            for p_lines in raw_page_lines:
                for ln in p_lines:
                    norm_key = re.sub(r"\s+", " ", _normalize_raw_text(ln["text"])).strip().lower()
                    if norm_key and norm_key not in line_styles:
                        line_styles[norm_key] = {
                            "bold": ln["bold"],
                            "larger": ln["size"] >= (body_font_size + 1.0),
                            "size": ln["size"],
                            "x0": ln["x0"],
                        }

            flagged: list[tuple[int, str]] = []
            for idx, txt in enumerate(pages_text):
                need, reason = page_needs_ocr(txt)
                if need:
                    flagged.append((idx, reason))

            if flagged:
                if enable_ocr and _tesseract_available():
                    if len(flagged) > MAX_OCR_PAGES:
                        warnings.append(
                            f"PDF has {len(flagged)} scanned/unreadable pages; OCR processed first {MAX_OCR_PAGES} pages."
                        )
                        flagged = flagged[:MAX_OCR_PAGES]
                    with tempfile.TemporaryDirectory(prefix="dh_ocr_") as tmpdir:
                        tasks: list[tuple[int, str, str]] = []
                        for p_idx, reason in flagged:
                            pix = doc[p_idx].get_pixmap(dpi=200, colorspace=fitz_mod.csGRAY)
                            img_path = os.path.join(tmpdir, f"page_{p_idx}.png")
                            pix.save(img_path)
                            tasks.append((p_idx, reason, img_path))

                        max_workers = min(2, max(1, len(tasks)))
                        with ThreadPoolExecutor(max_workers=max_workers) as ex:
                            results = list(ex.map(lambda t: _ocr_single_image(t[2]), tasks))

                        for (p_idx, reason, _), ocr_txt in zip(tasks, results):
                            clean_ocr = ocr_txt.strip()
                            if clean_ocr:
                                pages_text[p_idx] = clean_ocr
                                used_ocr = True
                                ocr_pages.append(p_idx + 1)
                                ocr_reasons.add(reason)
                elif not _tesseract_available():
                    warnings.append("Scanned or custom-font pages detected, but tesseract OCR is unavailable on host.")
        finally:
            doc.close()
    else:
        from pypdf import PdfReader

        reader = PdfReader(io.BytesIO(raw_bytes))
        pages_text = [(p.extract_text() or "").strip() for p in reader.pages]

    return {
        "pages_text": pages_text,
        "page_count": len(pages_text),
        "toc": toc,
        "line_styles": line_styles,
        "body_font_size": body_font_size,
        "used_ocr": used_ocr,
        "ocr_pages": ocr_pages,
        "ocr_reason": ", ".join(sorted(ocr_reasons)) if ocr_reasons else "",
        "warnings": warnings,
    }


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
                if len(candidate) < 100 and not _is_structural_line(candidate):
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
                if len(ln) < 100 and not _is_structural_line(ln) and _edge_template(ln) in repeated_edges:
                    continue
            kept.append(ln)
        result_pages.append("\n".join(kept))
    return result_pages


def _repair_ocr_section_numbers(text: str) -> str:
    """Repair sequence-aware OCR typos (e.g. 'l03.040.' -> '103.040.') and split inline headings."""
    if not text:
        return ""

    # Count clear dotted prefixes like 103. or 208A.
    prefix_counts: Counter[str] = Counter()
    for m in re.finditer(r"(?:^|\n|\.\s+|\"\s+)(\d{2,4}[A-Za-z]?)\.\d{2,4}[A-Za-z]?\.", text):
        prefix_counts[m.group(1).upper()] += 1
    active_prefixes = {p for p, c in prefix_counts.items() if c >= 2}

    def _fix_token(tok: str) -> str:
        t = tok.replace("l", "1").replace("I", "1").replace("|", "1").replace("O", "0").replace("o", "0")
        return t

    # Replace confusable OCR heading tokens (e.g. 'l03.040. COUNTY.') and force paragraph break before heading
    confusable_re = re.compile(
        r"(?:(?<=^)|(?<=\n)|(?<=\.\s)|(?<=\"\s)|(?<=;\s))\s*([lI|0-9]{2,4})\.(\d{2,4}[A-Za-z]?)\.(\s+[A-Z][A-Z0-9\s,&/'()-]{2,40}[.:])"
    )

    def _repl(m: re.Match) -> str:
        raw_pref = m.group(1)
        sub = m.group(2)
        tail = m.group(3)
        fixed_pref = _fix_token(raw_pref)
        if not active_prefixes or fixed_pref.upper() in active_prefixes or any(ch in raw_pref for ch in "lI|Oo"):
            return f"\n\n{fixed_pref}.{sub}.{tail}"
        return m.group(0)

    repaired = confusable_re.sub(_repl, text)

    # Also break inline merged clean dotted headings (e.g. '...Village. 103.040. COUNTY.')
    if active_prefixes:
        inline_re = re.compile(
            r"(?<=[.\";])\s+(\d{2,4}[A-Za-z]?)\.(\d{2,4}[A-Za-z]?)\.(\s+[A-Z][A-Z0-9\s,&/'()-]{2,40}[.:])"
        )

        def _inline_repl(m: re.Match) -> str:
            if m.group(1).upper() in active_prefixes:
                return f"\n\n{m.group(1)}.{m.group(2)}.{m.group(3)}"
            return m.group(0)

        repaired = inline_re.sub(_inline_repl, repaired)

    return repaired


def clean_pdf_pages(pages_text: list[str]) -> str:
    """Clean extracted PDF pages: strip headers/footers, de-hyphenate, repair OCR numbers, and reflow."""
    if not pages_text:
        return ""
    stripped_pages = _strip_page_edges(pages_text)
    joined = "\n\n".join(p.strip() for p in stripped_pages if p.strip())
    if not joined:
        return ""

    # De-hyphenate soft line wraps across newlines
    joined = re.sub(r"([a-z]{2,})-\n([a-z]{2,})", r"\1\2", joined)
    joined = _repair_ocr_section_numbers(joined)

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

        cur_joined = " ".join(cur_parts).strip()
        if _is_boundary_line(line, prev_non_empty):
            flush()
            cur_parts.append(line)
        elif cur_joined and _is_standalone_heading_text(cur_joined):
            # Keep multi-line ALL-CAPS heading together, otherwise flush before mixed-case body
            if line.isupper() and not line.endswith(".") and not _is_boundary_line(line, prev_non_empty):
                cur_parts.append(line)
            else:
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
            _DOTTED_3PART_LINE_RE.match(b)
            or _DOTTED_SERIES_LINE_RE.match(b)
            or _HYPHEN_SEC_LINE_RE.match(b)
            or _PREFIXED_SEC_LINE_RE.match(b)
            or _SUBD_RE.match(b)
        ):
            cnt += 1
    return cnt


def _chapter_prefix_for_section(sec_num: str) -> str:
    clean = (sec_num or "").strip()
    if "-" in clean and clean.split("-", 1)[0].isdigit():
        return f"Ch. {clean.split('-', 1)[0]}"
    m3 = re.match(r"^(\d{1,3})\.\d{1,3}\.\d+", clean)
    if m3:
        return f"Ch. {m3.group(1)}"
    md = re.match(r"^(\d{1,3})\.\d{2,4}", clean)
    if md:
        return f"Ch. {md.group(1)}"
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

    m = re.match(r"^(?:Section|Sec)[_-]?(\d+(?:[-.]\d+)?[A-Za-z]?)[_-]+(.+)$", base, re.IGNORECASE)
    if m:
        sec_num = m.group(1).upper() if m.group(1)[-1:].isalpha() else m.group(1)
        title = _humanize_slug(m.group(2))
        return {
            "chapter_prefix": _chapter_prefix_for_section(sec_num),
            "chapter_title": "",
            "section_number": sec_num,
            "title": title,
        }

    m = re.match(r"^(?:Chapter|Ch)[_-]?([0-9IVXLCM]+[A-Za-z]?)[_-]*(.*)$", base, re.IGNORECASE)
    if m:
        ch_num = m.group(1)
        return {
            "chapter_prefix": f"Ch. {ch_num}",
            "chapter_title": _humanize_slug(m.group(2)),
            "section_number": "",
            "title": "",
        }

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
    return [p for p in paragraphs if not (_TOC_DOTS_RE.search(p) and len(p) < 220)]


def _split_heading_and_body(rest: str) -> tuple[str, str]:
    """Extract clean title and inline body remainder from a section header's rest text."""
    r = (rest or "").strip()
    if not r:
        return ("", "")

    hm = _CAPS_INLINE_HEAD_RE.match(r)
    if hm:
        return (_smart_title(hm.group(1)), (hm.group(2) or "").strip())

    hm = _PUNCT_HEAD_RE.match(r)
    if hm:
        return (_smart_title(hm.group(1)), (hm.group(2) or "").strip())

    hm = _CAPS_ONLY_HEAD_RE.match(r)
    if hm:
        return (_smart_title(hm.group(1)), "")

    if len(r) <= 95:
        return (_smart_title(r.rstrip(".:")), "")

    parts = re.split(r"(?<=[.:])\s+", r, maxsplit=1)
    if parts and len(parts[0]) <= 105:
        return (_smart_title(parts[0].rstrip(".:")), parts[1].strip() if len(parts) > 1 else "")

    return (_smart_title(r[:80].rstrip(".:")), r)


def _match_heading_for_scheme(block: str, scheme: str) -> tuple[str, str, str] | None:
    """Try matching a block as a child heading under a specific numbering scheme."""
    b = block.strip()
    if not b:
        return None

    if scheme == "dotted_3part":
        m = _DOTTED_3PART_LINE_RE.match(b)
        if not m:
            return None
        num, rest = m.group(1).strip(), (m.group(2) or "").strip()
        if not rest or rest[0].islower():
            return None
        title, inline = _split_heading_and_body(rest)
        if not title:
            return None
        return (num, title, inline)

    if scheme == "dotted_series":
        m = _DOTTED_SERIES_LINE_RE.match(b)
        if not m:
            return None
        num, rest = m.group(1).strip(), (m.group(2) or "").strip()
        if not rest:
            return None
        # Reject ordinary prose/decimal values unless heading punctuation/ALL-CAPS/title-case is present
        if rest[0].islower():
            return None
        if not (_CAPS_ONLY_HEAD_RE.match(rest) or _CAPS_INLINE_HEAD_RE.match(rest) or _PUNCT_HEAD_RE.match(rest)):
            if len(rest) > 90 or rest.endswith((".", ",")) and "." not in rest[:-1]:
                return None
        title, inline = _split_heading_and_body(rest)
        if not title:
            return None
        return (num, title, inline)

    if scheme == "prefixed_sec":
        m = _PREFIXED_SEC_LINE_RE.match(b)
        if not m:
            return None
        num, rest = m.group(1).strip(), (m.group(2) or "").strip()
        if not rest:
            return (num, f"Section {num}", "")
        if rest[0].islower():
            return None
        title, inline = _split_heading_and_body(rest)
        return (num, title or f"Section {num}", inline)

    if scheme == "hyphen_sec":
        m = _HYPHEN_SEC_LINE_RE.match(b)
        if not m:
            return None
        num, rest = m.group(1).strip(), (m.group(2) or "").strip()
        title, inline = _split_heading_and_body(rest)
        if not title:
            return None
        return (num, title, inline)

    if scheme == "subdivision":
        m = _SUBD_RE.match(b)
        if not m:
            return None
        sub_n, rest = m.group(1).strip(), (m.group(2) or "").strip()
        if not rest or rest[0].islower():
            return None
        if not (_PUNCT_HEAD_RE.match(rest) or _CAPS_ONLY_HEAD_RE.match(rest) or _CAPS_INLINE_HEAD_RE.match(rest)):
            return None
        title, inline = _split_heading_and_body(rest)
        return (f"Subd. {sub_n}", title or f"Subdivision {sub_n}", inline)

    return None


def _build_children_for_scheme(
    paragraphs: list[str],
    scheme: str,
    parent_number: str = "",
) -> tuple[str, list[dict]]:
    # Pre-scan candidate matches for dotted_series so prefix filtering avoids stray decimals
    candidates: list[tuple[int, str, str, str]] = []
    for idx, p in enumerate(paragraphs):
        hit = _match_heading_for_scheme(p, scheme)
        if hit:
            candidates.append((idx, hit[0], hit[1], hit[2]))

    if scheme in ("dotted_series", "prefixed_sec", "dotted_3part") and candidates:
        pref_counts = Counter(re.split(r"[.-]", num, 1)[0].upper() for _, num, _, _ in candidates)
        clean_parent = (parent_number or "").strip().upper()
        dom_pref = ""
        if clean_parent and pref_counts.get(clean_parent, 0) >= 2:
            dom_pref = clean_parent
        elif pref_counts and scheme == "dotted_series":
            top_pref, top_cnt = pref_counts.most_common(1)[0]
            if top_cnt >= 2 and top_cnt >= max(2, len(candidates) // 2):
                dom_pref = top_pref
        if dom_pref:
            candidates = [c for c in candidates if re.split(r"[.-]", c[1], 1)[0].upper() == dom_pref]

    hit_by_idx = {idx: (num, title, inline) for idx, num, title, inline in candidates}
    preamble_blocks: list[str] = []
    children: list[dict] = []
    seen_nums: Counter[str] = Counter()
    cur_child: dict | None = None
    cur_blocks: list[str] = []

    def flush_child() -> None:
        nonlocal cur_child, cur_blocks
        if not cur_child:
            cur_blocks = []
            return
        body_txt = "\n\n".join(cur_blocks).strip()
        meta = extract_ordinance_metadata(body_txt)
        cur_child["body"] = body_txt
        cur_child["ordinance_ref"] = meta["ordinance_ref"]
        cur_child["effective_date"] = meta["effective_date"]
        cur_child["subsection_count"] = count_subsections(body_txt)
        children.append(cur_child)
        cur_child = None
        cur_blocks = []

    for idx, p in enumerate(paragraphs):
        if idx in hit_by_idx:
            flush_child()
            num, title, inline = hit_by_idx[idx]
            seen_nums[num.lower()] += 1
            uniq_num = num if seen_nums[num.lower()] == 1 else f"{num}-{seen_nums[num.lower()]}"
            cur_child = {
                "section_number": uniq_num,
                "node_type": "section",
                "article": "",
                "title": title,
                "summary": "",
                "body": "",
                "ordinance_ref": "",
                "effective_date": "",
                "subsection_count": 0,
                "children": [],
            }
            if inline:
                cur_blocks.append(inline)
        elif cur_child is None:
            preamble_blocks.append(p)
        else:
            cur_blocks.append(p)

    flush_child()
    return ("\n\n".join(preamble_blocks).strip(), children)


def split_section_body_into_children(
    body: str,
    parent_number: str = "",
    line_meta: dict | None = None,
    toc: list | None = None,
) -> tuple[str, list[dict], str]:
    """Split a monolithic code section body into recursive child sections across common city formats."""
    raw = (body or "").strip()
    if not raw:
        return ("", [], "")
    paragraphs = [p.strip() for p in re.split(r"\n{2,}", raw) if p.strip()]
    if len(paragraphs) < 2:
        return (raw, [], "")

    clean_parent = (parent_number or "").strip().upper()
    scored_results: list[tuple[int, int, str, str, list[dict]]] = []
    schemes = ("dotted_3part", "dotted_series", "prefixed_sec", "hyphen_sec")
    for prio_idx, scheme in enumerate(schemes):
        preamble, children = _build_children_for_scheme(paragraphs, scheme, parent_number=parent_number)
        if len(children) >= 2:
            non_empty = sum(1 for c in children if c["body"] or c["title"])
            if non_empty >= 2:
                parent_hits = (
                    sum(1 for c in children if re.split(r"[.-]", c["section_number"], 1)[0].upper() == clean_parent)
                    if clean_parent
                    else 0
                )
                scored_results.append((1 if parent_hits >= 2 else 0, -prio_idx, scheme, preamble, children))
    if scored_results:
        scored_results.sort(key=lambda t: (t[0], t[1]), reverse=True)
        _, _, best_scheme, best_pre, best_children = scored_results[0]
        return (best_pre, best_children, best_scheme)

    # Typographic numbered sections (bold / larger-font '1. Heading' or '1 Heading') if no scheme matched
    if line_meta:
        typed_hits: dict[int, tuple[str, str, str]] = {}
        for idx, p in enumerate(paragraphs):
            m = re.match(r"^(\d{1,3})\.?\s+(.+)$", p)
            if not m:
                continue
            first_line = p.splitlines()[0]
            st = line_meta.get(re.sub(r"\s+", " ", first_line).strip().lower())
            if st and (st.get("bold") or st.get("larger")):
                num = m.group(1)
                sec_num = f"{parent_number}.{num}" if parent_number else num
                title, inline = _split_heading_and_body(m.group(2))
                if title:
                    typed_hits[idx] = (sec_num, title, inline)
        if len(typed_hits) >= 2:
            pre: list[str] = []
            ch_list: list[dict] = []
            cur_c: dict | None = None
            cur_b: list[str] = []
            for idx, p in enumerate(paragraphs):
                if idx in typed_hits:
                    if cur_c:
                        btxt = "\n\n".join(cur_b).strip()
                        meta = extract_ordinance_metadata(btxt)
                        cur_c.update({"body": btxt, **meta, "subsection_count": count_subsections(btxt)})
                        ch_list.append(cur_c)
                        cur_b = []
                    sn, stitle, inl = typed_hits[idx]
                    cur_c = {
                        "section_number": sn, "node_type": "section", "article": "",
                        "title": stitle, "summary": "", "body": "",
                        "ordinance_ref": "", "effective_date": "", "subsection_count": 0, "children": [],
                    }
                    if inl:
                        cur_b.append(inl)
                elif cur_c is None:
                    pre.append(p)
                else:
                    cur_b.append(p)
            if cur_c:
                btxt = "\n\n".join(cur_b).strip()
                meta = extract_ordinance_metadata(btxt)
                cur_c.update({"body": btxt, **meta, "subsection_count": count_subsections(btxt)})
                ch_list.append(cur_c)
            if len(ch_list) >= 2:
                return ("\n\n".join(pre).strip(), ch_list, "typographic_numbered")

    # Subdivision fallback (e.g. Subd. 1. Purpose., Subd. 2. Definitions.)
    preamble, children = _build_children_for_scheme(paragraphs, "subdivision", parent_number=parent_number)
    if len(children) >= 2:
        if parent_number:
            for c in children:
                sub_d = c["section_number"].replace("Subd. ", "").strip()
                c["section_number"] = f"{parent_number} Subd. {sub_d}"
        return (preamble, children, "subdivision")

    return (raw, [], "")


def _detect_multi_section_book(paragraphs: list[str], filename: str = "") -> list[dict] | None:
    """Split a full Municipal Code book into Chapters -> optional Article/Division -> Sections."""
    work = _strip_toc_blocks(paragraphs)
    chapter_hits = sum(1 for p in work if _CHAPTER_LINE_RE.match(p))
    article_hits = sum(1 for p in work if _ARTICLE_LINE_RE.match(p))
    prefixed_sec_hits = sum(1 for p in work if _PREFIXED_SEC_LINE_RE.match(p))
    dotted3_hits = sum(1 for p in work if _DOTTED_3PART_LINE_RE.match(p))
    fn_info = infer_section_info_from_filename(filename)

    if fn_info.get("section_number") and chapter_hits < 2:
        return None

    is_book = (
        chapter_hits >= 2
        or (chapter_hits == 1 and (prefixed_sec_hits >= 2 or dotted3_hits >= 2 or article_hits >= 1))
        or (prefixed_sec_hits >= 3 and sum(1 for p in work if re.match(r"^(?:Sec(?:tion)?\.?|§+)\s*\d+[-.]\d+", p, re.I)) >= 2)
    )
    if not is_book:
        return None

    chapters: list[dict] = []
    chap_by_prefix: dict[str, dict] = {}
    current_chapter: dict | None = None
    current_article_node: dict | None = None
    current_division_node: dict | None = None
    current_section: dict | None = None
    section_body_blocks: list[str] = []
    seen_sec_nums_by_chap: dict[str, Counter[str]] = {}

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
        seen_sec_nums_by_chap[norm_p] = Counter()
        current_chapter = ch
        return ch

    def unique_num(chap: dict, num: str) -> str:
        c = seen_sec_nums_by_chap.setdefault(chap["code_prefix"], Counter())
        c[num.lower()] += 1
        return num if c[num.lower()] == 1 else f"{num}-{c[num.lower()]}"

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
        target_parent = current_division_node or current_article_node
        if target_parent is not None:
            target_parent["children"].append(current_section)
        else:
            current_chapter["sections"].append(current_section)
        current_section = None
        section_body_blocks = []

    def prune_empty_containers(nodes: list[dict]) -> list[dict]:
        kept: list[dict] = []
        for n in nodes:
            if n.get("children"):
                n["children"] = prune_empty_containers(n["children"])
            if n.get("node_type") in ("article", "division") and not n.get("children"):
                continue
            kept.append(n)
        return kept

    for p in work:
        cm = _CHAPTER_LINE_RE.match(p)
        if cm:
            flush_section()
            current_article_node = None
            current_division_node = None
            ch_id = cm.group(1).strip()
            ch_title = _smart_title(cm.group(2) or "") or f"Chapter {ch_id}"
            ensure_chapter(f"Ch. {ch_id}", ch_title)
            continue

        am = _ARTICLE_LINE_RE.match(p)
        if am:
            flush_section()
            if current_chapter is None:
                ensure_chapter("General", "General Provisions")
            kind_kw = am.group(1).upper()
            art_id = am.group(2).strip()
            art_name = _smart_title(am.group(3) or "")
            if kind_kw in ("ARTICLE", "PART"):
                current_division_node = None
                short_kw = "Art." if kind_kw == "ARTICLE" else "Part"
                num = unique_num(current_chapter, f"{short_kw} {art_id}")
                label = f"{kind_kw.title()} {art_id} — {art_name}" if art_name else f"{kind_kw.title()} {art_id}"
                current_article_node = {
                    "section_number": num,
                    "node_type": "article",
                    "article": label,
                    "title": art_name or f"{kind_kw.title()} {art_id}",
                    "summary": "",
                    "body": "",
                    "ordinance_ref": "",
                    "effective_date": "",
                    "subsection_count": 0,
                    "children": [],
                }
                current_chapter["sections"].append(current_article_node)
            else:  # DIVISION
                parent_prefix = f"{current_article_node['section_number']} / " if current_article_node else ""
                num = unique_num(current_chapter, f"{parent_prefix}Div. {art_id}")
                label = f"Division {art_id} — {art_name}" if art_name else f"Division {art_id}"
                current_division_node = {
                    "section_number": num,
                    "node_type": "division",
                    "article": current_article_node["article"] if current_article_node else label,
                    "title": art_name or f"Division {art_id}",
                    "summary": "",
                    "body": "",
                    "ordinance_ref": "",
                    "effective_date": "",
                    "subsection_count": 0,
                    "children": [],
                }
                if current_article_node is not None:
                    current_article_node["children"].append(current_division_node)
                else:
                    current_chapter["sections"].append(current_division_node)
            continue

        sm = _PREFIXED_SEC_LINE_RE.match(p) or (dotted3_hits >= 2 and _DOTTED_3PART_LINE_RE.match(p))
        if sm:
            sec_num = sm.group(1).strip()
            sec_rest = (sm.group(2) or "").strip() if len(sm.groups()) >= 2 else ""
            if sec_rest and sec_rest[0].islower():
                if current_section is not None:
                    section_body_blocks.append(p)
                continue
            flush_section()
            sec_title, inline_body = _split_heading_and_body(sec_rest)
            sec_title = sec_title or f"Section {sec_num}"
            if current_chapter is None:
                inferred_pref = _chapter_prefix_for_section(sec_num)
                ensure_chapter(inferred_pref, f"Chapter {inferred_pref.replace('Ch. ', '')}")
            art_label = (
                current_division_node["article"]
                if current_division_node
                else (current_article_node["article"] if current_article_node else "")
            )
            current_section = {
                "section_number": unique_num(current_chapter, sec_num),
                "node_type": "section",
                "article": art_label,
                "title": sec_title,
                "summary": "",
                "body": "",
                "ordinance_ref": "",
                "effective_date": "",
                "subsection_count": 0,
                "children": [],
            }
            if inline_body:
                section_body_blocks.append(inline_body)
            continue

        if current_section is not None:
            section_body_blocks.append(p)

    flush_section()
    for ch in chapters:
        ch["sections"] = prune_empty_containers(ch["sections"])
    chapters = [ch for ch in chapters if ch["sections"]]
    return chapters or None


def parse_code_pdf(
    raw_bytes: bytes,
    filename: str = "",
    split_children: bool = True,
    enable_ocr: bool = True,
) -> dict:
    """Parse a PDF (single section OR multi-chapter Code book) into a recursive chapters & sections tree."""
    doc_info = extract_pdf_document(raw_bytes, enable_ocr=enable_ocr)
    pages_text = doc_info["pages_text"]
    warnings: list[str] = list(doc_info["warnings"])

    if not any(p.strip() for p in pages_text):
        warnings.append(f"{filename or 'PDF'}: no selectable text extracted (scanned image PDF — enable OCR or view original PDF).")
        info = infer_section_info_from_filename(filename)
        return {
            "kind": "section",
            "pages": doc_info["page_count"],
            "used_ocr": doc_info["used_ocr"],
            "ocr_pages": doc_info["ocr_pages"],
            "ocr_reason": doc_info["ocr_reason"],
            "detected_scheme": "",
            "chapters": [
                {
                    "code_prefix": info["chapter_prefix"],
                    "title": info["chapter_title"] or f"Chapter {info['chapter_prefix']}",
                    "sections": [
                        {
                            "section_number": info["section_number"] or "100",
                            "node_type": "section",
                            "article": "",
                            "title": info["title"] or "Untitled Section",
                            "summary": "",
                            "body": "",
                            "ordinance_ref": "",
                            "effective_date": "",
                            "subsection_count": 0,
                            "children": [],
                        }
                    ],
                }
            ],
            "warnings": warnings,
        }

    cleaned = clean_pdf_pages(pages_text)
    paragraphs = [p for p in cleaned.split("\n\n") if p.strip()]

    book_chapters = _detect_multi_section_book(paragraphs, filename=filename)
    if book_chapters:
        return {
            "kind": "book",
            "pages": doc_info["page_count"],
            "used_ocr": doc_info["used_ocr"],
            "ocr_pages": doc_info["ocr_pages"],
            "ocr_reason": doc_info["ocr_reason"],
            "detected_scheme": "book",
            "chapters": book_chapters,
            "warnings": warnings,
        }

    # Single-section / single-series PDF
    info = infer_section_info_from_filename(filename)
    sec_num = info["section_number"]
    sec_title = info["title"]
    article = ""

    if paragraphs:
        cm = _CHAPTER_LINE_RE.match(paragraphs[0])
        if cm:
            if not sec_num:
                sec_num = cm.group(1).strip()
            if not sec_title:
                sec_title = _smart_title(cm.group(2) or "")
            paragraphs = paragraphs[1:]
        else:
            top = _TOP_SEC_TITLE_RE.match(paragraphs[0])
            if top:
                if not sec_num:
                    sec_num = top.group(1).strip()
                if not sec_title:
                    sec_title = _smart_title(top.group(2))
                paragraphs = paragraphs[1:]
            else:
                ms = _PREFIXED_SEC_LINE_RE.match(paragraphs[0])
                if ms and not sec_num:
                    sec_num = ms.group(1).strip()
                    if not sec_title:
                        sec_title = _smart_title(ms.group(2).rstrip("."))
                    paragraphs = paragraphs[1:]

    if paragraphs and _ARTICLE_LINE_RE.match(paragraphs[0]):
        am = _ARTICLE_LINE_RE.match(paragraphs[0])
        art_name = _smart_title(am.group(3) or "")
        article = f"{am.group(1).title()} {am.group(2).strip()} — {art_name}" if art_name else f"{am.group(1).title()} {am.group(2).strip()}"

    body = "\n\n".join(paragraphs).strip()
    sec_num = sec_num or "100"
    sec_title = sec_title or f"Section {sec_num}"
    ch_prefix = info["chapter_prefix"] if info["chapter_prefix"] != "General" else _chapter_prefix_for_section(sec_num)

    children: list[dict] = []
    detected_scheme = ""
    node_type = "section"
    parent_body = body

    if split_children and body:
        preamble, split_kids, scheme = split_section_body_into_children(
            body,
            parent_number=sec_num,
            line_meta=doc_info.get("line_styles"),
            toc=doc_info.get("toc"),
        )
        if len(split_kids) >= 2:
            parent_body = preamble
            children = split_kids
            detected_scheme = scheme
            node_type = "series"

    meta = extract_ordinance_metadata(body, filename)
    if children:
        child_ords = [c["ordinance_ref"] for c in children if c.get("ordinance_ref")]
        child_effs = [c["effective_date"] for c in children if c.get("effective_date")]
        if not meta["ordinance_ref"] and child_ords:
            meta["ordinance_ref"] = child_ords[-1]
        if not meta["effective_date"] and child_effs:
            meta["effective_date"] = child_effs[-1]

    return {
        "kind": "section",
        "pages": doc_info["page_count"],
        "used_ocr": doc_info["used_ocr"],
        "ocr_pages": doc_info["ocr_pages"],
        "ocr_reason": doc_info["ocr_reason"],
        "detected_scheme": detected_scheme,
        "chapters": [
            {
                "code_prefix": ch_prefix,
                "title": info["chapter_title"] or f"Chapter {ch_prefix}",
                "sections": [
                    {
                        "section_number": sec_num,
                        "node_type": node_type,
                        "article": article,
                        "title": sec_title,
                        "summary": "",
                        "body": parent_body,
                        "ordinance_ref": meta["ordinance_ref"],
                        "effective_date": meta["effective_date"],
                        "subsection_count": len(children) if children else count_subsections(parent_body),
                        "children": children,
                    }
                ],
            }
        ],
        "warnings": warnings,
    }
