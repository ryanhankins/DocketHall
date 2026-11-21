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

"""Municipal Citations module definition."""
from ..registry import CivicModule

CITATIONS_BACKUP_TABLES: list[tuple[str, list[str], set[str], bool]] = []

MODULE = CivicModule(
    id="citations",
    name="Municipal Citations",
    description="Parking and municipal code citations, online payment, PDF notices, and hearing/contest requests.",
    routers=[],
    bootstrap=lambda: None,
    permissions=[
        {"key": "citations.manage", "label": "Issue & Manage Municipal Citations"},
    ],
    features=[
        {"key": "online_contest", "label": "Online Citation Contest / Hearing Request", "description": "Let recipients contest unpaid citations and request a hearing online.", "default": True},
    ],
    nav_groups=[
        {
            "id": "citations-staff",
            "label": "Municipal Citations",
            "section_title": "Staff",
            "permission": "citations.manage",
            "items": [
                {"section": "citations-manage", "label": "Citations & Contests", "permission": "citations.manage"},
            ],
        },
    ],
    backup_tables=CITATIONS_BACKUP_TABLES,
)
