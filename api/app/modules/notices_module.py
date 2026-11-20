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

"""News Flash, Public Notices, Bids/RFPs & Jobs module definition."""
from .. import notices
from ..registry import CivicModule

NOTICES_BACKUP_TABLES: list[tuple[str, list[str], set[str], bool]] = [
    (
        "city_notices",
        [
            "id", "title", "category", "summary", "body", "department",
            "contact_info", "attachment_url", "attachment_key", "attachment_filename",
            "publish_at", "expires_at",
            "deadline_at", "is_pinned", "is_published", "created_by",
            "created_at", "updated_at",
        ],
        set(),
        True,
    ),
]

MODULE = CivicModule(
    id="notices",
    name="News, Notices, Bids & Jobs",
    description="Publish city news flashes, statutory public notices, open RFPs/bids, and job postings.",
    routers=[notices.router],
    bootstrap=notices.bootstrap,
    permissions=[
        {"key": "notices.manage", "label": "Manage City News, Public Notices, Bids & Jobs"},
    ],
    nav_groups=[
        {
            "id": "notices-staff",
            "label": "News & Notices",
            "section_title": "Staff",
            "permission": "notices.manage",
            "items": [
                {"section": "notices-manage", "label": "News, Notices, Bids & Jobs", "permission": "notices.manage"},
            ],
        },
    ],
    backup_tables=NOTICES_BACKUP_TABLES,
)
