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

"""Public citizen email subscriptions and alerts across enabled public modules."""
import re
import contextvars
import secrets
import threading
from html import escape as _html_escape

from fastapi import APIRouter, Depends, HTTPException, Query, Request
from fastapi.responses import HTMLResponse
from pydantic import BaseModel

from .audit import record_audit
from .auth import require_permission
from .db import pool
from .integrations import _send_smtp_mail, get_app_base_url
from .registry import get_enabled_module_ids

router = APIRouter(prefix="/api/subscriptions", tags=["subscriptions"])

_EMAIL_RE = re.compile(r"^[^@\s]+@[^@\s]+\.[^@\s]+$")

PUBLIC_TOPICS = [
    {
        "id": "agendas",
        "module_id": "agendas",
        "label": "Meeting Agendas & Minutes",
        "description": "Get notified when finalized meeting agendas are published.",
    },
    {
        "id": "codification",
        "module_id": "codification",
        "label": "City Code Updates",
        "description": "Get notified when municipal code sections are added or amended.",
    },
    {
        "id": "records",
        "module_id": "records",
        "label": "Public Contracts & Records",
        "description": "Get notified when new public contracts, resolutions, or records are published.",
    },
    {
        "id": "notices",
        "module_id": "notices",
        "label": "News, Notices & Bids",
        "description": "Get notified when city news, public notices, RFPs/bids, or job postings are published.",
    },
]
_VALID_TOPIC_IDS = {t["id"] for t in PUBLIC_TOPICS}
_TOPIC_LABELS = {t["id"]: t["label"] for t in PUBLIC_TOPICS}

SCHEMA = """
CREATE TABLE IF NOT EXISTS public_subscriptions (
    id          BIGSERIAL PRIMARY KEY,
    email       TEXT NOT NULL,
    topic       TEXT NOT NULL,
    token       TEXT NOT NULL UNIQUE,
    is_active   BOOLEAN NOT NULL DEFAULT TRUE,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (email, topic)
);
CREATE INDEX IF NOT EXISTS public_subs_topic_idx ON public_subscriptions(topic, is_active);
"""


def bootstrap() -> None:
    with pool.connection() as conn:
        conn.execute(SCHEMA)


def _get_smtp_config(conn) -> tuple[str, int, str, str] | None:
    row = conn.execute(
        "SELECT enabled, api_key, project_id, config "
        "FROM core_integrations WHERE provider = 'gmail_smtp'"
    ).fetchone()
    if not row or not row[0]:
        return None
    app_pw = (row[1] or "").strip()
    sender = (row[2] or "").strip()
    cfg = row[3] if isinstance(row[3], dict) else {}
    if not sender or not app_pw:
        return None
    smtp_host = (cfg.get("smtp_host") or "smtp.gmail.com").strip()
    smtp_port = int(cfg.get("smtp_port") or 587)
    return smtp_host, smtp_port, sender, app_pw


def notify_topic_subscribers(
    topic: str,
    subject: str,
    body: str,
    *,
    link_path: str = "",
    request: Request | None = None,
) -> None:
    """Best-effort background email to active public subscribers for a topic."""
    if topic not in _VALID_TOPIC_IDS:
        return
    base = get_app_base_url(request)
    path = link_path if (not link_path or link_path.startswith("/")) else f"/{link_path}"
    view_line = f"\n\nView on the Public Portal: {base}{path}" if path else ""
    try:
        with pool.connection() as conn:
            smtp = _get_smtp_config(conn)
            if not smtp:
                return
            rows = conn.execute(
                "SELECT email, token FROM public_subscriptions "
                "WHERE topic = %s AND is_active = TRUE",
                (topic,),
            ).fetchall()
    except Exception:
        return

    if not rows:
        return
    smtp_host, smtp_port, sender, app_pw = smtp

    def _worker():
        for email, token in rows:
            unsub_url = f"{base}/api/subscriptions/unsubscribe?token={token}"
            full_body = f"{body}{view_line}\n\nUnsubscribe from {_TOPIC_LABELS.get(topic, topic)}: {unsub_url}"
            try:
                _send_smtp_mail(smtp_host, smtp_port, sender, app_pw, [email], subject, full_body)
            except Exception:
                pass

    ctx = contextvars.copy_context()
    threading.Thread(target=ctx.run, args=(_worker,), daemon=True).start()


class SubscribeIn(BaseModel):
    email: str
    topics: list[str]


@router.get("/topics")
def list_public_topics():
    enabled = set(get_enabled_module_ids())
    return {
        "topics": [t for t in PUBLIC_TOPICS if t["module_id"] in enabled],
    }


@router.post("/subscribe")
def subscribe(body: SubscribeIn, request: Request):
    email = body.email.strip().lower()
    if not _EMAIL_RE.match(email) or len(email) > 254:
        raise HTTPException(status_code=400, detail="Please enter a valid email address")
    enabled = set(get_enabled_module_ids())
    allowed = {t["id"] for t in PUBLIC_TOPICS if t["module_id"] in enabled}
    chosen = [t for t in dict.fromkeys(body.topics) if t in allowed]
    if not chosen:
        raise HTTPException(status_code=400, detail="Please select at least one notification topic")

    tokens_by_topic: list[tuple[str, str]] = []
    with pool.connection() as conn:
        for t in chosen:
            tok = secrets.token_urlsafe(24)
            row = conn.execute(
                "INSERT INTO public_subscriptions (email, topic, token, is_active) "
                "VALUES (%s, %s, %s, TRUE) "
                "ON CONFLICT (email, topic) DO UPDATE SET is_active = TRUE "
                "RETURNING token",
                (email, t, tok),
            ).fetchone()
            tokens_by_topic.append((t, row[0]))
        smtp = _get_smtp_config(conn)

    if smtp:
        base = get_app_base_url(request)
        smtp_host, smtp_port, sender, app_pw = smtp
        lines = [
            f"You are now subscribed to CivicDesk public email alerts ({base}):",
            "",
        ]
        for t, tok in tokens_by_topic:
            lines.append(f"- {_TOPIC_LABELS.get(t, t)} (Unsubscribe: {base}/api/subscriptions/unsubscribe?token={tok})")
        msg_body = "\n".join(lines)

        def _confirm():
            try:
                _send_smtp_mail(
                    smtp_host, smtp_port, sender, app_pw, [email],
                    "[CivicDesk] Public Email Alert Subscription Confirmed",
                    msg_body,
                )
            except Exception:
                pass

        ctx = contextvars.copy_context()
        threading.Thread(target=ctx.run, args=(_confirm,), daemon=True).start()

    return {
        "email": email,
        "subscribed_topics": [t for t, _ in tokens_by_topic],
        "message": f"Subscribed {email} to {len(tokens_by_topic)} alert topic(s).",
    }


@router.get("/unsubscribe", response_class=HTMLResponse)
def unsubscribe(token: str = Query(..., min_length=8)):
    with pool.connection() as conn:
        row = conn.execute(
            "UPDATE public_subscriptions SET is_active = FALSE "
            "WHERE token = %s RETURNING email, topic",
            (token.strip(),),
        ).fetchone()
    if not row:
        return HTMLResponse(
            "<!doctype html><html><body style='font-family:sans-serif;max-width:520px;margin:3rem auto;padding:1rem;'>"
            "<h2>Subscription Not Found</h2><p>This unsubscribe link is invalid or already removed.</p>"
            "<p><a href='/'>Return to CivicDesk</a></p></body></html>",
            status_code=404,
        )
    label = _TOPIC_LABELS.get(row[1], row[1])
    return HTMLResponse(
        "<!doctype html><html><body style='font-family:sans-serif;max-width:520px;margin:3rem auto;padding:1rem;'>"
        f"<h2>Unsubscribed</h2><p><strong>{_html_escape(row[0])}</strong> has been unsubscribed from "
        f"<strong>{_html_escape(label)}</strong> alerts.</p>"
        "<p><a href='/'>Return to CivicDesk Public Portal</a></p></body></html>"
    )


@router.get("")
def list_subscribers(_: dict = Depends(require_permission("settings.manage"))):
    with pool.connection() as conn:
        rows = conn.execute(
            "SELECT id, email, topic, is_active, created_at "
            "FROM public_subscriptions ORDER BY created_at DESC, id DESC"
        ).fetchall()
    counts: dict[str, int] = {t["id"]: 0 for t in PUBLIC_TOPICS}
    subs = []
    for r in rows:
        if r[3] and r[2] in counts:
            counts[r[2]] += 1
        subs.append({
            "id": r[0],
            "email": r[1],
            "topic": r[2],
            "topic_label": _TOPIC_LABELS.get(r[2], r[2]),
            "is_active": bool(r[3]),
            "created_at": r[4].isoformat() if r[4] else None,
        })
    return {"topics": PUBLIC_TOPICS, "counts": counts, "subscribers": subs}


class BulletinIn(BaseModel):
    topic: str = "all"
    subject: str
    body: str
    link_path: str = ""


@router.post("/bulletin")
def send_email_bulletin(
    body: BulletinIn,
    request: Request,
    user: dict = Depends(require_permission("settings.manage", "notices.manage", "agendas.manage")),
):
    subj = body.subject.strip()
    msg_body = body.body.strip()
    if not subj or not msg_body:
        raise HTTPException(status_code=400, detail="Subject and message body are required")
    topic = (body.topic or "all").strip()
    if topic != "all" and topic not in _VALID_TOPIC_IDS:
        raise HTTPException(status_code=400, detail="Invalid subscriber topic")

    with pool.connection() as conn:
        smtp_cfg = _get_smtp_config(conn)
        if not smtp_cfg:
            raise HTTPException(status_code=400, detail="Outgoing SMTP email is not configured/enabled")
        if topic == "all":
            rows = conn.execute(
                "SELECT DISTINCT ON (email) email, token FROM public_subscriptions "
                "WHERE is_active = TRUE ORDER BY email, id DESC"
            ).fetchall()
        else:
            rows = conn.execute(
                "SELECT email, token FROM public_subscriptions WHERE topic = %s AND is_active = TRUE",
                (topic,),
            ).fetchall()
    if not rows:
        raise HTTPException(status_code=400, detail="No active subscribers found for the selected topic")

    smtp_host, smtp_port, sender, app_pw = smtp_cfg
    base = get_app_base_url(request)
    extra_link = ""
    if body.link_path.strip():
        lp = body.link_path.strip()
        extra_link = lp if lp.startswith(("http://", "https://")) else f"{base}{lp}"

    def _bg():
        for em, tok in rows:
            try:
                unsub_url = f"{base}/api/subscriptions/unsubscribe?token={tok}"
                parts = [msg_body]
                if extra_link:
                    parts.append(f"More details: {extra_link}")
                parts.append(f"---\nUnsubscribe: {unsub_url}")
                _send_smtp_mail(smtp_host, smtp_port, sender, app_pw, em, subj, "\n\n".join(parts))
            except Exception:
                pass

    threading.Thread(target=_bg, daemon=True).start()
    record_audit(user["username"], "subscription.bulletin_sent", f"Topic={topic}, recipients={len(rows)}, subject={subj}")
    return {"queued": True, "recipient_count": len(rows)}


@router.delete("/{sub_id}")
def delete_subscriber(sub_id: int, _: dict = Depends(require_permission("settings.manage"))):
    with pool.connection() as conn:
        row = conn.execute(
            "DELETE FROM public_subscriptions WHERE id = %s RETURNING id", (sub_id,)
        ).fetchone()
        if not row:
            raise HTTPException(status_code=404, detail="Subscriber not found")
    return {"ok": True}
