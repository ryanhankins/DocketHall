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

"""Business & Contractor Licensing, Compliance Programs, and Recurring Renewals module."""
from ..registry import CivicModule

LICENSING_BACKUP_TABLES: list[tuple[str, list[str], set[str], bool]] = [
    (
        "contractor_licenses",
        [
            "id", "license_number", "business_name", "license_type", "contact_name",
            "email", "phone", "address", "license_expires_at",
            "insurance_carrier", "insurance_policy_no", "insurance_expires_at",
            "bond_amount", "bond_expires_at", "status", "notes",
            "created_at", "updated_at",
        ],
        set(),
        True,
    ),
    (
        "recurring_compliance_programs",
        [
            "id", "program_type", "property_address", "parcel_id", "unit_count",
            "owner_name", "local_agent_name", "local_agent_phone", "local_agent_email",
            "cycle_months", "last_inspected_date", "next_inspection_date",
            "last_result", "inspector", "certificate_number", "status", "notes",
            "created_at", "updated_at",
        ],
        set(),
        True,
    ),
]

MODULE = CivicModule(
    id="licensing",
    name="Licensing & Compliance",
    description="Contractor licenses, COI/bond tracking, rental & fire compliance inspections, and automated recurring renewals.",
    routers=[],
    bootstrap=lambda: None,
    permissions=[
        {"key": "licensing.manage", "label": "Manage Contractors, Compliance Programs & Renewals"},
    ],
    features=[
        {"key": "contractors", "label": "Contractor Licensing & Registry", "description": "Track contractor licenses, insurance, and bond expirations.", "default": True},
        {"key": "compliance_programs", "label": "Rental & Fire Compliance Programs", "description": "Recurring inspection cycles for rental properties and businesses.", "default": True},
    ],
    nav_groups=[
        {
            "id": "licensing-staff",
            "label": "Licensing & Compliance",
            "section_title": "Staff",
            "permission": "licensing.manage",
            "items": [
                {"section": "contractors", "label": "Contractors & Licenses", "permission": "licensing.manage", "feature": "contractors"},
                {"section": "compliance-programs", "label": "Rental & Fire Compliance", "permission": "licensing.manage", "feature": "compliance_programs"},
                {"section": "renewals", "label": "Recurring Renewals", "permission": "licensing.manage"},
            ],
        },
    ],
    backup_tables=LICENSING_BACKUP_TABLES,
)
