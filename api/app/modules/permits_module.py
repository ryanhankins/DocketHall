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

"""City Permitting module definition."""
from .. import permits
from ..registry import CivicModule

PERMITS_BACKUP_TABLES: list[tuple[str, list[str], set[str], bool]] = [
    (
        "permit_portal_settings",
        [
            "id", "general_instructions", "required_documents_note",
            "fee_schedule_url", "fee_schedule_label",
            "payment_instructions", "payment_url", "updated_at",
        ],
        set(),
        False,
    ),
    (
        "permit_types",
        ["id", "name", "description", "kind", "expiration_rule", "required_fields", "custom_fields", "sort_order", "is_active"],
        {"required_fields", "custom_fields"},
        True,
    ),
    (
        "permit_uses",
        [
            "id", "permit_type_id", "name", "description", "fee_amount",
            "requires_plans", "requires_coi", "requires_survey", "sort_order", "is_active",
        ],
        set(),
        True,
    ),
    (
        "permits",
        [
            "id", "permit_number", "applicant_user_id", "applicant_username",
            "permit_type_id", "permit_use_id", "permit_type_name", "permit_use_name",
            "applicant_name", "applicant_email", "applicant_phone",
            "property_address", "building_name", "suite_name", "parcel_id", "owner_name",
            "contractor_name", "contractor_license",
            "project_description", "estimated_value", "accepted_terms",
            "status", "fee_amount", "payment_status", "review_notes", "reviewed_by",
            "assigned_to", "permit_kind", "expires_at", "renewed_from_id",
            "project_name", "custom_data",
            "created_at", "updated_at", "issued_at", "closed_at",
        ],
        {"custom_data"},
        True,
    ),
    (
        "permit_parcels",
        [
            "id", "parcel_id", "address", "building_name", "suite_name",
            "owner_name", "lot", "block", "section", "notes", "created_at",
        ],
        set(),
        True,
    ),
    (
        "permit_workflow_steps",
        [
            "id", "permit_id", "step_name", "department", "assigned_to",
            "status", "notes", "completed_at", "created_at",
        ],
        set(),
        True,
    ),
    (
        "permit_inspections",
        [
            "id", "permit_id", "inspection_type", "scheduled_date", "inspector",
            "result", "notes", "completed_at", "created_at",
        ],
        set(),
        True,
    ),
    (
        "permit_messages",
        ["id", "permit_id", "sender_username", "sender_role", "is_internal", "body", "created_at"],
        set(),
        True,
    ),
    (
        "permit_documents",
        [
            "id", "permit_id", "doc_category", "title", "filename",
            "content_type", "size_bytes", "sha256", "object_key",
            "uploaded_by", "created_at",
        ],
        set(),
        True,
    ),
    (
        "permit_activity_log",
        ["id", "permit_id", "action", "actor_username", "note", "created_at"],
        set(),
        True,
    ),
    (
        "permit_links",
        ["id", "source_permit_id", "target_permit_id", "link_type", "notes", "created_at"],
        set(),
        True,
    ),
]

MODULE = CivicModule(
    id="permits",
    name="City Permitting",
    description="Online permit catalog, applications, document uploads, and staff review.",
    routers=[permits.router],
    bootstrap=permits.bootstrap,
    permissions=[
        {"key": "permits.manage", "label": "Review Permits & Manage Permit Catalog"},
        {"key": "permits.submit", "label": "Apply for Permits & Track My Permits"},
    ],
    nav_groups=[
        {
            "id": "permits-staff",
            "label": "Permitting Management",
            "section_title": "Staff",
            "permission": "permits.manage",
            "items": [
                {"section": "permits-review", "label": "Permit Review Queue", "permission": "permits.manage"},
                {"section": "preferences-permits", "label": "Permit Preferences", "permission": "permits.manage"},
            ],
        },
        {
            "id": "permits-applicant",
            "label": "Permits",
            "section_title": "Applicant",
            "permission": "permits.submit",
            "items": [
                {"section": "permits-apply", "label": "Apply for Permit", "permission": "permits.submit"},
                {"section": "my-permits", "label": "My Permits", "permission": "permits.submit"},
            ],
        },
    ],
    backup_tables=PERMITS_BACKUP_TABLES,
)
