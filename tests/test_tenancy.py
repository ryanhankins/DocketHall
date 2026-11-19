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

"""Unit tests for schema-per-tenant context, slug validation, and object key isolation."""
import os
import sys
import unittest

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.join(ROOT, "api"))

try:
    from fastapi import HTTPException
    from app import tenancy

    HAS_TENANCY_DEPS = True
except ImportError:
    HAS_TENANCY_DEPS = False


@unittest.skipUnless(HAS_TENANCY_DEPS, "API dependencies (fastapi/psycopg) not installed")
class TenancyUnitTest(unittest.TestCase):
    def test_slug_validation_and_schema_naming(self):
        self.assertEqual(tenancy.validate_tenant_slug("birchwood-village"), "birchwood_village")
        self.assertEqual(tenancy.schema_for_slug("default"), "public")
        self.assertEqual(tenancy.schema_for_slug("birchwood_village"), "tenant_birchwood_village")
        for bad in ("", "a", "default", "public", "1bad", "bad;drop"):
            with self.assertRaises(HTTPException):
                tenancy.validate_tenant_slug(bad)

    def test_tenant_object_key_and_strip(self):
        self.assertEqual(tenancy.tenant_object_key("agendas/1/file.pdf"), "agendas/1/file.pdf")
        with tenancy.tenant_context("northfield", "tenant_northfield"):
            self.assertEqual(
                tenancy.tenant_object_key("agendas/1/file.pdf"),
                "tenants/northfield/agendas/1/file.pdf",
            )
            self.assertEqual(
                tenancy.strip_tenant_prefix("tenants/northfield/agendas/1/file.pdf"),
                "agendas/1/file.pdf",
            )
        self.assertEqual(tenancy.get_current_tenant_slug(), "default")


if __name__ == "__main__":
    unittest.main()
