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

"""Agendas & Council Submissions module definition."""
from .. import agendas
from ..registry import CivicModule

AGENDAS_BACKUP_TABLES: list[tuple[str, list[str], set[str], bool]] = [
    (
        "agendas",
        [
            "id", "title", "body", "meeting_date", "meeting_time", "status",
            "finalized_at", "created_by", "created_at", "updated_at",
            "minutes_attendance", "minutes_notes", "minutes_status",
            "media_url", "media_type", "amended_at",
        ],
        set(),
        True,
    ),
    (
        "agenda_items",
        [
            "id", "agenda_id", "position", "title", "description", "section",
            "presenter", "recommended_motion", "fiscal_impact", "revision_status",
            "target_body", "target_date", "created_at", "todo_status", "assigned_to",
            "recurrence", "recurrence_month", "source_agenda_id", "source_item_id",
            "completed_at", "minutes_action", "minutes_motion_by", "minutes_second_by",
            "minutes_vote", "minutes_notes",
        ],
        set(),
        True,
    ),
    (
        "agenda_documents",
        [
            "id", "agenda_item_id", "position", "title", "filename",
            "content_type", "size_bytes", "sha256", "object_key",
            "uploaded_by", "created_at",
        ],
        set(),
        True,
    ),
    (
        "backlog_agenda_links",
        ["backlog_item_id", "agenda_id", "created_at"],
        set(),
        False,
    ),
    (
        "agenda_status_log",
        ["id", "agenda_id", "action", "actor_username", "note", "created_at"],
        set(),
        True,
    ),
    (
        "agenda_templates",
        ["id", "name", "body", "meeting_time", "items", "created_at", "updated_at"],
        {"items"},
        True,
    ),
    (
        "council_submissions",
        [
            "id", "submitted_by", "submitted_username", "title", "description",
            "section", "recommended_motion", "fiscal_impact", "target_agenda_id",
            "target_date", "target_note", "status", "accepted_agenda_id",
            "accepted_item_id", "reviewed_by", "reviewed_username", "review_note",
            "created_at", "reviewed_at",
        ],
        set(),
        True,
    ),
    (
        "council_submission_documents",
        [
            "id", "submission_id", "title", "filename", "content_type", "size_bytes",
            "sha256", "object_key", "uploaded_by", "uploaded_username", "approval_status",
            "reviewed_by", "reviewed_username", "agenda_doc_id", "created_at", "reviewed_at",
        ],
        set(),
        True,
    ),
    (
        "agenda_preferences",
        [
            "id", "include_item_cover_sheets", "include_page_numbers", "city_title", "city_name",
            "meeting_location", "meeting_time", "other_notes", "footer_disclosures",
            "bodies", "sections", "categories", "city_logo_key",
            "backup_reminder_days", "last_backup_at", "posting_notice_hours",
            "alert_enabled", "alert_level", "alert_title", "alert_message",
            "alert_link_url", "alert_link_label", "footer_text",
            "city_website_url", "city_website_label", "directory_url", "directory_label",
            "theme_primary", "theme_secondary", "theme_tint", "theme_bg",
            "theme_surface", "theme_header_bg", "updated_at",
        ],
        {"bodies", "sections", "categories"},
        False,
    ),
]

MODULE = CivicModule(
    id="agendas",
    name="Agenda Management",
    description="Create, organize, and publish meeting agendas, packets, minutes, and submissions.",
    routers=[agendas.router],
    bootstrap=agendas.bootstrap,
    permissions=[
        {"key": "agendas.manage", "label": "Manage Agendas, Backlog & Agenda Preferences"},
        {"key": "agendas.submit", "label": "Submit Agenda Items & View Finalized Agendas"},
    ],
    nav_groups=[
        {
            "id": "agenda-management",
            "label": "Agenda Management",
            "section_title": "Staff",
            "permission": "agendas.manage",
            "items": [
                {"section": "agendas", "label": "Manage Agendas", "permission": "agendas.manage"},
                {"section": "backlog", "label": "Todos & Backlog", "permission": "agendas.manage", "badge": "backlog"},
                {"section": "preferences-agenda", "label": "Agenda Preferences", "permission": "agendas.manage"},
            ],
        },
        {
            "id": "agenda-council",
            "label": "Agendas",
            "section_title": "Member",
            "permission": "agendas.submit",
            "items": [
                {"section": "finalized-agendas", "label": "Finalized Agendas", "permission": "agendas.submit"},
                {"section": "council", "label": "Propose Agenda Item", "permission": "agendas.submit"},
            ],
        },
    ],
    backup_tables=AGENDAS_BACKUP_TABLES,
)
