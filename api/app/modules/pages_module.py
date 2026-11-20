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

"""Custom City Pages & Quick Links module definition."""
from .. import pages
from ..registry import CivicModule

PAGES_BACKUP_TABLES: list[tuple[str, list[str], set[str], bool]] = [
    (
        "city_pages",
        ["id", "slug", "title", "summary", "body", "category", "sort_order", "is_public", "updated_by", "created_at", "updated_at"],
        set(),
        True,
    ),
    (
        "city_quick_links",
        ["id", "label", "description", "url", "sort_order", "is_public", "created_at"],
        set(),
        True,
    ),
]

MODULE = CivicModule(
    id="pages",
    name="City Pages & Quick Links",
    description="Publish custom municipal information pages (utilities, trash, snow rules) and quick links.",
    routers=[pages.router],
    bootstrap=pages.bootstrap,
    permissions=[
        {"key": "pages.manage", "label": "Manage City Info Pages & Quick Links"},
    ],
    nav_groups=[
        {
            "id": "pages-staff",
            "label": "City Pages & Links",
            "section_title": "Staff",
            "permission": "pages.manage",
            "items": [
                {"section": "pages-manage", "label": "City Pages & Quick Links", "permission": "pages.manage"},
            ],
        },
    ],
    backup_tables=PAGES_BACKUP_TABLES,
)
