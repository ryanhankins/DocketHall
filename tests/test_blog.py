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

"""Unit tests for pure municipal blog utilities and RSS XML feed generation."""
from __future__ import annotations

from datetime import date, datetime, timezone
import os
import sys
import unittest
import xml.etree.ElementTree as ET

sys.path.insert(0, os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "api"))

from app.blog_utils import (
    build_rss_xml,
    compute_post_status,
    detect_safe_image_type,
    effective_comment_policy,
    is_post_publicly_visible,
    normalize_tags,
    post_included_in_rss,
    slugify,
    validate_comment_input,
)


class BlogUtilsTest(unittest.TestCase):
    def test_slugify_and_tags(self):
        self.assertEqual(slugify("Mayor's Spring Update 2026!"), "mayor-s-spring-update-2026")
        self.assertEqual(slugify("   ", fallback="cat"), "cat")
        tags = normalize_tags("Parks, public works, PARKS, Water & Sewer,  ")
        self.assertEqual(tags, ["Parks", "public works", "Water & Sewer"])
        self.assertEqual(normalize_tags(["A", "a", "B"]), ["A", "B"])

    def test_comment_policy_resolution(self):
        self.assertEqual(effective_comment_policy("moderated", "inherit"), "moderated")
        self.assertEqual(effective_comment_policy("moderated", "open"), "open")
        self.assertEqual(effective_comment_policy("open", "disabled"), "disabled")
        self.assertEqual(effective_comment_policy("invalid", "inherit"), "moderated")

    def test_scheduling_window_and_visibility(self):
        now = datetime(2026, 6, 15, 12, 0, tzinfo=timezone.utc)
        past = datetime(2026, 6, 10, 12, 0, tzinfo=timezone.utc)
        future = datetime(2026, 6, 20, 12, 0, tzinfo=timezone.utc)

        self.assertEqual(compute_post_status(False, past, None, now), "draft")
        self.assertEqual(compute_post_status(True, future, None, now), "scheduled")
        self.assertEqual(compute_post_status(True, past, date(2026, 6, 14), now), "expired")
        self.assertEqual(compute_post_status(True, past, date(2026, 6, 15), now), "published")

        self.assertTrue(is_post_publicly_visible(True, True, past, date(2026, 6, 15), now))
        self.assertFalse(is_post_publicly_visible(True, False, past, None, now))
        self.assertFalse(is_post_publicly_visible(True, True, future, None, now))

    def test_rss_inclusion_policy(self):
        self.assertFalse(post_included_in_rss("exclude", True))
        self.assertTrue(post_included_in_rss("include", False))
        self.assertTrue(post_included_in_rss("always_ask", True))
        self.assertFalse(post_included_in_rss("always_ask", False))

    def test_safe_image_detection(self):
        self.assertEqual(detect_safe_image_type(b"\x89PNG\r\n\x1a\n" + b"\x00" * 10), ("png", "image/png"))
        self.assertEqual(detect_safe_image_type(b"\xff\xd8\xff\xe0" + b"\x00" * 10), ("jpg", "image/jpeg"))
        self.assertEqual(detect_safe_image_type(b"GIF89a" + b"\x00" * 10), ("gif", "image/gif"))
        self.assertEqual(detect_safe_image_type(b"RIFF\x00\x00\x00\x00WEBPxxxx"), ("webp", "image/webp"))
        self.assertIsNone(detect_safe_image_type(b"<svg xmlns='http://www.w3.org/2000/svg'></svg>"))
        self.assertIsNone(detect_safe_image_type(b"<html><script>alert(1)</script></html>"))

    def test_comment_validation(self):
        name, email, body = validate_comment_input("  Jane Doe  ", "JANE@Example.COM ", " Great post! ")
        self.assertEqual((name, email, body), ("Jane Doe", "jane@example.com", "Great post!"))
        name2, email2, _ = validate_comment_input("Bob", "", "Hello residents")
        self.assertEqual((name2, email2), ("Bob", ""))
        with self.assertRaises(ValueError):
            validate_comment_input("", "", "Valid body")
        with self.assertRaises(ValueError):
            validate_comment_input("Bob", "not-an-email", "Valid body")
        with self.assertRaises(ValueError):
            validate_comment_input("Bob", "", "x")

    def test_build_rss_xml(self):
        xml_str = build_rss_xml(
            "City of Example Blog",
            "https://example.gov/#blog",
            "Updates & notices",
            [
                {
                    "title": "Water Main & Valve Work",
                    "link": "https://example.gov/#blog/water-work",
                    "guid": "https://example.gov/#blog/water-work",
                    "pub_date": datetime(2026, 6, 15, 14, 30, tzinfo=timezone.utc),
                    "author": "Public Works",
                    "category": "City Updates",
                    "tags": ["Water", "Streets"],
                    "lead_in": "Scheduled maintenance <Phase 1>",
                    "body": "Fallback body",
                }
            ],
        )
        root = ET.fromstring(xml_str)
        self.assertEqual(root.tag, "rss")
        self.assertEqual(root.attrib.get("version"), "2.0")
        ch = root.find("channel")
        self.assertIsNotNone(ch)
        self.assertEqual(ch.findtext("title"), "City of Example Blog")
        items = ch.findall("item")
        self.assertEqual(len(items), 1)
        self.assertEqual(items[0].findtext("title"), "Water Main & Valve Work")
        self.assertEqual(items[0].findtext("description"), "Scheduled maintenance <Phase 1>")
        cats = [el.text for el in items[0].findall("category")]
        self.assertEqual(cats, ["City Updates", "Water", "Streets"])


if __name__ == "__main__":
    unittest.main()
