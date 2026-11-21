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

"""Unit tests for Municipal Codification smart PDF parser and legal text formatter."""
import io
import os
import sys
import unittest

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.join(ROOT, "api"))

from app.codification_parser import (
    clean_pdf_pages,
    count_subsections,
    extract_ordinance_metadata,
    infer_section_info_from_filename,
    parse_code_pdf,
)


class CodificationParserTest(unittest.TestCase):
    def test_clean_birchwood_section_pages(self):
        page1 = (
            "Code 101 - page 1\n"
            "101.  ADOPTION OF CODE\n"
            "The Council of the City of Birchwood Village does ordain:\n"
            "101.010.  ADOPTION OF CODE.  The substantive general ordinances of The City of\n"
            "Birchwood Village, Minnesota, are hereby codified in book form entitled\n"
            "\"Municipal Code of The City of Birchwood Village, Minnesota\".\n"
            "101.090 SEPARABILITY.  If any chapter, section, sentence, clause or other part\n"
            "of this Code should be adjudged void, such decision shall not affect the validity.\n"
        )
        page2 = (
            "Code 101 - page 2\n"
            "\"AMENDED BY ORDINANCE 2004-2; JANUARY 13, 2004\".\n"
            "101.100.  PENALTY.  Every person convicted of a violation shall be\n"
            "guilty of a misdemeanor.\n"
        )
        cleaned = clean_pdf_pages([page1, page2])
        self.assertNotIn("Code 101 - page 1", cleaned)
        self.assertNotIn("Code 101 - page 2", cleaned)
        blocks = cleaned.split("\n\n")
        self.assertTrue(any(b.startswith("101.010. ADOPTION OF CODE.") for b in blocks))
        self.assertTrue(any(b.startswith("101.090 SEPARABILITY.") for b in blocks))
        self.assertTrue(any("AMENDED BY ORDINANCE 2004-2" in b for b in blocks))
        self.assertTrue(any(b.startswith("101.100. PENALTY.") for b in blocks))
        self.assertEqual(count_subsections(cleaned), 3)

    def test_extract_ordinance_metadata(self):
        sample = 'Adopted earlier. "AMENDED BY ORDINANCE 2004-2; JANUARY 13, 2004".'
        meta = extract_ordinance_metadata(sample)
        self.assertEqual(meta["ordinance_ref"], "Ord. 2004-2")
        self.assertEqual(meta["effective_date"], "2004-01-13")

        fn_meta = extract_ordinance_metadata("", "Section-302-Zoning-v2024.12.10.pdf")
        self.assertEqual(fn_meta["effective_date"], "2024-12-10")

    def test_infer_section_info_from_filename(self):
        a = infer_section_info_from_filename("Section-101-Series-Adoption-of-Code.pdf")
        self.assertEqual(a["section_number"], "101")
        self.assertEqual(a["chapter_prefix"], "1XX")
        self.assertEqual(a["title"], "Adoption of Code")

        b = infer_section_info_from_filename("Section-208A-Right-of-Way-Management.pdf")
        self.assertEqual(b["section_number"], "208A")
        self.assertEqual(b["chapter_prefix"], "2XX")

        c = infer_section_info_from_filename("BirchwoodCityCode801.pdf")
        self.assertEqual(c["section_number"], "801")
        self.assertEqual(c["chapter_prefix"], "8XX")

        d = infer_section_info_from_filename("Sec_30-15_Parking_Rules.pdf")
        self.assertEqual(d["section_number"], "30-15")
        self.assertEqual(d["chapter_prefix"], "Ch. 30")

    def test_multi_chapter_municode_book_parsing_if_pypdf_installed(self):
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
        self.assertEqual(parsed["chapters"][0]["code_prefix"], "Ch. 1")
        self.assertEqual(len(parsed["chapters"][0]["sections"]), 2)
        self.assertEqual(parsed["chapters"][0]["sections"][0]["section_number"], "1-1")
        self.assertEqual(parsed["chapters"][0]["sections"][1]["ordinance_ref"], "Ord. 2023-05")
        self.assertEqual(parsed["chapters"][0]["sections"][1]["effective_date"], "2023-05-14")
        self.assertTrue(parsed["chapters"][0]["sections"][0]["article"].startswith("Article I"))
        self.assertEqual(parsed["chapters"][1]["sections"][0]["section_number"], "2-1")


if __name__ == "__main__":
    unittest.main()
