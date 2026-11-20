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
import os
from typing import Literal
import uuid

from fastapi import APIRouter, Depends, HTTPException, Request
from fastapi.responses import Response
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
    id             BIGSERIAL PRIMARY KEY,
    name           TEXT NOT NULL UNIQUE,
    description    TEXT NOT NULL DEFAULT '',
    daily_fee      TEXT NOT NULL DEFAULT '$0.00',
    hourly_fee     TEXT NOT NULL DEFAULT '',
    deposit_amount TEXT NOT NULL DEFAULT '',
    capacity       TEXT NOT NULL DEFAULT '',
    rules          TEXT NOT NULL DEFAULT '',
    is_active      BOOLEAN NOT NULL DEFAULT TRUE,
    sort_order     INTEGER NOT NULL DEFAULT 0,
    created_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE reservable_facilities ADD COLUMN IF NOT EXISTS hourly_fee TEXT NOT NULL DEFAULT '';
ALTER TABLE reservable_facilities ADD COLUMN IF NOT EXISTS deposit_amount TEXT NOT NULL DEFAULT '';
CREATE TABLE IF NOT EXISTS facility_reservations (
    id                 BIGSERIAL PRIMARY KEY,
    reservation_number TEXT NOT NULL UNIQUE,
    facility_id        BIGINT NOT NULL REFERENCES reservable_facilities(id) ON DELETE CASCADE,
    facility_name      TEXT NOT NULL DEFAULT '',
    event_date         DATE NOT NULL,
    rental_mode        TEXT NOT NULL DEFAULT 'full_day',
    start_time         TEXT NOT NULL DEFAULT '',
    end_time           TEXT NOT NULL DEFAULT '',
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
ALTER TABLE facility_reservations ADD COLUMN IF NOT EXISTS rental_mode TEXT NOT NULL DEFAULT 'full_day';
ALTER TABLE facility_reservations ADD COLUMN IF NOT EXISTS start_time TEXT NOT NULL DEFAULT '';
ALTER TABLE facility_reservations ADD COLUMN IF NOT EXISTS end_time TEXT NOT NULL DEFAULT '';
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
        if os.environ.get("SEED_CITY_PROFILE", "").strip().lower() == "birchwood":
            conn.execute(
                "INSERT INTO reservable_facilities (name, description, daily_fee, hourly_fee, deposit_amount, capacity, rules, sort_order) "
                "VALUES ('Village Hall', 'Main municipal meeting hall available for community and private events.', '$75.00', '$25.00', '$100.00', '', 'Please leave hall clean and remove all trash after your event.', 1) "
                "ON CONFLICT (name) DO NOTHING"
            )


def _row_to_facility(r) -> dict:
    return {
        "id": r[0],
        "name": r[1],
        "description": r[2],
        "daily_fee": r[3],
        "hourly_fee": r[4],
        "deposit_amount": r[5],
        "capacity": r[6],
        "rules": r[7],
        "is_active": bool(r[8]),
        "sort_order": r[9],
    }


def _row_to_reservation(r) -> dict:
    return {
        "id": r[0],
        "reservation_number": r[1],
        "facility_id": r[2],
        "facility_name": r[3],
        "event_date": r[4].isoformat() if r[4] else None,
        "rental_mode": r[5] or "full_day",
        "start_time": r[6] or "",
        "end_time": r[7] or "",
        "event_title": r[8],
        "requester_name": r[9],
        "requester_email": r[10],
        "requester_phone": r[11],
        "notes": r[12],
        "fee_amount": r[13],
        "payment_status": r[14],
        "status": r[15],
        "staff_notes": r[16],
        "reviewed_by": r[17],
        "created_at": r[18].isoformat() if r[18] else None,
        "updated_at": r[19].isoformat() if r[19] else None,
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


_FAC_COLS = "id, name, description, daily_fee, hourly_fee, deposit_amount, capacity, rules, is_active, sort_order"

_RES_COLS = (
    "id, reservation_number, facility_id, facility_name, event_date, "
    "rental_mode, start_time, end_time, event_title, "
    "requester_name, requester_email, requester_phone, notes, fee_amount, "
    "payment_status, status, staff_notes, reviewed_by, created_at, updated_at"
)


class FacilityIn(BaseModel):
    name: str
    description: str = ""
    daily_fee: str = "$0.00"
    hourly_fee: str = ""
    deposit_amount: str = ""
    capacity: str = ""
    rules: str = ""
    is_active: bool = True
    sort_order: int = 0


class FacilityPatch(BaseModel):
    name: str | None = None
    description: str | None = None
    daily_fee: str | None = None
    hourly_fee: str | None = None
    deposit_amount: str | None = None
    capacity: str | None = None
    rules: str | None = None
    is_active: bool | None = None
    sort_order: int | None = None


class PublicReservationIn(BaseModel):
    facility_id: int
    event_date: str
    rental_mode: Literal["full_day", "hourly"] = "full_day"
    start_time: str = ""
    end_time: str = ""
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
            f"SELECT {_FAC_COLS} FROM reservable_facilities WHERE is_active = TRUE ORDER BY sort_order ASC, name ASC"
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
            "SELECT id, facility_id, facility_name, event_date, event_title, rental_mode, start_time, end_time "
            "FROM facility_reservations "
            "WHERE status = 'approved' AND event_date >= %s AND event_date < %s "
            "ORDER BY event_date ASC, start_time ASC, id ASC",
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
        r_mode = r[5] or "full_day"
        r_start = r[6] or ""
        r_end = r[7] or ""
        booked_slots.append({
            "facility_id": r[1],
            "facility_name": r[2],
            "event_date": r[3].isoformat(),
            "rental_mode": r_mode,
            "start_time": r_start,
            "end_time": r_end,
        })
        time_label = f"{r_start}-{r_end}" if (r_mode == "hourly" and r_start and r_end) else "All Day"
        items.append({
            "uid": f"res-{r[0]}",
            "kind": "reservation",
            "title": f"{r[2]} — Reserved" + (f" ({r[4]})" if r[4] else ""),
            "event_date": r[3].isoformat(),
            "start_time": time_label,
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


def _parse_hhmm_minutes(raw: str, label: str) -> int:
    clean = (raw or "").strip()
    parts = clean.split(":")
    if len(parts) != 2 or not parts[0].isdigit() or not parts[1].isdigit():
        raise HTTPException(status_code=400, detail=f"{label} must be HH:MM")
    h, m = int(parts[0]), int(parts[1])
    if not (0 <= h <= 23 and 0 <= m <= 59):
        raise HTTPException(status_code=400, detail=f"{label} must be a valid 24-hour time")
    return h * 60 + m


def _parse_money_float(raw: str) -> float | None:
    clean = (raw or "").strip().replace("$", "").replace(",", "")
    if not clean:
        return None
    try:
        return float(clean)
    except ValueError:
        return None


def _format_money(val: float) -> str:
    return f"${val:,.2f}"


def _compute_reservation_fee(rental_mode: str, start_min: int, end_min: int, daily_fee: str, hourly_fee: str, deposit_amount: str) -> str:
    if rental_mode == "hourly":
        hours = (end_min - start_min) / 60.0
        rate = _parse_money_float(hourly_fee)
        base = _format_money(rate * hours) if rate is not None else (hourly_fee or "$0.00")
    else:
        base = daily_fee or "$0.00"
    dep = (deposit_amount or "").strip()
    if dep and _parse_money_float(dep) not in (None, 0.0):
        return f"{base} + {dep} deposit"
    return base


@router.get("/public/ics")
def download_event_ics(kind: Literal["meeting", "event"], item_id: int):
    with pool.connection() as conn:
        if kind == "meeting":
            row = conn.execute(
                "SELECT title, meeting_date, meeting_time, body FROM agendas "
                "WHERE id = %s AND status = 'finalized' AND meeting_date IS NOT NULL",
                (item_id,),
            ).fetchone()
            if not row:
                raise HTTPException(status_code=404, detail="Meeting not found")
            title, ev_date, start_t, desc = row[0], row[1], row[2] or "", row[3] or ""
            loc = "City Hall"
        else:
            row = conn.execute(
                "SELECT title, event_date, start_time, location, description "
                "FROM calendar_events WHERE id = %s AND is_public = TRUE",
                (item_id,),
            ).fetchone()
            if not row:
                raise HTTPException(status_code=404, detail="Event not found")
            title, ev_date, start_t, loc, desc = row[0], row[1], row[2] or "", row[3] or "City Hall", row[4] or ""

    d_str = ev_date.strftime("%Y%m%d")
    t_clean = "".join(c for c in start_t if c.isdigit())
    if len(t_clean) >= 4:
        dtstart = f"DTSTART:{d_str}T{t_clean[:4]}00"
        end_hr = min(23, int(t_clean[:2]) + 1)
        dtend = f"DTEND:{d_str}T{end_hr:02d}{t_clean[2:4]}00"
    else:
        dtstart = f"DTSTART;VALUE=DATE:{d_str}"
        dtend = f"DTEND;VALUE=DATE:{d_str}"

    def _ics_esc(s: str) -> str:
        return str(s or "").replace("\\", "\\\\").replace(",", "\\,").replace(";", "\\;").replace("\n", "\\n")

    ics = "\r\n".join([
        "BEGIN:VCALENDAR",
        "VERSION:2.0",
        "PRODID:-//CivicDesk//City Calendar//EN",
        "BEGIN:VEVENT",
        f"UID:{kind}-{item_id}@civicdesk",
        f"DTSTAMP:{datetime.now(timezone.utc).strftime('%Y%m%dT%H%M%SZ')}",
        dtstart,
        dtend,
        f"SUMMARY:{_ics_esc(title)}",
        f"LOCATION:{_ics_esc(loc)}",
        f"DESCRIPTION:{_ics_esc(desc)}",
        "END:VEVENT",
        "END:VCALENDAR",
        "",
    ])
    return Response(
        content=ics.encode("utf-8"),
        media_type="text/calendar",
        headers={"Content-Disposition": f'attachment; filename="{kind}-{item_id}.ics"'},
    )


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

    rental_mode = body.rental_mode
    start_time = body.start_time.strip()
    end_time = body.end_time.strip()
    start_min = 0
    end_min = 24 * 60
    if rental_mode == "hourly":
        if not start_time or not end_time:
            raise HTTPException(status_code=400, detail="Start time and end time are required for hourly rentals")
        start_min = _parse_hhmm_minutes(start_time, "Start time")
        end_min = _parse_hhmm_minutes(end_time, "End time")
        if end_min <= start_min:
            raise HTTPException(status_code=400, detail="End time must be after start time")
        start_time = f"{start_min // 60:02d}:{start_min % 60:02d}"
        end_time = f"{end_min // 60:02d}:{end_min % 60:02d}"
    else:
        start_time = ""
        end_time = ""

    with pool.connection() as conn:
        fac = conn.execute(
            "SELECT id, name, daily_fee, hourly_fee, deposit_amount, is_active "
            "FROM reservable_facilities WHERE id = %s",
            (body.facility_id,),
        ).fetchone()
        if not fac or not fac[5]:
            raise HTTPException(status_code=400, detail="Selected facility is not available for reservation")
        if rental_mode == "hourly" and not (fac[3] or "").strip():
            raise HTTPException(status_code=400, detail=f"{fac[1]} only supports full-day rentals")

        existing = conn.execute(
            "SELECT id, rental_mode, start_time, end_time FROM facility_reservations "
            "WHERE facility_id = %s AND event_date = %s AND status = 'approved'",
            (body.facility_id, ev_date),
        ).fetchall()
        for _, ex_mode, ex_start, ex_end in existing:
            if (ex_mode or "full_day") == "full_day" or rental_mode == "full_day":
                raise HTTPException(
                    status_code=409,
                    detail=f"{fac[1]} already has a conflicting reservation on {ev_date.isoformat()}",
                )
            ex_s = _parse_hhmm_minutes(ex_start, "Existing start") if ex_start else 0
            ex_e = _parse_hhmm_minutes(ex_end, "Existing end") if ex_end else 24 * 60
            if start_min < ex_e and end_min > ex_s:
                raise HTTPException(
                    status_code=409,
                    detail=f"{fac[1]} is already reserved from {ex_start} to {ex_end} on {ev_date.isoformat()}",
                )

        fee_str = _compute_reservation_fee(rental_mode, start_min, end_min, fac[2], fac[3], fac[4])
        year = datetime.now(timezone.utc).year
        temp_num = f"RES-{year}-{uuid.uuid4().hex[:8].upper()}"
        row = conn.execute(
            f"INSERT INTO facility_reservations "
            f"(reservation_number, facility_id, facility_name, event_date, "
            f" rental_mode, start_time, end_time, event_title, "
            f" requester_name, requester_email, requester_phone, notes, fee_amount, status) "
            f"VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, 'pending') "
            f"RETURNING {_RES_COLS}",
            (
                temp_num,
                fac[0],
                fac[1],
                ev_date,
                rental_mode,
                start_time,
                end_time,
                body.event_title.strip(),
                name,
                body.requester_email.strip(),
                body.requester_phone.strip(),
                body.notes.strip(),
                fee_str,
            ),
        ).fetchone()
        res_id = row[0]
        final_num = f"RES-{year}-{res_id:04d}"
        row = conn.execute(
            f"UPDATE facility_reservations SET reservation_number = %s WHERE id = %s RETURNING {_RES_COLS}",
            (final_num, res_id),
        ).fetchone()
        res = _row_to_reservation(row)

    when_desc = f"{ev_date.isoformat()} ({start_time}–{end_time})" if rental_mode == "hourly" else f"{ev_date.isoformat()} (Full Day / 24hrs)"
    send_notification_email(
        "calendar_reservation_requested",
        f"[CivicDesk] New Facility Reservation Request {final_num}: {fac[1]}",
        f"{name} requested to reserve {fac[1]} on {when_desc} (Fee: {fee_str}).",
        link_path="/app#calendar-manage",
        request=request,
    )
    if res["requester_email"]:
        send_direct_email(
            [res["requester_email"]],
            f"[CivicDesk] Reservation Request Received: {final_num}",
            f"We received your request ({final_num}) to reserve {fac[1]} on {when_desc} (Fee: {fee_str}). "
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
            f"SELECT {_FAC_COLS} FROM reservable_facilities ORDER BY sort_order ASC, name ASC"
        ).fetchall()
    return [_row_to_facility(r) for r in rows]


@router.post("/facilities", status_code=201)
def create_facility(body: FacilityIn, _: dict = Depends(require_permission("calendar.manage"))):
    name = body.name.strip()
    if not name:
        raise HTTPException(status_code=400, detail="Facility name is required")
    with pool.connection() as conn:
        row = conn.execute(
            f"INSERT INTO reservable_facilities (name, description, daily_fee, hourly_fee, deposit_amount, capacity, rules, is_active, sort_order) "
            f"VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s) "
            f"RETURNING {_FAC_COLS}",
            (
                name,
                body.description.strip(),
                body.daily_fee.strip() or "$0.00",
                body.hourly_fee.strip(),
                body.deposit_amount.strip(),
                body.capacity.strip(),
                body.rules.strip(),
                body.is_active,
                body.sort_order,
            ),
        ).fetchone()
    return _row_to_facility(row)


@router.patch("/facilities/{fac_id}")
def update_facility(fac_id: int, body: FacilityPatch, _: dict = Depends(require_permission("calendar.manage"))):
    with pool.connection() as conn:
        row = conn.execute(
            f"UPDATE reservable_facilities SET "
            f"name = COALESCE(%s, name), "
            f"description = COALESCE(%s, description), "
            f"daily_fee = COALESCE(%s, daily_fee), "
            f"hourly_fee = COALESCE(%s, hourly_fee), "
            f"deposit_amount = COALESCE(%s, deposit_amount), "
            f"capacity = COALESCE(%s, capacity), "
            f"rules = COALESCE(%s, rules), "
            f"is_active = COALESCE(%s, is_active), "
            f"sort_order = COALESCE(%s, sort_order) "
            f"WHERE id = %s "
            f"RETURNING {_FAC_COLS}",
            (
                body.name.strip() if body.name is not None else None,
                body.description.strip() if body.description is not None else None,
                body.daily_fee.strip() if body.daily_fee is not None else None,
                body.hourly_fee.strip() if body.hourly_fee is not None else None,
                body.deposit_amount.strip() if body.deposit_amount is not None else None,
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
