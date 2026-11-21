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

"""Optional external integrations (e.g. Google Cloud API key configuration & validation)."""
import contextvars
import json
import os
import smtplib
import threading
import urllib.error
import urllib.request
from email.message import EmailMessage
from urllib.parse import urlparse

from fastapi import APIRouter, Depends, HTTPException, Request
from psycopg.types.json import Jsonb
from pydantic import BaseModel

from .auth import has_permission, require_admin, require_permission
from .db import pool

router = APIRouter(prefix="/api/integrations", tags=["integrations"])

GOOGLE_DISCOVERY_URL = "https://www.googleapis.com/discovery/v1/apis?fields=kind"

SCHEMA = """
CREATE TABLE IF NOT EXISTS core_integrations (
    provider        TEXT PRIMARY KEY,
    enabled         BOOLEAN NOT NULL DEFAULT FALSE,
    api_key         TEXT NOT NULL DEFAULT '',
    project_id      TEXT NOT NULL DEFAULT '',
    config          JSONB NOT NULL DEFAULT '{}'::jsonb,
    validated_at    TIMESTAMPTZ,
    last_status     TEXT NOT NULL DEFAULT '',
    updated_by      TEXT NOT NULL DEFAULT '',
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE core_integrations ADD COLUMN IF NOT EXISTS config JSONB NOT NULL DEFAULT '{}'::jsonb;
"""


def bootstrap() -> None:
    with pool.connection() as conn:
        with conn.transaction():
            conn.execute("SELECT pg_advisory_xact_lock(424249)")
            conn.execute(SCHEMA)
            smtp_email = os.environ.get("SMTP_SENDER_EMAIL", "").strip()
            smtp_pass = os.environ.get("SMTP_PASSWORD", "").strip()
            if smtp_email and smtp_pass:
                smtp_host = os.environ.get("SMTP_HOST", "smtp.gmail.com").strip() or "smtp.gmail.com"
                try:
                    smtp_port = int(os.environ.get("SMTP_PORT", "587"))
                except ValueError:
                    smtp_port = 587
                conn.execute(
                    "INSERT INTO core_integrations "
                    "(provider, enabled, api_key, project_id, config, last_status, updated_by, updated_at) "
                    "VALUES ('gmail_smtp', TRUE, %s, %s, %s, 'Seeded from environment', 'system', now()) "
                    "ON CONFLICT (provider) DO NOTHING",
                    (smtp_pass, smtp_email, Jsonb({"smtp_host": smtp_host, "smtp_port": smtp_port})),
                )


def _mask_key(key: str) -> str:
    k = (key or "").strip()
    if not k:
        return ""
    if len(k) <= 8:
        return "••••••••"
    return f"{k[:4]}••••••••{k[-4:]}"


def get_google_cloud_api_key() -> str | None:
    """Return the configured Google Cloud API key if enabled, else None."""
    with pool.connection() as conn:
        row = conn.execute(
            "SELECT api_key FROM core_integrations WHERE provider = 'google_cloud' AND enabled = TRUE"
        ).fetchone()
    if not row or not (row[0] or "").strip():
        return None
    return row[0].strip()


def _validate_google_api_key(api_key: str) -> tuple[bool, str]:
    """Validate a Google Cloud API key by calling Google's Discovery API."""
    key = (api_key or "").strip()
    if not key:
        return False, "API key cannot be empty."

    req = urllib.request.Request(
        GOOGLE_DISCOVERY_URL,
        headers={"X-Goog-Api-Key": key, "Accept": "application/json"},
        method="GET",
    )
    try:
        with urllib.request.urlopen(req, timeout=10) as resp:
            if resp.status == 200:
                return True, "Valid Google Cloud API key (Discovery API responded 200 OK)."
            return False, f"Unexpected response from Google Cloud API (HTTP {resp.status})."
    except urllib.error.HTTPError as exc:
        body_bytes = exc.read()
        msg = f"HTTP {exc.code}"
        reason = ""
        try:
            payload = json.loads(body_bytes.decode("utf-8"))
            err = payload.get("error") or {}
            if err.get("message"):
                msg = err["message"]
            for d in err.get("details") or []:
                if isinstance(d, dict) and d.get("reason"):
                    reason = d["reason"]
                    break
        except Exception:
            pass
        if reason in ("API_KEY_SERVICE_BLOCKED", "SERVICE_DISABLED") or (
            exc.code == 403 and "permission denied on the service" in msg.lower()
        ):
            return True, "Valid Google Cloud API key (authenticated; restricted to selected Google Cloud APIs)."
        return False, f"Google Cloud rejected the API key: {msg}"
    except Exception as exc:
        return False, f"Unable to reach Google Cloud API for validation: {exc}"


def _load_google_cloud_state(conn) -> dict:
    row = conn.execute(
        "SELECT enabled, api_key, project_id, validated_at, last_status, updated_by, updated_at "
        "FROM core_integrations WHERE provider = 'google_cloud'"
    ).fetchone()
    if not row:
        return {
            "provider": "google_cloud",
            "enabled": False,
            "has_api_key": False,
            "api_key_masked": "",
            "project_id": "",
            "validated_at": None,
            "last_status": "",
            "updated_by": "",
            "updated_at": None,
        }
    return {
        "provider": "google_cloud",
        "enabled": bool(row[0]),
        "has_api_key": bool((row[1] or "").strip()),
        "api_key_masked": _mask_key(row[1] or ""),
        "project_id": row[2] or "",
        "validated_at": row[3].isoformat() if row[3] else None,
        "last_status": row[4] or "",
        "updated_by": row[5] or "",
        "updated_at": row[6].isoformat() if row[6] else None,
    }


class GoogleCloudConfigIn(BaseModel):
    api_key: str | None = None
    project_id: str | None = None
    enabled: bool | None = None
    validate_key: bool = True


class GoogleCloudValidateIn(BaseModel):
    api_key: str | None = None


@router.get("/google-cloud")
def get_google_cloud_config(_: dict = Depends(require_admin)):
    with pool.connection() as conn:
        return _load_google_cloud_state(conn)


@router.put("/google-cloud")
def update_google_cloud_config(body: GoogleCloudConfigIn, admin: dict = Depends(require_admin)):
    with pool.connection() as conn:
        existing = conn.execute(
            "SELECT enabled, api_key, project_id, validated_at, last_status "
            "FROM core_integrations WHERE provider = 'google_cloud'"
        ).fetchone()

    cur_enabled = bool(existing[0]) if existing else False
    cur_key = (existing[1] or "") if existing else ""
    cur_project = (existing[2] or "") if existing else ""
    cur_val_at = existing[3] if existing else None
    cur_status = (existing[4] or "") if existing else ""

    new_key = cur_key if body.api_key is None else body.api_key.strip()
    new_project = cur_project if body.project_id is None else body.project_id.strip()
    new_enabled = cur_enabled if body.enabled is None else bool(body.enabled)

    if new_enabled and not new_key:
        raise HTTPException(status_code=400, detail="An API key is required to enable Google Cloud integration")

    validated_sql = "%s"
    validated_param = cur_val_at
    new_status = cur_status

    if body.api_key is not None:
        if new_key == "":
            new_enabled = False
            validated_param = None
            new_status = ""
        elif body.validate_key:
            ok, msg = _validate_google_api_key(new_key)
            if not ok:
                raise HTTPException(status_code=400, detail=msg)
            validated_sql = "now()"
            validated_param = None
            new_status = msg
        else:
            validated_param = None
            new_status = "Saved without validation"

    with pool.connection() as conn:
        if validated_sql == "now()":
            conn.execute(
                """
                INSERT INTO core_integrations
                    (provider, enabled, api_key, project_id, validated_at, last_status, updated_by, updated_at)
                VALUES ('google_cloud', %s, %s, %s, now(), %s, %s, now())
                ON CONFLICT (provider) DO UPDATE SET
                    enabled = EXCLUDED.enabled,
                    api_key = EXCLUDED.api_key,
                    project_id = EXCLUDED.project_id,
                    validated_at = now(),
                    last_status = EXCLUDED.last_status,
                    updated_by = EXCLUDED.updated_by,
                    updated_at = now()
                """,
                (new_enabled, new_key, new_project, new_status, admin["username"]),
            )
        else:
            conn.execute(
                """
                INSERT INTO core_integrations
                    (provider, enabled, api_key, project_id, validated_at, last_status, updated_by, updated_at)
                VALUES ('google_cloud', %s, %s, %s, %s, %s, %s, now())
                ON CONFLICT (provider) DO UPDATE SET
                    enabled = EXCLUDED.enabled,
                    api_key = EXCLUDED.api_key,
                    project_id = EXCLUDED.project_id,
                    validated_at = EXCLUDED.validated_at,
                    last_status = EXCLUDED.last_status,
                    updated_by = EXCLUDED.updated_by,
                    updated_at = now()
                """,
                (new_enabled, new_key, new_project, validated_param, new_status, admin["username"]),
            )
        return _load_google_cloud_state(conn)


@router.post("/google-cloud/validate")
def validate_google_cloud_key(body: GoogleCloudValidateIn, admin: dict = Depends(require_admin)):
    testing_saved = body.api_key is None or not body.api_key.strip()
    with pool.connection() as conn:
        if testing_saved:
            row = conn.execute(
                "SELECT api_key FROM core_integrations WHERE provider = 'google_cloud'"
            ).fetchone()
            key_to_test = (row[0] or "").strip() if row else ""
            if not key_to_test:
                raise HTTPException(status_code=400, detail="No Google Cloud API key is currently configured")
        else:
            key_to_test = body.api_key.strip()

    ok, msg = _validate_google_api_key(key_to_test)
    if testing_saved:
        with pool.connection() as conn:
            conn.execute(
                "UPDATE core_integrations SET "
                "validated_at = CASE WHEN %s THEN now() ELSE validated_at END, "
                "last_status = %s, updated_by = %s, updated_at = now() "
                "WHERE provider = 'google_cloud'",
                (ok, msg, admin["username"]),
            )
            state = _load_google_cloud_state(conn)
    else:
        with pool.connection() as conn:
            state = _load_google_cloud_state(conn)

    return {"valid": ok, "message": msg, "config": state}


@router.delete("/google-cloud")
def delete_google_cloud_config(_: dict = Depends(require_admin)):
    with pool.connection() as conn:
        conn.execute("DELETE FROM core_integrations WHERE provider = 'google_cloud'")
        return _load_google_cloud_state(conn)


# ------------------------------------------------------------------ Outgoing SMTP & Per-Module Notification Routing
_VALID_NOTIFICATION_MODULES = {"agendas", "permits", "complaints", "calendar", "notices", "forms", "records", "blog"}


def _load_email_state(conn) -> dict:
    row = conn.execute(
        "SELECT enabled, api_key, project_id, config, validated_at, last_status, updated_by, updated_at "
        "FROM core_integrations WHERE provider = 'gmail_smtp'"
    ).fetchone()
    if not row:
        return {
            "provider": "gmail_smtp",
            "enabled": False,
            "smtp_host": "smtp.gmail.com",
            "smtp_port": 587,
            "sender_email": "",
            "has_password": False,
            "password_masked": "",
            "validated_at": None,
            "last_status": "",
            "updated_by": "",
            "updated_at": None,
        }
    cfg = row[3] if isinstance(row[3], dict) else {}
    return {
        "provider": "gmail_smtp",
        "enabled": bool(row[0]),
        "smtp_host": (cfg.get("smtp_host") or "smtp.gmail.com").strip(),
        "smtp_port": int(cfg.get("smtp_port") or 587),
        "sender_email": row[2] or "",
        "has_password": bool((row[1] or "").strip()),
        "password_masked": _mask_key(row[1] or ""),
        "validated_at": row[4].isoformat() if row[4] else None,
        "last_status": row[5] or "",
        "updated_by": row[6] or "",
        "updated_at": row[7].isoformat() if row[7] else None,
    }


def _send_smtp_mail(
    smtp_host: str,
    smtp_port: int,
    sender_email: str,
    app_password: str,
    to_emails: list[str],
    subject: str,
    body: str,
) -> None:
    msg = EmailMessage()
    msg["From"] = sender_email
    msg["To"] = ", ".join(to_emails)
    msg["Subject"] = subject
    msg.set_content(body)
    with smtplib.SMTP(smtp_host, int(smtp_port), timeout=15) as smtp:
        smtp.ehlo()
        smtp.starttls()
        smtp.ehlo()
        smtp.login(sender_email, app_password)
        smtp.send_message(msg)


def _resolve_event_recipients(conn, event_key: str) -> list[str]:
    r_row = conn.execute(
        "SELECT config FROM core_integrations WHERE provider = 'email_routing'"
    ).fetchone()
    routing = (r_row[0] if (r_row and isinstance(r_row[0], dict)) else {})
    ev = routing.get(event_key)
    if not isinstance(ev, dict):
        return []

    recipients: list[str] = []
    seen: set[str] = set()

    user_ids = [int(uid) for uid in (ev.get("user_ids") or []) if isinstance(uid, int) or str(uid).isdigit()]
    if user_ids:
        u_rows = conn.execute(
            "SELECT email FROM users WHERE id = ANY(%s) AND is_active = TRUE AND email <> ''",
            (user_ids,),
        ).fetchall()
        for (em,) in u_rows:
            clean = (em or "").strip()
            if clean and clean.lower() not in seen:
                seen.add(clean.lower())
                recipients.append(clean)

    for raw_em in (ev.get("extra_emails") or "").split(","):
        clean = raw_em.strip()
        if clean and clean.lower() not in seen:
            seen.add(clean.lower())
            recipients.append(clean)

    return recipients


def get_app_base_url(request: Request | None = None) -> str:
    """Resolve the public base URL for links in notification emails."""
    env_url = os.environ.get("APP_BASE_URL", "").strip().rstrip("/")
    if env_url:
        return env_url
    if request is not None:
        origin = (request.headers.get("origin") or "").strip().rstrip("/")
        if origin.startswith(("http://", "https://")):
            return origin
        referer = (request.headers.get("referer") or "").strip()
        if referer.startswith(("http://", "https://")):
            p = urlparse(referer)
            if p.scheme and p.netloc:
                return f"{p.scheme}://{p.netloc}"
        proto = (request.headers.get("x-forwarded-proto") or request.url.scheme or "http").split(",")[0].strip()
        host = (request.headers.get("x-forwarded-host") or request.headers.get("host") or "").split(",")[0].strip()
        if host:
            return f"{proto}://{host}"
    return "http://localhost:8080"


def send_notification_email(
    event_key: str,
    subject: str,
    body: str,
    *,
    link_path: str = "",
    request: Request | None = None,
) -> None:
    """Best-effort background email notification routed per-module/event to selected users & emails."""
    if link_path:
        base = get_app_base_url(request)
        path = link_path if link_path.startswith("/") else f"/{link_path}"
        body = f"{body}\n\nOpen in DocketHall (login required if not signed in): {base}{path}"
    try:
        with pool.connection() as conn:
            row = conn.execute(
                "SELECT enabled, api_key, project_id, config "
                "FROM core_integrations WHERE provider = 'gmail_smtp'"
            ).fetchone()
            if not row or not row[0]:
                return
            app_pw = (row[1] or "").strip()
            sender = (row[2] or "").strip()
            cfg = row[3] if isinstance(row[3], dict) else {}
            if not sender or not app_pw:
                return
            smtp_host = (cfg.get("smtp_host") or "smtp.gmail.com").strip()
            smtp_port = int(cfg.get("smtp_port") or 587)
            recipients = _resolve_event_recipients(conn, event_key)
    except Exception:
        return

    if not recipients:
        return

    def _worker():
        try:
            _send_smtp_mail(smtp_host, smtp_port, sender, app_pw, recipients, subject, body)
        except Exception:
            pass

    ctx = contextvars.copy_context()
    threading.Thread(target=ctx.run, args=(_worker,), daemon=True).start()


def send_direct_email(
    to_emails: list[str],
    subject: str,
    body: str,
    *,
    link_path: str = "",
    request: Request | None = None,
) -> None:
    """Best-effort background email directly to explicit recipient addresses (e.g. permit applicant)."""
    cleaned = [e.strip() for e in to_emails if e and "@" in e]
    if not cleaned:
        return
    if link_path:
        base = get_app_base_url(request)
        path = link_path if link_path.startswith("/") else f"/{link_path}"
        body = f"{body}\n\nOpen in DocketHall (login required if not signed in): {base}{path}"
    try:
        with pool.connection() as conn:
            row = conn.execute(
                "SELECT enabled, api_key, project_id, config "
                "FROM core_integrations WHERE provider = 'gmail_smtp'"
            ).fetchone()
            if not row or not row[0]:
                return
            app_pw = (row[1] or "").strip()
            sender = (row[2] or "").strip()
            cfg = row[3] if isinstance(row[3], dict) else {}
            if not sender or not app_pw:
                return
            smtp_host = (cfg.get("smtp_host") or "smtp.gmail.com").strip()
            smtp_port = int(cfg.get("smtp_port") or 587)
    except Exception:
        return

    def _worker():
        try:
            _send_smtp_mail(smtp_host, smtp_port, sender, app_pw, cleaned, subject, body)
        except Exception:
            pass

    ctx = contextvars.copy_context()
    threading.Thread(target=ctx.run, args=(_worker,), daemon=True).start()


class EmailConfigIn(BaseModel):
    smtp_host: str | None = None
    smtp_port: int | None = None
    sender_email: str | None = None
    app_password: str | None = None
    enabled: bool | None = None


class EmailTestIn(BaseModel):
    to_email: str = ""


class NotificationRuleIn(BaseModel):
    user_ids: list[int] = []
    extra_emails: str = ""


class ModuleNotificationsIn(BaseModel):
    rules: dict[str, NotificationRuleIn] = {}


@router.get("/email")
def get_email_config(_: dict = Depends(require_admin)):
    with pool.connection() as conn:
        return _load_email_state(conn)


@router.put("/email")
def update_email_config(body: EmailConfigIn, admin: dict = Depends(require_admin)):
    with pool.connection() as conn:
        existing = conn.execute(
            "SELECT enabled, api_key, project_id, config FROM core_integrations WHERE provider = 'gmail_smtp'"
        ).fetchone()

    cur_enabled = bool(existing[0]) if existing else False
    cur_pw = (existing[1] or "") if existing else ""
    cur_sender = (existing[2] or "") if existing else ""
    cur_cfg = dict(existing[3]) if (existing and isinstance(existing[3], dict)) else {}

    new_sender = cur_sender if body.sender_email is None else body.sender_email.strip()
    new_pw = cur_pw if (body.app_password is None or not body.app_password.strip()) else body.app_password.replace(" ", "").strip()
    new_enabled = cur_enabled if body.enabled is None else bool(body.enabled)

    if body.smtp_host is not None:
        cur_cfg["smtp_host"] = body.smtp_host.strip() or "smtp.gmail.com"
    if body.smtp_port is not None:
        cur_cfg["smtp_port"] = max(1, min(65535, int(body.smtp_port)))

    if new_enabled and (not new_sender or not new_pw):
        raise HTTPException(status_code=400, detail="Sender email and SMTP password/app password are required to enable email notifications")

    with pool.connection() as conn:
        conn.execute(
            """
            INSERT INTO core_integrations
                (provider, enabled, api_key, project_id, config, last_status, updated_by, updated_at)
            VALUES ('gmail_smtp', %s, %s, %s, %s, 'Saved', %s, now())
            ON CONFLICT (provider) DO UPDATE SET
                enabled = EXCLUDED.enabled,
                api_key = EXCLUDED.api_key,
                project_id = EXCLUDED.project_id,
                config = EXCLUDED.config,
                last_status = 'Saved',
                updated_by = EXCLUDED.updated_by,
                updated_at = now()
            """,
            (new_enabled, new_pw, new_sender, Jsonb(cur_cfg), admin["username"]),
        )
        return _load_email_state(conn)


@router.post("/email/test")
def test_email_config(body: EmailTestIn, admin: dict = Depends(require_admin)):
    with pool.connection() as conn:
        row = conn.execute(
            "SELECT api_key, project_id, config FROM core_integrations WHERE provider = 'gmail_smtp'"
        ).fetchone()
    if not row or not (row[0] or "").strip() or not (row[1] or "").strip():
        raise HTTPException(status_code=400, detail="Save your Sender Email and SMTP Password first")

    app_pw = row[0].strip()
    sender = row[1].strip()
    cfg = row[2] if isinstance(row[2], dict) else {}
    smtp_host = (cfg.get("smtp_host") or "smtp.gmail.com").strip()
    smtp_port = int(cfg.get("smtp_port") or 587)
    recipients = [e.strip() for e in (body.to_email or "").split(",") if e.strip()]
    if not recipients:
        raise HTTPException(status_code=400, detail="Enter a test recipient email address")

    try:
        _send_smtp_mail(
            smtp_host,
            smtp_port,
            sender,
            app_pw,
            recipients,
            "DocketHall Test Notification",
            "This is a test email from DocketHall confirming your outgoing SMTP notification settings work.",
        )
        msg = f"Test email sent to {', '.join(recipients)}."
        with pool.connection() as conn:
            conn.execute(
                "UPDATE core_integrations SET validated_at = now(), last_status = %s, updated_by = %s, updated_at = now() "
                "WHERE provider = 'gmail_smtp'",
                (msg, admin["username"]),
            )
            state = _load_email_state(conn)
        return {"ok": True, "message": msg, "config": state}
    except Exception as exc:
        err_msg = f"SMTP error: {exc}"
        with pool.connection() as conn:
            conn.execute(
                "UPDATE core_integrations SET last_status = %s, updated_by = %s, updated_at = now() "
                "WHERE provider = 'gmail_smtp'",
                (err_msg, admin["username"]),
            )
        raise HTTPException(status_code=400, detail=err_msg)


@router.delete("/email")
def delete_email_config(_: dict = Depends(require_admin)):
    with pool.connection() as conn:
        conn.execute("DELETE FROM core_integrations WHERE provider = 'gmail_smtp'")
        return _load_email_state(conn)


@router.get("/notification-users")
def list_notification_users(
    _: dict = Depends(require_permission("settings.manage", "agendas.manage", "permits.manage", "complaints.manage", "calendar.manage", "notices.manage", "forms.manage", "records.manage", "blog.manage")),
):
    """Return active users that have an email address configured for notification routing."""
    with pool.connection() as conn:
        rows = conn.execute(
            "SELECT id, username, role, email FROM users "
            "WHERE is_active = TRUE AND email <> '' ORDER BY username"
        ).fetchall()
    return [
        {"id": r[0], "username": r[1], "role": r[2], "email": r[3]}
        for r in rows
    ]


def _require_module_pref_access(module_id: str, user: dict) -> None:
    if module_id not in _VALID_NOTIFICATION_MODULES:
        raise HTTPException(status_code=404, detail="Unknown notification module")
    if not (has_permission(user, "settings.manage") or has_permission(user, f"{module_id}.manage")):
        raise HTTPException(status_code=403, detail="Insufficient permissions")


@router.get("/notifications/{module_id}")
def get_module_notifications(
    module_id: str,
    user: dict = Depends(require_permission("settings.manage", "agendas.manage", "permits.manage", "complaints.manage", "calendar.manage", "notices.manage", "forms.manage", "records.manage", "blog.manage")),
):
    _require_module_pref_access(module_id, user)
    prefix = f"{module_id}_"
    with pool.connection() as conn:
        row = conn.execute(
            "SELECT config FROM core_integrations WHERE provider = 'email_routing'"
        ).fetchone()
    all_rules = row[0] if (row and isinstance(row[0], dict)) else {}
    mod_rules = {
        k: {
            "user_ids": list(v.get("user_ids") or []),
            "extra_emails": v.get("extra_emails") or "",
        }
        for k, v in all_rules.items()
        if k.startswith(prefix) and isinstance(v, dict)
    }
    return {"module_id": module_id, "rules": mod_rules}


@router.put("/notifications/{module_id}")
def update_module_notifications(
    module_id: str,
    body: ModuleNotificationsIn,
    user: dict = Depends(require_permission("settings.manage", "agendas.manage", "permits.manage", "complaints.manage", "calendar.manage", "notices.manage", "forms.manage", "records.manage", "blog.manage")),
):
    _require_module_pref_access(module_id, user)
    prefix = f"{module_id}_"
    with pool.connection() as conn:
        row = conn.execute(
            "SELECT config FROM core_integrations WHERE provider = 'email_routing'"
        ).fetchone()
        all_rules = dict(row[0]) if (row and isinstance(row[0], dict)) else {}
        for k in list(all_rules.keys()):
            if k.startswith(prefix):
                del all_rules[k]
        for ev_key, rule in body.rules.items():
            if not ev_key.startswith(prefix):
                continue
            all_rules[ev_key] = {
                "user_ids": sorted({int(uid) for uid in rule.user_ids}),
                "extra_emails": rule.extra_emails.strip(),
            }
        conn.execute(
            """
            INSERT INTO core_integrations (provider, enabled, config, updated_by, updated_at)
            VALUES ('email_routing', TRUE, %s, %s, now())
            ON CONFLICT (provider) DO UPDATE SET
                config = EXCLUDED.config,
                updated_by = EXCLUDED.updated_by,
                updated_at = now()
            """,
            (Jsonb(all_rules), user["username"]),
        )
    return get_module_notifications(module_id, user)
