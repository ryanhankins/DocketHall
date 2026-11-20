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

"""Contracts, Resolutions & Document Repository module definition."""
from .. import records
from ..registry import CivicModule

RECORDS_BACKUP_TABLES: list[tuple[str, list[str], set[str], bool]] = [
    (
        "repository_documents",
        [
            "id", "doc_number", "category", "title", "counterparty",
            "effective_date", "expiration_date", "renewal_notice_days",
            "auto_unpublish_on_expire", "status", "tags", "notes", "is_public", "created_by",
            "created_at", "updated_at",
        ],
        set(),
        True,
    ),
    (
        "repository_files",
        [
            "id", "document_id", "title", "filename", "content_type",
            "size_bytes", "sha256", "object_key", "uploaded_by", "created_at",
        ],
        set(),
        True,
    ),
    (
        "public_records_requests",
        [
            "id", "request_number", "requester_name", "requester_email", "requester_phone",
            "subject", "description", "department", "status", "due_date", "assigned_to",
            "fee_estimate", "response_notes", "fulfilled_at", "created_at", "updated_at",
        ],
        set(),
        True,
    ),
]

MODULE = CivicModule(
    id="records",
    name="Contracts & Document Repository",
    description="Searchable archive of contracts, resolutions, easements, and insurance certificates with expiration tracking.",
    routers=[records.router],
    bootstrap=records.bootstrap,
    permissions=[
        {"key": "records.manage", "label": "Manage Contracts, Resolutions & Document Repository"},
        {"key": "records.view", "label": "View Internal Contracts & Document Repository"},
    ],
    nav_groups=[
        {
            "id": "records-staff",
            "label": "Document Repository",
            "section_title": "Staff",
            "permission": "records.view",
            "items": [
                {"section": "records-repo", "label": "Contracts & Resolutions", "permission": "records.view"},
            ],
        },
    ],
    backup_tables=RECORDS_BACKUP_TABLES,
)
