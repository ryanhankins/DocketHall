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

"""Extended AI Assistant tool declarations and handlers covering all DocketHall modules."""
from __future__ import annotations

from datetime import date, datetime, timezone


EXT_TOOL_DECLARATIONS: list[dict] = [
    # --- Agendas & Legislative ---
    {
        "name": "delete_agenda_item",
        "description": "Remove an item from an in-progress agenda by agenda_id and item_id.",
        "parameters": {
            "type": "OBJECT",
            "properties": {
                "agenda_id": {"type": "INTEGER", "description": "Agenda ID"},
                "item_id": {"type": "INTEGER", "description": "Agenda item ID"},
            },
            "required": ["agenda_id", "item_id"],
        },
    },
    {
        "name": "update_todo",
        "description": "Update an agenda backlog todo item (title, todo_status, assigned_to, due_date, notes).",
        "parameters": {
            "type": "OBJECT",
            "properties": {
                "todo_id": {"type": "INTEGER", "description": "Backlog todo item ID"},
                "title": {"type": "STRING", "description": "Updated title"},
                "todo_status": {"type": "STRING", "description": "Status: 'open', 'in_progress', or 'done'"},
                "assigned_to": {"type": "STRING", "description": "Assigned username"},
                "due_date": {"type": "STRING", "description": "Due date YYYY-MM-DD"},
                "notes": {"type": "STRING", "description": "Updated notes"},
            },
            "required": ["todo_id"],
        },
    },
    {
        "name": "assign_todo_to_agenda",
        "description": "Assign a backlog todo item onto a specific agenda.",
        "parameters": {
            "type": "OBJECT",
            "properties": {
                "todo_id": {"type": "INTEGER", "description": "Backlog todo item ID"},
                "agenda_id": {"type": "INTEGER", "description": "Target agenda ID"},
                "section_name": {"type": "STRING", "description": "Agenda section (default 'New Business')"},
            },
            "required": ["todo_id", "agenda_id"],
        },
    },
    {
        "name": "list_council_submissions",
        "description": "List council/staff agenda item submissions (pending, accepted, or declined).",
        "parameters": {
            "type": "OBJECT",
            "properties": {
                "status": {"type": "STRING", "description": "Optional status filter: 'pending', 'accepted', or 'declined'"},
                "limit": {"type": "INTEGER", "description": "Max items (default 12)"},
            },
        },
    },
    {
        "name": "decide_council_submission",
        "description": "Accept a council submission onto an agenda or decline it.",
        "parameters": {
            "type": "OBJECT",
            "properties": {
                "submission_id": {"type": "INTEGER", "description": "Submission ID"},
                "decision": {"type": "STRING", "description": "'accept' or 'decline'"},
                "agenda_id": {"type": "INTEGER", "description": "Required when decision is 'accept'"},
                "review_note": {"type": "STRING", "description": "Optional review note"},
            },
            "required": ["submission_id", "decision"],
        },
    },
    {
        "name": "archive_item_to_records",
        "description": "Archive an agenda item (and its attachments) into the Public Records repository.",
        "parameters": {
            "type": "OBJECT",
            "properties": {
                "agenda_id": {"type": "INTEGER", "description": "Agenda ID"},
                "item_id": {"type": "INTEGER", "description": "Agenda item ID"},
                "category": {"type": "STRING", "description": "Record category (e.g. 'Resolution', 'Ordinance', 'Minutes')"},
            },
            "required": ["agenda_id", "item_id"],
        },
    },
    # --- Permits, Inspections, Parcels, Contractors & Compliance ---
    {
        "name": "update_inspection",
        "description": "Record an inspection result (pass, fail, cancelled, scheduled) or reschedule an inspection.",
        "parameters": {
            "type": "OBJECT",
            "properties": {
                "inspection_id": {"type": "INTEGER", "description": "Inspection ID from list_inspections"},
                "result": {"type": "STRING", "description": "Result: 'scheduled', 'pass', 'fail', or 'cancelled'"},
                "inspector": {"type": "STRING", "description": "Inspector name"},
                "scheduled_date": {"type": "STRING", "description": "Optional rescheduled date YYYY-MM-DD"},
                "notes": {"type": "STRING", "description": "Inspection findings or notes"},
            },
            "required": ["inspection_id"],
        },
    },
    {
        "name": "add_permit_fee",
        "description": "Add a fee or payment entry to a permit.",
        "parameters": {
            "type": "OBJECT",
            "properties": {
                "permit_number": {"type": "STRING", "description": "Permit number (e.g. 'PRM-2026-0001')"},
                "description": {"type": "STRING", "description": "Fee description"},
                "amount_dollars": {"type": "NUMBER", "description": "Amount in USD (e.g. 75.00)"},
                "entry_type": {"type": "STRING", "description": "'fee', 'payment', or 'adjustment' (default 'fee')"},
                "notes": {"type": "STRING", "description": "Optional notes"},
            },
            "required": ["permit_number", "description", "amount_dollars"],
        },
    },
    {
        "name": "send_permit_message",
        "description": "Post a staff comment or message on a permit application.",
        "parameters": {
            "type": "OBJECT",
            "properties": {
                "permit_number": {"type": "STRING", "description": "Permit number"},
                "body": {"type": "STRING", "description": "Message text"},
                "is_internal": {"type": "BOOLEAN", "description": "True for internal staff-only note, false for applicant-visible (default false)"},
            },
            "required": ["permit_number", "body"],
        },
    },
    {
        "name": "push_permit_to_agenda",
        "description": "Push a permit or variance application onto a meeting agenda for council/board review.",
        "parameters": {
            "type": "OBJECT",
            "properties": {
                "permit_number": {"type": "STRING", "description": "Permit number"},
                "agenda_id": {"type": "INTEGER", "description": "Target agenda ID"},
                "section_name": {"type": "STRING", "description": "Agenda section (default 'New Business')"},
            },
            "required": ["permit_number", "agenda_id"],
        },
    },
    {
        "name": "list_parcels",
        "description": "List or search municipal property parcels (address, parcel ID, owner, zoning).",
        "parameters": {
            "type": "OBJECT",
            "properties": {
                "search": {"type": "STRING", "description": "Optional address, parcel_id, or owner search"},
                "limit": {"type": "INTEGER", "description": "Max parcels (default 15)"},
            },
        },
    },
    {
        "name": "create_parcel",
        "description": "Add a property parcel record to the municipal parcel registry.",
        "parameters": {
            "type": "OBJECT",
            "properties": {
                "parcel_id": {"type": "STRING", "description": "Parcel / APN identifier"},
                "address": {"type": "STRING", "description": "Street address"},
                "owner_name": {"type": "STRING", "description": "Property owner name"},
                "zoning_district": {"type": "STRING", "description": "Zoning district (e.g. 'R-1')"},
                "notes": {"type": "STRING", "description": "Optional notes"},
            },
            "required": ["parcel_id", "address"],
        },
    },
    {
        "name": "update_contractor_license",
        "description": "Update a contractor license (status, email, phone, license_type).",
        "parameters": {
            "type": "OBJECT",
            "properties": {
                "contractor_id": {"type": "INTEGER", "description": "Contractor ID"},
                "license_number": {"type": "STRING", "description": "License number if contractor_id is unknown"},
                "status": {"type": "STRING", "description": "Status: 'active', 'suspended', 'expired', or 'revoked'"},
                "email": {"type": "STRING", "description": "Updated email"},
                "phone": {"type": "STRING", "description": "Updated phone"},
            },
        },
    },
    {
        "name": "create_compliance_program",
        "description": "Register a recurring compliance inspection program (e.g. Rental, Fire, Health).",
        "parameters": {
            "type": "OBJECT",
            "properties": {
                "program_type": {"type": "STRING", "description": "Program type (e.g. 'Rental Housing', 'Fire Safety', 'Health')"},
                "property_address": {"type": "STRING", "description": "Property address"},
                "owner_name": {"type": "STRING", "description": "Owner name"},
                "cycle_months": {"type": "INTEGER", "description": "Inspection cycle in months (default 12)"},
                "next_inspection_date": {"type": "STRING", "description": "Next inspection YYYY-MM-DD"},
                "notes": {"type": "STRING", "description": "Optional notes"},
            },
            "required": ["program_type", "property_address"],
        },
    },
    {
        "name": "record_compliance_inspection",
        "description": "Record an inspection outcome on a recurring compliance program.",
        "parameters": {
            "type": "OBJECT",
            "properties": {
                "program_id": {"type": "INTEGER", "description": "Compliance program ID"},
                "result": {"type": "STRING", "description": "Result: 'pass' or 'fail'"},
                "inspector": {"type": "STRING", "description": "Inspector name"},
                "notes": {"type": "STRING", "description": "Inspection notes"},
            },
            "required": ["program_id", "result"],
        },
    },
    # --- Complaints & 311 Work Orders ---
    {
        "name": "update_complaint",
        "description": "Update a code-enforcement complaint (status, assigned_to, enforcement_stage, investigation_report, final_resolution).",
        "parameters": {
            "type": "OBJECT",
            "properties": {
                "complaint_number": {"type": "STRING", "description": "Complaint number (e.g. 'CMP-2026-0001')"},
                "status": {"type": "STRING", "description": "Status: 'submitted', 'under_review', 'investigating', 'nov_issued', 'resolved', or 'closed'"},
                "assigned_to": {"type": "STRING", "description": "Assigned staff username"},
                "enforcement_stage": {"type": "STRING", "description": "Optional enforcement stage"},
                "investigation_report": {"type": "STRING", "description": "Investigation findings"},
                "final_resolution": {"type": "STRING", "description": "Final resolution summary"},
            },
            "required": ["complaint_number"],
        },
    },
    {
        "name": "update_work_order",
        "description": "Update a 311 / Public Works work order (status, priority, assigned_crew, completion_notes).",
        "parameters": {
            "type": "OBJECT",
            "properties": {
                "work_order_number": {"type": "STRING", "description": "Work order number (e.g. 'WO-2026-0001')"},
                "status": {"type": "STRING", "description": "Status: 'open', 'in_progress', 'completed', or 'cancelled'"},
                "priority": {"type": "STRING", "description": "Priority: 'low', 'normal', 'high', or 'urgent'"},
                "assigned_crew": {"type": "STRING", "description": "Assigned crew or technician"},
                "completion_notes": {"type": "STRING", "description": "Work or completion notes"},
            },
            "required": ["work_order_number"],
        },
    },
    # --- Public Records & FOIA ---
    {
        "name": "update_foia_request",
        "description": "Update a Public Records / FOIA request (status, assigned_to, response_notes, estimated_fee).",
        "parameters": {
            "type": "OBJECT",
            "properties": {
                "request_number": {"type": "STRING", "description": "FOIA request number (e.g. 'FOIA-2026-0001')"},
                "status": {"type": "STRING", "description": "Status: 'submitted', 'in_review', 'fulfilled', or 'denied'"},
                "assigned_to": {"type": "STRING", "description": "Assigned staff username"},
                "response_notes": {"type": "STRING", "description": "Response or fulfillment notes"},
                "estimated_fee": {"type": "STRING", "description": "Optional estimated fee (e.g. '$0.00')"},
            },
            "required": ["request_number"],
        },
    },
    {
        "name": "update_public_record",
        "description": "Update an existing Public Records repository document (title, category, is_public, notes).",
        "parameters": {
            "type": "OBJECT",
            "properties": {
                "doc_id": {"type": "INTEGER", "description": "Repository document ID"},
                "title": {"type": "STRING", "description": "Updated title"},
                "category": {"type": "STRING", "description": "Updated category"},
                "is_public": {"type": "BOOLEAN", "description": "Whether publicly visible"},
                "notes": {"type": "STRING", "description": "Updated notes"},
            },
            "required": ["doc_id"],
        },
    },
    # --- Codification ---
    {
        "name": "create_code_chapter",
        "description": "Create a new Municipal City Code chapter/title.",
        "parameters": {
            "type": "OBJECT",
            "properties": {
                "code_prefix": {"type": "STRING", "description": "Chapter/Title prefix (e.g. 'Title 6' or 'Ch. 12')"},
                "title": {"type": "STRING", "description": "Chapter title"},
                "description": {"type": "STRING", "description": "Optional chapter description"},
                "is_published": {"type": "BOOLEAN", "description": "Publish publicly (default true)"},
            },
            "required": ["code_prefix", "title"],
        },
    },
    {
        "name": "create_code_section",
        "description": "Create a new Municipal City Code section inside a chapter.",
        "parameters": {
            "type": "OBJECT",
            "properties": {
                "chapter_id": {"type": "INTEGER", "description": "Chapter ID"},
                "section_number": {"type": "STRING", "description": "Section number (e.g. '6.04.010')"},
                "title": {"type": "STRING", "description": "Section title"},
                "body": {"type": "STRING", "description": "Section legal text"},
                "summary": {"type": "STRING", "description": "Plain-language summary"},
                "ordinance_ref": {"type": "STRING", "description": "Adopting ordinance reference"},
                "is_published": {"type": "BOOLEAN", "description": "Publish publicly (default true)"},
            },
            "required": ["chapter_id", "section_number", "title", "body"],
        },
    },
    {
        "name": "update_code_section",
        "description": "Amend or update an existing Municipal City Code section.",
        "parameters": {
            "type": "OBJECT",
            "properties": {
                "section_id": {"type": "INTEGER", "description": "Code section ID"},
                "section_number": {"type": "STRING", "description": "Section number if section_id is unknown"},
                "title": {"type": "STRING", "description": "Updated title"},
                "body": {"type": "STRING", "description": "Updated legal text"},
                "summary": {"type": "STRING", "description": "Updated summary"},
                "ordinance_ref": {"type": "STRING", "description": "Amending ordinance reference"},
                "is_published": {"type": "BOOLEAN", "description": "Publish or unpublish"},
            },
        },
    },
    # --- Calendar & Reservations ---
    {
        "name": "update_calendar_event",
        "description": "Update an existing municipal calendar event by event_id.",
        "parameters": {
            "type": "OBJECT",
            "properties": {
                "event_id": {"type": "INTEGER", "description": "Calendar event ID"},
                "title": {"type": "STRING", "description": "Updated title"},
                "event_date": {"type": "STRING", "description": "Updated date YYYY-MM-DD"},
                "start_time": {"type": "STRING", "description": "Updated start time"},
                "location": {"type": "STRING", "description": "Updated location"},
                "description": {"type": "STRING", "description": "Updated description"},
                "is_public": {"type": "BOOLEAN", "description": "Public visibility"},
            },
            "required": ["event_id"],
        },
    },
    {
        "name": "delete_calendar_event",
        "description": "Delete a municipal calendar event by event_id.",
        "parameters": {
            "type": "OBJECT",
            "properties": {
                "event_id": {"type": "INTEGER", "description": "Calendar event ID"},
            },
            "required": ["event_id"],
        },
    },
    {
        "name": "decide_facility_reservation",
        "description": "Approve, deny, or cancel a facility reservation request.",
        "parameters": {
            "type": "OBJECT",
            "properties": {
                "reservation_id": {"type": "INTEGER", "description": "Reservation ID"},
                "status": {"type": "STRING", "description": "'approved', 'denied', or 'cancelled'"},
                "staff_notes": {"type": "STRING", "description": "Optional staff notes"},
            },
            "required": ["reservation_id", "status"],
        },
    },
    # --- Communications: Directory, FAQs, Form Submissions ---
    {
        "name": "update_directory_entry",
        "description": "Update a City Directory contact (staff, department, or official).",
        "parameters": {
            "type": "OBJECT",
            "properties": {
                "entry_id": {"type": "INTEGER", "description": "Directory entry ID"},
                "name_match": {"type": "STRING", "description": "Contact name if entry_id is unknown"},
                "title_role": {"type": "STRING", "description": "Updated title/role"},
                "department": {"type": "STRING", "description": "Updated department"},
                "email": {"type": "STRING", "description": "Updated email"},
                "phone": {"type": "STRING", "description": "Updated phone"},
                "office_hours": {"type": "STRING", "description": "Updated office hours"},
                "is_public": {"type": "BOOLEAN", "description": "Public visibility"},
            },
        },
    },
    {
        "name": "list_faqs",
        "description": "List or search City Frequently Asked Questions.",
        "parameters": {
            "type": "OBJECT",
            "properties": {
                "search": {"type": "STRING", "description": "Optional keyword"},
                "limit": {"type": "INTEGER", "description": "Max FAQs (default 15)"},
            },
        },
    },
    {
        "name": "update_faq",
        "description": "Update an existing City FAQ by faq_id.",
        "parameters": {
            "type": "OBJECT",
            "properties": {
                "faq_id": {"type": "INTEGER", "description": "FAQ ID"},
                "question": {"type": "STRING", "description": "Updated question"},
                "answer": {"type": "STRING", "description": "Updated answer"},
                "category": {"type": "STRING", "description": "Updated category"},
                "is_public": {"type": "BOOLEAN", "description": "Public visibility"},
            },
            "required": ["faq_id"],
        },
    },
    {
        "name": "list_form_submissions",
        "description": "List citizen submissions for a City Form or Poll.",
        "parameters": {
            "type": "OBJECT",
            "properties": {
                "form_id": {"type": "INTEGER", "description": "Form ID from list_forms"},
                "limit": {"type": "INTEGER", "description": "Max submissions (default 15)"},
            },
            "required": ["form_id"],
        },
    },
    # --- Utility Billing & Municipal Citations ---
    {
        "name": "record_bill_payment",
        "description": "Record an offline/check/cash/card payment on a utility bill or citation.",
        "parameters": {
            "type": "OBJECT",
            "properties": {
                "reference_number": {"type": "STRING", "description": "Bill or citation reference number (e.g. 'UTL-2026-0001' or 'CIT-2026-0001')"},
                "amount_paid": {"type": "STRING", "description": "Amount paid (e.g. '85.50')"},
                "payment_method": {"type": "STRING", "description": "Method: 'check', 'cash', 'ach', or 'card' (default 'check')"},
                "payment_ref": {"type": "STRING", "description": "Check number or receipt reference"},
                "notes": {"type": "STRING", "description": "Optional payment notes"},
            },
            "required": ["reference_number", "amount_paid"],
        },
    },
    {
        "name": "update_bill",
        "description": "Update a utility bill or citation (amount_due, due_date, dispute_status, notes).",
        "parameters": {
            "type": "OBJECT",
            "properties": {
                "reference_number": {"type": "STRING", "description": "Bill or citation reference number"},
                "amount_due": {"type": "STRING", "description": "Updated amount due"},
                "due_date": {"type": "STRING", "description": "Updated due date YYYY-MM-DD"},
                "dispute_status": {"type": "STRING", "description": "Dispute status: 'none', 'contested', 'upheld', or 'waived'"},
                "notes": {"type": "STRING", "description": "Updated notes"},
            },
            "required": ["reference_number"],
        },
    },
    # --- Admin: Users & Audit ---
    {
        "name": "list_users",
        "description": "List DocketHall user accounts (admin only).",
        "parameters": {
            "type": "OBJECT",
            "properties": {
                "limit": {"type": "INTEGER", "description": "Max users (default 25)"},
            },
        },
    },
    {
        "name": "update_user_role",
        "description": "Update a user's role or active status (admin only).",
        "parameters": {
            "type": "OBJECT",
            "properties": {
                "username": {"type": "STRING", "description": "Username to update"},
                "role": {"type": "STRING", "description": "Role: 'admin', 'admin_staff', 'read_only', or 'applicant'"},
                "is_active": {"type": "BOOLEAN", "description": "True to enable, False to disable"},
            },
            "required": ["username"],
        },
    },
    {
        "name": "list_audit_log",
        "description": "View recent entries from the DocketHall admin audit log.",
        "parameters": {
            "type": "OBJECT",
            "properties": {
                "action_filter": {"type": "STRING", "description": "Optional action keyword filter"},
                "limit": {"type": "INTEGER", "description": "Max entries (default 20)"},
            },
        },
    },
]

EXT_TOOL_ACCESS: dict[str, tuple[str | None, tuple[str, ...]]] = {
    "delete_agenda_item": ("agendas", ("agendas.manage",)),
    "update_todo": ("agendas", ("agendas.manage",)),
    "assign_todo_to_agenda": ("agendas", ("agendas.manage",)),
    "list_council_submissions": ("agendas", ("agendas.manage", "agendas.submit")),
    "decide_council_submission": ("agendas", ("agendas.manage",)),
    "archive_item_to_records": ("agendas", ("agendas.manage",)),
    "update_inspection": ("permits", ("permits.manage",)),
    "add_permit_fee": ("permits", ("permits.manage",)),
    "send_permit_message": ("permits", ("permits.manage",)),
    "push_permit_to_agenda": ("permits", ("permits.manage",)),
    "list_parcels": ("permits", ("permits.manage",)),
    "create_parcel": ("permits", ("permits.manage",)),
    "update_contractor_license": ("licensing", ("licensing.manage",)),
    "create_compliance_program": ("licensing", ("licensing.manage",)),
    "record_compliance_inspection": ("licensing", ("licensing.manage",)),
    "update_complaint": ("complaints", ("complaints.manage",)),
    "update_work_order": ("complaints", ("complaints.manage",)),
    "update_foia_request": ("records", ("records.manage",)),
    "update_public_record": ("records", ("records.manage",)),
    "create_code_chapter": ("codification", ("codification.manage",)),
    "create_code_section": ("codification", ("codification.manage",)),
    "update_code_section": ("codification", ("codification.manage",)),
    "update_calendar_event": ("calendar", ("calendar.manage",)),
    "delete_calendar_event": ("calendar", ("calendar.manage",)),
    "decide_facility_reservation": ("calendar", ("calendar.manage",)),
    "update_directory_entry": ("communications", ("directory.manage",)),
    "list_faqs": ("communications", ()),
    "update_faq": ("communications", ("directory.manage",)),
    "list_form_submissions": ("communications", ("forms.manage",)),
    "record_bill_payment": ("utilities", ("utilities.manage", "citations.manage")),
    "update_bill": ("utilities", ("utilities.manage", "citations.manage")),
    "list_users": (None, ("__admin__",)),
    "update_user_role": (None, ("__admin__",)),
    "list_audit_log": (None, ("__admin__",)),
}

EXT_READ_ONLY_TOOLS: set[str] = {
    "list_council_submissions",
    "list_parcels",
    "list_faqs",
    "list_form_submissions",
    "list_users",
    "list_audit_log",
}


def describe_ext_action(name: str, args: dict) -> str | None:
    a = args or {}
    descriptions = {
        "delete_agenda_item": lambda: f"Delete agenda item #{a.get('item_id', '')} from agenda #{a.get('agenda_id', '')}",
        "update_todo": lambda: f"Update backlog todo #{a.get('todo_id', '')}",
        "assign_todo_to_agenda": lambda: f"Assign todo #{a.get('todo_id', '')} to agenda #{a.get('agenda_id', '')}",
        "decide_council_submission": lambda: f"{str(a.get('decision', 'review')).capitalize()} council submission #{a.get('submission_id', '')}",
        "archive_item_to_records": lambda: f"Archive agenda #{a.get('agenda_id', '')} item #{a.get('item_id', '')} to Public Records",
        "update_inspection": lambda: f"Update inspection #{a.get('inspection_id', '')}" + (f" ({a['result']})" if a.get("result") else ""),
        "add_permit_fee": lambda: f"Add ${a.get('amount_dollars', '')} {a.get('entry_type', 'fee')} to permit {a.get('permit_number', '')}",
        "send_permit_message": lambda: f"Post message on permit {a.get('permit_number', '')}",
        "push_permit_to_agenda": lambda: f"Push permit {a.get('permit_number', '')} to agenda #{a.get('agenda_id', '')}",
        "create_parcel": lambda: f"Add parcel {a.get('parcel_id', '')} ({a.get('address', '')})",
        "update_contractor_license": lambda: f"Update contractor license {a.get('license_number') or '#' + str(a.get('contractor_id', ''))}",
        "create_compliance_program": lambda: f"Create {a.get('program_type', 'compliance')} program at {a.get('property_address', '')}",
        "record_compliance_inspection": lambda: f"Record {a.get('result', '')} inspection on compliance program #{a.get('program_id', '')}",
        "update_complaint": lambda: f"Update complaint {a.get('complaint_number', '')}",
        "update_work_order": lambda: f"Update work order {a.get('work_order_number', '')}",
        "update_foia_request": lambda: f"Update FOIA request {a.get('request_number', '')}",
        "update_public_record": lambda: f"Update public record #{a.get('doc_id', '')}",
        "create_code_chapter": lambda: f"Create code chapter {a.get('code_prefix', '')}: {a.get('title', '')}",
        "create_code_section": lambda: f"Create code section {a.get('section_number', '')}: {a.get('title', '')}",
        "update_code_section": lambda: f"Update code section {a.get('section_number') or '#' + str(a.get('section_id', ''))}",
        "update_calendar_event": lambda: f"Update calendar event #{a.get('event_id', '')}",
        "delete_calendar_event": lambda: f"Delete calendar event #{a.get('event_id', '')}",
        "decide_facility_reservation": lambda: f"Set reservation #{a.get('reservation_id', '')} to '{a.get('status', '')}'",
        "update_directory_entry": lambda: f"Update directory contact {a.get('name_match') or '#' + str(a.get('entry_id', ''))}",
        "update_faq": lambda: f"Update FAQ #{a.get('faq_id', '')}",
        "record_bill_payment": lambda: f"Record ${a.get('amount_paid', '')} payment on {a.get('reference_number', '')}",
        "update_bill": lambda: f"Update bill/citation {a.get('reference_number', '')}",
        "update_user_role": lambda: f"Update user '{a.get('username', '')}'",
    }
    fn = descriptions.get(name)
    return fn() if fn else None


def execute_ext_tool(conn, name: str, args: dict, user: dict) -> tuple[dict, dict | None] | None:
    """Handle extended DocketHall tools; return None if `name` is not handled here."""
    username = user["username"]

    if name == "delete_agenda_item":
        ag_id, item_id = int(args["agenda_id"]), int(args["item_id"])
        row = conn.execute(
            "DELETE FROM agenda_items WHERE id = %s AND agenda_id = %s RETURNING title",
            (item_id, ag_id),
        ).fetchone()
        if not row:
            return {"ok": False, "error": f"Item #{item_id} not found on agenda #{ag_id}"}, None
        return (
            {"ok": True, "agenda_id": ag_id, "deleted_item_id": item_id},
            {"tool": name, "summary": f"Deleted item '{row[0]}' from agenda #{ag_id}", "route": f"/app/agendas/{ag_id}"},
        )

    if name == "update_todo":
        tid = int(args["todo_id"])
        sets, params = [], []
        for k, col in [("title", "title"), ("todo_status", "todo_status"), ("assigned_to", "assigned_to"), ("notes", "description")]:
            if args.get(k) is not None:
                sets.append(f"{col} = %s")
                params.append(str(args[k]).strip())
        if args.get("due_date"):
            sets.append("target_date = %s")
            params.append(date.fromisoformat(str(args["due_date"]).strip()))
        if not sets:
            return {"ok": False, "error": "No fields provided to update"}, None
        params.append(tid)
        row = conn.execute(
            f"UPDATE agenda_items SET {', '.join(sets)} WHERE id = %s AND agenda_id IS NULL RETURNING id, title, todo_status",
            tuple(params),
        ).fetchone()
        if not row:
            return {"ok": False, "error": f"Backlog todo #{tid} not found"}, None
        return (
            {"ok": True, "todo_id": row[0], "title": row[1], "todo_status": row[2]},
            {"tool": name, "summary": f"Updated todo '{row[1]}' ({row[2]})", "route": "/app/backlog"},
        )

    if name == "assign_todo_to_agenda":
        tid, ag_id = int(args["todo_id"]), int(args["agenda_id"])
        sec = str(args.get("section_name") or "New Business").strip() or "New Business"
        if not conn.execute("SELECT 1 FROM agendas WHERE id = %s", (ag_id,)).fetchone():
            return {"ok": False, "error": f"Agenda #{ag_id} not found"}, None
        next_pos = conn.execute("SELECT COALESCE(MAX(position), 0) + 1 FROM agenda_items WHERE agenda_id = %s", (ag_id,)).fetchone()[0]
        row = conn.execute(
            "UPDATE agenda_items SET agenda_id = %s, section = %s, position = %s WHERE id = %s AND agenda_id IS NULL RETURNING id, title",
            (ag_id, sec, next_pos, tid),
        ).fetchone()
        if not row:
            return {"ok": False, "error": f"Backlog todo #{tid} not found"}, None
        return (
            {"ok": True, "item_id": row[0], "agenda_id": ag_id, "title": row[1]},
            {"tool": name, "summary": f"Assigned '{row[1]}' to agenda #{ag_id}", "route": f"/app/agendas/{ag_id}"},
        )

    if name == "list_council_submissions":
        lim = max(1, min(int(args.get("limit") or 12), 25))
        st = str(args.get("status") or "").strip().lower()
        if st:
            rows = conn.execute(
                "SELECT id, title, section, submitted_username, status, target_date FROM council_submissions WHERE status = %s ORDER BY id DESC LIMIT %s",
                (st, lim),
            ).fetchall()
        else:
            rows = conn.execute(
                "SELECT id, title, section, submitted_username, status, target_date FROM council_submissions ORDER BY id DESC LIMIT %s",
                (lim,),
            ).fetchall()
        return (
            {"ok": True, "submissions": [{"id": r[0], "title": r[1], "section": r[2], "submitted_by": r[3], "status": r[4], "target_date": r[5].isoformat() if r[5] else None} for r in rows]},
            None,
        )

    if name == "decide_council_submission":
        sid = int(args["submission_id"])
        dec = str(args["decision"]).strip().lower()
        note = str(args.get("review_note") or "").strip()
        sub = conn.execute("SELECT id, title, description, section, recommended_motion, fiscal_impact, status FROM council_submissions WHERE id = %s", (sid,)).fetchone()
        if not sub:
            return {"ok": False, "error": f"Submission #{sid} not found"}, None
        if dec == "decline":
            conn.execute(
                "UPDATE council_submissions SET status = 'declined', reviewed_by = %s, reviewed_username = %s, review_note = %s, reviewed_at = now() WHERE id = %s",
                (user["id"], username, note, sid),
            )
            return (
                {"ok": True, "submission_id": sid, "status": "declined"},
                {"tool": name, "summary": f"Declined submission '{sub[1]}'", "route": "/app/council"},
            )
        ag_id = int(args["agenda_id"])
        if not conn.execute("SELECT 1 FROM agendas WHERE id = %s", (ag_id,)).fetchone():
            return {"ok": False, "error": f"Agenda #{ag_id} not found"}, None
        next_pos = conn.execute("SELECT COALESCE(MAX(position), 0) + 1 FROM agenda_items WHERE agenda_id = %s", (ag_id,)).fetchone()[0]
        it = conn.execute(
            "INSERT INTO agenda_items (agenda_id, position, section, title, description, recommended_motion, fiscal_impact) "
            "VALUES (%s, %s, %s, %s, %s, %s, %s) RETURNING id",
            (ag_id, next_pos, sub[3] or "New Business", sub[1], sub[2], sub[4], sub[5]),
        ).fetchone()
        conn.execute(
            "UPDATE council_submissions SET status = 'accepted', accepted_agenda_id = %s, accepted_item_id = %s, reviewed_by = %s, reviewed_username = %s, review_note = %s, reviewed_at = now() WHERE id = %s",
            (ag_id, it[0], user["id"], username, note, sid),
        )
        return (
            {"ok": True, "submission_id": sid, "status": "accepted", "agenda_id": ag_id, "item_id": it[0]},
            {"tool": name, "summary": f"Accepted submission '{sub[1]}' onto agenda #{ag_id}", "route": f"/app/agendas/{ag_id}"},
        )

    if name == "archive_item_to_records":
        ag_id, item_id = int(args["agenda_id"]), int(args["item_id"])
        cat = str(args.get("category") or "Resolution").strip()
        it = conn.execute("SELECT title, description FROM agenda_items WHERE id = %s AND agenda_id = %s", (item_id, ag_id)).fetchone()
        if not it:
            return {"ok": False, "error": f"Item #{item_id} not found on agenda #{ag_id}"}, None
        year = datetime.now(timezone.utc).year
        row = conn.execute(
            "INSERT INTO repository_documents (doc_number, category, title, notes, is_public, created_by) VALUES ('TEMP', %s, %s, %s, TRUE, %s) RETURNING id",
            (cat, it[0], it[1] or "", username),
        ).fetchone()
        dnum = f"DOC-{year}-{row[0]:04d}"
        conn.execute("UPDATE repository_documents SET doc_number = %s WHERE id = %s", (dnum, row[0]))
        return (
            {"ok": True, "doc_id": row[0], "doc_number": dnum, "title": it[0]},
            {"tool": name, "summary": f"Archived '{it[0]}' to Public Records ({dnum})", "route": "/app/records"},
        )

    if name == "update_inspection":
        iid = int(args["inspection_id"])
        sets, params = [], []
        if args.get("result"):
            res = str(args["result"]).strip().lower()
            sets.append("result = %s")
            params.append(res)
            if res in {"pass", "fail", "cancelled"}:
                sets.append("completed_at = now()")
        if args.get("inspector") is not None:
            sets.append("inspector = %s")
            params.append(str(args["inspector"]).strip())
        if args.get("scheduled_date"):
            sets.append("scheduled_date = %s")
            params.append(date.fromisoformat(str(args["scheduled_date"]).strip()))
        if args.get("notes") is not None:
            sets.append("notes = %s")
            params.append(str(args["notes"]).strip())
        if not sets:
            return {"ok": False, "error": "No fields provided"}, None
        params.append(iid)
        row = conn.execute(
            f"UPDATE permit_inspections SET {', '.join(sets)} WHERE id = %s RETURNING id, inspection_type, result",
            tuple(params),
        ).fetchone()
        if not row:
            return {"ok": False, "error": f"Inspection #{iid} not found"}, None
        return (
            {"ok": True, "inspection_id": row[0], "inspection_type": row[1], "result": row[2]},
            {"tool": name, "summary": f"Updated inspection #{row[0]} ({row[1]}: {row[2]})", "route": "/app/field-inspector"},
        )

    if name == "add_permit_fee":
        pnum = str(args["permit_number"]).strip()
        p = conn.execute("SELECT id FROM permits WHERE permit_number = %s", (pnum,)).fetchone()
        if not p:
            return {"ok": False, "error": f"Permit {pnum} not found"}, None
        cents = int(round(float(args["amount_dollars"]) * 100))
        etype = str(args.get("entry_type") or "fee").strip().lower()
        desc = str(args["description"]).strip()
        notes = str(args.get("notes") or "").strip()
        row = conn.execute(
            "INSERT INTO permit_fee_entries (permit_id, entry_type, description, amount_cents, recorded_by, notes) VALUES (%s, %s, %s, %s, %s, %s) RETURNING id",
            (p[0], etype, desc, cents, username, notes),
        ).fetchone()
        return (
            {"ok": True, "fee_entry_id": row[0], "permit_number": pnum, "amount_cents": cents},
            {"tool": name, "summary": f"Added ${cents / 100:.2f} {etype} to {pnum}", "route": "/app/permits-review"},
        )

    if name == "send_permit_message":
        pnum = str(args["permit_number"]).strip()
        p = conn.execute("SELECT id FROM permits WHERE permit_number = %s", (pnum,)).fetchone()
        if not p:
            return {"ok": False, "error": f"Permit {pnum} not found"}, None
        body_txt = str(args["body"]).strip()
        is_int = bool(args.get("is_internal", False))
        row = conn.execute(
            "INSERT INTO permit_messages (permit_id, sender_username, sender_role, is_internal, body) VALUES (%s, %s, %s, %s, %s) RETURNING id",
            (p[0], username, user.get("role", "admin_staff"), is_int, body_txt),
        ).fetchone()
        return (
            {"ok": True, "message_id": row[0], "permit_number": pnum},
            {"tool": name, "summary": f"Posted message on permit {pnum}", "route": "/app/permits-review"},
        )

    if name == "push_permit_to_agenda":
        pnum, ag_id = str(args["permit_number"]).strip(), int(args["agenda_id"])
        sec = str(args.get("section_name") or "New Business").strip() or "New Business"
        p = conn.execute("SELECT id, permit_type_name, property_address, applicant_name FROM permits WHERE permit_number = %s", (pnum,)).fetchone()
        if not p:
            return {"ok": False, "error": f"Permit {pnum} not found"}, None
        if not conn.execute("SELECT 1 FROM agendas WHERE id = %s", (ag_id,)).fetchone():
            return {"ok": False, "error": f"Agenda #{ag_id} not found"}, None
        next_pos = conn.execute("SELECT COALESCE(MAX(position), 0) + 1 FROM agenda_items WHERE agenda_id = %s", (ag_id,)).fetchone()[0]
        title = f"{pnum}: {p[1]} — {p[2]}"
        desc = f"Applicant: {p[3] or 'N/A'}\nProperty: {p[2] or 'N/A'}"
        it = conn.execute(
            "INSERT INTO agenda_items (agenda_id, position, section, title, description) VALUES (%s, %s, %s, %s, %s) RETURNING id",
            (ag_id, next_pos, sec, title, desc),
        ).fetchone()
        return (
            {"ok": True, "item_id": it[0], "agenda_id": ag_id, "permit_number": pnum},
            {"tool": name, "summary": f"Pushed {pnum} onto agenda #{ag_id}", "route": f"/app/agendas/{ag_id}"},
        )

    if name == "list_parcels":
        lim = max(1, min(int(args.get("limit") or 15), 30))
        q = str(args.get("search") or "").strip()
        if q:
            rows = conn.execute(
                "SELECT id, parcel_id, address, owner_name, zoning_district FROM permit_parcels "
                "WHERE parcel_id ILIKE %s OR address ILIKE %s OR owner_name ILIKE %s ORDER BY id DESC LIMIT %s",
                (f"%{q}%", f"%{q}%", f"%{q}%", lim),
            ).fetchall()
        else:
            rows = conn.execute(
                "SELECT id, parcel_id, address, owner_name, zoning_district FROM permit_parcels ORDER BY id DESC LIMIT %s",
                (lim,),
            ).fetchall()
        return (
            {"ok": True, "parcels": [{"id": r[0], "parcel_id": r[1], "address": r[2], "owner_name": r[3], "zoning_district": r[4]} for r in rows]},
            None,
        )

    if name == "create_parcel":
        pid_str = str(args["parcel_id"]).strip()
        addr = str(args["address"]).strip()
        owner = str(args.get("owner_name") or "").strip()
        zoning = str(args.get("zoning_district") or "").strip()
        notes = str(args.get("notes") or "").strip()
        row = conn.execute(
            "INSERT INTO permit_parcels (parcel_id, address, owner_name, zoning_district, notes) VALUES (%s, %s, %s, %s, %s) RETURNING id",
            (pid_str, addr, owner, zoning, notes),
        ).fetchone()
        return (
            {"ok": True, "id": row[0], "parcel_id": pid_str, "address": addr},
            {"tool": name, "summary": f"Added parcel {pid_str} ({addr})", "route": "/app/permits-review"},
        )

    if name == "update_contractor_license":
        cid = args.get("contractor_id")
        lnum = str(args.get("license_number") or "").strip()
        where = "id = %s" if cid is not None else "LOWER(license_number) = LOWER(%s)"
        key_val = int(cid) if cid is not None else lnum
        sets, params = [], []
        for k in ("status", "email", "phone"):
            if args.get(k) is not None:
                sets.append(f"{k} = %s")
                params.append(str(args[k]).strip())
        if not sets:
            return {"ok": False, "error": "No fields provided"}, None
        params.append(key_val)
        row = conn.execute(
            f"UPDATE contractor_licenses SET {', '.join(sets)} WHERE {where} RETURNING id, business_name, license_number, status",
            tuple(params),
        ).fetchone()
        if not row:
            return {"ok": False, "error": "Contractor license not found"}, None
        return (
            {"ok": True, "contractor_id": row[0], "business_name": row[1], "license_number": row[2], "status": row[3]},
            {"tool": name, "summary": f"Updated contractor {row[1]} ({row[3]})", "route": "/app/contractors"},
        )

    if name == "create_compliance_program":
        ptype = str(args["program_type"]).strip()
        addr = str(args["property_address"]).strip()
        owner = str(args.get("owner_name") or "").strip()
        cycle = max(1, int(args.get("cycle_months") or 12))
        next_dt = date.fromisoformat(str(args["next_inspection_date"]).strip()) if args.get("next_inspection_date") else None
        notes = str(args.get("notes") or "").strip()
        row = conn.execute(
            "INSERT INTO recurring_compliance_programs (program_type, property_address, owner_name, cycle_months, next_inspection_date, status, notes) "
            "VALUES (%s, %s, %s, %s, %s, 'active', %s) RETURNING id",
            (ptype, addr, owner, cycle, next_dt, notes),
        ).fetchone()
        return (
            {"ok": True, "program_id": row[0], "program_type": ptype, "property_address": addr},
            {"tool": name, "summary": f"Created {ptype} compliance program at {addr}", "route": "/app/compliance-programs"},
        )

    if name == "record_compliance_inspection":
        pid = int(args["program_id"])
        res = str(args["result"]).strip().lower()
        insp = str(args.get("inspector") or username).strip()
        notes = str(args.get("notes") or "").strip()
        row = conn.execute(
            "UPDATE recurring_compliance_programs SET last_inspected_date = CURRENT_DATE, last_result = %s, inspector = %s, "
            "notes = COALESCE(NULLIF(%s, ''), notes), updated_at = now() WHERE id = %s RETURNING id, program_type, property_address",
            (res, insp, notes, pid),
        ).fetchone()
        if not row:
            return {"ok": False, "error": f"Compliance program #{pid} not found"}, None
        return (
            {"ok": True, "program_id": row[0], "result": res},
            {"tool": name, "summary": f"Recorded {res} on {row[1]} ({row[2]})", "route": "/app/compliance-programs"},
        )

    if name == "update_complaint":
        cnum = str(args["complaint_number"]).strip()
        sets, params = ["updated_at = now()"], []
        for k in ("status", "assigned_to", "enforcement_stage", "investigation_report", "final_resolution"):
            if args.get(k) is not None:
                sets.append(f"{k} = %s")
                params.append(str(args[k]).strip())
        if args.get("status") in {"resolved", "closed"}:
            sets.append("resolved_at = now()")
        params.append(cnum)
        row = conn.execute(
            f"UPDATE complaints SET {', '.join(sets)} WHERE complaint_number = %s RETURNING id, complaint_number, status",
            tuple(params),
        ).fetchone()
        if not row:
            return {"ok": False, "error": f"Complaint {cnum} not found"}, None
        return (
            {"ok": True, "complaint_id": row[0], "complaint_number": row[1], "status": row[2]},
            {"tool": name, "summary": f"Updated complaint {row[1]} ({row[2]})", "route": "/app/complaints-manage"},
        )

    if name == "update_work_order":
        wnum = str(args["work_order_number"]).strip()
        sets, params = ["updated_at = now()"], []
        for k in ("status", "priority", "assigned_crew", "completion_notes"):
            if args.get(k) is not None:
                sets.append(f"{k} = %s")
                params.append(str(args[k]).strip())
        if args.get("status") == "completed":
            sets.append("completed_at = now()")
        params.append(wnum)
        row = conn.execute(
            f"UPDATE public_works_orders SET {', '.join(sets)} WHERE work_order_number = %s RETURNING id, work_order_number, status",
            tuple(params),
        ).fetchone()
        if not row:
            return {"ok": False, "error": f"Work order {wnum} not found"}, None
        return (
            {"ok": True, "work_order_id": row[0], "work_order_number": row[1], "status": row[2]},
            {"tool": name, "summary": f"Updated work order {row[1]} ({row[2]})", "route": "/app/complaints-manage"},
        )

    if name == "update_foia_request":
        rnum = str(args["request_number"]).strip()
        sets, params = ["updated_at = now()"], []
        for k in ("status", "assigned_to", "response_notes", "estimated_fee"):
            if args.get(k) is not None:
                sets.append(f"{k} = %s")
                params.append(str(args[k]).strip())
        if args.get("status") in {"fulfilled", "denied"}:
            sets.append("fulfilled_at = now()")
        params.append(rnum)
        row = conn.execute(
            f"UPDATE public_records_requests SET {', '.join(sets)} WHERE request_number = %s RETURNING id, request_number, status",
            tuple(params),
        ).fetchone()
        if not row:
            return {"ok": False, "error": f"FOIA request {rnum} not found"}, None
        return (
            {"ok": True, "request_id": row[0], "request_number": row[1], "status": row[2]},
            {"tool": name, "summary": f"Updated FOIA {row[1]} ({row[2]})", "route": "/app/records"},
        )

    if name == "update_public_record":
        did = int(args["doc_id"])
        sets, params = ["updated_at = now()"], []
        for k in ("title", "category", "notes"):
            if args.get(k) is not None:
                sets.append(f"{k} = %s")
                params.append(str(args[k]).strip())
        if args.get("is_public") is not None:
            sets.append("is_public = %s")
            params.append(bool(args["is_public"]))
        params.append(did)
        row = conn.execute(
            f"UPDATE repository_documents SET {', '.join(sets)} WHERE id = %s RETURNING id, doc_number, title",
            tuple(params),
        ).fetchone()
        if not row:
            return {"ok": False, "error": f"Public record #{did} not found"}, None
        return (
            {"ok": True, "doc_id": row[0], "doc_number": row[1], "title": row[2]},
            {"tool": name, "summary": f"Updated record {row[1]} ('{row[2]}')", "route": "/app/records"},
        )

    if name == "create_code_chapter":
        prefix = str(args["code_prefix"]).strip()
        title = str(args["title"]).strip()
        desc = str(args.get("description") or "").strip()
        is_pub = bool(args.get("is_published", True))
        next_sort = conn.execute("SELECT COALESCE(MAX(sort_order), 0) + 1 FROM code_chapters").fetchone()[0]
        row = conn.execute(
            "INSERT INTO code_chapters (code_prefix, title, description, sort_order, is_published) VALUES (%s, %s, %s, %s, %s) RETURNING id",
            (prefix, title, desc, next_sort, is_pub),
        ).fetchone()
        return (
            {"ok": True, "chapter_id": row[0], "code_prefix": prefix, "title": title},
            {"tool": name, "summary": f"Created code chapter {prefix}: {title}", "route": "/app/codification"},
        )

    if name == "create_code_section":
        cid = int(args["chapter_id"])
        snum = str(args["section_number"]).strip()
        title = str(args["title"]).strip()
        body_txt = str(args["body"]).strip()
        summary = str(args.get("summary") or "").strip()
        ord_ref = str(args.get("ordinance_ref") or "").strip()
        is_pub = bool(args.get("is_published", True))
        if not conn.execute("SELECT 1 FROM code_chapters WHERE id = %s", (cid,)).fetchone():
            return {"ok": False, "error": f"Code chapter #{cid} not found"}, None
        next_sort = conn.execute("SELECT COALESCE(MAX(sort_order), 0) + 1 FROM code_sections WHERE chapter_id = %s", (cid,)).fetchone()[0]
        row = conn.execute(
            "INSERT INTO code_sections (chapter_id, node_type, section_number, title, summary, body, ordinance_ref, sort_order, is_published) "
            "VALUES (%s, 'section', %s, %s, %s, %s, %s, %s, %s) RETURNING id",
            (cid, snum, title, summary, body_txt, ord_ref, next_sort, is_pub),
        ).fetchone()
        return (
            {"ok": True, "section_id": row[0], "section_number": snum, "title": title},
            {"tool": name, "summary": f"Created code section {snum}: {title}", "route": "/app/codification"},
        )

    if name == "update_code_section":
        sid = args.get("section_id")
        snum = str(args.get("section_number") or "").strip()
        where = "id = %s" if sid is not None else "LOWER(section_number) = LOWER(%s)"
        key_val = int(sid) if sid is not None else snum
        sets, params = ["updated_at = now()"], []
        for k in ("title", "body", "summary", "ordinance_ref"):
            if args.get(k) is not None:
                sets.append(f"{k} = %s")
                params.append(str(args[k]).strip())
        if args.get("is_published") is not None:
            sets.append("is_published = %s")
            params.append(bool(args["is_published"]))
        params.append(key_val)
        row = conn.execute(
            f"UPDATE code_sections SET {', '.join(sets)} WHERE {where} RETURNING id, section_number, title",
            tuple(params),
        ).fetchone()
        if not row:
            return {"ok": False, "error": "Code section not found"}, None
        return (
            {"ok": True, "section_id": row[0], "section_number": row[1], "title": row[2]},
            {"tool": name, "summary": f"Updated code section {row[1]}: {row[2]}", "route": "/app/codification"},
        )

    if name == "update_calendar_event":
        eid = int(args["event_id"])
        sets, params = [], []
        for k in ("title", "start_time", "location", "description"):
            if args.get(k) is not None:
                sets.append(f"{k} = %s")
                params.append(str(args[k]).strip())
        if args.get("event_date"):
            sets.append("event_date = %s")
            params.append(date.fromisoformat(str(args["event_date"]).strip()))
        if args.get("is_public") is not None:
            sets.append("is_public = %s")
            params.append(bool(args["is_public"]))
        if not sets:
            return {"ok": False, "error": "No fields provided"}, None
        params.append(eid)
        row = conn.execute(
            f"UPDATE calendar_events SET {', '.join(sets)} WHERE id = %s RETURNING id, title, event_date",
            tuple(params),
        ).fetchone()
        if not row:
            return {"ok": False, "error": f"Calendar event #{eid} not found"}, None
        return (
            {"ok": True, "event_id": row[0], "title": row[1], "event_date": row[2].isoformat()},
            {"tool": name, "summary": f"Updated calendar event '{row[1]}'", "route": "/app/calendar-manage"},
        )

    if name == "delete_calendar_event":
        eid = int(args["event_id"])
        row = conn.execute("DELETE FROM calendar_events WHERE id = %s RETURNING title", (eid,)).fetchone()
        if not row:
            return {"ok": False, "error": f"Calendar event #{eid} not found"}, None
        return (
            {"ok": True, "deleted_event_id": eid},
            {"tool": name, "summary": f"Deleted calendar event '{row[0]}'", "route": "/app/calendar-manage"},
        )

    if name == "decide_facility_reservation":
        rid = int(args["reservation_id"])
        st = str(args["status"]).strip().lower()
        notes = str(args.get("staff_notes") or "").strip()
        row = conn.execute(
            "UPDATE facility_reservations SET status = %s, staff_notes = COALESCE(NULLIF(%s, ''), staff_notes), reviewed_by = %s, updated_at = now() "
            "WHERE id = %s RETURNING id, reservation_number, status",
            (st, notes, username, rid),
        ).fetchone()
        if not row:
            return {"ok": False, "error": f"Reservation #{rid} not found"}, None
        return (
            {"ok": True, "reservation_id": row[0], "reservation_number": row[1], "status": row[2]},
            {"tool": name, "summary": f"Set reservation {row[1]} to {row[2]}", "route": "/app/calendar-manage"},
        )

    if name == "update_directory_entry":
        eid = args.get("entry_id")
        nmatch = str(args.get("name_match") or "").strip()
        where = "id = %s" if eid is not None else "LOWER(trim(name)) = LOWER(%s)"
        key_val = int(eid) if eid is not None else nmatch
        sets, params = [], []
        for k in ("title_role", "department", "email", "phone", "office_hours"):
            if args.get(k) is not None:
                sets.append(f"{k} = %s")
                params.append(str(args[k]).strip())
        if args.get("is_public") is not None:
            sets.append("is_public = %s")
            params.append(bool(args["is_public"]))
        if not sets:
            return {"ok": False, "error": "No fields provided"}, None
        params.append(key_val)
        row = conn.execute(
            f"UPDATE city_directory_entries SET {', '.join(sets)} WHERE {where} RETURNING id, name",
            tuple(params),
        ).fetchone()
        if not row:
            return {"ok": False, "error": "Directory contact not found"}, None
        return (
            {"ok": True, "entry_id": row[0], "name": row[1]},
            {"tool": name, "summary": f"Updated directory contact '{row[1]}'", "route": "/app/directory-manage"},
        )

    if name == "list_faqs":
        lim = max(1, min(int(args.get("limit") or 15), 30))
        q = str(args.get("search") or "").strip()
        if q:
            rows = conn.execute(
                "SELECT id, question, answer, category, is_public FROM city_faqs WHERE question ILIKE %s OR answer ILIKE %s ORDER BY sort_order ASC, id ASC LIMIT %s",
                (f"%{q}%", f"%{q}%", lim),
            ).fetchall()
        else:
            rows = conn.execute(
                "SELECT id, question, answer, category, is_public FROM city_faqs ORDER BY sort_order ASC, id ASC LIMIT %s",
                (lim,),
            ).fetchall()
        return (
            {"ok": True, "faqs": [{"id": r[0], "question": r[1], "answer": r[2], "category": r[3], "is_public": r[4]} for r in rows]},
            None,
        )

    if name == "update_faq":
        fid = int(args["faq_id"])
        sets, params = ["updated_at = now()"], []
        for k in ("question", "answer", "category"):
            if args.get(k) is not None:
                sets.append(f"{k} = %s")
                params.append(str(args[k]).strip())
        if args.get("is_public") is not None:
            sets.append("is_public = %s")
            params.append(bool(args["is_public"]))
        params.append(fid)
        row = conn.execute(
            f"UPDATE city_faqs SET {', '.join(sets)} WHERE id = %s RETURNING id, question",
            tuple(params),
        ).fetchone()
        if not row:
            return {"ok": False, "error": f"FAQ #{fid} not found"}, None
        return (
            {"ok": True, "faq_id": row[0], "question": row[1]},
            {"tool": name, "summary": f"Updated FAQ #{row[0]}", "route": "/app/directory-manage"},
        )

    if name == "list_form_submissions":
        fid = int(args["form_id"])
        lim = max(1, min(int(args.get("limit") or 15), 30))
        rows = conn.execute(
            "SELECT id, submitter_name, submitter_email, responses, status, created_at FROM city_form_submissions WHERE form_id = %s ORDER BY id DESC LIMIT %s",
            (fid, lim),
        ).fetchall()
        return (
            {"ok": True, "submissions": [{"id": r[0], "submitter_name": r[1], "submitter_email": r[2], "responses": r[3], "status": r[4], "created_at": r[5].isoformat() if r[5] else None} for r in rows]},
            None,
        )

    if name == "record_bill_payment":
        ref = str(args["reference_number"]).strip()
        amt = str(args["amount_paid"]).strip().lstrip("$")
        method = str(args.get("payment_method") or "check").strip().lower()
        pref = str(args.get("payment_ref") or "").strip()
        notes = str(args.get("notes") or "").strip()
        row = conn.execute(
            "UPDATE municipal_bills SET payment_status = 'paid', amount_paid = %s, payment_method = %s, payment_ref = %s, "
            "paid_at = now(), notes = COALESCE(NULLIF(%s, ''), notes), updated_at = now() "
            "WHERE reference_number = %s RETURNING id, reference_number, bill_type, payer_name",
            (amt, method, pref, notes, ref),
        ).fetchone()
        if not row:
            return {"ok": False, "error": f"Bill or citation {ref} not found"}, None
        route = "/app/utilities-manage" if row[2] == "utility" else "/app/billing-manage"
        return (
            {"ok": True, "bill_id": row[0], "reference_number": row[1], "payment_status": "paid", "amount_paid": amt},
            {"tool": name, "summary": f"Recorded ${amt} payment on {row[1]} ({row[3]})", "route": route},
        )

    if name == "update_bill":
        ref = str(args["reference_number"]).strip()
        sets, params = ["updated_at = now()"], []
        for k in ("amount_due", "dispute_status", "notes"):
            if args.get(k) is not None:
                sets.append(f"{k} = %s")
                params.append(str(args[k]).strip().lstrip("$") if k == "amount_due" else str(args[k]).strip())
        if args.get("due_date"):
            sets.append("due_date = %s")
            params.append(str(args["due_date"]).strip())
        params.append(ref)
        row = conn.execute(
            f"UPDATE municipal_bills SET {', '.join(sets)} WHERE reference_number = %s RETURNING id, reference_number, bill_type",
            tuple(params),
        ).fetchone()
        if not row:
            return {"ok": False, "error": f"Bill or citation {ref} not found"}, None
        route = "/app/utilities-manage" if row[2] == "utility" else "/app/billing-manage"
        return (
            {"ok": True, "bill_id": row[0], "reference_number": row[1]},
            {"tool": name, "summary": f"Updated {row[1]}", "route": route},
        )

    if name == "list_users":
        lim = max(1, min(int(args.get("limit") or 25), 50))
        rows = conn.execute(
            "SELECT id, username, role, email, is_active FROM users ORDER BY id ASC LIMIT %s",
            (lim,),
        ).fetchall()
        return (
            {"ok": True, "users": [{"id": r[0], "username": r[1], "role": r[2], "email": r[3], "is_active": r[4]} for r in rows]},
            None,
        )

    if name == "update_user_role":
        uname = str(args["username"]).strip()
        sets, params = [], []
        if args.get("role"):
            sets.append("role = %s")
            params.append(str(args["role"]).strip())
        if args.get("is_active") is not None:
            sets.append("is_active = %s")
            params.append(bool(args["is_active"]))
        if not sets:
            return {"ok": False, "error": "No fields provided"}, None
        params.append(uname)
        row = conn.execute(
            f"UPDATE users SET {', '.join(sets)} WHERE username = %s RETURNING id, username, role, is_active",
            tuple(params),
        ).fetchone()
        if not row:
            return {"ok": False, "error": f"User '{uname}' not found"}, None
        return (
            {"ok": True, "user_id": row[0], "username": row[1], "role": row[2], "is_active": row[3]},
            {"tool": name, "summary": f"Updated user '{row[1]}' ({row[2]})", "route": "/app/users"},
        )

    if name == "list_audit_log":
        lim = max(1, min(int(args.get("limit") or 20), 50))
        q = str(args.get("action_filter") or "").strip()
        if q:
            rows = conn.execute(
                "SELECT id, actor_username, action, target_type, summary, created_at FROM core_audit_log WHERE action ILIKE %s OR summary ILIKE %s ORDER BY id DESC LIMIT %s",
                (f"%{q}%", f"%{q}%", lim),
            ).fetchall()
        else:
            rows = conn.execute(
                "SELECT id, actor_username, action, target_type, summary, created_at FROM core_audit_log ORDER BY id DESC LIMIT %s",
                (lim,),
            ).fetchall()
        return (
            {"ok": True, "audit_log": [{"id": r[0], "actor": r[1], "action": r[2], "target_type": r[3], "summary": r[4], "created_at": r[5].isoformat() if r[5] else None} for r in rows]},
            None,
        )

    return None
