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

"""Layer 1 OpenAPI schema & route inventory contract tests."""

import sys
import unittest
from pathlib import Path

API_ROOT = Path(__file__).resolve().parent.parent / "api"
if str(API_ROOT) not in sys.path:
    sys.path.insert(0, str(API_ROOT))

try:
    from fastapi.routing import APIRoute
    from app.main import app

    _HAS_APP = True
except Exception:
    _HAS_APP = False


@unittest.skipUnless(_HAS_APP, "FastAPI/API dependencies not installed on host")
class OpenApiManifestTest(unittest.TestCase):
    def test_openapi_schema_builds_cleanly(self):
        schema = app.openapi()
        self.assertIn("paths", schema)
        self.assertGreater(len(schema["paths"]), 100)

    def test_no_duplicate_method_path_routes(self):
        seen = {}
        duplicates = []
        for route in app.routes:
            if not isinstance(route, APIRoute):
                continue
            for method in route.methods or ():
                if method in ("HEAD", "OPTIONS"):
                    continue
                key = (method, route.path)
                if key in seen:
                    duplicates.append((key, seen[key], route.name))
                else:
                    seen[key] = route.name
        self.assertEqual(duplicates, [], f"Duplicate routes detected: {duplicates}")

    def test_expected_router_prefixes_present(self):
        paths = {r.path for r in app.routes if isinstance(r, APIRoute)}
        expected_prefixes = (
            "/api/health",
            "/api/login",
            "/api/users",
            "/api/backup",
            "/api/agendas",
            "/api/permits",
            "/api/payments",
            "/api/complaints",
            "/api/records",
            "/api/codification",
            "/api/blog",
            "/api/pages",
            "/api/calendar",
            "/api/directory",
            "/api/forms",
            "/api/notices",
            "/api/public",
            "/api/subscriptions",
        )
        for prefix in expected_prefixes:
            self.assertTrue(
                any(p.startswith(prefix) for p in paths),
                f"Expected router prefix missing from FastAPI app: {prefix}",
            )
