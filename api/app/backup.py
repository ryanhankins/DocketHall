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

from fastapi import APIRouter, Depends, File, HTTPException, UploadFile
from fastapi.responses import FileResponse
from pydantic import BaseModel, Field
from psycopg.types.json import Jsonb
from starlette.background import BackgroundTask

from .agendas import _bucket, _minio, get_staff_user
from .db import pool
from .registry import get_module_backup_tables
from .tenancy import strip_tenant_prefix, tenant_object_key

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
        "public_subscriptions",
        ["id", "email", "topic", "token", "is_active", "created_at"],
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
]


def _get_export_tables() -> list[tuple[str, list[str], set[str], bool]]:
    return _CORE_TABLES + get_module_backup_tables()


def _json_val(v):
    if isinstance(v, (datetime, date)):
        return v.isoformat()
    return v


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


@router.get("/export")
def export_archive(user: dict = Depends(get_staff_user)):
    """Export all CivicDesk data in a human-readable and machine-reconstructible .zip archive."""
    include_users = user["role"] == "admin"
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

            # 4. Binary files from MinIO (documents + logo)
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
            for pref in table_data.get("agenda_preferences", []):
                if pref.get("city_logo_key"):
                    object_keys.append(pref["city_logo_key"])
            seen_keys: set[str] = set()
            minio_client = _minio()
            bucket = _bucket()
            for key in object_keys:
                if key in seen_keys:
                    continue
                seen_keys.add(key)
                try:
                    obj = minio_client.get_object(bucket, key)
                    try:
                        raw = obj.read()
                    finally:
                        obj.close()
                        obj.release_conn()
                    arc_path = f"files/{key}"
                    zf.writestr(arc_path, raw)
                    file_checksums[arc_path] = hashlib.sha256(raw).hexdigest()
                except Exception as exc:
                    warnings.append(f"Missing MinIO object {key}: {exc}")

            # 5. Manifest & README
            manifest = {
                "format": BACKUP_FORMAT,
                "exported_at": datetime.now(timezone.utc).isoformat(),
                "exported_by": user["username"],
                "includes_users": include_users,
                "row_counts": {k: len(v) for k, v in table_data.items()},
                "file_checksums": file_checksums,
                "warnings": warnings,
            }
            zf.writestr("manifest.json", json.dumps(manifest, indent=2))
            zf.writestr(
                "README.txt",
                "CivicDesk Full Archive\n"
                "======================\n\n"
                "- human/         Human-readable agendas (Markdown), todos/backlog (CSV),\n"
                "                 council submissions (CSV), preferences, and templates.\n"
                "- data/          Machine-reconstructible JSON table exports.\n"
                "- files/         Uploaded document attachments and logo from object storage.\n"
                "- manifest.json  Archive metadata and SHA-256 file checksums.\n\n"
                "To restore onto a fresh CivicDesk instance:\n"
                "Sign in as admin -> Manage Users -> Backup & Restore -> upload this .zip.\n",
            )
    except Exception:
        if os.path.exists(tmp_path):
            os.unlink(tmp_path)
        raise

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
    """Reconstruct CivicDesk database and MinIO files from a backup .zip archive."""
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
            export_tables = _get_export_tables()
            for tname, _, _, _ in export_tables:
                if tname == "users" and not has_users:
                    continue
                path = f"data/{tname}.json"
                if path not in names:
                    raise HTTPException(status_code=400, detail=f"Archive missing {path}")
                table_rows[tname] = json.loads(zf.read(path).decode("utf-8"))

            # Upload binary files to MinIO
            minio_client = _minio()
            bucket = _bucket()
            restored_files = 0
            for arc_path in manifest.get("file_checksums") or {}:
                if not arc_path.startswith("files/"):
                    continue
                raw_key = arc_path[len("files/"):]
                key = tenant_object_key(strip_tenant_prefix(raw_key))
                raw = zf.read(arc_path)
                ctype = mimetypes.guess_type(key)[0] or "application/octet-stream"
                minio_client.put_object(bucket, key, io.BytesIO(raw), length=len(raw), content_type=ctype)
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
                        if c in ("object_key", "city_logo_key") and isinstance(v, str) and v:
                            v = tenant_object_key(strip_tenant_prefix(v))
                        if c == "email" and v is None:
                            v = ""
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
