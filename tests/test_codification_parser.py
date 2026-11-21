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

"""Unit tests for Municipal Codification multi-city PDF parser, OCR fallback, & tree splitter."""
import io
import os
import shutil
import sys
import unittest

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.join(ROOT, "api"))

from app.codification_parser import (
    clean_pdf_pages,
    count_subsections,
    extract_ordinance_metadata,
    infer_section_info_from_filename,
    page_needs_ocr,
    parse_code_pdf,
    split_section_body_into_children,
)


class CodificationParserTest(unittest.TestCase):
    def test_clean_birchwood_section_pages_and_split_series(self):
        page1 = (
            "Code 101 - page 1\n"
            "101.  ADOPTION OF CODE\n"
            "The Council of the City of Birchwood Village does ordain:\n"
            "101.010.  ADOPTION OF CODE.  The substantive general ordinances of The City of\n"
            "Birchwood Village, Minnesota, are hereby codified in book form entitled\n"
            '"Municipal Code of The City of Birchwood Village, Minnesota".\n'
            "101.090 SEPARABILITY.  If any chapter, section, sentence, clause or other part\n"
            "of this Code should be adjudged void, such decision shall not affect the validity.\n"
        )
        page2 = (
            "Code 101 - page 2\n"
            '"AMENDED BY ORDINANCE 2004-2; JANUARY 13, 2004".\n'
            "101.095 CONFLICT BETWEEN CODE PROVISIONS. Higher standards prevail.\n"
            "101.100.  PENALTY.  Every person convicted of a violation shall be\n"
            "guilty of a misdemeanor.\n"
        )
        cleaned = clean_pdf_pages([page1, page2])
        self.assertNotIn("Code 101 - page 1", cleaned)
        self.assertNotIn("Code 101 - page 2", cleaned)
        self.assertEqual(count_subsections(cleaned), 4)

        preamble, children, scheme = split_section_body_into_children(cleaned, parent_number="101")
        self.assertEqual(scheme, "dotted_series")
        self.assertIn("does ordain", preamble)
        self.assertEqual([c["section_number"] for c in children], ["101.010", "101.090", "101.095", "101.100"])
        self.assertEqual(children[0]["title"], "Adoption of Code")
        self.assertEqual(children[1]["ordinance_ref"], "Ord. 2004-2")
        self.assertEqual(children[1]["effective_date"], "2004-01-13")

    def test_sequence_aware_ocr_repair_and_inline_split(self):
        raw = (
            "103.010. CERTAIN TERMS DEFINED. As used herein.\n\n"
            "103.020. CITY. The City of Birchwood Village.\n\n"
            "103.030. CITY COUNCIL. The Council of the City of Birchwood Village. "
            "l03.040. COUNTY. The County of Washington, Minnesota.\n\n"
            "103.050. CODE. The Municipal Code."
        )
        cleaned = clean_pdf_pages([raw])
        preamble, children, scheme = split_section_body_into_children(cleaned, parent_number="103")
        self.assertEqual(scheme, "dotted_series")
        self.assertEqual(preamble, "")
        self.assertEqual([c["section_number"] for c in children], ["103.010", "103.020", "103.030", "103.040", "103.050"])
        self.assertEqual(children[3]["title"], "County")

    def test_multi_city_numbering_schemes(self):
        # Standalone ALL-CAPS heading & alphanumeric prefix (208A / 902 style)
        standalone_txt = (
            "902.010 GRANT OF FRANCHISE\n"
            "The City hereby authorizes Grantee to occupy Streets.\n\n"
            "902.020 TERM OF FRANCHISE\n"
            "The franchise term shall be ten years."
        )
        _, kids, scheme = split_section_body_into_children(clean_pdf_pages([standalone_txt]), parent_number="902")
        self.assertEqual(scheme, "dotted_series")
        self.assertEqual([k["section_number"] for k in kids], ["902.010", "902.020"])
        self.assertEqual(kids[0]["title"], "Grant of Franchise")

        # 3-part dotted (WA/OR/CA Sterling / Code Publishing style)
        three_part = (
            "1.04.010 Purpose. This chapter establishes administrative citations.\n\n"
            "1.04.020 Definitions. For purposes of this chapter, words mean as follows."
        )
        _, kids3, scheme3 = split_section_body_into_children(three_part, parent_number="1.04")
        self.assertEqual(scheme3, "dotted_3part")
        self.assertEqual([k["section_number"] for k in kids3], ["1.04.010", "1.04.020"])

        # American Legal section symbol style
        amlegal = (
            "§ 30.01 ESTABLISHMENT. There is hereby established a Planning Commission.\n\n"
            "§ 30.02 MEMBERSHIP. The Commission shall consist of five members."
        )
        _, kids_am, scheme_am = split_section_body_into_children(amlegal, parent_number="30")
        self.assertEqual(scheme_am, "muni_sec")
        self.assertEqual([k["section_number"] for k in kids_am], ["30.01", "30.02"])

    def test_page_needs_ocr_classifier(self):
        self.assertEqual(page_needs_ocr(""), (True, "empty_text"))
        self.assertEqual(page_needs_ocr("Page 2"), (True, "empty_text"))
        garbled = "/1/2/3/4/i255/i255/6 /7 /8/9/6 /10 /11/i255 /13/14/15/16/14/17/14/16/i255/18 /19 /20"
        self.assertEqual(page_needs_ocr(garbled), (True, "garbled_fonts"))
        valid_table = (
            "302.010. LOT REQUIREMENTS. Minimum setback schedule:\n"
            "Front yard setback: 30 feet. Side yard setback: 10 feet. Rear yard: 25 feet.\n"
            "Maximum building height is 35 feet across R-1 residential districts."
        )
        self.assertEqual(page_needs_ocr(valid_table), (False, ""))

        code_hdr_page = (
            "Code 101 - page 1\n"
            "101. ADOPTION OF CODE\n"
            "The substantive general ordinances of the City of Birchwood Village are codified."
        )
        self.assertEqual(page_needs_ocr(code_hdr_page), (False, ""))

    def test_preserve_standalone_top_heading_and_ignore_wrapped_cross_ref(self):
        pages = [
            "902. CABLE FRANCHISE: FRANCHISE\n902.010\nGRANT OF FRANCHISE\nThe City authorizes Grantee.",
            "902.020\nRESERVATION OF AUTHORITY\nRights are reserved as set forth in\nSection 3.2 below for streets.",
            "902.030\nTERM\nThe franchise term is ten years.",
        ]
        cleaned = clean_pdf_pages(pages)
        _, kids, scheme = split_section_body_into_children(cleaned, parent_number="902")
        self.assertEqual(scheme, "dotted_series")
        self.assertEqual([k["section_number"] for k in kids], ["902.010", "902.020", "902.030"])
        self.assertNotIn("3.2", [k["section_number"] for k in kids])
        self.assertIn("Section 3.2 below for streets", kids[1]["body"])

    def test_extract_ordinance_metadata_and_filename(self):
        sample = 'Adopted earlier. "AMENDED BY ORDINANCE 2004-2; JANUARY 13, 2004".'
        meta = extract_ordinance_metadata(sample)
        self.assertEqual(meta["ordinance_ref"], "Ord. 2004-2")
        self.assertEqual(meta["effective_date"], "2004-01-13")

        fn_meta = extract_ordinance_metadata("", "Section-302-Zoning-v2024.12.10.pdf")
        self.assertEqual(fn_meta["effective_date"], "2024-12-10")

        a = infer_section_info_from_filename("Section-208A-Right-of-Way-Management.pdf")
        self.assertEqual(a["section_number"], "208A")
        self.assertEqual(a["chapter_prefix"], "2XX")

    def test_multi_chapter_municode_book_hierarchy(self):
        try:
            from pypdf import PdfReader  # noqa: F401
            from reportlab.pdfgen import canvas
        except ImportError:
            self.skipTest("pypdf/reportlab not installed on host")

        buf = io.BytesIO()
        c = canvas.Canvas(buf)
        lines = [
            "CODE OF ORDINANCES - CHATFIELD, MINNESOTA",
            "TABLE OF CONTENTS",
            "Chapter 1 General Provisions ........ 1",
            "Chapter 2 Administration ............ 2",
            "CHAPTER 1 - GENERAL PROVISIONS",
            "ARTICLE I. - IN GENERAL",
            "DIVISION 1. - RULES",
            "Sec. 1-1. How Code designated and cited.",
            "The ordinances embraced in this volume shall constitute the Code of Ordinances.",
            "Sec. 1-2. Rules of construction.",
            "(a) Words used in the present tense include the future.",
            "(Ord. No. 2023-05, 5-14-2023)",
            "CHAPTER 2 - ADMINISTRATION",
            "Sec. 2-1. Regular meetings.",
            "The city council shall meet twice monthly.",
        ]
        y = 760
        for ln in lines:
            c.drawString(50, y, ln)
            y -= 20
        c.showPage()
        c.save()

        parsed = parse_code_pdf(buf.getvalue(), "Chatfield_Code.pdf")
        self.assertEqual(parsed["kind"], "book")
        self.assertEqual(len(parsed["chapters"]), 2)
        ch1 = parsed["chapters"][0]
        self.assertEqual(ch1["code_prefix"], "Ch. 1")
        art = ch1["sections"][0]
        self.assertEqual(art["node_type"], "article")
        self.assertEqual(art["section_number"], "Art. I")
        div = art["children"][0]
        self.assertEqual(div["node_type"], "division")
        secs = div["children"]
        self.assertEqual([s["section_number"] for s in secs], ["1-1", "1-2"])
        self.assertEqual(secs[1]["ordinance_ref"], "Ord. 2023-05")
        self.assertEqual(secs[1]["effective_date"], "2023-05-14")

    def test_ocr_fallback_on_image_only_pdf_in_container(self):
        try:
            import pymupdf  # noqa: F401
            from PIL import Image, ImageDraw, ImageFont
        except ImportError:
            self.skipTest("PyMuPDF/PIL not installed")
        if not shutil.which("tesseract"):
            self.skipTest("tesseract binary not installed")

        img = Image.new("RGB", (1400, 900), "white")
        draw = ImageDraw.Draw(img)
        font = None
        for fp in (
            "/usr/share/fonts/truetype/liberation/LiberationSans-Regular.ttf",
            "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf",
        ):
            if os.path.exists(fp):
                font = ImageFont.truetype(fp, 28)
                break
        if font is None:
            font = ImageFont.load_default()
        y = 60
        for ln in [
            "801. FUND BALANCES",
            "801.010. PURPOSE. The purpose of this section is to establish fund targets.",
            "801.020. RESERVE LEVEL. The general fund reserve shall be maintained.",
        ]:
            draw.text((60, y), ln, fill="black", font=font)
            y += 70
        pdf_buf = io.BytesIO()
        img.save(pdf_buf, format="PDF", resolution=150.0)

        parsed = parse_code_pdf(pdf_buf.getvalue(), "BirchwoodCityCode801.pdf", split_children=True, enable_ocr=True)
        self.assertTrue(parsed["used_ocr"])
        self.assertEqual(parsed["ocr_pages"], [1])
        sec = parsed["chapters"][0]["sections"][0]
        self.assertEqual(sec["section_number"], "801")
        child_nums = [c["section_number"] for c in sec["children"]]
        self.assertIn("801.010", child_nums)
        self.assertIn("801.020", child_nums)


if __name__ == "__main__":
    unittest.main()
