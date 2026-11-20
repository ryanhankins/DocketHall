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

"""Configurable Native Online Payments via Stripe Checkout REST API."""
import base64
import hashlib
import hmac
import json
import re
import time
import urllib.error
import urllib.parse
import urllib.request
from typing import Literal

from fastapi import APIRouter, Depends, HTTPException, Request
from psycopg.types.json import Jsonb
from pydantic import BaseModel

from .audit import record_audit
from .auth import current_user, has_permission, require_admin
from .db import pool
from .integrations import _mask_key, get_app_base_url
from .tenancy import get_current_tenant_slug, is_multi_tenant, schema_for_slug, tenant_context

router = APIRouter(prefix="/api/payments", tags=["payments"])

_AMOUNT_RE = re.compile(r"([0-9]+(?:\.[0-9]{1,2})?)")


def _parse_cents(fee_text: str) -> int:
    cleaned = str(fee_text or "").replace(",", "")
    m = _AMOUNT_RE.search(cleaned)
    if not m:
        return 0
    try:
        return int(round(float(m.group(1)) * 100))
    except ValueError:
        return 0


def _load_stripe_row(conn) -> dict:
    row = conn.execute(
        "SELECT enabled, api_key, project_id, config, validated_at, last_status, updated_by, updated_at "
        "FROM core_integrations WHERE provider = 'stripe'"
    ).fetchone()
    if not row:
        return {
            "provider": "stripe",
            "enabled": False,
            "has_secret_key": False,
            "secret_key_masked": "",
            "publishable_key": "",
            "has_webhook_secret": False,
            "webhook_secret_masked": "",
            "currency": "usd",
            "validated_at": None,
            "last_status": "",
            "updated_by": "",
            "updated_at": None,
        }
    cfg = dict(row[3]) if isinstance(row[3], dict) else {}
    sk = (row[1] or "").strip()
    wh = (cfg.get("webhook_secret") or "").strip()
    return {
        "provider": "stripe",
        "enabled": bool(row[0]),
        "has_secret_key": bool(sk),
        "secret_key_masked": _mask_key(sk),
        "publishable_key": (row[2] or "").strip(),
        "has_webhook_secret": bool(wh),
        "webhook_secret_masked": _mask_key(wh),
        "currency": (cfg.get("currency") or "usd").lower(),
        "validated_at": row[4].isoformat() if row[4] else None,
        "last_status": row[5] or "",
        "updated_by": row[6] or "",
        "updated_at": row[7].isoformat() if row[7] else None,
    }


def _get_active_stripe_secrets() -> tuple[str, str, str] | None:
    with pool.connection() as conn:
        row = conn.execute(
            "SELECT enabled, api_key, config FROM core_integrations WHERE provider = 'stripe'"
        ).fetchone()
    if not row or not row[0]:
        return None
    sk = (row[1] or "").strip()
    if not sk:
        return None
    cfg = dict(row[2]) if isinstance(row[2], dict) else {}
    return sk, (cfg.get("webhook_secret") or "").strip(), (cfg.get("currency") or "usd").lower()


def _stripe_request(method: str, path: str, secret_key: str, form_data: dict | None = None) -> dict:
    url = f"https://api.stripe.com{path}"
    auth_b64 = base64.b64encode(f"{secret_key}:".encode("utf-8")).decode("ascii")
    headers = {
        "Authorization": f"Basic {auth_b64}",
        "User-Agent": "DocketHall-Payments",
    }
    data = None
    if form_data is not None:
        data = urllib.parse.urlencode(form_data).encode("utf-8")
        headers["Content-Type"] = "application/x-www-form-urlencoded"
    req = urllib.request.Request(url, data=data, headers=headers, method=method)
    try:
        with urllib.request.urlopen(req, timeout=12) as resp:
            return json.loads(resp.read().decode("utf-8"))
    except urllib.error.HTTPError as e:
        raw = e.read().decode("utf-8", errors="replace")
        try:
            err_msg = (json.loads(raw).get("error") or {}).get("message") or raw
        except Exception:
            err_msg = raw
        raise HTTPException(status_code=400, detail=f"Stripe error: {err_msg}")
    except Exception as e:
        raise HTTPException(status_code=502, detail=f"Could not reach Stripe: {e}")


class StripeConfigIn(BaseModel):
    secret_key: str | None = None
    publishable_key: str | None = None
    webhook_secret: str | None = None
    currency: str | None = None
    enabled: bool | None = None
    validate_key: bool = True


class CheckoutIn(BaseModel):
    item_type: Literal["permit", "reservation"]
    item_id: int


class VerifySessionIn(BaseModel):
    session_id: str


@router.get("/admin/stripe")
def get_stripe_config(_: dict = Depends(require_admin)):
    with pool.connection() as conn:
        return _load_stripe_row(conn)


@router.put("/admin/stripe")
def update_stripe_config(body: StripeConfigIn, admin: dict = Depends(require_admin)):
    with pool.connection() as conn:
        existing = conn.execute(
            "SELECT enabled, api_key, project_id, config, validated_at, last_status "
            "FROM core_integrations WHERE provider = 'stripe'"
        ).fetchone()
    cur_enabled = bool(existing[0]) if existing else False
    cur_sk = (existing[1] or "") if existing else ""
    cur_pk = (existing[2] or "") if existing else ""
    cur_cfg = dict(existing[3]) if existing and isinstance(existing[3], dict) else {}
    cur_val_at = existing[4] if existing else None
    cur_status = (existing[5] or "") if existing else ""

    new_sk = cur_sk if body.secret_key is None else body.secret_key.strip()
    new_pk = cur_pk if body.publishable_key is None else body.publishable_key.strip()
    new_wh = cur_cfg.get("webhook_secret", "") if body.webhook_secret is None else body.webhook_secret.strip()
    new_cur = (cur_cfg.get("currency") or "usd") if body.currency is None else (body.currency.strip().lower() or "usd")
    new_enabled = cur_enabled if body.enabled is None else bool(body.enabled)

    if new_enabled and not new_sk:
        raise HTTPException(status_code=400, detail="Stripe Secret Key is required to enable online payments")

    validated_now = False
    new_status = cur_status
    if body.secret_key is not None:
        if not new_sk:
            new_enabled = False
            cur_val_at = None
            new_status = ""
        elif body.validate_key:
            acct = _stripe_request("GET", "/v1/account", new_sk)
            validated_now = True
            mode = "Live" if new_sk.startswith("sk_live_") else "Test"
            acct_name = (acct.get("settings") or {}).get("dashboard", {}).get("display_name") or acct.get("id") or "Stripe"
            new_status = f"Validated ({mode} mode: {acct_name})"
        else:
            cur_val_at = None
            new_status = "Saved without validation"

    new_cfg = {"webhook_secret": new_wh, "currency": new_cur}
    with pool.connection() as conn:
        if validated_now:
            conn.execute(
                "INSERT INTO core_integrations (provider, enabled, api_key, project_id, config, validated_at, last_status, updated_by, updated_at) "
                "VALUES ('stripe', %s, %s, %s, %s, now(), %s, %s, now()) "
                "ON CONFLICT (provider) DO UPDATE SET "
                "enabled = EXCLUDED.enabled, api_key = EXCLUDED.api_key, project_id = EXCLUDED.project_id, "
                "config = EXCLUDED.config, validated_at = now(), last_status = EXCLUDED.last_status, "
                "updated_by = EXCLUDED.updated_by, updated_at = now()",
                (new_enabled, new_sk, new_pk, Jsonb(new_cfg), new_status, admin["username"]),
            )
        else:
            conn.execute(
                "INSERT INTO core_integrations (provider, enabled, api_key, project_id, config, validated_at, last_status, updated_by, updated_at) "
                "VALUES ('stripe', %s, %s, %s, %s, %s, %s, %s, now()) "
                "ON CONFLICT (provider) DO UPDATE SET "
                "enabled = EXCLUDED.enabled, api_key = EXCLUDED.api_key, project_id = EXCLUDED.project_id, "
                "config = EXCLUDED.config, validated_at = EXCLUDED.validated_at, last_status = EXCLUDED.last_status, "
                "updated_by = EXCLUDED.updated_by, updated_at = now()",
                (new_enabled, new_sk, new_pk, Jsonb(new_cfg), cur_val_at, new_status, admin["username"]),
            )
        return _load_stripe_row(conn)


@router.get("/config")
def get_public_payment_config():
    secrets = _get_active_stripe_secrets()
    if not secrets:
        return {"enabled": False, "currency": "usd"}
    return {"enabled": True, "currency": secrets[2]}


def _mark_item_paid(conn, item_type: str, item_id: int, session_id: str) -> bool:
    if item_type == "permit":
        row = conn.execute(
            "UPDATE permits SET payment_status = 'paid', updated_at = now() "
            "WHERE id = %s AND payment_status != 'paid' RETURNING permit_number",
            (item_id,),
        ).fetchone()
        if row:
            conn.execute(
                "INSERT INTO permit_activity_log (permit_id, action, actor_username, note) "
                "VALUES (%s, 'Payment Received', 'stripe', %s)",
                (item_id, f"Paid online via Stripe ({session_id})"),
            )
            return True
    elif item_type == "reservation":
        row = conn.execute(
            "UPDATE facility_reservations SET payment_status = 'paid', updated_at = now() "
            "WHERE id = %s AND payment_status != 'paid' RETURNING reservation_number",
            (item_id,),
        ).fetchone()
        return bool(row)
    return False


@router.post("/checkout")
def create_checkout_session(
    body: CheckoutIn,
    request: Request,
):
    user = current_user(request)
    secrets = _get_active_stripe_secrets()
    if not secrets:
        raise HTTPException(status_code=400, detail="Online payments are not currently enabled")
    secret_key, _, currency = secrets
    base = get_app_base_url(request)
    t_slug = get_current_tenant_slug() or "default"

    with pool.connection() as conn:
        if body.item_type == "permit":
            if not user:
                raise HTTPException(status_code=401, detail="Sign in required to pay permit fee")
            row = conn.execute(
                "SELECT id, permit_number, permit_type_name, permit_use_name, fee_amount, payment_status, applicant_user_id "
                "FROM permits WHERE id = %s",
                (body.item_id,),
            ).fetchone()
            if not row:
                raise HTTPException(status_code=404, detail="Permit not found")
            if row[6] != user["id"] and not has_permission(user, "permits.manage"):
                raise HTTPException(status_code=403, detail="Access denied")
            if row[5] == "paid":
                raise HTTPException(status_code=400, detail="This permit fee is already paid")
            cents = _parse_cents(row[4])
            if cents <= 0:
                raise HTTPException(status_code=400, detail="No payable dollar fee amount is set on this permit")
            desc = f"Permit {row[1]} — {row[2]}: {row[3]}"
            success_url = f"{base}/app?payment=success&session_id={{CHECKOUT_SESSION_ID}}#my-permits"
            cancel_url = f"{base}/app?payment=cancelled#my-permits"
        else:
            row = conn.execute(
                "SELECT id, reservation_number, facility_name, event_date, fee_amount, payment_status "
                "FROM facility_reservations WHERE id = %s",
                (body.item_id,),
            ).fetchone()
            if not row:
                raise HTTPException(status_code=404, detail="Reservation not found")
            if row[5] == "paid":
                raise HTTPException(status_code=400, detail="This reservation fee is already paid")
            cents = _parse_cents(row[4])
            if cents <= 0:
                raise HTTPException(status_code=400, detail="No payable dollar fee amount is set on this reservation")
            desc = f"Facility Reservation {row[1]} — {row[2]} ({row[3]})"
            success_url = f"{base}/?payment=success&session_id={{CHECKOUT_SESSION_ID}}#calendar"
            cancel_url = f"{base}/?payment=cancelled#calendar"

    session = _stripe_request(
        "POST",
        "/v1/checkout/sessions",
        secret_key,
        form_data={
            "mode": "payment",
            "success_url": success_url,
            "cancel_url": cancel_url,
            "line_items[0][quantity]": "1",
            "line_items[0][price_data][currency]": currency,
            "line_items[0][price_data][unit_amount]": str(cents),
            "line_items[0][price_data][product_data][name]": desc[:120],
            "metadata[item_type]": body.item_type,
            "metadata[item_id]": str(body.item_id),
            "metadata[tenant_slug]": t_slug,
        },
    )
    return {"checkout_url": session.get("url"), "session_id": session.get("id")}


@router.post("/verify-session")
def verify_checkout_session(body: VerifySessionIn):
    secrets = _get_active_stripe_secrets()
    if not secrets:
        raise HTTPException(status_code=400, detail="Online payments are not enabled")
    secret_key = secrets[0]
    sid = body.session_id.strip()
    if not sid:
        raise HTTPException(status_code=400, detail="session_id is required")
    session = _stripe_request("GET", f"/v1/checkout/sessions/{urllib.parse.quote(sid)}", secret_key)
    paid = session.get("payment_status") == "paid"
    meta = session.get("metadata") or {}
    item_type = meta.get("item_type")
    item_id = int(meta["item_id"]) if str(meta.get("item_id") or "").isdigit() else 0
    if paid and item_type in ("permit", "reservation") and item_id > 0:
        with pool.connection() as conn:
            changed = _mark_item_paid(conn, item_type, item_id, sid)
        if changed:
            record_audit("stripe", f"payment.{item_type}_paid", f"{item_type} #{item_id} via {sid}")
    return {"paid": paid, "item_type": item_type, "item_id": item_id}


def _verify_stripe_sig(payload: bytes, sig_header: str, secret: str) -> bool:
    parts = dict(item.split("=", 1) for item in sig_header.split(",") if "=" in item)
    ts = parts.get("t", "")
    v1 = parts.get("v1", "")
    if not ts or not v1:
        return False
    try:
        if abs(time.time() - int(ts)) > 300:
            return False
    except ValueError:
        return False
    signed = f"{ts}.".encode("utf-8") + payload
    expected = hmac.new(secret.encode("utf-8"), signed, hashlib.sha256).hexdigest()
    return hmac.compare_digest(expected, v1)


@router.post("/webhook")
async def stripe_webhook(request: Request):
    raw = await request.body()
    secrets = _get_active_stripe_secrets()
    if not secrets:
        raise HTTPException(status_code=400, detail="Stripe not configured")
    _, wh_secret, _ = secrets
    if wh_secret:
        sig = request.headers.get("stripe-signature", "")
        if not _verify_stripe_sig(raw, sig, wh_secret):
            raise HTTPException(status_code=400, detail="Invalid Stripe signature")
    try:
        event = json.loads(raw.decode("utf-8"))
    except Exception:
        raise HTTPException(status_code=400, detail="Invalid JSON payload")

    if event.get("type") == "checkout.session.completed":
        obj = (event.get("data") or {}).get("object") or {}
        if obj.get("payment_status") == "paid":
            meta = obj.get("metadata") or {}
            item_type = meta.get("item_type")
            item_id = int(meta["item_id"]) if str(meta.get("item_id") or "").isdigit() else 0
            t_slug = (meta.get("tenant_slug") or "default").strip()
            if item_type in ("permit", "reservation") and item_id > 0:
                schema = schema_for_slug(t_slug) if (is_multi_tenant() and t_slug != "default") else "public"
                with tenant_context(t_slug, schema):
                    with pool.connection() as conn:
                        changed = _mark_item_paid(conn, item_type, item_id, str(obj.get("id") or "webhook"))
                    if changed:
                        record_audit("stripe", f"payment.{item_type}_paid", f"{item_type} #{item_id} via webhook")
    return {"received": True}
