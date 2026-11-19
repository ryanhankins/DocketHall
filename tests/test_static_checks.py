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

"""Static checks for Python compilation and JS/JSX import integrity."""
import compileall
import glob
import os
import re
import unittest

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
API_APP = os.path.join(ROOT, "api", "app")
WEB_SRC = os.path.join(ROOT, "web", "src")

_JSX_TAG_RE = re.compile(r"<([A-Z][A-Za-z0-9_]*)[\s/>]")
_IMPORT_RE = re.compile(r"import\s+(?:([A-Za-z0-9_]+)\s*,?\s*)?(?:\{([^}]+)\})?\s*from\s+['\"][^'\"]+['\"]")
_DECL_RE = re.compile(r"(?:function|class|const|let|var)\s+([A-Z][A-Za-z0-9_]*)\b")
_REL_IMPORT_RE = re.compile(
    r"(?:import|export)\s+(?:[^'\"]+\s+from\s+)?['\"](\.[^'\"]+)['\"]|import\(\s*['\"](\.[^'\"]+)['\"]\s*\)"
)


class StaticChecksTest(unittest.TestCase):
    def test_python_compileall(self):
        ok = compileall.compile_dir(API_APP, quiet=1)
        self.assertTrue(ok, "Python compileall failed for api/app")

    def test_web_relative_imports_exist(self):
        files = glob.glob(os.path.join(WEB_SRC, "**", "*.jsx"), recursive=True) + glob.glob(
            os.path.join(WEB_SRC, "**", "*.js"), recursive=True
        )
        self.assertGreater(len(files), 0)
        broken = []
        for path in sorted(files):
            with open(path, "r", encoding="utf-8") as f:
                txt = f.read()
            for m in _REL_IMPORT_RE.finditer(txt):
                rel = m.group(1) or m.group(2)
                target = os.path.normpath(os.path.join(os.path.dirname(path), rel))
                if not (
                    os.path.isfile(target)
                    or os.path.isfile(target + ".js")
                    or os.path.isfile(target + ".jsx")
                ):
                    broken.append((os.path.relpath(path, WEB_SRC), rel))
        self.assertEqual(broken, [], f"Broken relative imports found: {broken}")

    def test_jsx_components_are_imported_or_declared(self):
        files = glob.glob(os.path.join(WEB_SRC, "**", "*.jsx"), recursive=True)
        missing = []
        for path in sorted(files):
            with open(path, "r", encoding="utf-8") as f:
                txt = f.read()
            defined = set(_DECL_RE.findall(txt))
            # Allow destructured component props like `{ as: Tag = 'span' }`
            for m in re.finditer(r":\s*([A-Z][A-Za-z0-9_]*)\s*(?:=|,|\})", txt):
                defined.add(m.group(1))
            for m in _IMPORT_RE.finditer(txt):
                if m.group(1):
                    defined.add(m.group(1))
                if m.group(2):
                    for part in m.group(2).split(","):
                        part = part.strip()
                        if not part:
                            continue
                        defined.add(part.split(" as ")[-1].strip() if " as " in part else part)
            defined.update({"React", "Suspense", "Fragment", "StrictMode"})
            used = set(_JSX_TAG_RE.findall(txt))
            diff = sorted(used - defined)
            if diff:
                missing.append((os.path.relpath(path, WEB_SRC), diff))
        self.assertEqual(missing, [], f"Unimported JSX components found: {missing}")


if __name__ == "__main__":
    unittest.main()
