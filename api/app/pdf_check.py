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

"""PDF accessibility / WCAG 2.1 AA & PDF/UA compliance checker."""
import io
from typing import Any

from fastapi import APIRouter, Depends, File, HTTPException, Request, UploadFile
from pypdf import PdfReader

from .auth import current_user

router = APIRouter(prefix="/api/pdf", tags=["pdf"])

_MAX_CHECK_BYTES = 50 * 1024 * 1024


def _require_authenticated(request: Request) -> dict:
    user = current_user(request)
    if not user:
        raise HTTPException(status_code=401, detail="Not authenticated")
    return user


def _resolve(obj: Any) -> Any:
    try:
        return obj.get_object()
    except Exception:
        return obj


def check_pdf_compliance(pdf_bytes: bytes, filename: str = "", context_note: str = "") -> dict[str, Any]:
    """Inspect PDF bytes for WCAG 2.1 AA / PDF/UA accessibility signals."""
    if not pdf_bytes or not pdf_bytes.lstrip()[:8].startswith(b"%PDF-"):
        raise HTTPException(status_code=400, detail="File is not a valid PDF document")

    try:
        reader = PdfReader(io.BytesIO(pdf_bytes))
    except Exception as exc:
        raise HTTPException(status_code=400, detail=f"Unable to parse PDF: {exc}") from exc

    if reader.is_encrypted:
        return {
            "filename": filename or "document.pdf",
            "page_count": 0,
            "compliant": False,
            "summary": "Non-Compliant",
            "score": 0,
            "checks": [
                {
                    "id": "encryption",
                    "label": "Unencrypted / Assistive-Technology Access",
                    "status": "fail",
                    "detail": "PDF is encrypted/password-protected and cannot be inspected or read reliably by screen readers.",
                }
            ],
        }

    root = _resolve(reader.trailer.get("/Root")) or {}
    meta = reader.metadata or {}
    page_count = len(reader.pages)
    checks: list[dict[str, str]] = []

    # 1. Document Title + DisplayDocTitle (WCAG 2.4.2)
    title = str(meta.get("/Title") or "").strip()
    vp = _resolve(root.get("/ViewerPreferences"))
    display_title = bool(isinstance(vp, dict) and vp.get("/DisplayDocTitle"))
    if title and display_title:
        checks.append({
            "id": "title",
            "label": "Document Title & Window Title (WCAG 2.4.2)",
            "status": "pass",
            "detail": f'Title is set ("{title[:80]}") with DisplayDocTitle enabled.',
        })
    elif title:
        checks.append({
            "id": "title",
            "label": "Document Title & Window Title (WCAG 2.4.2)",
            "status": "warn",
            "detail": f'Title is set ("{title[:80]}"), but DisplayDocTitle preference is off.',
        })
    else:
        checks.append({
            "id": "title",
            "label": "Document Title & Window Title (WCAG 2.4.2)",
            "status": "fail",
            "detail": "Missing PDF /Title metadata. Set a descriptive Document Title before exporting.",
        })

    # 2. Document Language (WCAG 3.1.1)
    lang = str(root.get("/Lang") or "").strip()
    if lang:
        checks.append({
            "id": "language",
            "label": "Document Language (WCAG 3.1.1)",
            "status": "pass",
            "detail": f'Document language tag is set ("{lang}").',
        })
    else:
        checks.append({
            "id": "language",
            "label": "Document Language (WCAG 3.1.1)",
            "status": "fail",
            "detail": "Missing /Lang tag on PDF catalog. Screen readers need a primary language (e.g. en-US).",
        })

    # 3. Tagged PDF & Reading Structure (WCAG 1.3.1 / PDF/UA)
    mark_info = _resolve(root.get("/MarkInfo"))
    is_marked = bool(isinstance(mark_info, dict) and mark_info.get("/Marked"))
    has_struct = "/StructTreeRoot" in root
    if is_marked and has_struct:
        checks.append({
            "id": "tagged",
            "label": "Tagged PDF & Reading Order Structure (WCAG 1.3.1)",
            "status": "pass",
            "detail": "PDF is marked as Tagged and includes a StructTreeRoot tag hierarchy.",
        })
    elif is_marked or has_struct:
        checks.append({
            "id": "tagged",
            "label": "Tagged PDF & Reading Order Structure (WCAG 1.3.1)",
            "status": "warn",
            "detail": "Partial tag metadata found; export with full Tagged PDF / accessibility tags enabled.",
        })
    else:
        detail = (
            "PDF is untagged (no MarkInfo/StructTreeRoot). Without tags, screen readers cannot reliably "
            "navigate headings, lists, or tables. Re-export from Word/InDesign/Acrobat with 'Tagged PDF' enabled."
        )
        if context_note:
            detail = f"{detail} {context_note}"
        checks.append({
            "id": "tagged",
            "label": "Tagged PDF & Reading Order Structure (WCAG 1.3.1)",
            "status": "fail",
            "detail": detail,
        })

    # 4. Selectable Text / OCR Check (WCAG 1.1.1 / 1.4.5)
    sample_pages = min(page_count, 10)
    empty_pages = 0
    for idx in range(sample_pages):
        try:
            txt = (reader.pages[idx].extract_text() or "").strip()
        except Exception:
            txt = ""
        if len(txt) < 20:
            empty_pages += 1

    if sample_pages == 0:
        checks.append({
            "id": "text",
            "label": "Selectable Text / OCR (WCAG 1.4.5)",
            "status": "fail",
            "detail": "PDF contains 0 pages.",
        })
    elif empty_pages == 0:
        checks.append({
            "id": "text",
            "label": "Selectable Text / OCR (WCAG 1.4.5)",
            "status": "pass",
            "detail": f"All {sample_pages} sampled page(s) contain selectable text (not image-only scans).",
        })
    elif empty_pages < sample_pages:
        checks.append({
            "id": "text",
            "label": "Selectable Text / OCR (WCAG 1.4.5)",
            "status": "warn",
            "detail": f"{empty_pages} of {sample_pages} sampled page(s) have little or no extractable text (may contain scanned images needing OCR or alt text).",
        })
    else:
        checks.append({
            "id": "text",
            "label": "Selectable Text / OCR (WCAG 1.4.5)",
            "status": "fail",
            "detail": "No selectable text found on sampled pages — appears to be a scanned image PDF requiring OCR.",
        })

    # 5. Navigation Bookmarks for Multi-Page PDFs (WCAG 2.4.5)
    has_outlines = "/Outlines" in root
    if page_count <= 1 or has_outlines:
        checks.append({
            "id": "bookmarks",
            "label": "Navigation Bookmarks (WCAG 2.4.5)",
            "status": "pass",
            "detail": "Single-page document." if page_count <= 1 else "Document includes PDF outlines/bookmarks for navigation.",
        })
    else:
        checks.append({
            "id": "bookmarks",
            "label": "Navigation Bookmarks (WCAG 2.4.5)",
            "status": "warn",
            "detail": f"Multi-page PDF ({page_count} pages) has no /Outlines bookmarks; adding heading bookmarks helps keyboard/screen-reader navigation.",
        })

    # 6. Form Field Labels if AcroForm present (WCAG 4.1.2)
    acro = _resolve(root.get("/AcroForm"))
    if isinstance(acro, dict) and acro.get("/Fields"):
        fields = _resolve(acro.get("/Fields")) or []
        missing_tu = 0
        for fref in fields[:50]:
            fobj = _resolve(fref)
            if isinstance(fobj, dict) and not str(fobj.get("/TU") or "").strip():
                missing_tu += 1
        if missing_tu == 0:
            checks.append({
                "id": "forms",
                "label": "Interactive Form Field Tooltips (WCAG 4.1.2)",
                "status": "pass",
                "detail": "All inspected PDF form fields include accessible /TU tooltips.",
            })
        else:
            checks.append({
                "id": "forms",
                "label": "Interactive Form Field Tooltips (WCAG 4.1.2)",
                "status": "fail",
                "detail": f"{missing_tu} PDF form field(s) are missing accessible /TU tooltip labels.",
            })

    total = len(checks)
    points = sum(1.0 if c["status"] == "pass" else (0.5 if c["status"] == "warn" else 0.0) for c in checks)
    score = int(round((points / total) * 100)) if total else 0
    fail_count = sum(1 for c in checks if c["status"] == "fail")
    warn_count = sum(1 for c in checks if c["status"] == "warn")
    summary = "Compliant" if fail_count == 0 and warn_count == 0 else ("Needs Attention" if fail_count == 0 else "Non-Compliant")

    return {
        "filename": filename or "document.pdf",
        "page_count": page_count,
        "compliant": fail_count == 0,
        "summary": summary,
        "score": score,
        "checks": checks,
    }


@router.post("/check")
async def check_uploaded_pdf(
    file: UploadFile = File(...),
    _: dict = Depends(_require_authenticated),
):
    data = await file.read(_MAX_CHECK_BYTES + 1)
    if len(data) > _MAX_CHECK_BYTES:
        raise HTTPException(status_code=413, detail="PDF exceeds 50 MB limit")
    return check_pdf_compliance(data, file.filename or "uploaded.pdf")
