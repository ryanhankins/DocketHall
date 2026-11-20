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

"""Staff & Council Directory and Self-Service FAQs module definition."""
from .. import directory
from ..registry import CivicModule

DIRECTORY_BACKUP_TABLES: list[tuple[str, list[str], set[str], bool]] = [
    (
        "city_directory_entries",
        [
            "id", "name", "title_role", "department", "email", "phone",
            "office_hours", "notes", "is_elected", "sort_order", "is_public", "created_at",
        ],
        set(),
        True,
    ),
    (
        "city_faqs",
        ["id", "question", "answer", "category", "sort_order", "is_public", "created_at", "updated_at"],
        set(),
        True,
    ),
]

MODULE = CivicModule(
    id="directory",
    name="Directory & FAQs",
    description="Publish City Council & staff contact directory and self-service FAQs.",
    routers=[directory.router],
    bootstrap=directory.bootstrap,
    permissions=[
        {"key": "directory.manage", "label": "Manage Staff/Council Directory & Public FAQs"},
    ],
    nav_groups=[
        {
            "id": "directory-staff",
            "label": "Directory & FAQs",
            "section_title": "Staff",
            "permission": "directory.manage",
            "items": [
                {"section": "directory-manage", "label": "Directory & FAQs", "permission": "directory.manage"},
            ],
        },
    ],
    backup_tables=DIRECTORY_BACKUP_TABLES,
)
