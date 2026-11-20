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

"""Configurable SLA thresholds and overdue escalation rules across FOIA, 311/Complaints, and Permits."""
from datetime import date, timedelta

from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel

from .audit import record_audit
from .auth import current_user, has_permission, require_permission
from .db import pool
from .integrations import send_direct_email, send_notification_email

router = APIRouter(prefix="/api/sla", tags=["sla"])

SCHEMA = """
CREATE TABLE IF NOT EXISTS core_sla_rules (
    rule_key            TEXT PRIMARY KEY,
    label               TEXT NOT NULL DEFAULT '',
    module_id           TEXT NOT NULL DEFAULT '',
    target_days         INTEGER NOT NULL DEFAULT 10,
    warning_days        INTEGER NOT NULL DEFAULT 3,
    escalation_email    TEXT NOT NULL DEFAULT '',
    auto_escalate       BOOLEAN NOT NULL DEFAULT TRUE,
    enabled             BOOLEAN NOT NULL DEFAULT TRUE,
    updated_by          TEXT NOT NULL DEFAULT '',
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);
"""

_DEFAULT_RULES = [
    ("foia_deadline", "FOIA / Public Records Statutory Deadline", "records", 10, 3),
    ("complaint_resolution", "311 / Complaint Target Resolution", "complaints", 14, 3),
    ("permit_review", "Permit Review Stalled Threshold", "permits", 14, 3),
]


def bootstrap() -> None:
    with pool.connection() as conn:
        with conn.transaction():
            conn.execute("SELECT pg_advisory_xact_lock(424255)")
            conn.execute(SCHEMA)
            for key, label, mod_id, target_days, warning_days in _DEFAULT_RULES:
                conn.execute(
                    "INSERT INTO core_sla_rules (rule_key, label, module_id, target_days, warning_days) "
                    "VALUES (%s, %s, %s, %s, %s) ON CONFLICT (rule_key) DO NOTHING",
                    (key, label, mod_id, target_days, warning_days),
                )


def _row_to_rule(r) -> dict:
    return {
        "rule_key": r[0],
        "label": r[1],
        "module_id": r[2],
        "target_days": int(r[3]),
        "warning_days": int(r[4]),
        "escalation_email": r[5] or "",
        "auto_escalate": bool(r[6]),
        "enabled": bool(r[7]),
        "updated_by": r[8] or "",
        "updated_at": r[9].isoformat() if r[9] else None,
    }


def get_sla_target_days(rule_key: str, default_days: int = 10) -> int:
    try:
        with pool.connection() as conn:
            row = conn.execute(
                "SELECT target_days, enabled FROM core_sla_rules WHERE rule_key = %s",
                (rule_key,),
            ).fetchone()
            if row and row[1] and int(row[0]) > 0:
                return int(row[0])
    except Exception:
        pass
    return default_days


def _parse_iso_date(val: str | None) -> date | None:
    s = (val or "").strip()[:10]
    if not s:
        return None
    try:
        return date.fromisoformat(s)
    except ValueError:
        return None


def _table_exists(conn, table_name: str) -> bool:
    row = conn.execute("SELECT to_regclass(%s)", (table_name,)).fetchone()
    return bool(row and row[0])


def _load_rules_map(conn) -> dict[str, dict]:
    rows = conn.execute(
        "SELECT rule_key, label, module_id, target_days, warning_days, "
        "escalation_email, auto_escalate, enabled, updated_by, updated_at "
        "FROM core_sla_rules ORDER BY rule_key"
    ).fetchall()
    return {r[0]: _row_to_rule(r) for r in rows}


def evaluate_sla_alerts(conn) -> dict:
    rules = _load_rules_map(conn)
    today = date.today()
    alerts: list[dict] = []

    # 1. FOIA / Public Records Requests
    r_foia = rules.get("foia_deadline")
    if r_foia and r_foia["enabled"] and _table_exists(conn, "public_records_requests"):
        rows = conn.execute(
            "SELECT id, request_number, subject, department, status, due_date, assigned_to, created_at "
            "FROM public_records_requests "
            "WHERE status NOT IN ('fulfilled', 'closed', 'denied') "
            "ORDER BY created_at ASC"
        ).fetchall()
        for r in rows:
            created_d = r[7].date() if r[7] else today
            due_d = _parse_iso_date(r[5]) or (created_d + timedelta(days=r_foia["target_days"]))
            days_rem = (due_d - today).days
            if days_rem < 0:
                severity = "overdue"
            elif days_rem <= r_foia["warning_days"]:
                severity = "warning"
            else:
                continue
            alerts.append({
                "rule_key": "foia_deadline",
                "module_id": "records",
                "record_id": r[0],
                "reference": r[1],
                "title": r[2],
                "detail": r[3] or "Public Records",
                "status": r[4],
                "assigned_to": r[6] or "",
                "due_date": due_d.isoformat(),
                "days_remaining": days_rem,
                "severity": severity,
                "link_hash": "#records",
            })

    # 2. 311 / Complaints
    r_comp = rules.get("complaint_resolution")
    if r_comp and r_comp["enabled"] and _table_exists(conn, "complaints"):
        rows = conn.execute(
            "SELECT id, complaint_number, subject_property_address, ordinance_section, "
            "status, assigned_to, nov_compliance_deadline, reinspection_date, created_at "
            "FROM complaints "
            "WHERE status NOT IN ('resolved', 'dismissed') "
            "ORDER BY created_at ASC"
        ).fetchall()
        for r in rows:
            created_d = r[8].date() if r[8] else today
            target_d = created_d + timedelta(days=r_comp["target_days"])
            for d_str in (r[6], r[7]):
                parsed = _parse_iso_date(d_str)
                if parsed and parsed < target_d:
                    target_d = parsed
            days_rem = (target_d - today).days
            if days_rem < 0:
                severity = "overdue"
            elif days_rem <= r_comp["warning_days"]:
                severity = "warning"
            else:
                continue
            alerts.append({
                "rule_key": "complaint_resolution",
                "module_id": "complaints",
                "record_id": r[0],
                "reference": r[1],
                "title": r[2] or "311 / Code Case",
                "detail": r[3] or "Code / 311",
                "status": r[4],
                "assigned_to": r[5] or "",
                "due_date": target_d.isoformat(),
                "days_remaining": days_rem,
                "severity": severity,
                "link_hash": "#complaints-manage",
            })

    # 3. Stalled Permit Reviews
    r_perm = rules.get("permit_review")
    if r_perm and r_perm["enabled"] and _table_exists(conn, "permits"):
        rows = conn.execute(
            "SELECT id, permit_number, property_address, permit_type_name, status, "
            "COALESCE(updated_at, created_at) "
            "FROM permits "
            "WHERE status IN ('submitted', 'under_review', 'in_review', 'pending', 'incomplete', 'corrections_required') "
            "ORDER BY COALESCE(updated_at, created_at) ASC"
        ).fetchall()
        for r in rows:
            touch_d = r[5].date() if r[5] else today
            due_d = touch_d + timedelta(days=r_perm["target_days"])
            days_rem = (due_d - today).days
            if days_rem < 0:
                severity = "overdue"
            elif days_rem <= r_perm["warning_days"]:
                severity = "warning"
            else:
                continue
            alerts.append({
                "rule_key": "permit_review",
                "module_id": "permits",
                "record_id": r[0],
                "reference": r[1],
                "title": r[2] or "Permit Application",
                "detail": r[3] or "Permit Review",
                "status": r[4],
                "assigned_to": "",
                "due_date": due_d.isoformat(),
                "days_remaining": days_rem,
                "severity": severity,
                "link_hash": "#permits-review",
            })

    alerts.sort(key=lambda a: (0 if a["severity"] == "overdue" else 1, a["days_remaining"], a["reference"]))
    overdue_count = sum(1 for a in alerts if a["severity"] == "overdue")
    warning_count = sum(1 for a in alerts if a["severity"] == "warning")
    by_rule = {}
    for rk in rules:
        by_rule[rk] = {
            "overdue": sum(1 for a in alerts if a["rule_key"] == rk and a["severity"] == "overdue"),
            "warning": sum(1 for a in alerts if a["rule_key"] == rk and a["severity"] == "warning"),
        }
    return {
        "summary": {
            "total": len(alerts),
            "overdue": overdue_count,
            "warning": warning_count,
            "by_rule": by_rule,
        },
        "alerts": alerts,
    }


def _require_sla_viewer(request: Request) -> dict:
    user = current_user(request)
    if not user:
        raise HTTPException(status_code=401, detail="Not authenticated")
    allowed = (
        has_permission(user, "settings.manage")
        or has_permission(user, "records.manage")
        or has_permission(user, "complaints.manage")
        or has_permission(user, "permits.manage")
    )
    if not allowed:
        raise HTTPException(status_code=403, detail="Insufficient permissions")
    return user


class SlaRulePatch(BaseModel):
    target_days: int | None = None
    warning_days: int | None = None
    escalation_email: str | None = None
    auto_escalate: bool | None = None
    enabled: bool | None = None


@router.get("/rules")
def list_sla_rules(_: dict = Depends(_require_sla_viewer)):
    with pool.connection() as conn:
        rules = list(_load_rules_map(conn).values())
    return {"rules": rules}


@router.patch("/rules/{rule_key}")
def update_sla_rule(
    rule_key: str,
    body: SlaRulePatch,
    user: dict = Depends(require_permission("settings.manage")),
):
    if body.target_days is not None and (body.target_days < 1 or body.target_days > 365):
        raise HTTPException(status_code=400, detail="Target days must be between 1 and 365")
    if body.warning_days is not None and (body.warning_days < 0 or body.warning_days > 90):
        raise HTTPException(status_code=400, detail="Warning days must be between 0 and 90")
    with pool.connection() as conn:
        row = conn.execute(
            "UPDATE core_sla_rules SET "
            "target_days = COALESCE(%s, target_days), "
            "warning_days = COALESCE(%s, warning_days), "
            "escalation_email = COALESCE(%s, escalation_email), "
            "auto_escalate = COALESCE(%s, auto_escalate), "
            "enabled = COALESCE(%s, enabled), "
            "updated_by = %s, updated_at = now() "
            "WHERE rule_key = %s "
            "RETURNING rule_key, label, module_id, target_days, warning_days, "
            "escalation_email, auto_escalate, enabled, updated_by, updated_at",
            (
                body.target_days,
                body.warning_days,
                body.escalation_email.strip() if body.escalation_email is not None else None,
                body.auto_escalate,
                body.enabled,
                user["username"],
                rule_key,
            ),
        ).fetchone()
        if not row:
            raise HTTPException(status_code=404, detail="SLA rule not found")
    record_audit(user["username"], "sla.update_rule", f"Updated SLA rule {rule_key}")
    return _row_to_rule(row)


@router.get("/alerts")
def get_sla_alerts(_: dict = Depends(_require_sla_viewer)):
    with pool.connection() as conn:
        return evaluate_sla_alerts(conn)


def run_sla_escalation_digest(request: Request | None = None) -> dict:
    with pool.connection() as conn:
        rules = _load_rules_map(conn)
        res = evaluate_sla_alerts(conn)
    alerts = res["alerts"]
    if not alerts:
        return {"sent": False, "overdue_count": 0, "warning_count": 0, "emailed_rules": [], "summary": []}

    emailed_rules: list[str] = []
    summary_lines: list[str] = []
    for rk, rule in rules.items():
        if not rule["enabled"] or not rule["auto_escalate"]:
            continue
        r_alerts = [a for a in alerts if a["rule_key"] == rk]
        if not r_alerts:
            continue
        overdue = [a for a in r_alerts if a["severity"] == "overdue"]
        warning = [a for a in r_alerts if a["severity"] == "warning"]
        line = f"• {rule['label']}: {len(overdue)} overdue, {len(warning)} approaching deadline"
        summary_lines.append(line)

        recipients = [e.strip() for e in rule["escalation_email"].split(",") if "@" in e]
        if recipients:
            detail_lines = [
                f"  - [{a['severity'].upper()}] {a['reference']} — {a['title']} (Due {a['due_date']}, {a['days_remaining']}d)"
                for a in r_alerts[:25]
            ]
            send_direct_email(
                recipients,
                f"[DocketHall SLA Escalation] {rule['label']} ({len(overdue)} overdue)",
                f"{line}\n\n" + "\n".join(detail_lines),
                link_path="/app#sla-rules",
                request=request,
            )
            emailed_rules.append(rk)

    if summary_lines:
        send_notification_email(
            "permits_updated",
            f"[DocketHall] Daily SLA & Overdue Escalation Digest ({res['summary']['overdue']} overdue)",
            "Cross-module SLA & deadline summary:\n\n" + "\n".join(summary_lines),
            link_path="/app#sla-rules",
            request=request,
        )

    return {
        "sent": bool(summary_lines),
        "overdue_count": res["summary"]["overdue"],
        "warning_count": res["summary"]["warning"],
        "emailed_rules": emailed_rules,
        "summary": summary_lines,
    }


@router.post("/run-digest")
def trigger_sla_digest(
    request: Request,
    user: dict = Depends(require_permission("settings.manage")),
):
    res = run_sla_escalation_digest(request=request)
    record_audit(
        user["username"],
        "sla.run_digest",
        f"sent={res['sent']}, overdue={res['overdue_count']}, warning={res['warning_count']}",
    )
    return res
