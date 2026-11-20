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

"""City Calendar & Facility Reservations module definition."""
from .. import calendar_mod
from ..registry import CivicModule

CALENDAR_BACKUP_TABLES: list[tuple[str, list[str], set[str], bool]] = [
    (
        "reservable_facilities",
        ["id", "name", "description", "daily_fee", "hourly_fee", "deposit_amount", "capacity", "rules", "is_active", "sort_order", "created_at"],
        set(),
        True,
    ),
    (
        "facility_reservations",
        [
            "id", "reservation_number", "facility_id", "facility_name", "event_date",
            "rental_mode", "start_time", "end_time",
            "event_title", "requester_name", "requester_email", "requester_phone",
            "notes", "fee_amount", "payment_status", "status", "staff_notes",
            "reviewed_by", "created_at", "updated_at",
        ],
        set(),
        True,
    ),
    (
        "calendar_events",
        ["id", "title", "event_date", "start_time", "end_time", "location", "category", "description", "is_public", "created_by", "created_at"],
        set(),
        True,
    ),
]

MODULE = CivicModule(
    id="calendar",
    name="City Calendar & Rentals",
    description="Public community calendar synced with council meetings, plus configurable municipal facility reservations.",
    routers=[calendar_mod.router],
    bootstrap=calendar_mod.bootstrap,
    permissions=[
        {"key": "calendar.manage", "label": "Manage City Calendar, Events & Facility Reservations"},
    ],
    features=[
        {"key": "reservations", "label": "Municipal Facility Reservations", "description": "Allow residents to book pavilions/halls online with optional fee collection.", "default": True},
    ],
    nav_groups=[
        {
            "id": "calendar-staff",
            "label": "Calendar & Rentals",
            "section_title": "Staff",
            "permission": "calendar.manage",
            "items": [
                {"section": "calendar-manage", "label": "Reservations & Events", "permission": "calendar.manage"},
                {"section": "preferences-calendar", "label": "Calendar & Rental Settings", "permission": "calendar.manage"},
            ],
        },
    ],
    backup_tables=CALENDAR_BACKUP_TABLES,
)
