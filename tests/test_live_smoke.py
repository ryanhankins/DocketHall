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

"""Live HTTP smoke tests against a running CivicDesk stack (set CIVICDESK_LIVE_URL)."""
import http.cookiejar
import json
import os
import unittest
import urllib.request

BASE = os.environ.get("CIVICDESK_LIVE_URL", "").strip().rstrip("/")


class _NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        return None


@unittest.skipUnless(BASE, "CIVICDESK_LIVE_URL is not set")
class LiveSmokeTest(unittest.TestCase):
    def _get(self, path):
        with urllib.request.urlopen(BASE + path, timeout=15) as r:
            raw = r.read()
            ct = r.headers.get("Content-Type", "")
            return r.status, ct, raw

    def test_health_and_public_endpoints(self):
        st, _, raw = self._get("/api/health")
        self.assertEqual(st, 200)
        self.assertEqual(json.loads(raw.decode())["status"], "ok")

        st, ct, mod_raw = self._get("/api/modules/public")
        self.assertEqual(st, 200)
        self.assertIn("application/json", ct)
        enabled = set(json.loads(mod_raw.decode()).get("enabled", []))

        public_paths = [
            "/api/subscriptions/topics",
            "/api/public/search?q=water",
            "/api/public/transparency",
            "/api/payments/bills/public-lookup?q=UTIL",
        ]
        if "agendas" in enabled:
            public_paths.append("/api/agendas/public")
        if "codification" in enabled:
            public_paths.append("/api/codification/public")
        if "permits" in enabled:
            public_paths.append("/api/permits/public/catalog")
        if "complaints" in enabled:
            public_paths.append("/api/complaints/public-log")
        if "records" in enabled:
            public_paths.append("/api/records/public")
        if "directory" in enabled:
            public_paths.append("/api/directory/public")
        if "communications" in enabled:
            public_paths.append("/api/blog/public")

        for path in public_paths:
            st, ct, _ = self._get(path)
            self.assertEqual(st, 200, path)
            self.assertIn("application/json", ct, path)

        if "communications" in enabled:
            st, ct, rss_raw = self._get("/api/blog/rss.xml")
            self.assertEqual(st, 200)
            self.assertIn("xml", ct)
            self.assertIn(b"<rss", rss_raw)

        if "codification" in enabled:
            st, ct, pdf = self._get("/api/codification/public/full.pdf")
            self.assertEqual(st, 200)
            self.assertIn("application/pdf", ct)
            self.assertTrue(pdf.startswith(b"%PDF"))

    def test_unauthenticated_app_redirects_to_login_preserving_next(self):
        opener = urllib.request.build_opener(_NoRedirect())
        with self.assertRaises(urllib.error.HTTPError) as ctx:
            opener.open(BASE + "/app", timeout=10)
        self.assertEqual(ctx.exception.code, 302)
        self.assertEqual(ctx.exception.headers.get("Location"), "/?next=/app")

    def test_admin_login_and_modules(self):
        cj = http.cookiejar.CookieJar()
        opener = urllib.request.build_opener(urllib.request.HTTPCookieProcessor(cj))
        req = urllib.request.Request(
            BASE + "/api/login",
            data=json.dumps({"username": "admin", "password": "admin"}).encode(),
            headers={"Content-Type": "application/json"},
            method="POST",
        )
        with opener.open(req, timeout=10) as r:
            self.assertEqual(r.status, 200)
        with opener.open(BASE + "/api/modules", timeout=10) as r:
            self.assertEqual(r.status, 200)
            data = json.loads(r.read().decode())
            ids = {m["id"] for m in data["modules"]}

        admin_paths = [
            "/api/my-account/summary",
            "/api/modules/admin",
            "/api/modules/admin/presets",
            "/api/payments/bills",
        ]
        if "permits" in ids:
            admin_paths.extend([
                "/api/permits/contractors",
                "/api/permits/link-candidates",
                "/api/permits/compliance-programs",
                "/api/permits/reports/summary",
                "/api/permits/parcels/map",
            ])
        if "records" in ids:
            admin_paths.append("/api/records/requests")
        if "complaints" in ids:
            admin_paths.append("/api/complaints/work-orders")
        if "communications" in ids:
            admin_paths.extend([
                "/api/blog/categories",
                "/api/blog/posts",
                "/api/blog/comments",
            ])

        for admin_path in admin_paths:
            with opener.open(BASE + admin_path, timeout=10) as r:
                self.assertEqual(r.status, 200, admin_path)


if __name__ == "__main__":
    unittest.main()
