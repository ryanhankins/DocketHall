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

"""Unit tests for Municipal Codification bulk URL discovery, ZIP unpacking, and SSRF guards."""
import io
import os
import sys
import unittest
import zipfile

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.join(ROOT, "api"))


class CodificationBulkImportTest(unittest.TestCase):
    def setUp(self):
        try:
            from app import codification  # noqa: F401
        except ImportError:
            self.skipTest("API dependencies (fastapi/psycopg) not installed")

    def test_extract_pdf_links_from_html(self):
        from app.codification import extract_pdf_links_from_html

        html = """
        <html>
          <head><title>City of Example — City Code</title></head>
          <body>
            <a href="/uploads/Section-101-Series-Adoption-of-Code.pdf">Adoption of Code</a>
            <a href="uploads/Section-102-Rules-of-Construction.pdf?v=2">Rules of Construction</a>
            <a href="/uploads/Section-101-Series-Adoption-of-Code.pdf#page=2">Duplicate Link</a>
            <a href="/about-us">About Us</a>
            <a href="mailto:clerk@example.gov">Email Clerk</a>
          </body>
        </html>
        """
        title, items = extract_pdf_links_from_html(html, "https://cityofexample.gov/code/")
        self.assertEqual(title, "City of Example — City Code")
        self.assertEqual(len(items), 2)
        self.assertEqual(items[0]["url"], "https://cityofexample.gov/uploads/Section-101-Series-Adoption-of-Code.pdf")
        self.assertEqual(items[0]["section_number"], "101")
        self.assertEqual(items[0]["chapter_prefix"], "1XX")
        self.assertEqual(items[1]["url"], "https://cityofexample.gov/code/uploads/Section-102-Rules-of-Construction.pdf?v=2")
        self.assertEqual(items[1]["section_number"], "102")

    def test_unpack_pdf_zip_filters_safely(self):
        from app.codification import _unpack_pdf_zip

        buf = io.BytesIO()
        with zipfile.ZipFile(buf, "w") as zf:
            zf.writestr("__MACOSX/._Section-101.pdf", b"%PDF-1.4\njunk")
            zf.writestr("code/Section-101-Adoption.pdf", b"%PDF-1.4\nvalid-pdf-1")
            zf.writestr("code/notes.txt", b"ignored text file")
            zf.writestr("code/spoofed.pdf", b"NOT A REAL PDF")

        warnings: list[str] = []
        entries = _unpack_pdf_zip(buf.getvalue(), "city_code.zip", warnings)
        self.assertEqual(len(entries), 1)
        self.assertEqual(entries[0][0], "Section-101-Adoption.pdf")
        self.assertTrue(entries[0][1].startswith(b"%PDF-1.4"))
        self.assertTrue(any("not a valid PDF" in w for w in warnings))

    def test_is_safe_public_http_url_blocks_internal_targets(self):
        from app.codification import _is_safe_public_http_url

        self.assertFalse(_is_safe_public_http_url("http://127.0.0.1/code.pdf"))
        self.assertFalse(_is_safe_public_http_url("http://localhost:8080/api/health"))
        self.assertFalse(_is_safe_public_http_url("http://169.254.169.254/latest/meta-data/"))
        self.assertFalse(_is_safe_public_http_url("http://10.0.0.5/secret.pdf"))
        self.assertFalse(_is_safe_public_http_url("file:///etc/passwd"))
        self.assertTrue(_is_safe_public_http_url("https://8.8.8.8/code.pdf"))


if __name__ == "__main__":
    unittest.main()
