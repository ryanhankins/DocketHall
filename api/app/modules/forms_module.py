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

"""Standalone Custom Forms & Opinion Polls module definition."""
from .. import forms
from ..registry import CivicModule

FORMS_BACKUP_TABLES: list[tuple[str, list[str], set[str], bool]] = [
    (
        "city_forms",
        [
            "id", "slug", "title", "form_kind", "description", "fields",
            "allow_anonymous", "show_poll_results", "closes_at",
            "is_public", "sort_order", "created_by", "created_at", "updated_at",
        ],
        {"fields"},
        True,
    ),
    (
        "city_form_submissions",
        ["id", "form_id", "submitter_name", "submitter_email", "responses", "status", "staff_notes", "created_at"],
        {"responses"},
        True,
    ),
]

MODULE = CivicModule(
    id="forms",
    name="Forms & Opinion Polls",
    description="Create general-purpose resident forms, applications, and community opinion polls.",
    routers=[forms.router],
    bootstrap=forms.bootstrap,
    permissions=[
        {"key": "forms.manage", "label": "Manage Custom Forms, Polls & Submissions"},
    ],
    nav_groups=[
        {
            "id": "forms-staff",
            "label": "Forms & Polls",
            "section_title": "Staff",
            "permission": "forms.manage",
            "items": [
                {"section": "forms-manage", "label": "Forms & Opinion Polls", "permission": "forms.manage"},
            ],
        },
    ],
    backup_tables=FORMS_BACKUP_TABLES,
)
