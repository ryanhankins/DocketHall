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

import csv
import hashlib
import io
import json
import mimetypes
import os
import re
import tempfile
import zipfile
from datetime import date, datetime, timedelta, timezone

from fastapi import APIRouter, Depends, File, HTTPException, Query, UploadFile
from fastapi.responses import FileResponse, StreamingResponse
from pydantic import BaseModel, Field
from psycopg.types.json import Jsonb
from starlette.background import BackgroundTask

from .agendas import _bucket, _storage, get_staff_user
from .audit import record_audit
from .auth import require_not_demo_mode, require_permission
from .db import pool
from .registry import get_module_backup_tables
from .storage import BotoS3StorageClient
from .tenancy import get_current_tenant_slug, strip_tenant_prefix, tenant_object_key

router = APIRouter(prefix="/api/backup", tags=["backup"])

BACKUP_FORMAT = "civicdesk-backup-v1"
_SLUG_RE = re.compile(r"[^A-Za-z0-9._-]+")

# Core table definitions in foreign-key dependency order.
# (table_name, columns, jsonb_columns, has_serial_id)
_CORE_TABLES: list[tuple[str, list[str], set[str], bool]] = [
    (
        "users",
        ["id", "username", "email", "password_hash", "role", "permissions", "is_active", "is_default_password", "created_at", "last_login_at"],
        {"permissions"},
        True,
    ),
    (
        "core_modules",
        ["module_id", "enabled", "features", "updated_at"],
        {"features"},
        False,
    ),
    (
        "core_integrations",
        ["provider", "enabled", "api_key", "project_id", "config", "validated_at", "last_status", "updated_by", "updated_at"],
        {"config"},
        False,
    ),
    (
        "core_sla_rules",
        ["rule_key", "label", "module_id", "target_days", "warning_days", "escalation_email", "auto_escalate", "enabled", "updated_by", "updated_at"],
        set(),
        False,
    ),
    (
        "public_subscriptions",
        ["id", "email", "topic", "token", "is_active", "created_at", "phone", "sms_enabled"],
        set(),
        True,
    ),
    (
        "core_audit_log",
        ["id", "actor_username", "action", "target_type", "target_id", "summary", "created_at"],
        set(),
        True,
    ),
    (
        "core_help_docs",
        ["id", "slug", "title", "category", "audience", "sort_order", "body", "is_published", "updated_by", "created_at", "updated_at"],
        set(),
        True,
    ),
    (
        "municipal_bills",
        [
            "id", "reference_number", "bill_type", "account_number", "payer_name", "payer_email",
            "service_address", "description", "amount_due", "due_date", "payment_status", "paid_at",
            "payment_method", "payment_ref", "notes", "created_by", "created_at", "updated_at",
            "line_items", "amount_paid", "late_fee_applied", "dispute_status", "dispute_notes", "gl_account_code",
        ],
        {"line_items"},
        True,
    ),
]


def _get_export_tables() -> list[tuple[str, list[str], set[str], bool]]:
    return _CORE_TABLES + get_module_backup_tables()


def _json_val(v):
    if isinstance(v, (datetime, date)):
        return v.isoformat()
    return v


def _toposort_self_ref_rows(rows: list[dict]) -> list[dict]:
    """Order rows with a self-referencing parent_id FK so parents insert before children."""
    ordered: list[dict] = []
    seen_ids: set = set()
    remaining = list(rows)
    while remaining:
        progressed = False
        next_rem: list[dict] = []
        for r in remaining:
            pid = r.get("parent_id")
            if pid is None or pid in seen_ids:
                ordered.append(r)
                if r.get("id") is not None:
                    seen_ids.add(r.get("id"))
                progressed = True
            else:
                next_rem.append(r)
        remaining = next_rem
        if not progressed:
            ordered.extend(remaining)
            break
    return ordered


def _fetch_table(conn, table: str, cols: list[str]) -> list[dict]:
    col_sql = ", ".join(cols)
    order_sql = " ORDER BY id ASC" if "id" in cols else ""
    rows = conn.execute(f"SELECT {col_sql} FROM {table}{order_sql}").fetchall()
    return [{c: _json_val(row[i]) for i, c in enumerate(cols)} for row in rows]


def _csv_bytes(headers: list[str], rows: list[list]) -> bytes:
    buf = io.StringIO()
    writer = csv.writer(buf)
    writer.writerow(headers)
    writer.writerows(rows)
    return buf.getvalue().encode("utf-8")


def _slug(text: str) -> str:
    return _SLUG_RE.sub("_", (text or "").strip()).strip("._") or "untitled"


def _render_agenda_md(agenda: dict, items: list[dict], docs_by_item: dict[int, list[dict]], logs: list[dict]) -> str:
    lines = [
        f"# {agenda['title']}",
        "",
        f"- **Body:** {agenda['body'] or '—'}",
        f"- **Meeting Date:** {agenda['meeting_date'] or '—'}",
        f"- **Meeting Time:** {agenda['meeting_time'] or '—'}",
        f"- **Status:** {agenda['status'] or '—'}",
        f"- **Finalized At:** {agenda['finalized_at'] or '—'}",
    ]
    if agenda.get("minutes_attendance"):
        lines.append(f"- **Attendance:** {agenda['minutes_attendance']}")
    if agenda.get("minutes_notes"):
        lines.extend(["", "## Minutes Notes", "", agenda["minutes_notes"]])

    lines.extend(["", "## Agenda Items", ""])
    if not items:
        lines.append("_No items._")
    for it in items:
        lines.append(f"### {it['position']}. {it['title']}")
        if it.get("section"):
            lines.append(f"- **Section:** {it['section']}")
        if it.get("presenter"):
            lines.append(f"- **Presenter:** {it['presenter']}")
        if it.get("revision_status"):
            lines.append(f"- **Revision Status:** {it['revision_status']}")
        if it.get("recommended_motion"):
            lines.append(f"- **Recommended Motion:** {it['recommended_motion']}")
        if it.get("fiscal_impact"):
            lines.append(f"- **Fiscal Impact:** {it['fiscal_impact']}")
        if it.get("description"):
            lines.extend(["", it["description"], ""])
        if any(it.get(k) for k in ("minutes_action", "minutes_motion_by", "minutes_second_by", "minutes_vote", "minutes_notes")):
            lines.append(
                f"- **Minutes:** Action={it.get('minutes_action') or '—'}, "
                f"Motion={it.get('minutes_motion_by') or '—'}, "
                f"Second={it.get('minutes_second_by') or '—'}, "
                f"Vote={it.get('minutes_vote') or '—'}"
            )
            if it.get("minutes_notes"):
                lines.append(f"  - Notes: {it['minutes_notes']}")
        docs = docs_by_item.get(it["id"], [])
        if docs:
            lines.append("- **Attachments:**")
            for d in docs:
                lines.append(f"  - `{d['title']}` (`files/{d['object_key']}`, {d['filename']})")
        lines.append("")

    if logs:
        lines.extend(["## Status Log", ""])
        for lg in logs:
            note = f" — {lg['note']}" if lg.get("note") else ""
            lines.append(f"- `{lg['created_at']}` **{lg['actor_username'] or 'system'}**: {lg['action']}{note}")
    return "\n".join(lines) + "\n"


class BackupSettingsIn(BaseModel):
    reminder_days: int = Field(ge=0, le=3650)


def _load_backup_status(conn) -> dict:
    row = conn.execute(
        "SELECT backup_reminder_days, last_backup_at FROM agenda_preferences WHERE id = 1"
    ).fetchone()
    days = int(row[0]) if row and row[0] is not None else 0
    last_at = row[1] if row else None
    now = datetime.now(timezone.utc)
    days_since = None
    overdue = False
    if last_at is not None:
        if last_at.tzinfo is None:
            last_at = last_at.replace(tzinfo=timezone.utc)
        days_since = max(0, int((now - last_at).total_seconds() // 86400))
    if days > 0:
        overdue = last_at is None or (now - last_at) >= timedelta(days=days)
    return {
        "reminder_days": days,
        "last_backup_at": last_at.isoformat() if last_at else None,
        "days_since_backup": days_since,
        "overdue": overdue,
    }


@router.get("/status")
def get_backup_status(_: dict = Depends(get_staff_user)):
    """Return backup reminder settings and whether a backup is currently overdue."""
    with pool.connection() as conn:
        return _load_backup_status(conn)


@router.put("/settings")
def update_backup_settings(body: BackupSettingsIn, _: dict = Depends(get_staff_user)):
    """Update the backup reminder interval in days (0 disables the reminder)."""
    with pool.connection() as conn:
        conn.execute(
            "UPDATE agenda_preferences SET backup_reminder_days = %s, updated_at = now() WHERE id = 1",
            (body.reminder_days,),
        )
        return _load_backup_status(conn)


def _build_backup_zip(include_users: bool, exported_by: str) -> str:
    table_data: dict[str, list[dict]] = {}
    with pool.connection() as conn:
        for tname, cols, _, _ in _get_export_tables():
            if tname == "users" and not include_users:
                continue
            table_data[tname] = _fetch_table(conn, tname, cols)

    tmp = tempfile.NamedTemporaryFile(delete=False, suffix=".zip")
    tmp_path = tmp.name
    tmp.close()

    file_checksums: dict[str, str] = {}
    warnings: list[str] = []

    try:
        with zipfile.ZipFile(tmp_path, "w", compression=zipfile.ZIP_DEFLATED) as zf:
            # 1. Machine-reconstructible JSON tables
            for tname, rows in table_data.items():
                zf.writestr(f"data/{tname}.json", json.dumps(rows, indent=2))

            # 2. Human-readable agendas & attachments index
            items_by_agenda: dict[int, list[dict]] = {}
            backlog_items: list[dict] = []
            for it in table_data.get("agenda_items", []):
                if it["agenda_id"] is None:
                    backlog_items.append(it)
                else:
                    items_by_agenda.setdefault(it["agenda_id"], []).append(it)
            for lst in items_by_agenda.values():
                lst.sort(key=lambda x: (x["position"], x["id"]))

            docs_by_item: dict[int, list[dict]] = {}
            for d in table_data.get("agenda_documents", []):
                docs_by_item.setdefault(d["agenda_item_id"], []).append(d)
            for lst in docs_by_item.values():
                lst.sort(key=lambda x: (x["position"], x["id"]))

            logs_by_agenda: dict[int, list[dict]] = {}
            for lg in table_data.get("agenda_status_log", []):
                logs_by_agenda.setdefault(lg["agenda_id"], []).append(lg)

            for ag in table_data.get("agendas", []):
                folder = f"{ag['meeting_date'] or 'undated'}_{ag['id']}_{_slug(ag['title'])}"
                md = _render_agenda_md(
                    ag,
                    items_by_agenda.get(ag["id"], []),
                    docs_by_item,
                    logs_by_agenda.get(ag["id"], []),
                )
                zf.writestr(f"human/agendas/{folder}/agenda.md", md)

            # 3. Human-readable CSVs & JSON config
            zf.writestr(
                "human/todos_and_backlog.csv",
                _csv_bytes(
                    [
                        "id", "title", "todo_status", "target_body", "target_date",
                        "assigned_to", "recurrence", "recurrence_month", "section",
                        "description", "created_at", "completed_at",
                    ],
                    [
                        [
                            it["id"], it["title"], it["todo_status"], it["target_body"],
                            it["target_date"] or "", it["assigned_to"], it["recurrence"],
                            it["recurrence_month"] or "", it["section"], it["description"],
                            it["created_at"] or "", it["completed_at"] or "",
                        ]
                        for it in backlog_items
                    ],
                ),
            )
            zf.writestr(
                "human/council_submissions.csv",
                _csv_bytes(
                    [
                        "id", "submitted_username", "title", "status", "target_agenda_id",
                        "target_date", "target_note", "accepted_agenda_id",
                        "reviewed_username", "review_note", "created_at", "reviewed_at",
                    ],
                    [
                        [
                            s["id"], s["submitted_username"], s["title"], s["status"],
                            s["target_agenda_id"] or "", s["target_date"] or "",
                            s["target_note"], s["accepted_agenda_id"] or "",
                            s["reviewed_username"], s["review_note"],
                            s["created_at"] or "", s["reviewed_at"] or "",
                        ]
                        for s in table_data.get("council_submissions", [])
                    ],
                ),
            )
            zf.writestr("human/preferences.json", json.dumps(table_data.get("agenda_preferences", []), indent=2))
            zf.writestr("human/templates.json", json.dumps(table_data.get("agenda_templates", []), indent=2))

            # 4. Binary files from object storage (documents + logo)
            object_keys: list[str] = [d["object_key"] for d in table_data.get("agenda_documents", []) if d.get("object_key")]
            object_keys.extend(
                sd["object_key"] for sd in table_data.get("council_submission_documents", []) if sd.get("object_key")
            )
            object_keys.extend(
                rf["object_key"] for rf in table_data.get("repository_files", []) if rf.get("object_key")
            )
            object_keys.extend(
                cd["object_key"] for cd in table_data.get("complaint_documents", []) if cd.get("object_key")
            )
            object_keys.extend(
                pd["object_key"] for pd in table_data.get("permit_documents", []) if pd.get("object_key")
            )
            object_keys.extend(
                cs["object_key"] for cs in table_data.get("code_sections", []) if cs.get("object_key")
            )
            object_keys.extend(
                prr["fulfillment_object_key"] for prr in table_data.get("public_records_requests", []) if prr.get("fulfillment_object_key")
            )
            object_keys.extend(
                cn["attachment_key"] for cn in table_data.get("city_notices", []) if cn.get("attachment_key")
            )
            for pref in table_data.get("agenda_preferences", []):
                if pref.get("city_logo_key"):
                    object_keys.append(pref["city_logo_key"])
            seen_keys: set[str] = set()
            storage_client = _storage()
            bucket = _bucket()
            for key in object_keys:
                if key in seen_keys:
                    continue
                seen_keys.add(key)
                try:
                    obj = storage_client.get_object(bucket, key)
                    try:
                        raw = obj.read()
                    finally:
                        obj.close()
                        obj.release_conn()
                    arc_path = f"files/{key}"
                    zf.writestr(arc_path, raw)
                    file_checksums[arc_path] = hashlib.sha256(raw).hexdigest()
                except Exception as exc:
                    warnings.append(f"Missing storage object {key}: {exc}")

            # 5. Manifest & README
            manifest = {
                "format": BACKUP_FORMAT,
                "exported_at": datetime.now(timezone.utc).isoformat(),
                "exported_by": exported_by,
                "includes_users": include_users,
                "row_counts": {k: len(v) for k, v in table_data.items()},
                "file_checksums": file_checksums,
                "warnings": warnings,
            }
            zf.writestr("manifest.json", json.dumps(manifest, indent=2))
            zf.writestr(
                "README.txt",
                "DocketHall Full Archive\n"
                "======================\n\n"
                "- human/         Human-readable agendas (Markdown), todos/backlog (CSV),\n"
                "                 council submissions (CSV), preferences, and templates.\n"
                "- data/          Machine-reconstructible JSON table exports.\n"
                "- files/         Uploaded document attachments and logo from object storage.\n"
                "- manifest.json  Archive metadata and SHA-256 file checksums.\n\n"
                "To restore onto a fresh DocketHall instance:\n"
                "Sign in as admin -> Manage Users -> Backup & Restore -> upload this .zip.\n",
            )
    except Exception:
        if os.path.exists(tmp_path):
            os.unlink(tmp_path)
        raise
    return tmp_path


@router.get("/export")
def export_archive(user: dict = Depends(get_staff_user)):
    """Export all DocketHall data in a human-readable and machine-reconstructible .zip archive."""
    tmp_path = _build_backup_zip(include_users=(user["role"] == "admin"), exported_by=user["username"])

    with pool.connection() as conn:
        conn.execute("UPDATE agenda_preferences SET last_backup_at = now() WHERE id = 1")

    stamp = datetime.now(timezone.utc).strftime("%Y%m%d_%H%M%S")
    return FileResponse(
        tmp_path,
        media_type="application/zip",
        filename=f"civicdesk_backup_{stamp}.zip",
        background=BackgroundTask(os.unlink, tmp_path),
    )


@router.post("/import")
async def import_archive(
    file: UploadFile = File(...),
    user: dict = Depends(get_staff_user),
):
    """Reconstruct DocketHall database and stored files from a backup .zip archive."""
    tmp = tempfile.NamedTemporaryFile(delete=False, suffix=".zip")
    tmp_path = tmp.name
    try:
        while chunk := await file.read(1024 * 1024):
            tmp.write(chunk)
        tmp.close()

        if not zipfile.is_zipfile(tmp_path):
            raise HTTPException(status_code=400, detail="Uploaded file is not a valid .zip archive")

        with zipfile.ZipFile(tmp_path, "r") as zf:
            names = set(zf.namelist())
            if "manifest.json" not in names:
                raise HTTPException(status_code=400, detail="Archive is missing manifest.json")
            manifest = json.loads(zf.read("manifest.json").decode("utf-8"))
            if manifest.get("format") != BACKUP_FORMAT:
                raise HTTPException(status_code=400, detail="Unsupported backup archive format")

            # Verify binary checksums before modifying state
            for arc_path, expected_sha in (manifest.get("file_checksums") or {}).items():
                if arc_path not in names:
                    raise HTTPException(status_code=400, detail=f"Archive missing file: {arc_path}")
                actual_sha = hashlib.sha256(zf.read(arc_path)).hexdigest()
                if actual_sha != expected_sha:
                    raise HTTPException(status_code=400, detail=f"Checksum mismatch for {arc_path}")

            table_rows: dict[str, list[dict]] = {}
            has_users = ("data/users.json" in names) and (user["role"] == "admin")
            core_names = {t for t, _, _, _ in _CORE_TABLES}
            export_tables = _get_export_tables()
            for tname, _, _, _ in export_tables:
                if tname == "users" and not has_users:
                    continue
                path = f"data/{tname}.json"
                if path not in names:
                    if tname in core_names:
                        raise HTTPException(status_code=400, detail=f"Archive missing {path}")
                    continue
                table_rows[tname] = json.loads(zf.read(path).decode("utf-8"))

            # Upload binary files to object storage
            storage_client = _storage()
            bucket = _bucket()
            restored_files = 0
            for arc_path in manifest.get("file_checksums") or {}:
                if not arc_path.startswith("files/"):
                    continue
                raw_key = arc_path[len("files/"):]
                key = tenant_object_key(strip_tenant_prefix(raw_key))
                raw = zf.read(arc_path)
                ctype = mimetypes.guess_type(key)[0] or "application/octet-stream"
                storage_client.put_object(bucket, key, io.BytesIO(raw), length=len(raw), content_type=ctype)
                restored_files += 1

        # Restore Postgres tables in a single transaction
        with pool.connection() as conn:
            existing_user_ids: set[int] = set()
            if not has_users:
                existing_user_ids = {r[0] for r in conn.execute("SELECT id FROM users").fetchall()}
            else:
                conn.execute("TRUNCATE TABLE sessions, password_reset_tokens CASCADE")

            truncate_targets = [t for t, _, _, _ in reversed(export_tables) if (t != "users" or has_users)]
            conn.execute(f"TRUNCATE TABLE {', '.join(truncate_targets)} RESTART IDENTITY CASCADE")

            for tname, cols, jsonb_cols, has_serial in export_tables:
                if tname not in table_rows:
                    continue
                rows = table_rows[tname]
                if not rows:
                    continue
                if "parent_id" in cols:
                    rows = _toposort_self_ref_rows(rows)
                col_sql = ", ".join(cols)
                placeholders = ", ".join(["%s"] * len(cols))
                insert_sql = f"INSERT INTO {tname} ({col_sql}) VALUES ({placeholders})"

                user_id_fk_cols = {
                    "created_by", "uploaded_by", "submitted_by", "reviewed_by",
                    "applicant_user_id", "complainant_user_id",
                }
                for row in rows:
                    vals = []
                    for c in cols:
                        v = row.get(c)
                        if not has_users and c in user_id_fk_cols and isinstance(v, int) and v not in existing_user_ids:
                            v = None
                        if c in ("object_key", "city_logo_key", "fulfillment_object_key", "attachment_key") and isinstance(v, str) and v:
                            v = tenant_object_key(strip_tenant_prefix(v))
                        if c == "email" and v is None:
                            v = ""
                        if c == "node_type" and not v:
                            v = "section"
                        if c in jsonb_cols:
                            if v is None and c == "permissions":
                                v = []
                            if v is not None:
                                v = Jsonb(v)
                        vals.append(v)
                    conn.execute(insert_sql, tuple(vals))

                if has_serial:
                    conn.execute(
                        f"SELECT setval(pg_get_serial_sequence('{tname}', 'id'), "
                        f"COALESCE((SELECT MAX(id) FROM {tname}), 1), "
                        f"(SELECT COUNT(*) > 0 FROM {tname}))"
                    )

        return {
            "status": "restored",
            "restored_by": user["username"],
            "includes_users": has_users,
            "row_counts": {k: len(v) for k, v in table_rows.items()},
            "restored_files": restored_files,
        }
    finally:
        if os.path.exists(tmp_path):
            os.unlink(tmp_path)


_DEFAULT_BACKUP_POLICY = {
    "enabled": False,
    "schedule_frequency": "daily",
    "target_type": "local_s3",
    "s3_endpoint": "",
    "s3_bucket": "",
    "s3_prefix": "backups/",
    "s3_access_key": "",
    "s3_secure": True,
    "retain_backups_count": 30,
    "retention_enabled": False,
    "retention_complaints_years": 0,
    "retention_foia_years": 0,
    "retention_audit_years": 0,
    "last_offsite_backup_at": None,
    "last_offsite_key": "",
    "last_retention_run_at": None,
}


def _load_backup_policy(conn) -> tuple[dict, str]:
    row = conn.execute(
        "SELECT enabled, api_key, config FROM core_integrations WHERE provider = 'offsite_backup_policy'"
    ).fetchone()
    cfg = dict(_DEFAULT_BACKUP_POLICY)
    secret = ""
    if row:
        cfg["enabled"] = bool(row[0])
        secret = (row[1] or "").strip()
        if isinstance(row[2], dict):
            cfg.update(row[2])
    cfg["has_s3_secret"] = bool(secret)
    return cfg, secret


def _get_offsite_s3_client(cfg: dict, secret: str) -> tuple[object, str, str]:
    prefix = (cfg.get("s3_prefix") or "backups/").strip().lstrip("/")
    if prefix and not prefix.endswith("/"):
        prefix += "/"
    tenant = get_current_tenant_slug() or "default"
    full_prefix = f"{prefix}{tenant}/"
    if cfg.get("target_type") == "s3_compatible" and (cfg.get("s3_endpoint") or "").strip():
        bucket = (cfg.get("s3_bucket") or "").strip() or _bucket()
        client = BotoS3StorageClient(
            cfg["s3_endpoint"].strip(),
            access_key=(cfg.get("s3_access_key") or "").strip(),
            secret_key=secret,
            secure=bool(cfg.get("s3_secure", True)),
        )
        return client, bucket, full_prefix
    return _storage(), (cfg.get("s3_bucket") or "").strip() or _bucket(), full_prefix


class BackupPolicyIn(BaseModel):
    enabled: bool = False
    schedule_frequency: str = "daily"
    target_type: str = "local_s3"
    s3_endpoint: str = ""
    s3_bucket: str = ""
    s3_prefix: str = "backups/"
    s3_access_key: str = ""
    s3_secret_key: str | None = None
    s3_secure: bool = True
    retain_backups_count: int = Field(default=30, ge=1, le=3650)
    retention_enabled: bool = False
    retention_complaints_years: int = Field(default=0, ge=0, le=100)
    retention_foia_years: int = Field(default=0, ge=0, le=100)
    retention_audit_years: int = Field(default=0, ge=0, le=100)


@router.get("/policy")
def get_backup_policy(_: dict = Depends(require_permission("settings.manage"))):
    with pool.connection() as conn:
        cfg, secret = _load_backup_policy(conn)
    snapshots: list[dict] = []
    try:
        client, bucket, full_prefix = _get_offsite_s3_client(cfg, secret)
        if client.bucket_exists(bucket):
            objs = sorted(
                client.list_objects(bucket, prefix=full_prefix, recursive=True),
                key=lambda o: o.last_modified or datetime.min.replace(tzinfo=timezone.utc),
                reverse=True,
            )
            for o in objs[:25]:
                snapshots.append({
                    "object_key": o.object_name,
                    "size_bytes": o.size,
                    "last_modified": o.last_modified.isoformat() if o.last_modified else None,
                })
    except Exception:
        pass
    return {"policy": cfg, "snapshots": snapshots}


@router.get("/snapshots/download")
def download_offsite_snapshot(
    key: str = Query(..., min_length=1),
    user: dict = Depends(require_permission("settings.manage")),
):
    """Download an offsite backup snapshot .zip by object key."""
    with pool.connection() as conn:
        cfg, secret = _load_backup_policy(conn)
    client, bucket, full_prefix = _get_offsite_s3_client(cfg, secret)
    clean_key = key.strip().lstrip("/")
    if (
        not clean_key.startswith(full_prefix)
        or ".." in clean_key.split("/")
        or not clean_key.lower().endswith(".zip")
    ):
        raise HTTPException(status_code=400, detail="Invalid snapshot key")
    try:
        obj = client.get_object(bucket, clean_key)
    except Exception:
        raise HTTPException(status_code=404, detail="Snapshot not found")
    filename = _SLUG_RE.sub("_", os.path.basename(clean_key)) or "dockethall_backup.zip"
    record_audit(user["username"], "backup.download_snapshot", f"Downloaded {clean_key}")

    def _iter_chunks():
        try:
            yield from obj.stream(64 * 1024)
        finally:
            obj.close()
            obj.release_conn()

    return StreamingResponse(
        _iter_chunks(),
        media_type="application/zip",
        headers={
            "Content-Disposition": f'attachment; filename="{filename}"',
            "X-Content-Type-Options": "nosniff",
        },
    )


@router.put("/policy")
def update_backup_policy(
    body: BackupPolicyIn,
    user: dict = Depends(require_permission("settings.manage")),
):
    require_not_demo_mode("Modifying offsite backup policy")
    freq = body.schedule_frequency if body.schedule_frequency in ("daily", "weekly") else "daily"
    ttype = body.target_type if body.target_type in ("local_s3", "s3_compatible") else "local_s3"
    with pool.connection() as conn:
        cur_cfg, cur_secret = _load_backup_policy(conn)
        next_secret = body.s3_secret_key.strip() if body.s3_secret_key is not None and body.s3_secret_key.strip() else cur_secret
        next_cfg = {
            **cur_cfg,
            "enabled": bool(body.enabled),
            "schedule_frequency": freq,
            "target_type": ttype,
            "s3_endpoint": body.s3_endpoint.strip(),
            "s3_bucket": body.s3_bucket.strip(),
            "s3_prefix": body.s3_prefix.strip() or "backups/",
            "s3_access_key": body.s3_access_key.strip(),
            "s3_secure": bool(body.s3_secure),
            "retain_backups_count": body.retain_backups_count,
            "retention_enabled": bool(body.retention_enabled),
            "retention_complaints_years": body.retention_complaints_years,
            "retention_foia_years": body.retention_foia_years,
            "retention_audit_years": body.retention_audit_years,
        }
        next_cfg.pop("has_s3_secret", None)
        conn.execute(
            "INSERT INTO core_integrations (provider, enabled, api_key, config, updated_by, updated_at) "
            "VALUES ('offsite_backup_policy', %s, %s, %s, %s, now()) "
            "ON CONFLICT (provider) DO UPDATE SET "
            "enabled = EXCLUDED.enabled, api_key = EXCLUDED.api_key, config = EXCLUDED.config, "
            "updated_by = EXCLUDED.updated_by, updated_at = now()",
            (bool(body.enabled), next_secret, Jsonb(next_cfg), user["username"]),
        )
        saved_cfg, _ = _load_backup_policy(conn)
    record_audit(user["username"], "backup.update_policy", f"Scheduled={body.enabled}, retention={body.retention_enabled}")
    return {"policy": saved_cfg}


def run_scheduled_offsite_backup(actor_username: str = "system", force: bool = False) -> dict:
    with pool.connection() as conn:
        cfg, secret = _load_backup_policy(conn)
    if not force and not cfg.get("enabled"):
        return {"ran": False, "reason": "disabled"}
    if not force and cfg.get("last_offsite_backup_at"):
        try:
            last_dt = datetime.fromisoformat(cfg["last_offsite_backup_at"])
            min_gap = timedelta(days=6, hours=23) if cfg.get("schedule_frequency") == "weekly" else timedelta(hours=23)
            if datetime.now(timezone.utc) - last_dt < min_gap:
                return {"ran": False, "reason": "not_due"}
        except Exception:
            pass

    tmp_path = _build_backup_zip(include_users=True, exported_by=actor_username)
    stamp = datetime.now(timezone.utc).strftime("%Y%m%d_%H%M%S")
    try:
        client, bucket, full_prefix = _get_offsite_s3_client(cfg, secret)
        if not client.bucket_exists(bucket):
            client.make_bucket(bucket)
        obj_key = f"{full_prefix}dockethall_backup_{stamp}.zip"
        size_bytes = os.path.getsize(tmp_path)
        with open(tmp_path, "rb") as fh:
            client.put_object(bucket, obj_key, fh, length=size_bytes, content_type="application/zip")

        keep = max(1, int(cfg.get("retain_backups_count") or 30))
        objs = sorted(
            client.list_objects(bucket, prefix=full_prefix, recursive=True),
            key=lambda o: o.last_modified or datetime.min.replace(tzinfo=timezone.utc),
            reverse=True,
        )
        pruned = 0
        for old_obj in objs[keep:]:
            client.remove_object(bucket, old_obj.object_name)
            pruned += 1
    finally:
        if os.path.exists(tmp_path):
            os.unlink(tmp_path)

    now_iso = datetime.now(timezone.utc).isoformat()
    with pool.connection() as conn:
        conn.execute("UPDATE agenda_preferences SET last_backup_at = now() WHERE id = 1")
        cur_cfg, cur_secret = _load_backup_policy(conn)
        cur_cfg.pop("has_s3_secret", None)
        cur_cfg["last_offsite_backup_at"] = now_iso
        cur_cfg["last_offsite_key"] = obj_key
        conn.execute(
            "INSERT INTO core_integrations (provider, enabled, api_key, config, updated_by, updated_at) "
            "VALUES ('offsite_backup_policy', %s, %s, %s, %s, now()) "
            "ON CONFLICT (provider) DO UPDATE SET config = EXCLUDED.config, updated_at = now()",
            (bool(cur_cfg.get("enabled")), cur_secret, Jsonb(cur_cfg), actor_username),
        )
    return {"ran": True, "object_key": obj_key, "size_bytes": size_bytes, "pruned_snapshots": pruned}


def run_retention_policies(actor_username: str = "system", force: bool = False) -> dict:
    with pool.connection() as conn:
        cfg, secret = _load_backup_policy(conn)
        if not force and not cfg.get("retention_enabled"):
            return {"ran": False, "reason": "disabled"}

        def _table_ok(name: str) -> bool:
            r = conn.execute("SELECT to_regclass(%s)", (name,)).fetchone()
            return bool(r and r[0])

        c_pruned = 0
        f_pruned = 0
        a_pruned = 0

        c_yrs = int(cfg.get("retention_complaints_years") or 0)
        if c_yrs > 0 and _table_ok("complaints"):
            res = conn.execute(
                "DELETE FROM complaints "
                "WHERE status IN ('resolved', 'dismissed') "
                "AND updated_at < now() - make_interval(years => %s)",
                (c_yrs,),
            )
            c_pruned = res.rowcount or 0

        f_yrs = int(cfg.get("retention_foia_years") or 0)
        if f_yrs > 0 and _table_ok("public_records_requests"):
            res = conn.execute(
                "DELETE FROM public_records_requests "
                "WHERE status IN ('fulfilled', 'closed', 'denied') "
                "AND updated_at < now() - make_interval(years => %s)",
                (f_yrs,),
            )
            f_pruned = res.rowcount or 0

        a_yrs = int(cfg.get("retention_audit_years") or 0)
        if a_yrs > 0 and _table_ok("core_audit_log"):
            res = conn.execute(
                "DELETE FROM core_audit_log WHERE created_at < now() - make_interval(years => %s)",
                (a_yrs,),
            )
            a_pruned = res.rowcount or 0

        cfg.pop("has_s3_secret", None)
        cfg["last_retention_run_at"] = datetime.now(timezone.utc).isoformat()
        conn.execute(
            "INSERT INTO core_integrations (provider, enabled, api_key, config, updated_by, updated_at) "
            "VALUES ('offsite_backup_policy', %s, %s, %s, %s, now()) "
            "ON CONFLICT (provider) DO UPDATE SET config = EXCLUDED.config, updated_at = now()",
            (bool(cfg.get("enabled")), secret, Jsonb(cfg), actor_username),
        )
    return {
        "ran": True,
        "complaints_pruned": c_pruned,
        "foia_pruned": f_pruned,
        "audit_pruned": a_pruned,
    }


@router.post("/run-offsite")
def trigger_offsite_backup(user: dict = Depends(require_permission("settings.manage"))):
    res = run_scheduled_offsite_backup(actor_username=user["username"], force=True)
    record_audit(user["username"], "backup.run_offsite", f"Uploaded {res.get('object_key')}")
    return res


@router.post("/run-retention")
def trigger_retention_policies(user: dict = Depends(require_permission("settings.manage"))):
    res = run_retention_policies(actor_username=user["username"], force=True)
    record_audit(
        user["username"],
        "backup.run_retention",
        f"Pruned complaints={res['complaints_pruned']}, foia={res['foia_pruned']}, audit={res['audit_pruned']}",
    )
    return res


@router.get("/readiness")
def get_launch_readiness(_: dict = Depends(require_permission("settings.manage", "agendas.manage"))):
    """Return live city launch & onboarding readiness checks."""
    from . import agendas

    branding = agendas.get_preferences_branding() or {}
    city_title_set = bool((branding.get("city_title") or "").strip())
    logo_set = bool(branding.get("has_city_logo"))
    reminder_days = int(branding.get("backup_reminder_days") or 0)

    with pool.connection() as conn:
        admin_row = conn.execute("SELECT is_default_password FROM users WHERE username = 'admin'").fetchone()
        default_pw = bool(admin_row and admin_row[0])
        smtp_row = conn.execute("SELECT enabled FROM core_integrations WHERE provider = 'gmail_smtp'").fetchone()
        smtp_configured = bool(smtp_row and smtp_row[0])
        policy, _ = _load_backup_policy(conn)
        backup_configured = bool(policy.get("enabled") or reminder_days > 0)

        def _count(sql: str) -> int:
            try:
                return int(conn.execute(sql).fetchone()[0] or 0)
            except Exception:
                return 0

        counts = {
            "agendas": _count("SELECT COUNT(*) FROM agendas"),
            "code_chapters": _count("SELECT COUNT(*) FROM code_chapters"),
            "blog_posts": _count("SELECT COUNT(*) FROM blog_posts"),
            "permit_types": _count("SELECT COUNT(*) FROM permit_types"),
        }

    return {
        "checks": [
            {
                "id": "branding",
                "label": "City Title & Seal Configured",
                "done": city_title_set and logo_set,
                "route": "/app/preferences-general",
            },
            {
                "id": "password",
                "label": "Default Admin Password Changed",
                "done": not default_pw,
                "route": "/app/my-account",
            },
            {
                "id": "smtp",
                "label": "Outgoing SMTP Email Configured",
                "done": smtp_configured,
                "route": "/app/integrations",
            },
            {
                "id": "backup",
                "label": "Backup Reminder or Offsite S3 Schedule Set",
                "done": backup_configured,
                "route": "/app/preferences-backup",
            },
            {
                "id": "content",
                "label": "Public Content Ready (Agenda, Code, Blog, or Permits)",
                "done": sum(counts.values()) > 0,
                "route": "/app/preferences-backup",
            },
        ],
        "counts": counts,
    }


@router.post("/seed-demo")
def seed_demo_city_data(user: dict = Depends(require_permission("settings.manage"))):
    """Idempotently populate realistic sample city data for evaluation and onboarding."""
    created = {"agendas": 0, "code_chapters": 0, "blog_posts": 0, "bills": 0}
    with pool.connection() as conn:
        try:
            ag_cnt = conn.execute("SELECT COUNT(*) FROM agendas").fetchone()[0]
            if ag_cnt == 0:
                ag = conn.execute(
                    "INSERT INTO agendas (title, body, meeting_date, meeting_time, status, finalized_at, created_by) "
                    "VALUES (%s, %s, CURRENT_DATE + 7, '18:30', 'Finalized Agendas', now(), %s) RETURNING id",
                    ("Regular City Council Meeting (Sample)", "City Council", user["username"]),
                ).fetchone()
                for pos, sec, ttl, pres, mot, fisc in [
                    (1, "Call to Order", "Call to Order & Roll Call", "Mayor", "", ""),
                    (2, "New Business", "Ordinance 2026-01: Water & Sewer Utility Rate Schedule", "Public Works Director", "Move to adopt Ordinance 2026-01.", "$18,500 projected annual utility fund revenue"),
                    (3, "New Business", "Approve 2026 Street Sealcoat Contract", "City Engineer", "Move to award contract to low bidder.", "$42,000 Street Improvement Fund"),
                ]:
                    conn.execute(
                        "INSERT INTO agenda_items (agenda_id, position, section, title, presenter, recommended_motion, fiscal_impact) "
                        "VALUES (%s, %s, %s, %s, %s, %s, %s)",
                        (ag[0], pos, sec, ttl, pres, mot, fisc),
                    )
                created["agendas"] = 1
        except Exception:
            pass

        try:
            ch_cnt = conn.execute("SELECT COUNT(*) FROM code_chapters").fetchone()[0]
            if ch_cnt == 0:
                ch = conn.execute(
                    "INSERT INTO code_chapters (code_prefix, title, description, sort_order, is_published) "
                    "VALUES ('100', 'General Provisions', 'Definitions, rules of construction, and general penalties.', 1, TRUE) RETURNING id"
                ).fetchone()
                conn.execute(
                    "INSERT INTO code_sections (chapter_id, section_number, title, body, sort_order, is_published) "
                    "VALUES (%s, '100.010', 'Definitions and Rules of Construction', %s, 1, TRUE)",
                    (ch[0], "Unless the context otherwise requires, 'City' means the Municipality and 'Code' means this Municipal Code of Ordinances."),
                )
                created["code_chapters"] = 1
        except Exception:
            pass

        try:
            post_cnt = conn.execute("SELECT COUNT(*) FROM blog_posts").fetchone()[0]
            if post_cnt == 0:
                cat = conn.execute(
                    "INSERT INTO blog_categories (slug, name, description, is_public) "
                    "VALUES ('city-updates', 'City Updates', 'Official news and community announcements.', TRUE) "
                    "ON CONFLICT (slug) DO UPDATE SET name = EXCLUDED.name RETURNING id"
                ).fetchone()
                conn.execute(
                    "INSERT INTO blog_posts (category_id, slug, title, lead_in, body, author_name, is_featured, is_published, created_by) "
                    "VALUES (%s, 'welcome-to-our-city-portal', 'Welcome to Our Online City Portal', "
                    "'Browse meeting agendas, apply for permits, pay utility bills, and submit 311 requests online.', "
                    "'Residents and businesses can now access city agendas, municipal code, public records, and permit applications 24/7.', "
                    "%s, TRUE, TRUE, %s) ON CONFLICT (slug) DO NOTHING",
                    (cat[0], user["username"], user["username"]),
                )
                created["blog_posts"] = 1
        except Exception:
            pass

        try:
            bill_cnt = conn.execute("SELECT COUNT(*) FROM municipal_bills").fetchone()[0]
            if bill_cnt == 0:
                conn.execute(
                    "INSERT INTO municipal_bills "
                    "(reference_number, bill_type, account_number, payer_name, service_address, description, amount_due, due_date, gl_account_code, created_by) "
                    "VALUES ('UTIL-DEMO-01', 'utility', 'ACCT-DEMO-100', 'Sample Resident', '100 Main St', "
                    "'Quarterly Water & Sewer Statement (Sample)', '$68.50', to_char(CURRENT_DATE + 15, 'YYYY-MM-DD'), '601-43200', %s) "
                    "ON CONFLICT (reference_number) DO NOTHING",
                    (user["username"],),
                )
                created["bills"] = 1
        except Exception:
            pass

    record_audit(user["username"], "backup.seed_demo", f"Seeded demo data: {created}")
    return {"seeded": created}
