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

"""Utility Billing module definition."""
from ..registry import CivicModule

UTILITIES_BACKUP_TABLES: list[tuple[str, list[str], set[str], bool]] = []

MODULE = CivicModule(
    id="utilities",
    name="Utility Billing",
    description="Water, sewer, and trash utility accounts, batch CSV statements, late-fee aging, and online payment.",
    routers=[],
    bootstrap=lambda: None,
    permissions=[
        {"key": "utilities.manage", "label": "Manage Utility Accounts & Billing Statements"},
    ],
    features=[
        {"key": "late_fees", "label": "Automated Late-Fee Aging", "description": "Apply flat or percentage late fees to past-due utility accounts.", "default": True},
        {"key": "csv_import", "label": "Batch CSV Statement Import", "description": "Bulk-import monthly utility billing cycles from CSV.", "default": True},
    ],
    nav_groups=[
        {
            "id": "utilities-staff",
            "label": "Utility Billing",
            "section_title": "Staff",
            "permission": "utilities.manage",
            "items": [
                {"section": "utilities-manage", "label": "Utility Accounts & Bills", "permission": "utilities.manage"},
            ],
        },
    ],
    backup_tables=UTILITIES_BACKUP_TABLES,
)
