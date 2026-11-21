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

"""Municipal Codification module definition."""
from .. import codification
from ..registry import CivicModule

CODIFICATION_BACKUP_TABLES: list[tuple[str, list[str], set[str], bool]] = [
    (
        "code_chapters",
        ["id", "code_prefix", "title", "description", "sort_order", "is_published"],
        set(),
        True,
    ),
    (
        "code_sections",
        [
            "id", "chapter_id", "section_number", "article", "title", "summary", "body",
            "ordinance_ref", "effective_date", "source_pdf_url", "object_key",
            "sort_order", "is_published", "updated_at",
        ],
        set(),
        True,
    ),
    (
        "code_revisions",
        [
            "id", "section_id", "ordinance_number", "effective_date",
            "change_summary", "previous_body", "new_body", "edited_by", "created_at",
        ],
        set(),
        True,
    ),
]

MODULE = CivicModule(
    id="codification",
    name="City Code & Codification",
    description="Manage municipal code chapters, sections, amendments, and public City Code portal.",
    routers=[codification.router],
    bootstrap=codification.bootstrap,
    permissions=[
        {"key": "codification.manage", "label": "Manage City Code Chapters, Sections & Amendments"},
    ],
    nav_groups=[
        {
            "id": "codification-staff",
            "label": "Codification",
            "section_title": "Staff",
            "permission": "codification.manage",
            "items": [
                {"section": "codification-admin", "label": "City Code Editor", "permission": "codification.manage"},
            ],
        },
    ],
    backup_tables=CODIFICATION_BACKUP_TABLES,
)
