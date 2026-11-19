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

"""City Calendar & Configurable Facility Reservations module."""
from datetime import date, datetime, timezone
from typing import Literal
import uuid

from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel

from .auth import require_permission
from .db import pool
from .integrations import send_direct_email, send_notification_email

router = APIRouter(prefix="/api/calendar", tags=["calendar"])

RESERVATION_STATUSES = ("pending", "approved", "declined", "cancelled")
PAYMENT_STATUSES = ("unpaid", "paid", "waived")
EVENT_CATEGORIES = ("Community Event", "Holiday / Closure", "Public Works", "Public Hearing", "Other")

SCHEMA = """
CREATE TABLE IF NOT EXISTS reservable_facilities (
    id          BIGSERIAL PRIMARY KEY,
    name        TEXT NOT NULL UNIQUE,
    description TEXT NOT NULL DEFAULT '',
    daily_fee   TEXT NOT NULL DEFAULT '$0.00',
    capacity    TEXT NOT NULL DEFAULT '',
    rules       TEXT NOT NULL DEFAULT '',
    is_active   BOOLEAN NOT NULL DEFAULT TRUE,
    sort_order  INTEGER NOT NULL DEFAULT 0,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS facility_reservations (
    id                 BIGSERIAL PRIMARY KEY,
    reservation_number TEXT NOT NULL UNIQUE,
    facility_id        BIGINT NOT NULL REFERENCES reservable_facilities(id) ON DELETE CASCADE,
    facility_name      TEXT NOT NULL DEFAULT '',
    event_date         DATE NOT NULL,
    event_title        TEXT NOT NULL DEFAULT '',
    requester_name     TEXT NOT NULL,
    requester_email    TEXT NOT NULL DEFAULT '',
    requester_phone    TEXT NOT NULL DEFAULT '',
    notes              TEXT NOT NULL DEFAULT '',
    fee_amount         TEXT NOT NULL DEFAULT '',
    payment_status     TEXT NOT NULL DEFAULT 'unpaid',
    status             TEXT NOT NULL DEFAULT 'pending',
    staff_notes        TEXT NOT NULL DEFAULT '',
    reviewed_by        TEXT NOT NULL DEFAULT '',
    created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at         TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS facility_res_date_idx ON facility_reservations(facility_id, event_date, status);
CREATE TABLE IF NOT EXISTS calendar_events (
    id          BIGSERIAL PRIMARY KEY,
    title       TEXT NOT NULL,
    event_date  DATE NOT NULL,
    start_time  TEXT NOT NULL DEFAULT '',
    end_time    TEXT NOT NULL DEFAULT '',
    location    TEXT NOT NULL DEFAULT '',
    category    TEXT NOT NULL DEFAULT 'Community Event',
    description TEXT NOT NULL DEFAULT '',
    is_public   BOOLEAN NOT NULL DEFAULT TRUE,
    created_by  TEXT NOT NULL DEFAULT '',
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS calendar_events_date_idx ON calendar_events(event_date);
"""


def bootstrap() -> None:
    with pool.connection() as conn:
        conn.execute("SELECT pg_advisory_xact_lock(424246)")
        conn.execute(SCHEMA)
        conn.execute(
            "INSERT INTO reservable_facilities (name, description, daily_fee, capacity, rules, sort_order) "
            "VALUES ('Village Hall', 'Main municipal meeting hall available for community and private events.', '$75.00', '', 'Please leave hall clean and remove all trash after your event.', 1) "
            "ON CONFLICT (name) DO NOTHING"
        )


def _row_to_facility(r) -> dict:
    return {
        "id": r[0],
        "name": r[1],
        "description": r[2],
        "daily_fee": r[3],
        "capacity": r[4],
        "rules": r[5],
        "is_active": bool(r[6]),
        "sort_order": r[7],
    }


def _row_to_reservation(r) -> dict:
    return {
        "id": r[0],
        "reservation_number": r[1],
        "facility_id": r[2],
        "facility_name": r[3],
        "event_date": r[4].isoformat() if r[4] else None,
        "event_title": r[5],
        "requester_name": r[6],
        "requester_email": r[7],
        "requester_phone": r[8],
        "notes": r[9],
        "fee_amount": r[10],
        "payment_status": r[11],
        "status": r[12],
        "staff_notes": r[13],
        "reviewed_by": r[14],
        "created_at": r[15].isoformat() if r[15] else None,
        "updated_at": r[16].isoformat() if r[16] else None,
    }


def _row_to_event(r) -> dict:
    return {
        "id": r[0],
        "title": r[1],
        "event_date": r[2].isoformat() if r[2] else None,
        "start_time": r[3],
        "end_time": r[4],
        "location": r[5],
        "category": r[6],
        "description": r[7],
        "is_public": bool(r[8]),
        "created_by": r[9],
        "created_at": r[10].isoformat() if r[10] else None,
    }


_RES_COLS = (
    "id, reservation_number, facility_id, facility_name, event_date, event_title, "
    "requester_name, requester_email, requester_phone, notes, fee_amount, "
    "payment_status, status, staff_notes, reviewed_by, created_at, updated_at"
)


class FacilityIn(BaseModel):
    name: str
    description: str = ""
    daily_fee: str = "$0.00"
    capacity: str = ""
    rules: str = ""
    is_active: bool = True
    sort_order: int = 0


class FacilityPatch(BaseModel):
    name: str | None = None
    description: str | None = None
    daily_fee: str | None = None
    capacity: str | None = None
    rules: str | None = None
    is_active: bool | None = None
    sort_order: int | None = None


class PublicReservationIn(BaseModel):
    facility_id: int
    event_date: str
    event_title: str = ""
    requester_name: str
    requester_email: str = ""
    requester_phone: str = ""
    notes: str = ""


class ReservationPatch(BaseModel):
    status: Literal["pending", "approved", "declined", "cancelled"] | None = None
    payment_status: Literal["unpaid", "paid", "waived"] | None = None
    fee_amount: str | None = None
    staff_notes: str | None = None


class CalendarEventIn(BaseModel):
    title: str
    event_date: str
    start_time: str = ""
    end_time: str = ""
    location: str = ""
    category: str = "Community Event"
    description: str = ""
    is_public: bool = True


class CalendarEventPatch(BaseModel):
    title: str | None = None
    event_date: str | None = None
    start_time: str | None = None
    end_time: str | None = None
    location: str | None = None
    category: str | None = None
    description: str | None = None
    is_public: bool | None = None


def _parse_date(val: str, label: str = "Date") -> date:
    try:
        return date.fromisoformat(val.strip())
    except ValueError:
        raise HTTPException(status_code=400, detail=f"{label} must be YYYY-MM-DD")


# ------------------------------------------------------------------ public endpoints
@router.get("/public")
def get_public_calendar(month: str = ""):
    """Return public meetings, city events, approved facility bookings, and reservable facilities."""
    if month:
        try:
            parts = month.strip().split("-")
            y, m = int(parts[0]), int(parts[1])
            start_dt = date(y, m, 1)
            end_dt = date(y + 1, 1, 1) if m == 12 else date(y, m + 1, 1)
        except Exception:
            raise HTTPException(status_code=400, detail="month must be YYYY-MM")
    else:
        today = date.today()
        start_dt = date(today.year, today.month, 1)
        end_dt = date(today.year + 1, 1, 1) if today.month == 12 else date(today.year, today.month + 1, 1)

    with pool.connection() as conn:
        fac_rows = conn.execute(
            "SELECT id, name, description, daily_fee, capacity, rules, is_active, sort_order "
            "FROM reservable_facilities WHERE is_active = TRUE ORDER BY sort_order ASC, name ASC"
        ).fetchall()
        facilities = [_row_to_facility(r) for r in fac_rows]

        ev_rows = conn.execute(
            "SELECT id, title, event_date, start_time, end_time, location, category, description "
            "FROM calendar_events "
            "WHERE is_public = TRUE AND event_date >= %s AND event_date < %s "
            "ORDER BY event_date ASC, start_time ASC, id ASC",
            (start_dt, end_dt),
        ).fetchall()

        res_rows = conn.execute(
            "SELECT id, facility_id, facility_name, event_date, event_title "
            "FROM facility_reservations "
            "WHERE status = 'approved' AND event_date >= %s AND event_date < %s "
            "ORDER BY event_date ASC, id ASC",
            (start_dt, end_dt),
        ).fetchall()

        # Include finalized agendas automatically on the City Calendar
        ag_rows = conn.execute(
            "SELECT id, title, body, meeting_date, meeting_time "
            "FROM agendas "
            "WHERE (finalized_at IS NOT NULL OR LOWER(status) LIKE 'finalized%%') "
            "  AND meeting_date >= %s AND meeting_date < %s "
            "ORDER BY meeting_date ASC, id ASC",
            (start_dt, end_dt),
        ).fetchall()

    items: list[dict] = []
    for r in ag_rows:
        items.append({
            "uid": f"agenda-{r[0]}",
            "kind": "meeting",
            "title": f"{r[2]}: {r[1]}" if r[2] else r[1],
            "event_date": r[3].isoformat(),
            "start_time": r[4] or "",
            "location": "",
            "category": "Public Meeting",
            "description": "Finalized meeting agenda published on Public Portal.",
        })
    for r in ev_rows:
        items.append({
            "uid": f"event-{r[0]}",
            "kind": "event",
            "title": r[1],
            "event_date": r[2].isoformat(),
            "start_time": r[3] or "",
            "end_time": r[4] or "",
            "location": r[5] or "",
            "category": r[6] or "Community Event",
            "description": r[7] or "",
        })
    booked_slots: list[dict] = []
    for r in res_rows:
        booked_slots.append({
            "facility_id": r[1],
            "facility_name": r[2],
            "event_date": r[3].isoformat(),
        })
        items.append({
            "uid": f"res-{r[0]}",
            "kind": "reservation",
            "title": f"{r[2]} — Reserved" + (f" ({r[4]})" if r[4] else ""),
            "event_date": r[3].isoformat(),
            "start_time": "All Day",
            "location": r[2],
            "category": "Facility Reserved",
            "description": "",
        })

    items.sort(key=lambda x: (x["event_date"], x.get("start_time") or ""))
    return {
        "month": start_dt.strftime("%Y-%m"),
        "facilities": facilities,
        "items": items,
        "booked_slots": booked_slots,
    }


@router.post("/reservations/public", status_code=201)
def create_public_reservation(body: PublicReservationIn, request: Request):
    name = body.requester_name.strip()
    if not name:
        raise HTTPException(status_code=400, detail="Your name is required")
    if not body.requester_email.strip() and not body.requester_phone.strip():
        raise HTTPException(status_code=400, detail="Please provide an email address or phone number")
    ev_date = _parse_date(body.event_date, "Reservation date")
    if ev_date < date.today():
        raise HTTPException(status_code=400, detail="Reservation date cannot be in the past")

    with pool.connection() as conn:
        fac = conn.execute(
            "SELECT id, name, daily_fee, is_active FROM reservable_facilities WHERE id = %s",
            (body.facility_id,),
        ).fetchone()
        if not fac or not fac[3]:
            raise HTTPException(status_code=400, detail="Selected facility is not available for reservation")

        conflict = conn.execute(
            "SELECT id FROM facility_reservations "
            "WHERE facility_id = %s AND event_date = %s AND status = 'approved'",
            (body.facility_id, ev_date),
        ).fetchone()
        if conflict:
            raise HTTPException(
                status_code=409,
                detail=f"{fac[1]} is already reserved on {ev_date.isoformat()}",
            )

        year = datetime.now(timezone.utc).year
        temp_num = f"RES-{year}-{uuid.uuid4().hex[:8].upper()}"
        row = conn.execute(
            f"INSERT INTO facility_reservations "
            f"(reservation_number, facility_id, facility_name, event_date, event_title, "
            f" requester_name, requester_email, requester_phone, notes, fee_amount, status) "
            f"VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, 'pending') "
            f"RETURNING {_RES_COLS}",
            (
                temp_num,
                fac[0],
                fac[1],
                ev_date,
                body.event_title.strip(),
                name,
                body.requester_email.strip(),
                body.requester_phone.strip(),
                body.notes.strip(),
                fac[2] or "$0.00",
            ),
        ).fetchone()
        res_id = row[0]
        final_num = f"RES-{year}-{res_id:04d}"
        row = conn.execute(
            f"UPDATE facility_reservations SET reservation_number = %s WHERE id = %s RETURNING {_RES_COLS}",
            (final_num, res_id),
        ).fetchone()
        res = _row_to_reservation(row)

    send_notification_email(
        "calendar_reservation_requested",
        f"[CivicDesk] New Facility Reservation Request {final_num}: {fac[1]}",
        f"{name} requested to reserve {fac[1]} on {ev_date.isoformat()} (Fee: {fac[2]}).",
        link_path="/app#calendar-manage",
        request=request,
    )
    if res["requester_email"]:
        send_direct_email(
            [res["requester_email"]],
            f"[CivicDesk] Reservation Request Received: {final_num}",
            f"We received your request ({final_num}) to reserve {fac[1]} on {ev_date.isoformat()} (Fee: {fac[2]}). "
            f"City staff will review and confirm your reservation.",
            link_path="/#calendar",
            request=request,
        )
    return res


# ------------------------------------------------------------------ staff endpoints
@router.get("/facilities")
def list_facilities(_: dict = Depends(require_permission("calendar.manage"))):
    with pool.connection() as conn:
        rows = conn.execute(
            "SELECT id, name, description, daily_fee, capacity, rules, is_active, sort_order "
            "FROM reservable_facilities ORDER BY sort_order ASC, name ASC"
        ).fetchall()
    return [_row_to_facility(r) for r in rows]


@router.post("/facilities", status_code=201)
def create_facility(body: FacilityIn, _: dict = Depends(require_permission("calendar.manage"))):
    name = body.name.strip()
    if not name:
        raise HTTPException(status_code=400, detail="Facility name is required")
    with pool.connection() as conn:
        row = conn.execute(
            "INSERT INTO reservable_facilities (name, description, daily_fee, capacity, rules, is_active, sort_order) "
            "VALUES (%s, %s, %s, %s, %s, %s, %s) "
            "RETURNING id, name, description, daily_fee, capacity, rules, is_active, sort_order",
            (name, body.description.strip(), body.daily_fee.strip() or "$0.00", body.capacity.strip(), body.rules.strip(), body.is_active, body.sort_order),
        ).fetchone()
    return _row_to_facility(row)


@router.patch("/facilities/{fac_id}")
def update_facility(fac_id: int, body: FacilityPatch, _: dict = Depends(require_permission("calendar.manage"))):
    with pool.connection() as conn:
        row = conn.execute(
            "UPDATE reservable_facilities SET "
            "name = COALESCE(%s, name), "
            "description = COALESCE(%s, description), "
            "daily_fee = COALESCE(%s, daily_fee), "
            "capacity = COALESCE(%s, capacity), "
            "rules = COALESCE(%s, rules), "
            "is_active = COALESCE(%s, is_active), "
            "sort_order = COALESCE(%s, sort_order) "
            "WHERE id = %s "
            "RETURNING id, name, description, daily_fee, capacity, rules, is_active, sort_order",
            (
                body.name.strip() if body.name is not None else None,
                body.description.strip() if body.description is not None else None,
                body.daily_fee.strip() if body.daily_fee is not None else None,
                body.capacity.strip() if body.capacity is not None else None,
                body.rules.strip() if body.rules is not None else None,
                body.is_active,
                body.sort_order,
                fac_id,
            ),
        ).fetchone()
        if not row:
            raise HTTPException(status_code=404, detail="Facility not found")
    return _row_to_facility(row)


@router.delete("/facilities/{fac_id}")
def delete_facility(fac_id: int, _: dict = Depends(require_permission("calendar.manage"))):
    with pool.connection() as conn:
        row = conn.execute("DELETE FROM reservable_facilities WHERE id = %s RETURNING id", (fac_id,)).fetchone()
        if not row:
            raise HTTPException(status_code=404, detail="Facility not found")
    return {"deleted": True, "id": fac_id}


@router.get("/reservations")
def list_reservations(status: str = "", _: dict = Depends(require_permission("calendar.manage"))):
    sql = f"SELECT {_RES_COLS} FROM facility_reservations "
    params: list = []
    if status and status != "all":
        sql += "WHERE status = %s "
        params.append(status)
    sql += "ORDER BY event_date ASC, id DESC"
    with pool.connection() as conn:
        rows = conn.execute(sql, params).fetchall()
    return [_row_to_reservation(r) for r in rows]


@router.patch("/reservations/{res_id}")
def update_reservation(
    res_id: int,
    body: ReservationPatch,
    request: Request,
    user: dict = Depends(require_permission("calendar.manage")),
):
    with pool.connection() as conn:
        cur_row = conn.execute(f"SELECT {_RES_COLS} FROM facility_reservations WHERE id = %s", (res_id,)).fetchone()
        if not cur_row:
            raise HTTPException(status_code=404, detail="Reservation not found")
        cur = _row_to_reservation(cur_row)
        if body.status == "approved":
            conflict = conn.execute(
                "SELECT reservation_number FROM facility_reservations "
                "WHERE facility_id = %s AND event_date = %s AND status = 'approved' AND id <> %s",
                (cur["facility_id"], cur["event_date"], res_id),
            ).fetchone()
            if conflict:
                raise HTTPException(
                    status_code=409,
                    detail=f"Cannot approve: {cur['facility_name']} already has approved reservation {conflict[0]} on {cur['event_date']}",
                )
        row = conn.execute(
            f"UPDATE facility_reservations SET "
            f"status = COALESCE(%s, status), "
            f"payment_status = COALESCE(%s, payment_status), "
            f"fee_amount = COALESCE(%s, fee_amount), "
            f"staff_notes = COALESCE(%s, staff_notes), "
            f"reviewed_by = %s, "
            f"updated_at = now() "
            f"WHERE id = %s RETURNING {_RES_COLS}",
            (
                body.status,
                body.payment_status,
                body.fee_amount.strip() if body.fee_amount is not None else None,
                body.staff_notes.strip() if body.staff_notes is not None else None,
                user["username"],
                res_id,
            ),
        ).fetchone()
        updated = _row_to_reservation(row)

    if body.status and body.status != cur["status"] and updated["requester_email"]:
        send_direct_email(
            [updated["requester_email"]],
            f"[CivicDesk] Reservation {updated['reservation_number']} {updated['status'].title()}",
            f"Your reservation ({updated['reservation_number']}) for {updated['facility_name']} on {updated['event_date']} "
            f"has been marked '{updated['status']}'.\nFee: {updated['fee_amount']} ({updated['payment_status']})"
            + (f"\nNote: {updated['staff_notes']}" if updated["staff_notes"] else ""),
            link_path="/#calendar",
            request=request,
        )
    return updated


@router.delete("/reservations/{res_id}")
def delete_reservation(res_id: int, _: dict = Depends(require_permission("calendar.manage"))):
    with pool.connection() as conn:
        row = conn.execute("DELETE FROM facility_reservations WHERE id = %s RETURNING id", (res_id,)).fetchone()
        if not row:
            raise HTTPException(status_code=404, detail="Reservation not found")
    return {"deleted": True, "id": res_id}


@router.get("/events")
def list_calendar_events(_: dict = Depends(require_permission("calendar.manage"))):
    with pool.connection() as conn:
        rows = conn.execute(
            "SELECT id, title, event_date, start_time, end_time, location, category, description, is_public, created_by, created_at "
            "FROM calendar_events ORDER BY event_date ASC, start_time ASC, id ASC"
        ).fetchall()
    return [_row_to_event(r) for r in rows]


@router.post("/events", status_code=201)
def create_calendar_event(body: CalendarEventIn, user: dict = Depends(require_permission("calendar.manage"))):
    title = body.title.strip()
    if not title:
        raise HTTPException(status_code=400, detail="Event title is required")
    ev_date = _parse_date(body.event_date, "Event date")
    cat = body.category.strip() if body.category.strip() in EVENT_CATEGORIES else "Community Event"
    with pool.connection() as conn:
        row = conn.execute(
            "INSERT INTO calendar_events (title, event_date, start_time, end_time, location, category, description, is_public, created_by) "
            "VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s) "
            "RETURNING id, title, event_date, start_time, end_time, location, category, description, is_public, created_by, created_at",
            (title, ev_date, body.start_time.strip(), body.end_time.strip(), body.location.strip(), cat, body.description.strip(), body.is_public, user["username"]),
        ).fetchone()
    return _row_to_event(row)


@router.delete("/events/{ev_id}")
def delete_calendar_event(ev_id: int, _: dict = Depends(require_permission("calendar.manage"))):
    with pool.connection() as conn:
        row = conn.execute("DELETE FROM calendar_events WHERE id = %s RETURNING id", (ev_id,)).fetchone()
        if not row:
            raise HTTPException(status_code=404, detail="Event not found")
    return {"deleted": True, "id": ev_id}
