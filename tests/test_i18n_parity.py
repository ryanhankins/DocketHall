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

"""Layer 1 static check: multilingual portal translation key parity."""

import re
import unittest
from pathlib import Path

HOME_JSX = Path(__file__).resolve().parent.parent / "web" / "src" / "home.jsx"


class I18nParityTest(unittest.TestCase):
    def test_all_portal_languages_share_same_keys(self):
        src = HOME_JSX.read_text(encoding="utf-8")
        langs = ("es", "fr", "so", "hmn")
        key_sets = {}
        for lang in langs:
            m = re.search(rf"\b{lang}:\s*\{{(.*?)\n  \}}", src, re.DOTALL)
            self.assertIsNotNone(m, f"Missing translation block for '{lang}' in home.jsx")
            keys = set(re.findall(r"^\s*'([^']+)':\s*'", m.group(1), re.MULTILINE))
            self.assertGreater(len(keys), 10, f"Too few translation keys for '{lang}'")
            key_sets[lang] = keys

        base = key_sets["es"]
        for lang in ("fr", "so", "hmn"):
            missing = base - key_sets[lang]
            self.assertEqual(missing, set(), f"Missing keys in '{lang}': {sorted(missing)}")
