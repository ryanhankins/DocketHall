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

"""Administrative & Code Complaints module definition."""
from .. import complaints
from ..registry import CivicModule

COMPLAINTS_BACKUP_TABLES: list[tuple[str, list[str], set[str], bool]] = [
    (
        "complaint_settings",
        ["id", "code_citation", "privacy_statute", "max_compliance_days", "ordinance_presets", "updated_at"],
        {"ordinance_presets"},
        False,
    ),
    (
        "complaints",
        [
            "id", "complaint_number", "intake_channel", "is_anonymous", "is_real_property_complaint",
            "complainant_user_id", "complainant_username", "complainant_name", "complainant_email",
            "complainant_phone", "complainant_address",
            "subject_property_address", "subject_person_name", "ordinance_section",
            "conduct_description", "date_observed",
            "status", "assigned_to", "assisting_agency", "investigation_report", "internal_notes",
            "nov_issued_at", "nov_issuing_official", "nov_violation_datetime",
            "nov_required_action", "nov_compliance_deadline", "hearing_requested_at",
            "council_meeting_date", "final_resolution", "resolved_at",
            "code_section_id", "enforcement_stage", "reinspection_date",
            "citation_amount", "citation_issued_at",
            "created_at", "updated_at", "latitude", "longitude",
        ],
        set(),
        True,
    ),
    (
        "complaint_reinspections",
        ["id", "complaint_id", "inspect_date", "inspector", "outcome", "notes", "created_at"],
        set(),
        True,
    ),
    (
        "complaint_documents",
        [
            "id", "complaint_id", "doc_category", "is_confidential", "title", "filename",
            "content_type", "size_bytes", "sha256", "object_key", "uploaded_by", "created_at",
        ],
        set(),
        True,
    ),
    (
        "complaint_activity_log",
        ["id", "complaint_id", "action", "actor_username", "is_internal", "note", "created_at"],
        set(),
        True,
    ),
    (
        "complaint_messages",
        ["id", "complaint_id", "sender_username", "sender_role", "is_internal", "body", "created_at"],
        set(),
        True,
    ),
    (
        "public_works_orders",
        [
            "id", "work_order_number", "source_complaint_id", "category", "asset_id",
            "location", "description", "priority", "status", "assigned_crew",
            "estimated_cost", "reporter_name", "reporter_email", "completion_notes",
            "completed_at", "created_at", "updated_at", "latitude", "longitude",
        ],
        set(),
        True,
    ),
]

MODULE = CivicModule(
    id="complaints",
    name="Administrative Complaints",
    description="Zero-fee complaint intake, confidential complainant tracking, public Complaint Log Book, investigations, and Notices of Violation.",
    routers=[complaints.router],
    bootstrap=complaints.bootstrap,
    permissions=[
        {"key": "complaints.manage", "label": "Investigate Complaints, Manage Log Book & Issue Notices"},
        {"key": "complaints.view_private", "label": "View Confidential Complainant Identity & Private Data"},
        {"key": "complaints.submit", "label": "File Complaints & Track My Complaints"},
        {"key": "complaints.log", "label": "View Public Complaint Log Book"},
    ],
    features=[
        {"key": "work_orders", "label": "311 Public Works Orders", "description": "Dispatch and track public works maintenance orders from 311 requests.", "default": True},
        {"key": "nov_enforcement", "label": "Notices of Violation & Hearings", "description": "Formal NOV issuance, compliance deadlines, citations, and council hearings.", "default": True},
    ],
    nav_groups=[
        {
            "id": "complaints-staff",
            "label": "Complaints & Enforcement",
            "section_title": "Staff",
            "permission": "complaints.manage",
            "items": [
                {"section": "complaints-manage", "label": "Complaint Queue & Investigations", "permission": "complaints.manage"},
                {"section": "preferences-complaints", "label": "Complaint Preferences", "permission": "complaints.manage"},
            ],
        },
        {
            "id": "complaints-resident",
            "label": "Complaints",
            "section_title": "Complaints",
            "permission": "complaints.log",
            "items": [
                {"section": "complaints-file", "label": "File a Complaint", "permission": "complaints.submit"},
                {"section": "my-complaints", "label": "My Complaints", "permission": "complaints.submit"},
                {"section": "complaints-log", "label": "Complaint Log Book", "permission": "complaints.log"},
            ],
        },
    ],
    backup_tables=COMPLAINTS_BACKUP_TABLES,
)
