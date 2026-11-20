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

"""Unified 'My Civic Account' summary & self-service profile endpoints."""
from datetime import date
import re

from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel

from .audit import record_audit
from .auth import current_user
from .db import pool
from .registry import get_enabled_module_ids

router = APIRouter(prefix="/api/my-account", tags=["my-account"])

_EMAIL_RE = re.compile(r"^[^@\s]+@[^@\s]+\.[^@\s]+$")


def _require_authenticated(request: Request) -> dict:
    user = current_user(request)
    if not user:
        raise HTTPException(status_code=401, detail="Not authenticated")
    return user


class ProfileUpdateIn(BaseModel):
    email: str = ""


@router.put("/profile")
def update_my_profile(body: ProfileUpdateIn, user: dict = Depends(_require_authenticated)):
    email = (body.email or "").strip()
    if email and not _EMAIL_RE.match(email):
        raise HTTPException(status_code=400, detail="Please enter a valid email address")
    with pool.connection() as conn:
        conn.execute(
            "UPDATE users SET email = %s WHERE id = %s",
            (email, user["id"]),
        )
    record_audit(user["username"], "user.profile_updated", "users", user["id"], f"Updated profile email")
    return {"id": user["id"], "username": user["username"], "role": user["role"], "email": email}


@router.get("/summary")
def get_my_account_summary(user: dict = Depends(_require_authenticated)):
    enabled = set(get_enabled_module_ids())
    uid = user["id"]
    email = (user.get("email") or "").strip()

    permits: list[dict] = []
    inspections: list[dict] = []
    complaints: list[dict] = []
    reservations: list[dict] = []
    records_requests: list[dict] = []
    form_submissions: list[dict] = []
    subscriptions: list[dict] = []
    bills: list[dict] = []
    stripe_enabled = False

    with pool.connection() as conn:
        stripe_row = conn.execute(
            "SELECT enabled, api_key FROM core_integrations WHERE provider = 'stripe'"
        ).fetchone()
        stripe_enabled = bool(stripe_row and stripe_row[0] and (stripe_row[1] or "").strip())

        if "permits" in enabled:
            p_rows = conn.execute(
                "SELECT id, permit_number, permit_type_name, permit_use_name, property_address, "
                "status, fee_amount, payment_status, created_at, updated_at "
                "FROM permits WHERE applicant_user_id = %s ORDER BY created_at DESC, id DESC LIMIT 50",
                (uid,),
            ).fetchall()
            permits = [
                {
                    "id": r[0],
                    "permit_number": r[1],
                    "permit_type_name": r[2],
                    "permit_use_name": r[3],
                    "property_address": r[4],
                    "status": r[5],
                    "fee_amount": r[6] or "",
                    "payment_status": r[7] or "unpaid",
                    "created_at": r[8].isoformat() if r[8] else None,
                    "updated_at": r[9].isoformat() if r[9] else None,
                }
                for r in p_rows
            ]

            i_rows = conn.execute(
                "SELECT i.id, i.permit_id, p.permit_number, p.property_address, i.inspection_type, "
                "i.scheduled_date, i.requested_window, i.result, i.inspector "
                "FROM permit_inspections i JOIN permits p ON p.id = i.permit_id "
                "WHERE p.applicant_user_id = %s "
                "ORDER BY (i.scheduled_date = ''), i.scheduled_date DESC, i.id DESC LIMIT 25",
                (uid,),
            ).fetchall()
            inspections = [
                {
                    "id": r[0],
                    "permit_id": r[1],
                    "permit_number": r[2],
                    "property_address": r[3] or "",
                    "inspection_type": r[4],
                    "scheduled_date": r[5] or "",
                    "scheduled_time": r[6] or "",
                    "status": r[7] or "scheduled",
                    "inspector_name": r[8] or "",
                }
                for r in i_rows
            ]

        if "complaints" in enabled:
            c_rows = conn.execute(
                "SELECT id, complaint_number, ordinance_section, subject_property_address, status, created_at, updated_at "
                "FROM complaints WHERE complainant_user_id = %s ORDER BY id DESC LIMIT 50",
                (uid,),
            ).fetchall()
            complaints = [
                {
                    "id": r[0],
                    "complaint_number": r[1],
                    "category": r[2] or "",
                    "property_address": r[3] or "",
                    "status": r[4],
                    "created_at": r[5].isoformat() if r[5] else None,
                    "updated_at": r[6].isoformat() if r[6] else None,
                }
                for r in c_rows
            ]

        if email:
            if "calendar" in enabled:
                r_rows = conn.execute(
                    "SELECT id, reservation_number, facility_name, event_date, rental_mode, "
                    "start_time, end_time, event_title, fee_amount, payment_status, status, created_at "
                    "FROM facility_reservations WHERE LOWER(requester_email) = LOWER(%s) "
                    "ORDER BY event_date DESC, id DESC LIMIT 50",
                    (email,),
                ).fetchall()
                reservations = [
                    {
                        "id": r[0],
                        "reservation_number": r[1],
                        "facility_name": r[2],
                        "event_date": r[3].isoformat() if hasattr(r[3], "isoformat") else str(r[3]),
                        "rental_mode": r[4] or "full_day",
                        "start_time": r[5] or "",
                        "end_time": r[6] or "",
                        "event_title": r[7] or "",
                        "fee_amount": r[8] or "",
                        "payment_status": r[9] or "unpaid",
                        "status": r[10],
                        "created_at": r[11].isoformat() if r[11] else None,
                    }
                    for r in r_rows
                ]

            if "records" in enabled:
                rr_rows = conn.execute(
                    "SELECT id, request_number, subject, department, status, due_date, "
                    "fee_estimate, fulfillment_filename, created_at, updated_at "
                    "FROM public_records_requests WHERE LOWER(requester_email) = LOWER(%s) "
                    "ORDER BY id DESC LIMIT 50",
                    (email,),
                ).fetchall()
                records_requests = [
                    {
                        "id": r[0],
                        "request_number": r[1],
                        "subject": r[2],
                        "department": r[3],
                        "status": r[4],
                        "due_date": r[5] or "",
                        "fee_estimate": r[6] or "",
                        "fulfillment_filename": r[7] or "",
                        "created_at": r[8].isoformat() if r[8] else None,
                        "updated_at": r[9].isoformat() if r[9] else None,
                    }
                    for r in rr_rows
                ]

            if "forms" in enabled:
                f_rows = conn.execute(
                    "SELECT s.id, s.form_id, f.title, f.form_kind, s.status, s.created_at "
                    "FROM city_form_submissions s JOIN city_forms f ON f.id = s.form_id "
                    "WHERE LOWER(s.submitter_email) = LOWER(%s) ORDER BY s.id DESC LIMIT 50",
                    (email,),
                ).fetchall()
                form_submissions = [
                    {
                        "id": r[0],
                        "form_id": r[1],
                        "form_title": r[2],
                        "form_kind": r[3],
                        "status": r[4],
                        "created_at": r[5].isoformat() if r[5] else None,
                    }
                    for r in f_rows
                ]

            sub_rows = conn.execute(
                "SELECT topic, created_at FROM public_subscriptions "
                "WHERE LOWER(email) = LOWER(%s) AND is_active = TRUE ORDER BY topic",
                (email,),
            ).fetchall()
            subscriptions = [
                {"topic": r[0], "created_at": r[1].isoformat() if r[1] else None}
                for r in sub_rows
            ]

            b_rows = conn.execute(
                "SELECT id, reference_number, bill_type, account_number, service_address, "
                "description, amount_due, due_date, payment_status, created_at "
                "FROM municipal_bills WHERE LOWER(payer_email) = LOWER(%s) "
                "ORDER BY (payment_status = 'unpaid') DESC, id DESC LIMIT 50",
                (email,),
            ).fetchall()
            bills = [
                {
                    "id": r[0],
                    "reference_number": r[1],
                    "bill_type": r[2],
                    "account_number": r[3] or "",
                    "service_address": r[4] or "",
                    "description": r[5] or "",
                    "amount_due": r[6] or "",
                    "due_date": r[7] or "",
                    "payment_status": r[8] or "unpaid",
                    "created_at": r[9].isoformat() if r[9] else None,
                }
                for r in b_rows
            ]

    today_str = date.today().isoformat()
    open_permits = sum(1 for p in permits if p["status"] not in ("closed", "denied", "withdrawn", "expired"))
    unpaid_permits = [p for p in permits if p["payment_status"] != "paid" and _has_payable_amount(p["fee_amount"])]
    unpaid_reservations = [r for r in reservations if r["payment_status"] != "paid" and r["status"] != "cancelled" and _has_payable_amount(r["fee_amount"])]
    unpaid_bills = [b for b in bills if b["payment_status"] == "unpaid" and _has_payable_amount(b["amount_due"])]
    open_complaints = sum(1 for c in complaints if c["status"] not in ("closed", "resolved", "dismissed"))
    upcoming_inspections = sum(
        1 for i in inspections
        if i["status"] in ("scheduled", "pending") and (not i["scheduled_date"] or i["scheduled_date"] >= today_str)
    )

    return {
        "user": {
            "id": user["id"],
            "username": user["username"],
            "role": user["role"],
            "email": email,
        },
        "enabled_modules": sorted(enabled),
        "stripe_enabled": stripe_enabled,
        "counts": {
            "open_permits": open_permits,
            "total_permits": len(permits),
            "unpaid_items": len(unpaid_permits) + len(unpaid_reservations) + len(unpaid_bills),
            "upcoming_inspections": upcoming_inspections,
            "open_complaints": open_complaints,
            "total_complaints": len(complaints),
            "reservations": len(reservations),
            "records_requests": len(records_requests),
            "form_submissions": len(form_submissions),
            "subscriptions": len(subscriptions),
            "bills": len(bills),
        },
        "permits": permits,
        "inspections": inspections,
        "complaints": complaints,
        "reservations": reservations,
        "records_requests": records_requests,
        "form_submissions": form_submissions,
        "subscriptions": subscriptions,
        "bills": bills,
    }


def _has_payable_amount(fee_text: str) -> bool:
    cleaned = str(fee_text or "").replace(",", "")
    m = re.search(r"([0-9]+(?:\.[0-9]{1,2})?)", cleaned)
    if not m:
        return False
    try:
        return float(m.group(1)) > 0
    except ValueError:
        return False
