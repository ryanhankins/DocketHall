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

"""Validate that core + all 6 modules' backup_tables match the SQL schemas in api/app."""
import ast
import glob
import os
import re
import unittest

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
API_APP = os.path.join(ROOT, "api", "app")

EXPECTED_MODULES = {
    "agendas", "permits", "licensing", "codification", "records", "complaints",
    "calendar", "communications", "utilities", "citations", "ai_assistant",
}
EPHEMERAL_TABLES = {"sessions", "password_reset_tokens"}

_CREATE_TABLE_RE = re.compile(
    r"CREATE\s+TABLE\s+IF\s+NOT\s+EXISTS\s+([a-z_][a-z0-9_]*)\s*\((.*?)\)\s*;",
    re.IGNORECASE | re.DOTALL,
)
_ALTER_ADD_COL_RE = re.compile(
    r"ALTER\s+TABLE\s+([a-z_][a-z0-9_]*)\s+ADD\s+COLUMN\s+IF\s+NOT\s+EXISTS\s+([a-z_][a-z0-9_]*)\b",
    re.IGNORECASE,
)
_SQL_KEYWORDS = {"PRIMARY", "UNIQUE", "CHECK", "FOREIGN", "CONSTRAINT"}


def _extract_backup_var(path: str, var_name: str) -> list[tuple[str, list[str], set[str], bool]]:
    with open(path, "r", encoding="utf-8") as f:
        tree = ast.parse(f.read(), filename=path)
    for node in tree.body:
        target_id = None
        value = None
        if isinstance(node, ast.Assign) and len(node.targets) == 1 and isinstance(node.targets[0], ast.Name):
            target_id = node.targets[0].id
            value = node.value
        elif isinstance(node, ast.AnnAssign) and isinstance(node.target, ast.Name):
            target_id = node.target.id
            value = node.value
        if target_id == var_name and value is not None:
            return ast.literal_eval(value)
    raise AssertionError(f"{var_name} not found in {path}")


def _extract_schema_columns() -> dict[str, set[str]]:
    tables: dict[str, set[str]] = {}
    for py_path in sorted(glob.glob(os.path.join(API_APP, "*.py"))):
        with open(py_path, "r", encoding="utf-8") as f:
            txt = f.read()
        for m in _CREATE_TABLE_RE.finditer(txt):
            tname = m.group(1).lower()
            cols = tables.setdefault(tname, set())
            for raw_line in m.group(2).splitlines():
                line = raw_line.strip()
                if not line or line.startswith("--"):
                    continue
                first = line.split()[0].upper().rstrip(",")
                if first in _SQL_KEYWORDS:
                    continue
                cols.add(line.split()[0].lower())
        for m in _ALTER_ADD_COL_RE.finditer(txt):
            tname = m.group(1).lower()
            col = m.group(2).lower()
            tables.setdefault(tname, set()).add(col)
    return tables


class BackupSchemaSyncTest(unittest.TestCase):
    def test_all_six_modules_and_core_match_sql_schemas(self):
        core_tables = _extract_backup_var(os.path.join(API_APP, "backup.py"), "_CORE_TABLES")
        backup_cols: dict[str, list[str]] = {t: cols for t, cols, _, _ in core_tables}

        found_modules: set[str] = set()
        for mod_path in sorted(glob.glob(os.path.join(API_APP, "modules", "*_module.py"))):
            mod_name = os.path.basename(mod_path).removesuffix("_module.py")
            var_name = f"{mod_name.upper()}_BACKUP_TABLES"
            entries = _extract_backup_var(mod_path, var_name)
            if mod_name not in {"utilities", "citations"}:
                self.assertGreater(len(entries), 0, f"{mod_name} has empty {var_name}")
            found_modules.add(mod_name)
            for tname, cols, _, _ in entries:
                self.assertNotIn(tname, backup_cols, f"Duplicate backup table {tname}")
                backup_cols[tname] = cols

        self.assertEqual(found_modules, EXPECTED_MODULES)

        schema_cols = _extract_schema_columns()
        expected_tables = set(schema_cols.keys()) - EPHEMERAL_TABLES
        self.assertEqual(
            sorted(expected_tables - set(backup_cols.keys())),
            [],
            "SQL tables missing from backup_tables",
        )
        self.assertEqual(
            sorted(set(backup_cols.keys()) - expected_tables),
            [],
            "Backup tables not found in SQL schemas",
        )

        for tname in sorted(expected_tables):
            with self.subTest(table=tname):
                bcols = set(backup_cols[tname])
                scols = schema_cols[tname]
                self.assertEqual(sorted(scols - bcols), [], f"{tname} missing columns in backup")
                self.assertEqual(sorted(bcols - scols), [], f"{tname} has extra columns in backup")


if __name__ == "__main__":
    unittest.main()
