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

"""Admin AI Assistant powered by Google Gemini Function Calling."""
from __future__ import annotations

from datetime import date, datetime, timezone
import json
import os
import re
import urllib.error
import urllib.parse
import urllib.request

from fastapi import APIRouter, Depends, HTTPException, Request
from fastapi.concurrency import run_in_threadpool
from pydantic import BaseModel, Field
from psycopg.types.json import Jsonb

from .ai_tools_ext import (
    EXT_READ_ONLY_TOOLS,
    EXT_TOOL_ACCESS,
    EXT_TOOL_DECLARATIONS,
    describe_ext_action,
    execute_ext_tool,
)
from .audit import record_audit
from .auth import current_user, has_permission, is_demo_mode, require_admin, require_not_demo_mode, require_permission
from .db import pool
from .registry import is_module_enabled

router = APIRouter(prefix="/api/ai", tags=["ai"])

DEFAULT_GEMINI_MODEL = "gemini-3.8-flash"
DEMO_GEMINI_MODEL = "gemini-3.5-flash-lite"
DEFAULT_DAILY_SPEND_LIMIT_USD = 1.00
DEMO_DAILY_SPEND_LIMIT_USD = 1.00
_ALLOWED_MODELS = (
    "gemini-3.5-flash-lite",
    "gemini-3.1-flash-lite",
    "gemini-3.8-flash",
    "gemini-3.8-pro",
)
# Conservative USD per 1M tokens: (input, output)
_MODEL_RATES_PER_M: dict[str, tuple[float, float]] = {
    "gemini-3.5-flash-lite": (0.10, 0.40),
    "gemini-3.1-flash-lite": (0.10, 0.40),
    "gemini-3.8-flash": (0.30, 2.50),
    "gemini-3.8-pro": (1.25, 10.00),
}
_SLUG_RE = re.compile(r"[^a-z0-9]+")


def _slugify(text: str, fallback: str = "item") -> str:
    s = _SLUG_RE.sub("-", (text or "").strip().lower()).strip("-")
    return s[:80] or fallback


def _default_daily_limit_usd() -> float:
    raw = (os.environ.get("AI_DAILY_SPEND_LIMIT_USD") or "").strip()
    if raw:
        try:
            return max(0.0, float(raw))
        except ValueError:
            pass
    return DEFAULT_DAILY_SPEND_LIMIT_USD


def _parse_daily_limit(cfg: dict) -> float:
    if isinstance(cfg, dict) and "daily_spend_limit_usd" in cfg and cfg["daily_spend_limit_usd"] is not None:
        try:
            return max(0.0, float(cfg["daily_spend_limit_usd"]))
        except (TypeError, ValueError):
            pass
    return _default_daily_limit_usd()


def _load_gemini_settings() -> tuple[str, str, str, float]:
    """Return (api_key, model, source, daily_spend_limit_usd)."""
    with pool.connection() as conn:
        row = conn.execute(
            "SELECT enabled, api_key, config FROM core_integrations WHERE provider = 'gemini_ai'"
        ).fetchone()
    cfg = row[2] if row and isinstance(row[2], dict) else {}
    limit = _parse_daily_limit(cfg)
    demo = is_demo_mode()
    if row and row[0] and (row[1] or "").strip():
        model = DEMO_GEMINI_MODEL if demo else ((cfg.get("model") or DEFAULT_GEMINI_MODEL).strip() or DEFAULT_GEMINI_MODEL)
        return row[1].strip(), model, "integrations", (DEMO_DAILY_SPEND_LIMIT_USD if demo else limit)
    env_key = (os.environ.get("GEMINI_API_KEY") or "").strip()
    if env_key:
        env_model = DEMO_GEMINI_MODEL if demo else ((os.environ.get("GEMINI_MODEL") or DEFAULT_GEMINI_MODEL).strip() or DEFAULT_GEMINI_MODEL)
        return env_key, env_model, "env", (DEMO_DAILY_SPEND_LIMIT_USD if demo else limit)
    return "", (DEMO_GEMINI_MODEL if demo else DEFAULT_GEMINI_MODEL), "none", (DEMO_DAILY_SPEND_LIMIT_USD if demo else limit)


def _load_gemini_config() -> tuple[str, str, str]:
    """Return (api_key, model, source)."""
    key, model, source, _ = _load_gemini_settings()
    return key, model, source


def _estimate_call_cost_usd(model: str, prompt_tokens: int, output_tokens: int) -> float:
    in_rate, out_rate = _MODEL_RATES_PER_M.get(model, (0.30, 2.50))
    return (max(0, prompt_tokens) * in_rate + max(0, output_tokens) * out_rate) / 1_000_000.0


def _ensure_ai_daily_usage_table(conn) -> None:
    conn.execute(
        """
        CREATE TABLE IF NOT EXISTS ai_daily_usage (
            usage_date DATE PRIMARY KEY,
            prompt_tokens BIGINT NOT NULL DEFAULT 0,
            output_tokens BIGINT NOT NULL DEFAULT 0,
            request_count INTEGER NOT NULL DEFAULT 0,
            estimated_cost_usd DOUBLE PRECISION NOT NULL DEFAULT 0,
            updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
        );
        """
    )


def _get_today_usage() -> tuple[float, int]:
    """Return (estimated_cost_usd, request_count) for today (UTC)."""
    with pool.connection() as conn:
        _ensure_ai_daily_usage_table(conn)
        row = conn.execute(
            "SELECT estimated_cost_usd, request_count FROM ai_daily_usage WHERE usage_date = CURRENT_DATE"
        ).fetchone()
    if not row:
        return 0.0, 0
    return float(row[0] or 0.0), int(row[1] or 0)


def _record_gemini_usage(model: str, resp: dict) -> None:
    usage = resp.get("usageMetadata") if isinstance(resp, dict) else None
    if not isinstance(usage, dict):
        return
    p_tok = int(usage.get("promptTokenCount") or 0)
    c_tok = int(usage.get("candidatesTokenCount") or 0) + int(usage.get("thoughtsTokenCount") or 0)
    cost = _estimate_call_cost_usd(model, p_tok, c_tok)
    with pool.connection() as conn:
        _ensure_ai_daily_usage_table(conn)
        conn.execute(
            "INSERT INTO ai_daily_usage (usage_date, prompt_tokens, output_tokens, request_count, estimated_cost_usd, updated_at) "
            "VALUES (CURRENT_DATE, %s, %s, 1, %s, now()) "
            "ON CONFLICT (usage_date) DO UPDATE SET "
            "prompt_tokens = ai_daily_usage.prompt_tokens + EXCLUDED.prompt_tokens, "
            "output_tokens = ai_daily_usage.output_tokens + EXCLUDED.output_tokens, "
            "request_count = ai_daily_usage.request_count + 1, "
            "estimated_cost_usd = ai_daily_usage.estimated_cost_usd + EXCLUDED.estimated_cost_usd, "
            "updated_at = now()",
            (p_tok, c_tok, cost),
        )


def _enforce_daily_budget() -> None:
    _, _, _, limit = _load_gemini_settings()
    if limit <= 0:
        return
    spent, _ = _get_today_usage()
    if spent >= limit:
        raise HTTPException(
            status_code=429,
            detail=f"Daily AI spend limit (${limit:.2f}/day) reached (today's estimated spend: ${spent:.4f}). An administrator can adjust the limit in Integrations.",
        )


def _call_gemini(api_key: str, model: str, payload: dict, *, enforce_budget: bool = True) -> dict:
    if enforce_budget:
        _enforce_daily_budget()
    safe_model = urllib.parse.quote(model, safe=".-")
    url = f"https://generativelanguage.googleapis.com/v1beta/models/{safe_model}:generateContent"
    req = urllib.request.Request(
        url,
        data=json.dumps(payload).encode("utf-8"),
        headers={"Content-Type": "application/json", "x-goog-api-key": api_key},
        method="POST",
    )
    try:
        with urllib.request.urlopen(req, timeout=30) as resp:
            data = json.loads(resp.read().decode("utf-8"))
            _record_gemini_usage(model, data)
            return data
    except urllib.error.HTTPError as exc:
        raw = exc.read().decode("utf-8", errors="replace")
        try:
            detail = json.loads(raw).get("error", {}).get("message") or raw
        except Exception:
            detail = raw
        raise HTTPException(status_code=502, detail=f"Gemini API error ({exc.code}): {detail[:240]}")
    except Exception as exc:
        raise HTTPException(status_code=502, detail=f"Gemini API request failed: {exc}")


_TOOL_DECLARATIONS = [
    {
        "name": "create_agenda",
        "description": "Create a new meeting agenda (draft) in DocketHall.",
        "parameters": {
            "type": "OBJECT",
            "properties": {
                "title": {"type": "STRING", "description": "Agenda title, e.g. 'Special Meeting' or 'Regular City Council Meeting'"},
                "body": {"type": "STRING", "description": "Governing body name, e.g. 'City Council', 'Planning Commission'. Defaults to 'City Council'."},
                "meeting_date": {"type": "STRING", "description": "ISO date YYYY-MM-DD (e.g. '2026-12-01')"},
                "meeting_time": {"type": "STRING", "description": "Time string, e.g. '6:00 PM'"},
            },
            "required": ["title", "meeting_date"],
        },
    },
    {
        "name": "add_agenda_item",
        "description": "Add an agenda item to an existing agenda by agenda_id.",
        "parameters": {
            "type": "OBJECT",
            "properties": {
                "agenda_id": {"type": "INTEGER", "description": "Numeric ID of the target agenda"},
                "title": {"type": "STRING", "description": "Agenda item title"},
                "section_name": {"type": "STRING", "description": "Agenda section (e.g. 'New Business', 'Consent Agenda', 'Public Hearings')"},
                "description": {"type": "STRING", "description": "Optional summary/notes for the item"},
            },
            "required": ["agenda_id", "title"],
        },
    },
    {
        "name": "create_todo",
        "description": "Create an item in Agenda Todos & Item Backlog for future meetings.",
        "parameters": {
            "type": "OBJECT",
            "properties": {
                "title": {"type": "STRING", "description": "Todo / backlog item title"},
                "due_date": {"type": "STRING", "description": "Optional due date YYYY-MM-DD"},
                "notes": {"type": "STRING", "description": "Optional notes"},
            },
            "required": ["title"],
        },
    },
    {
        "name": "update_agenda_item",
        "description": "Update an existing item on an in-progress agenda (title, description, section, presenter, recommended_motion, fiscal_impact). Use get_agenda_details first to find item_id.",
        "parameters": {
            "type": "OBJECT",
            "properties": {
                "agenda_id": {"type": "INTEGER", "description": "Agenda ID"},
                "item_id": {"type": "INTEGER", "description": "Existing agenda item ID from get_agenda_details"},
                "title": {"type": "STRING", "description": "Optional updated title"},
                "description": {"type": "STRING", "description": "Optional updated description / background"},
                "section_name": {"type": "STRING", "description": "Optional updated section"},
                "presenter": {"type": "STRING", "description": "Optional presenter"},
                "recommended_motion": {"type": "STRING", "description": "Optional recommended motion"},
                "fiscal_impact": {"type": "STRING", "description": "Optional fiscal impact"},
            },
            "required": ["agenda_id", "item_id"],
        },
    },
    {
        "name": "add_agenda_item_attachment",
        "description": "Attach a text document, memo, or code-research note to an agenda item (creates a downloadable text attachment on the item).",
        "parameters": {
            "type": "OBJECT",
            "properties": {
                "agenda_id": {"type": "INTEGER", "description": "Agenda ID"},
                "item_id": {"type": "INTEGER", "description": "Optional agenda item ID (defaults to the latest item on the agenda)"},
                "title": {"type": "STRING", "description": "Attachment title (e.g. 'City Code Summary: Llamas')"},
                "content": {"type": "STRING", "description": "Full text content of the attachment"},
            },
            "required": ["agenda_id", "title", "content"],
        },
    },
    {
        "name": "create_notice",
        "description": "Create a NEW public notice, news item, bid, or job posting. Do not use to edit or publish an existing notice; use update_notice instead.",
        "parameters": {
            "type": "OBJECT",
            "properties": {
                "title": {"type": "STRING", "description": "Notice title"},
                "category": {"type": "STRING", "description": "One of: 'Notice', 'News', 'Bid / RFP', 'Job Posting'"},
                "summary": {"type": "STRING", "description": "Short summary"},
                "body": {"type": "STRING", "description": "Full notice text"},
                "is_public": {"type": "BOOLEAN", "description": "Whether to publish immediately (default true)"},
            },
            "required": ["title", "body"],
        },
    },
    {
        "name": "list_notices",
        "description": "List or search existing City Notices, News, Bids/RFPs, and Job Postings (including drafts).",
        "parameters": {
            "type": "OBJECT",
            "properties": {
                "search": {"type": "STRING", "description": "Optional keyword/title filter"},
                "status": {"type": "STRING", "description": "Optional filter: 'all', 'draft', or 'published'"},
                "limit": {"type": "INTEGER", "description": "Max notices to return (default 10)"},
            },
        },
    },
    {
        "name": "update_notice",
        "description": "Update, publish, or unpublish an existing City Notice by notice_id or title_match.",
        "parameters": {
            "type": "OBJECT",
            "properties": {
                "notice_id": {"type": "INTEGER", "description": "Numeric ID of the notice"},
                "title_match": {"type": "STRING", "description": "Existing notice title to match if notice_id is unknown"},
                "title": {"type": "STRING", "description": "Updated title"},
                "category": {"type": "STRING", "description": "Updated category: 'Notice', 'News', 'Bid / RFP', or 'Job Posting'"},
                "summary": {"type": "STRING", "description": "Updated summary"},
                "body": {"type": "STRING", "description": "Updated body text"},
                "is_public": {"type": "BOOLEAN", "description": "Set true to publish or false to unpublish to draft"},
            },
        },
    },
    {
        "name": "create_blog_post",
        "description": "Create a NEW City Blog article (draft or published). Do not use to publish or edit an existing post; use list_blog_posts and update_blog_post instead.",
        "parameters": {
            "type": "OBJECT",
            "properties": {
                "title": {"type": "STRING", "description": "Blog post title"},
                "summary": {"type": "STRING", "description": "Short excerpt"},
                "body": {"type": "STRING", "description": "Article body text"},
                "is_published": {"type": "BOOLEAN", "description": "Publish immediately (default false = draft)"},
            },
            "required": ["title", "body"],
        },
    },
    {
        "name": "list_blog_posts",
        "description": "List or search existing City Blog posts (including drafts and published articles).",
        "parameters": {
            "type": "OBJECT",
            "properties": {
                "search": {"type": "STRING", "description": "Optional keyword/title filter"},
                "status": {"type": "STRING", "description": "Optional filter: 'all', 'draft', or 'published'"},
                "limit": {"type": "INTEGER", "description": "Max posts to return (default 10)"},
            },
        },
    },
    {
        "name": "update_blog_post",
        "description": "Update, publish, or unpublish an existing City Blog post by post_id or title_match.",
        "parameters": {
            "type": "OBJECT",
            "properties": {
                "post_id": {"type": "INTEGER", "description": "Numeric ID of the blog post"},
                "title_match": {"type": "STRING", "description": "Existing blog post title or slug to match if post_id is unknown"},
                "title": {"type": "STRING", "description": "Updated post title"},
                "summary": {"type": "STRING", "description": "Updated excerpt / lead-in"},
                "body": {"type": "STRING", "description": "Updated article body"},
                "is_published": {"type": "BOOLEAN", "description": "Set true to publish or false to revert to draft"},
            },
        },
    },
    {
        "name": "create_calendar_event",
        "description": "Add an event or meeting to the municipal calendar.",
        "parameters": {
            "type": "OBJECT",
            "properties": {
                "title": {"type": "STRING", "description": "Event title"},
                "event_date": {"type": "STRING", "description": "Date YYYY-MM-DD"},
                "start_time": {"type": "STRING", "description": "Start time, e.g. '6:00 PM'"},
                "location": {"type": "STRING", "description": "Event location"},
                "description": {"type": "STRING", "description": "Event details"},
            },
            "required": ["title", "event_date"],
        },
    },
    {
        "name": "update_urgent_alert",
        "description": "Enable, update, or clear the site-wide urgent alert banner on the public portal.",
        "parameters": {
            "type": "OBJECT",
            "properties": {
                "enabled": {"type": "BOOLEAN", "description": "True to show the banner, False to hide it"},
                "message": {"type": "STRING", "description": "Banner message text"},
            },
            "required": ["enabled"],
        },
    },
    {
        "name": "list_agendas",
        "description": "List recent or upcoming agendas in DocketHall.",
        "parameters": {
            "type": "OBJECT",
            "properties": {
                "limit": {"type": "INTEGER", "description": "Max agendas to return (default 8)"},
            },
        },
    },
    {
        "name": "finalize_agenda",
        "description": "Finalize and publish an agenda by agenda_id so it appears on the public portal.",
        "parameters": {
            "type": "OBJECT",
            "properties": {
                "agenda_id": {"type": "INTEGER", "description": "Numeric ID of the agenda to finalize"},
            },
            "required": ["agenda_id"],
        },
    },
    {
        "name": "create_permit",
        "description": "Create a permit or land-use application (e.g., Variance Application, Building Permit, Zoning Permit, Conditional Use Permit, Mechanical/Plumbing Permit, Small Craft Permit).",
        "parameters": {
            "type": "OBJECT",
            "properties": {
                "permit_type_name": {"type": "STRING", "description": "Permit type (e.g. 'Variance Application', 'Building Permit', 'Zoning Permit', 'Conditional Use Permit')"},
                "permit_use_name": {"type": "STRING", "description": "Optional specific use (e.g. 'New Home', 'Reroof', 'Fence (over 7 feet)')"},
                "property_address": {"type": "STRING", "description": "Street address for the permit/variance"},
                "applicant_name": {"type": "STRING", "description": "Applicant name (defaults to 'Admin Intake' if not specified)"},
                "applicant_email": {"type": "STRING", "description": "Optional applicant email"},
                "applicant_phone": {"type": "STRING", "description": "Optional applicant phone"},
                "description": {"type": "STRING", "description": "Project or variance description"},
            },
            "required": ["permit_type_name", "property_address"],
        },
    },
    {
        "name": "update_permit_status",
        "description": "Update the status of an existing permit by permit_number (e.g. PRM-2026-0001).",
        "parameters": {
            "type": "OBJECT",
            "properties": {
                "permit_number": {"type": "STRING", "description": "Permit number"},
                "status": {"type": "STRING", "description": "New status: submitted, in_review, approved, issued, denied, closed"},
                "notes": {"type": "STRING", "description": "Optional review notes"},
            },
            "required": ["permit_number", "status"],
        },
    },
    {
        "name": "schedule_inspection",
        "description": "Schedule an inspection for an existing permit by permit_number.",
        "parameters": {
            "type": "OBJECT",
            "properties": {
                "permit_number": {"type": "STRING", "description": "Permit number"},
                "inspection_type": {"type": "STRING", "description": "Inspection type (e.g. 'Framing', 'Final', 'Footing', 'Plumbing', 'Site')"},
                "scheduled_date": {"type": "STRING", "description": "Date YYYY-MM-DD"},
                "inspector": {"type": "STRING", "description": "Optional inspector name"},
                "notes": {"type": "STRING", "description": "Optional notes"},
            },
            "required": ["permit_number", "inspection_type", "scheduled_date"],
        },
    },
    {
        "name": "list_permits",
        "description": "List or search existing permits and variance applications.",
        "parameters": {
            "type": "OBJECT",
            "properties": {
                "query": {"type": "STRING", "description": "Optional search by address, permit number, or type"},
                "status": {"type": "STRING", "description": "Optional status filter"},
            },
        },
    },
    {
        "name": "get_permit_details",
        "description": "Fetch full details, custom/planning fields, fee payment status, and attached documents for a specific permit or variance application.",
        "parameters": {
            "type": "OBJECT",
            "properties": {
                "permit_number": {"type": "STRING", "description": "Permit number (e.g. 'PRM-2026-0001')"},
            },
            "required": ["permit_number"],
        },
    },
    {
        "name": "list_complaints",
        "description": "List or search code-enforcement complaints by complaint number, property address, ordinance section, or description.",
        "parameters": {
            "type": "OBJECT",
            "properties": {
                "query": {"type": "STRING", "description": "Optional search by complaint number, address, or keyword"},
                "status": {"type": "STRING", "description": "Optional status filter (e.g. 'submitted', 'investigating', 'resolved')"},
            },
        },
    },
    {
        "name": "get_complaint_details",
        "description": "Fetch full details, alleged conduct, ordinance section, investigation report, and non-confidential documents for a specific complaint (e.g. 'CMP-2026-0002').",
        "parameters": {
            "type": "OBJECT",
            "properties": {
                "complaint_number": {"type": "STRING", "description": "Complaint number (e.g. 'CMP-2026-0002')"},
            },
            "required": ["complaint_number"],
        },
    },
    {
        "name": "create_complaint",
        "description": "Log a code-enforcement or administrative complaint.",
        "parameters": {
            "type": "OBJECT",
            "properties": {
                "property_address": {"type": "STRING", "description": "Subject property address"},
                "description": {"type": "STRING", "description": "Complaint / conduct description"},
                "ordinance_section": {"type": "STRING", "description": "Optional city code section (e.g. '605.020')"},
                "complainant_name": {"type": "STRING", "description": "Optional complainant name"},
                "is_anonymous": {"type": "BOOLEAN", "description": "True if anonymous"},
            },
            "required": ["description"],
        },
    },
    {
        "name": "create_work_order",
        "description": "Create a 311 / Public Works work order (e.g. pothole, streetlight, snowplow, tree, water leak).",
        "parameters": {
            "type": "OBJECT",
            "properties": {
                "category": {"type": "STRING", "description": "Category (e.g. 'Pothole / Street', 'Snow / Ice', 'Tree / Parks', 'Water / Sewer', 'Streetlight')"},
                "location": {"type": "STRING", "description": "Street address or intersection"},
                "description": {"type": "STRING", "description": "Work order description"},
                "priority": {"type": "STRING", "description": "low, normal, high, or urgent"},
            },
            "required": ["location", "description"],
        },
    },
    {
        "name": "create_public_record",
        "description": "Add a document to the Public Records repository (Policy, Contract, Resolution, Ordinance, Agreement, Guide).",
        "parameters": {
            "type": "OBJECT",
            "properties": {
                "title": {"type": "STRING", "description": "Document title"},
                "category": {"type": "STRING", "description": "Policy, Contract, Resolution, Ordinance, Agreement, or Guide"},
                "counterparty": {"type": "STRING", "description": "Optional counterparty or department"},
                "notes": {"type": "STRING", "description": "Optional summary/notes"},
                "is_public": {"type": "BOOLEAN", "description": "Publish publicly (default true)"},
            },
            "required": ["title", "category"],
        },
    },
    {
        "name": "search_records",
        "description": "Search Public Records / City Documents (policies, guides, ordinances, forms) by keyword and list their attached files.",
        "parameters": {
            "type": "OBJECT",
            "properties": {
                "query": {"type": "STRING", "description": "Search keyword(s)"},
            },
            "required": ["query"],
        },
    },
    {
        "name": "read_record_file",
        "description": "Extract and read the text content of an attached file (PDF, DOCX, TXT, etc.) from Public Records using its file_id from search_records.",
        "parameters": {
            "type": "OBJECT",
            "properties": {
                "file_id": {"type": "INTEGER", "description": "File ID returned by search_records"},
            },
            "required": ["file_id"],
        },
    },
    {
        "name": "search_city_code",
        "description": "Search the Municipal City Code by keyword(s) or section number. Returns matching sections with their text.",
        "parameters": {
            "type": "OBJECT",
            "properties": {
                "query": {"type": "STRING", "description": "Keyword(s) or section number (e.g. '605.020', 'dogs', 'fence')"},
            },
            "required": ["query"],
        },
    },
    {
        "name": "get_city_code_section",
        "description": "Fetch the full text of a specific Municipal City Code section by section_number.",
        "parameters": {
            "type": "OBJECT",
            "properties": {
                "section_number": {"type": "STRING", "description": "Exact section number (e.g. '605.020')"},
            },
            "required": ["section_number"],
        },
    },
    {
        "name": "search_portal_info",
        "description": "Search City Info Pages, FAQs, Public Notices, Blog Posts, and Forms for answers to resident or admin questions.",
        "parameters": {
            "type": "OBJECT",
            "properties": {
                "query": {"type": "STRING", "description": "Search keyword(s)"},
            },
            "required": ["query"],
        },
    },
    {
        "name": "create_directory_entry",
        "description": "Add a staff member, department, or elected official to the City Directory.",
        "parameters": {
            "type": "OBJECT",
            "properties": {
                "name": {"type": "STRING", "description": "Full name or office name"},
                "title_role": {"type": "STRING", "description": "Title or role (e.g. 'City Clerk', 'Councilmember')"},
                "department": {"type": "STRING", "description": "Department"},
                "email": {"type": "STRING", "description": "Email address"},
                "phone": {"type": "STRING", "description": "Phone number"},
                "is_elected": {"type": "BOOLEAN", "description": "True for elected officials"},
            },
            "required": ["name"],
        },
    },
    {
        "name": "create_faq",
        "description": "Add a Frequently Asked Question to the City Directory / FAQ section.",
        "parameters": {
            "type": "OBJECT",
            "properties": {
                "question": {"type": "STRING", "description": "FAQ question"},
                "answer": {"type": "STRING", "description": "FAQ answer"},
                "category": {"type": "STRING", "description": "Category (e.g. 'General', 'Permits', 'Utilities')"},
            },
            "required": ["question", "answer"],
        },
    },
    {
        "name": "create_page",
        "description": "Create a NEW custom City Information Page. Do not use to publish or edit an existing page; use list_pages and update_page instead.",
        "parameters": {
            "type": "OBJECT",
            "properties": {
                "title": {"type": "STRING", "description": "Page title"},
                "summary": {"type": "STRING", "description": "Short summary"},
                "body": {"type": "STRING", "description": "Page content"},
                "is_public": {"type": "BOOLEAN", "description": "Publish publicly (default true)"},
            },
            "required": ["title", "body"],
        },
    },
    {
        "name": "list_pages",
        "description": "List or search existing City Information Pages (including unpublished drafts).",
        "parameters": {
            "type": "OBJECT",
            "properties": {
                "search": {"type": "STRING", "description": "Optional keyword/title filter"},
                "limit": {"type": "INTEGER", "description": "Max pages to return (default 10)"},
            },
        },
    },
    {
        "name": "update_page",
        "description": "Update, publish, or unpublish an existing City Information Page by page_id or title_match.",
        "parameters": {
            "type": "OBJECT",
            "properties": {
                "page_id": {"type": "INTEGER", "description": "Numeric ID of the page"},
                "title_match": {"type": "STRING", "description": "Existing page title or slug to match if page_id is unknown"},
                "title": {"type": "STRING", "description": "Updated page title"},
                "summary": {"type": "STRING", "description": "Updated summary"},
                "body": {"type": "STRING", "description": "Updated page content"},
                "is_public": {"type": "BOOLEAN", "description": "Set true to publish or false to unpublish"},
            },
        },
    },
    {
        "name": "add_contractor_license",
        "description": "Add a contractor license record.",
        "parameters": {
            "type": "OBJECT",
            "properties": {
                "business_name": {"type": "STRING", "description": "Contractor business name"},
                "license_number": {"type": "STRING", "description": "License number"},
                "license_type": {"type": "STRING", "description": "e.g. 'General Contractor', 'Plumbing', 'Mechanical', 'Electrical'"},
                "email": {"type": "STRING", "description": "Contact email"},
                "phone": {"type": "STRING", "description": "Contact phone"},
            },
            "required": ["business_name", "license_number"],
        },
    },
    {
        "name": "create_utility_bill",
        "description": "Create a municipal utility bill (water/sewer/trash).",
        "parameters": {
            "type": "OBJECT",
            "properties": {
                "account_number": {"type": "STRING", "description": "Utility account number"},
                "payer_name": {"type": "STRING", "description": "Resident / customer name"},
                "service_address": {"type": "STRING", "description": "Service address"},
                "amount_due": {"type": "STRING", "description": "Amount due (e.g. '85.50')"},
                "due_date": {"type": "STRING", "description": "Due date YYYY-MM-DD"},
                "description": {"type": "STRING", "description": "Optional billing period description"},
            },
            "required": ["payer_name", "service_address", "amount_due"],
        },
    },
    {
        "name": "create_citation",
        "description": "Create a municipal code or parking citation.",
        "parameters": {
            "type": "OBJECT",
            "properties": {
                "payer_name": {"type": "STRING", "description": "Respondent name"},
                "service_address": {"type": "STRING", "description": "Property or location"},
                "description": {"type": "STRING", "description": "Violation description"},
                "amount_due": {"type": "STRING", "description": "Fine amount (e.g. '100.00')"},
                "due_date": {"type": "STRING", "description": "Due date YYYY-MM-DD"},
            },
            "required": ["payer_name", "description", "amount_due"],
        },
    },
    {
        "name": "toggle_module",
        "description": "Enable or disable a DocketHall module (agendas, permits, codification, records, complaints, calendar, communications, licensing, citations, utilities).",
        "parameters": {
            "type": "OBJECT",
            "properties": {
                "module_id": {"type": "STRING", "description": "Module ID"},
                "enabled": {"type": "BOOLEAN", "description": "True to enable, False to disable"},
            },
            "required": ["module_id", "enabled"],
        },
    },
    {
        "name": "update_branding",
        "description": "Update general city preferences (city title, default meeting time, meeting location, footer text).",
        "parameters": {
            "type": "OBJECT",
            "properties": {
                "city_title": {"type": "STRING", "description": "City title"},
                "meeting_time": {"type": "STRING", "description": "Default meeting time"},
                "meeting_location": {"type": "STRING", "description": "Default meeting location"},
                "footer_text": {"type": "STRING", "description": "Footer contact/hours text"},
            },
        },
    },
    {
        "name": "get_agenda_details",
        "description": "Fetch full details and agenda items for a specific meeting agenda by agenda_id.",
        "parameters": {
            "type": "OBJECT",
            "properties": {
                "agenda_id": {"type": "INTEGER", "description": "Agenda ID"},
            },
            "required": ["agenda_id"],
        },
    },
    {
        "name": "list_backlog_todos",
        "description": "List or search agenda backlog / todo items.",
        "parameters": {
            "type": "OBJECT",
            "properties": {
                "query": {"type": "STRING", "description": "Optional search keyword"},
                "status": {"type": "STRING", "description": "Optional status ('open' or 'done')"},
            },
        },
    },
    {
        "name": "list_inspections",
        "description": "List or search permit inspections by permit number or result.",
        "parameters": {
            "type": "OBJECT",
            "properties": {
                "permit_number": {"type": "STRING", "description": "Optional permit number filter"},
                "result": {"type": "STRING", "description": "Optional result filter ('scheduled', 'passed', 'failed')"},
            },
        },
    },
    {
        "name": "list_work_orders",
        "description": "List or search 311 / Public Works work orders.",
        "parameters": {
            "type": "OBJECT",
            "properties": {
                "query": {"type": "STRING", "description": "Optional search by work order number, location, or description"},
                "status": {"type": "STRING", "description": "Optional status filter"},
            },
        },
    },
    {
        "name": "list_foia_requests",
        "description": "List or search Public Records / FOIA requests.",
        "parameters": {
            "type": "OBJECT",
            "properties": {
                "query": {"type": "STRING", "description": "Optional search by request number, subject, or requester"},
                "status": {"type": "STRING", "description": "Optional status filter"},
            },
        },
    },
    {
        "name": "list_calendar_events",
        "description": "List or search upcoming municipal calendar events.",
        "parameters": {
            "type": "OBJECT",
            "properties": {
                "query": {"type": "STRING", "description": "Optional keyword"},
                "from_date": {"type": "STRING", "description": "Optional start date YYYY-MM-DD"},
            },
        },
    },
    {
        "name": "search_directory",
        "description": "Search City Directory contacts (staff, departments, elected officials).",
        "parameters": {
            "type": "OBJECT",
            "properties": {
                "query": {"type": "STRING", "description": "Optional name, role, or department"},
            },
        },
    },
    {
        "name": "list_forms",
        "description": "List or search published City Forms and Polls.",
        "parameters": {
            "type": "OBJECT",
            "properties": {
                "query": {"type": "STRING", "description": "Optional keyword"},
            },
        },
    },
    {
        "name": "list_contractor_licenses",
        "description": "List or search licensed contractors.",
        "parameters": {
            "type": "OBJECT",
            "properties": {
                "query": {"type": "STRING", "description": "Optional business name or license number"},
                "status": {"type": "STRING", "description": "Optional status filter"},
            },
        },
    },
    {
        "name": "list_utility_bills",
        "description": "List or search municipal utility billing statements.",
        "parameters": {
            "type": "OBJECT",
            "properties": {
                "query": {"type": "STRING", "description": "Optional reference, account number, payer name, or address"},
                "payment_status": {"type": "STRING", "description": "Optional status ('unpaid', 'paid')"},
            },
        },
    },
    {
        "name": "list_citations",
        "description": "List or search municipal citations.",
        "parameters": {
            "type": "OBJECT",
            "properties": {
                "query": {"type": "STRING", "description": "Optional reference number, payer name, or address"},
                "payment_status": {"type": "STRING", "description": "Optional status ('unpaid', 'paid')"},
            },
        },
    },
    {
        "name": "list_compliance_programs",
        "description": "List or search Rental & Fire Recurring Compliance Programs by property address, owner, parcel ID, certificate number, or program type.",
        "parameters": {
            "type": "OBJECT",
            "properties": {
                "query": {"type": "STRING", "description": "Optional property address, owner name, parcel ID, or certificate number"},
                "program_type": {"type": "STRING", "description": "Optional program type (e.g. 'Rental Housing', 'Fire Inspection')"},
                "status": {"type": "STRING", "description": "Optional status ('active', 'inactive', 'suspended')"},
            },
        },
    },
    {
        "name": "list_facility_reservations",
        "description": "List or search municipal facility reservations by reservation number, facility name, event title, or requester.",
        "parameters": {
            "type": "OBJECT",
            "properties": {
                "query": {"type": "STRING", "description": "Optional search keyword"},
                "status": {"type": "STRING", "description": "Optional status ('pending', 'approved', 'denied', 'cancelled')"},
            },
        },
    },
    {
        "name": "list_facilities",
        "description": "List available reservable municipal facilities (parks, pavilions, halls) and their fees.",
        "parameters": {"type": "OBJECT", "properties": {}},
    },
    {
        "name": "create_facility",
        "description": "Add a new reservable municipal facility (only after the user confirms they want to create it).",
        "parameters": {
            "type": "OBJECT",
            "properties": {
                "name": {"type": "STRING", "description": "Facility name (e.g. 'Tighe-Schmitz Park Pavilion')"},
                "description": {"type": "STRING", "description": "Optional description"},
                "daily_fee": {"type": "STRING", "description": "Optional daily fee (e.g. '$50.00')"},
                "hourly_fee": {"type": "STRING", "description": "Optional hourly fee"},
                "capacity": {"type": "STRING", "description": "Optional capacity"},
            },
            "required": ["name"],
        },
    },
    {
        "name": "create_facility_reservation",
        "description": "Create a municipal facility reservation request (e.g. park pavilion or hall booking).",
        "parameters": {
            "type": "OBJECT",
            "properties": {
                "facility_name": {"type": "STRING", "description": "Facility name (e.g. 'Tighe-Schmitz Park Pavilion')"},
                "event_date": {"type": "STRING", "description": "Event date YYYY-MM-DD"},
                "event_title": {"type": "STRING", "description": "Event title or purpose (default 'Park Pavilion Reservation')"},
                "requester_name": {"type": "STRING", "description": "Requester name (defaults to current user)"},
                "start_time": {"type": "STRING", "description": "Optional start time (e.g. '3:00 PM')"},
                "end_time": {"type": "STRING", "description": "Optional end time (e.g. '5:00 PM')"},
                "requester_email": {"type": "STRING", "description": "Optional email"},
                "requester_phone": {"type": "STRING", "description": "Optional phone"},
                "notes": {"type": "STRING", "description": "Optional notes"},
            },
            "required": ["facility_name", "event_date"],
        },
    },
] + EXT_TOOL_DECLARATIONS


_TOOL_ACCESS: dict[str, tuple[str | None, tuple[str, ...]]] = {
    "create_agenda": ("agendas", ("agendas.manage",)),
    "add_agenda_item": ("agendas", ("agendas.manage", "agendas.submit")),
    "update_agenda_item": ("agendas", ("agendas.manage", "agendas.submit")),
    "add_agenda_item_attachment": ("agendas", ("agendas.manage", "agendas.submit")),
    "create_todo": ("agendas", ("agendas.manage",)),
    "list_agendas": ("agendas", ("agendas.manage", "agendas.submit")),
    "finalize_agenda": ("agendas", ("agendas.manage",)),
    "create_notice": ("communications", ("notices.manage",)),
    "list_notices": ("communications", ("notices.manage",)),
    "update_notice": ("communications", ("notices.manage",)),
    "create_blog_post": ("communications", ("blog.manage",)),
    "list_blog_posts": ("communications", ("blog.manage",)),
    "update_blog_post": ("communications", ("blog.manage",)),
    "update_urgent_alert": ("communications", ("notices.manage", "pages.manage")),
    "create_directory_entry": ("communications", ("directory.manage",)),
    "create_faq": ("communications", ("directory.manage",)),
    "create_page": ("communications", ("pages.manage",)),
    "list_pages": ("communications", ("pages.manage",)),
    "update_page": ("communications", ("pages.manage",)),
    "search_portal_info": ("communications", ()),
    "create_calendar_event": ("calendar", ("calendar.manage",)),
    "create_permit": ("permits", ("permits.manage", "permits.submit")),
    "update_permit_status": ("permits", ("permits.manage",)),
    "schedule_inspection": ("permits", ("permits.manage",)),
    "list_permits": ("permits", ("permits.manage",)),
    "get_permit_details": ("permits", ("permits.manage",)),
    "create_complaint": ("complaints", ("complaints.manage", "complaints.submit")),
    "list_complaints": ("complaints", ("complaints.manage", "complaints.log")),
    "get_complaint_details": ("complaints", ("complaints.manage", "complaints.log")),
    "create_work_order": ("complaints", ("complaints.manage",)),
    "create_public_record": ("records", ("records.manage",)),
    "search_records": ("records", ("records.manage", "records.view")),
    "read_record_file": ("records", ("records.manage", "records.view")),
    "search_city_code": ("codification", ()),
    "get_city_code_section": ("codification", ()),
    "add_contractor_license": ("licensing", ("licensing.manage",)),
    "create_utility_bill": ("utilities", ("utilities.manage",)),
    "create_citation": ("citations", ("citations.manage",)),
    "toggle_module": (None, ("__admin__",)),
    "update_branding": (None, ("__admin__",)),
    "get_agenda_details": ("agendas", ("agendas.manage", "agendas.submit")),
    "list_backlog_todos": ("agendas", ("agendas.manage",)),
    "list_inspections": ("permits", ("permits.manage",)),
    "list_work_orders": ("complaints", ("complaints.manage",)),
    "list_foia_requests": ("records", ("records.manage", "records.view")),
    "list_calendar_events": ("calendar", ()),
    "search_directory": ("communications", ()),
    "list_forms": ("communications", ()),
    "list_contractor_licenses": ("licensing", ("licensing.manage",)),
    "list_utility_bills": ("utilities", ("utilities.manage",)),
    "list_citations": ("citations", ("citations.manage",)),
    "list_compliance_programs": ("licensing", ("licensing.manage",)),
    "list_facility_reservations": ("calendar", ("calendar.manage",)),
    "list_facilities": ("calendar", ()),
    "create_facility": ("calendar", ("calendar.manage",)),
    "create_facility_reservation": ("calendar", ("calendar.manage",)),
    **EXT_TOOL_ACCESS,
}


def _check_tool_access(name: str, user: dict) -> str | None:
    """Return None if user may run tool `name`, otherwise a human-readable denial reason."""
    policy = _TOOL_ACCESS.get(name)
    if policy is None:
        return f"Unknown or unauthorized tool: {name}"
    mod_id, perms = policy
    if mod_id and not is_module_enabled(mod_id):
        return f"The '{mod_id}' module is currently disabled."
    if "__admin__" in perms:
        if user.get("role") != "admin":
            return "Administrator access is required for this action."
        return None
    if perms and not any(has_permission(user, p) for p in perms):
        return f"Insufficient permissions for '{name}' (requires one of: {', '.join(perms)})."
    return None


def _allowed_tools_for_user(user: dict) -> list[dict]:
    return [decl for decl in _TOOL_DECLARATIONS if _check_tool_access(decl["name"], user) is None]


def _find_active_facility(conn, fname_req: str):
    """Look up an active reservable facility by exact name or search terms."""
    fac = conn.execute(
        "SELECT id, name, daily_fee, hourly_fee FROM reservable_facilities WHERE is_active = TRUE AND LOWER(name) = LOWER(%s)",
        (fname_req,),
    ).fetchone()
    if not fac:
        terms = _extract_search_terms(fname_req)
        if terms:
            conds = " AND ".join("name ILIKE %s" for _ in terms)
            fac = conn.execute(
                f"SELECT id, name, daily_fee, hourly_fee FROM reservable_facilities WHERE is_active = TRUE AND ({conds}) ORDER BY id ASC LIMIT 1",
                tuple(f"%{t}%" for t in terms),
            ).fetchone()
    return fac


def _find_cms_record(conn, table: str, rec_id, title_match: str, *, has_slug: bool = True):
    """Find a CMS row (blog_posts, city_notices, city_pages) by ID, exact slug/title, or fuzzy title."""
    if rec_id is not None:
        try:
            rid = int(rec_id)
            row = conn.execute(f"SELECT id, title FROM {table} WHERE id = %s", (rid,)).fetchone()
            if row:
                return row
        except (TypeError, ValueError):
            pass
    match = (title_match or "").strip()
    if not match:
        return None
    if has_slug:
        slug_guess = _slugify(match, "")
        if slug_guess:
            row = conn.execute(
                f"SELECT id, title FROM {table} WHERE slug = %s ORDER BY id DESC LIMIT 1",
                (slug_guess,),
            ).fetchone()
            if row:
                return row
    row = conn.execute(
        f"SELECT id, title FROM {table} WHERE LOWER(trim(title)) = LOWER(%s) ORDER BY id DESC LIMIT 1",
        (match,),
    ).fetchone()
    if row:
        return row
    return conn.execute(
        f"SELECT id, title FROM {table} WHERE title ILIKE %s ORDER BY id DESC LIMIT 1",
        (f"%{match}%",),
    ).fetchone()


def _format_blog_body(body_txt: str) -> str:
    txt = body_txt.strip()
    if not txt:
        return ""
    return txt if txt.lstrip().startswith("<") else f"<p>{txt}</p>"


def _execute_tool(name: str, args: dict, user: dict) -> tuple[dict, dict | None]:
    """Execute a validated tool call after enforcing module and permission checks."""
    denied = _check_tool_access(name, user)
    if denied:
        return {"ok": False, "error": denied}, None
    username = user["username"]
    with pool.connection() as conn:
        if name == "create_agenda":
            title = str(args.get("title") or "").strip() or "Meeting Agenda"
            body = str(args.get("body") or "City Council").strip() or "City Council"
            mdate = date.fromisoformat(str(args["meeting_date"]).strip())
            mtime = str(args.get("meeting_time") or "6:30 PM").strip()
            cat_row = conn.execute("SELECT categories FROM agenda_preferences WHERE id = 1").fetchone()
            default_status = "In Progress"
            if cat_row and isinstance(cat_row[0], list) and cat_row[0]:
                first_cat = cat_row[0][0]
                if isinstance(first_cat, dict) and first_cat.get("name"):
                    default_status = first_cat["name"]
            row = conn.execute(
                "INSERT INTO agendas (title, body, meeting_date, meeting_time, status) "
                "VALUES (%s, %s, %s, %s, %s) RETURNING id, title, body, meeting_date, meeting_time, status",
                (title, body, mdate, mtime, default_status),
            ).fetchone()
            ag_id = row[0]
            route = f"/app/agendas/{ag_id}"
            return (
                {"ok": True, "agenda_id": ag_id, "title": row[1], "body": row[2], "meeting_date": row[3].isoformat(), "meeting_time": row[4], "status": row[5]},
                {"tool": name, "summary": f"Created agenda #{ag_id}: {row[1]} ({row[2]}, {row[3].isoformat()} at {row[4]})", "route": route},
            )

        if name == "add_agenda_item":
            ag_id = int(args["agenda_id"])
            ag_exists = conn.execute(
                "SELECT id, title, status, finalized_at FROM agendas WHERE id = %s",
                (ag_id,),
            ).fetchone()
            if not ag_exists:
                return {"ok": False, "error": f"Agenda #{ag_id} not found"}, None
            cat_row = conn.execute("SELECT categories FROM agenda_preferences WHERE id = 1").fetchone()
            final_cats = {
                c["name"]
                for c in (cat_row[0] if cat_row and isinstance(cat_row[0], list) else [])
                if isinstance(c, dict) and c.get("is_final") and c.get("name")
            }
            ag_status = str(ag_exists[2] or "")
            if ag_exists[3] is not None or ag_status.lower().startswith("finalized") or ag_status in final_cats:
                return {
                    "ok": False,
                    "error": f"Agenda #{ag_id} ('{ag_exists[1]}') is finalized and cannot be modified.",
                }, None
            title = str(args.get("title") or "").strip()
            section_name = str(args.get("section_name") or "New Business").strip()
            desc = str(args.get("description") or "").strip()
            sec_match = conn.execute(
                "SELECT section, MAX(position) FROM agenda_items "
                "WHERE agenda_id = %s AND LOWER(trim(section)) = LOWER(trim(%s)) "
                "GROUP BY section ORDER BY MAX(position) DESC LIMIT 1",
                (ag_id, section_name),
            ).fetchone()
            if sec_match:
                section_name = sec_match[0]
                insert_pos = int(sec_match[1]) + 1
                conn.execute(
                    "UPDATE agenda_items SET position = position + 1 WHERE agenda_id = %s AND position >= %s",
                    (ag_id, insert_pos),
                )
            else:
                max_pos = conn.execute("SELECT COALESCE(MAX(position), 0) FROM agenda_items WHERE agenda_id = %s", (ag_id,)).fetchone()[0]
                insert_pos = int(max_pos) + 1
            row = conn.execute(
                "INSERT INTO agenda_items (agenda_id, position, title, section, description) "
                "VALUES (%s, %s, %s, %s, %s) RETURNING id",
                (ag_id, insert_pos, title, section_name, desc),
            ).fetchone()
            return (
                {"ok": True, "item_id": row[0], "agenda_id": ag_id, "title": title, "section_name": section_name},
                {"tool": name, "summary": f"Added item '{title}' to {ag_exists[1]}", "route": f"/app/agendas/{ag_id}"},
            )

        if name == "update_agenda_item":
            ag_id = int(args["agenda_id"])
            item_id = int(args["item_id"])
            ag_exists = conn.execute(
                "SELECT id, title, status, finalized_at FROM agendas WHERE id = %s",
                (ag_id,),
            ).fetchone()
            if not ag_exists:
                return {"ok": False, "error": f"Agenda #{ag_id} not found"}, None
            cat_row = conn.execute("SELECT categories FROM agenda_preferences WHERE id = 1").fetchone()
            final_cats = {
                c["name"]
                for c in (cat_row[0] if cat_row and isinstance(cat_row[0], list) else [])
                if isinstance(c, dict) and c.get("is_final") and c.get("name")
            }
            ag_status = str(ag_exists[2] or "")
            if ag_exists[3] is not None or ag_status.lower().startswith("finalized") or ag_status in final_cats:
                return {
                    "ok": False,
                    "error": f"Agenda #{ag_id} ('{ag_exists[1]}') is finalized and cannot be modified.",
                }, None
            it_row = conn.execute(
                "SELECT id, title FROM agenda_items WHERE id = %s AND agenda_id = %s",
                (item_id, ag_id),
            ).fetchone()
            if not it_row:
                return {"ok": False, "error": f"Agenda item #{item_id} not found on agenda #{ag_id}"}, None
            col_map = {
                "title": "title",
                "description": "description",
                "section_name": "section",
                "presenter": "presenter",
                "recommended_motion": "recommended_motion",
                "fiscal_impact": "fiscal_impact",
            }
            sets = []
            params = []
            for arg_k, db_col in col_map.items():
                if args.get(arg_k) is not None:
                    sets.append(f"{db_col} = %s")
                    params.append(str(args[arg_k]).strip())
            if not sets:
                return {"ok": False, "error": "No fields provided to update"}, None
            params.extend([item_id, ag_id])
            conn.execute(
                f"UPDATE agenda_items SET {', '.join(sets)} WHERE id = %s AND agenda_id = %s",
                tuple(params),
            )
            new_title = str(args.get("title") or it_row[1]).strip()
            return (
                {"ok": True, "item_id": item_id, "agenda_id": ag_id, "title": new_title},
                {"tool": name, "summary": f"Updated item #{item_id} ('{new_title}') on {ag_exists[1]}", "route": f"/app/agendas/{ag_id}"},
            )

        if name == "add_agenda_item_attachment":
            from . import agendas as _agendas

            ag_id = int(args["agenda_id"])
            ag_row = conn.execute("SELECT id, title FROM agendas WHERE id = %s", (ag_id,)).fetchone()
            if not ag_row:
                return {"ok": False, "error": f"Agenda #{ag_id} not found"}, None
            if args.get("item_id") is not None:
                item_id = int(args["item_id"])
                it_row = conn.execute(
                    "SELECT id, title FROM agenda_items WHERE id = %s AND agenda_id = %s",
                    (item_id, ag_id),
                ).fetchone()
            else:
                it_row = conn.execute(
                    "SELECT id, title FROM agenda_items WHERE agenda_id = %s ORDER BY id DESC LIMIT 1",
                    (ag_id,),
                ).fetchone()
            if not it_row:
                return {"ok": False, "error": f"No agenda item found on agenda #{ag_id}. Add an agenda item first."}, None
            item_id = it_row[0]
            doc_title = str(args.get("title") or "").strip() or "Attachment"
            doc_content = str(args.get("content") or "").strip()
            if not doc_content:
                return {"ok": False, "error": "Attachment content cannot be empty"}, None
            _agendas.create_text_document(
                ag_id,
                item_id,
                _agendas.TextDocIn(title=doc_title, content=doc_content),
                user,
            )
            return (
                {"ok": True, "agenda_id": ag_id, "item_id": item_id, "title": doc_title},
                {"tool": name, "summary": f"Attached '{doc_title}' to '{it_row[1]}' on {ag_row[1]}", "route": f"/app/agendas/{ag_id}"},
            )

        if name == "create_todo":
            title = str(args.get("title") or "").strip()
            due_raw = str(args.get("due_date") or "").strip()
            due_val = date.fromisoformat(due_raw) if due_raw else None
            notes = str(args.get("notes") or "").strip()
            next_pos = conn.execute(
                "SELECT COALESCE(MAX(position), 0) + 1 FROM agenda_items WHERE agenda_id IS NULL"
            ).fetchone()[0]
            row = conn.execute(
                "INSERT INTO agenda_items (agenda_id, position, title, description, target_date, todo_status, assigned_to, recurrence) "
                "VALUES (NULL, %s, %s, %s, %s, 'open', %s, 'none') RETURNING id",
                (next_pos, title, notes, due_val, username),
            ).fetchone()
            return (
                {"ok": True, "todo_id": row[0], "title": title, "due_date": due_val.isoformat() if due_val else None},
                {"tool": name, "summary": f"Added backlog todo: {title}", "route": "/app/backlog"},
            )

        if name == "create_notice":
            title = str(args.get("title") or "").strip()
            raw_cat = str(args.get("category") or "notice").strip().lower()
            cat_map = {"notice": "notice", "news": "news", "bid": "bid", "bid / rfp": "bid", "rfp": "bid", "job": "job", "job posting": "job"}
            cat = cat_map.get(raw_cat, "notice")
            summary = str(args.get("summary") or "").strip()
            body_txt = str(args.get("body") or summary or title).strip()
            is_pub = bool(args.get("is_public", True))
            existing = conn.execute(
                "SELECT id, is_published FROM city_notices WHERE LOWER(trim(title)) = LOWER(%s) ORDER BY id DESC LIMIT 1",
                (title,),
            ).fetchone()
            if existing:
                if not existing[1] and is_pub:
                    conn.execute(
                        "UPDATE city_notices SET category = %s, "
                        "summary = COALESCE(NULLIF(%s, ''), summary), "
                        "body = COALESCE(NULLIF(%s, ''), body), "
                        "is_published = TRUE, updated_at = now() WHERE id = %s",
                        (cat, summary, body_txt, existing[0]),
                    )
                    return (
                        {"ok": True, "notice_id": existing[0], "title": title, "category": cat, "is_published": True, "updated_existing": True},
                        {"tool": name, "summary": f"Published existing notice: {title}", "route": "/app/notices-manage"},
                    )
                return (
                    {"ok": False, "error": f"A notice titled '{title}' already exists (notice_id={existing[0]}). Use update_notice to modify or publish/unpublish it."},
                    None,
                )
            row = conn.execute(
                "INSERT INTO city_notices (title, category, summary, body, is_published, created_by) "
                "VALUES (%s, %s, %s, %s, %s, %s) RETURNING id",
                (title, cat, summary, body_txt, is_pub, username),
            ).fetchone()
            return (
                {"ok": True, "notice_id": row[0], "title": title, "category": cat, "is_published": is_pub},
                {"tool": name, "summary": f"Created {cat}: {title}", "route": "/app/notices-manage"},
            )

        if name == "list_notices":
            lim = max(1, min(int(args.get("limit") or 10), 25))
            q = str(args.get("search") or "").strip()
            st = str(args.get("status") or "all").strip().lower()
            clauses = ["1=1"]
            params: list = []
            if st == "draft":
                clauses.append("is_published = FALSE")
            elif st == "published":
                clauses.append("is_published = TRUE")
            if q:
                clauses.append("(title ILIKE %s OR summary ILIKE %s)")
                params.extend([f"%{q}%", f"%{q}%"])
            params.append(lim)
            rows = conn.execute(
                f"SELECT id, title, category, summary, is_published, publish_at FROM city_notices WHERE {' AND '.join(clauses)} ORDER BY id DESC LIMIT %s",
                tuple(params),
            ).fetchall()
            return (
                {
                    "ok": True,
                    "notices": [
                        {
                            "id": r[0],
                            "title": r[1],
                            "category": r[2],
                            "summary": r[3],
                            "is_published": r[4],
                            "publish_at": r[5].isoformat() if r[5] else None,
                        }
                        for r in rows
                    ],
                },
                None,
            )

        if name == "update_notice":
            target = _find_cms_record(conn, "city_notices", args.get("notice_id"), str(args.get("title_match") or args.get("title") or ""), has_slug=False)
            if not target:
                return ({"ok": False, "error": "Notice not found. Use list_notices to find the notice ID or exact title."}, None)
            nid, current_title = target
            sets = ["updated_at = now()"]
            params_u: list = []
            if args.get("title"):
                sets.append("title = %s")
                params_u.append(str(args["title"]).strip())
            if args.get("category"):
                raw_cat = str(args["category"]).strip().lower()
                cat_map = {"notice": "notice", "news": "news", "bid": "bid", "bid / rfp": "bid", "rfp": "bid", "job": "job", "job posting": "job"}
                sets.append("category = %s")
                params_u.append(cat_map.get(raw_cat, "notice"))
            if "summary" in args and args["summary"] is not None:
                sets.append("summary = %s")
                params_u.append(str(args["summary"]).strip())
            if args.get("body"):
                sets.append("body = %s")
                params_u.append(str(args["body"]).strip())
            if "is_public" in args and args["is_public"] is not None:
                sets.append("is_published = %s")
                params_u.append(bool(args["is_public"]))
            params_u.append(nid)
            row = conn.execute(
                f"UPDATE city_notices SET {', '.join(sets)} WHERE id = %s RETURNING id, title, is_published",
                tuple(params_u),
            ).fetchone()
            return (
                {"ok": True, "notice_id": row[0], "title": row[1], "is_published": row[2]},
                {"tool": name, "summary": f"Updated notice '{row[1]}' ({'published' if row[2] else 'draft'})", "route": "/app/notices-manage"},
            )

        if name == "create_blog_post":
            title = str(args.get("title") or "").strip()
            summary = str(args.get("summary") or "").strip()
            body_txt = str(args.get("body") or "").strip()
            is_pub = bool(args.get("is_published", False))
            slug = _slugify(title, "post")
            existing = conn.execute(
                "SELECT id, is_published, slug FROM blog_posts WHERE slug = %s OR LOWER(trim(title)) = LOWER(%s) ORDER BY id DESC LIMIT 1",
                (slug, title),
            ).fetchone()
            if existing:
                if not existing[1] and is_pub:
                    conn.execute(
                        "UPDATE blog_posts SET "
                        "lead_in = COALESCE(NULLIF(%s, ''), lead_in), "
                        "body = COALESCE(NULLIF(%s, ''), body), "
                        "is_published = TRUE, updated_at = now() WHERE id = %s",
                        (summary, _format_blog_body(body_txt), existing[0]),
                    )
                    return (
                        {"ok": True, "post_id": existing[0], "slug": existing[2], "title": title, "is_published": True, "updated_existing": True},
                        {"tool": name, "summary": f"Published existing blog post: {title}", "route": "/app/blog-manage"},
                    )
                return (
                    {"ok": False, "error": f"A blog post titled '{title}' already exists (post_id={existing[0]}, slug={existing[2]}). Use update_blog_post to modify or publish/unpublish it."},
                    None,
                )
            cat_row = conn.execute("SELECT id FROM blog_categories ORDER BY id ASC LIMIT 1").fetchone()
            if not cat_row:
                cat_row = conn.execute(
                    "INSERT INTO blog_categories (name, slug) VALUES ('City News', 'city-news') RETURNING id"
                ).fetchone()
            row = conn.execute(
                "INSERT INTO blog_posts (category_id, slug, title, lead_in, body, is_published, author_name) "
                "VALUES (%s, %s, %s, %s, %s, %s, %s) RETURNING id, slug",
                (cat_row[0], slug, title, summary, _format_blog_body(body_txt), is_pub, username),
            ).fetchone()
            return (
                {"ok": True, "post_id": row[0], "slug": row[1], "title": title, "is_published": is_pub},
                {"tool": name, "summary": f"Created blog post ({'published' if is_pub else 'draft'}): {title}", "route": "/app/blog-manage"},
            )

        if name == "list_blog_posts":
            lim = max(1, min(int(args.get("limit") or 10), 25))
            q = str(args.get("search") or "").strip()
            st = str(args.get("status") or "all").strip().lower()
            clauses = ["1=1"]
            params_b: list = []
            if st == "draft":
                clauses.append("is_published = FALSE")
            elif st == "published":
                clauses.append("is_published = TRUE")
            if q:
                clauses.append("(title ILIKE %s OR lead_in ILIKE %s OR slug ILIKE %s)")
                params_b.extend([f"%{q}%", f"%{q}%", f"%{q}%"])
            params_b.append(lim)
            rows = conn.execute(
                f"SELECT id, slug, title, lead_in, is_published, publish_at FROM blog_posts WHERE {' AND '.join(clauses)} ORDER BY id DESC LIMIT %s",
                tuple(params_b),
            ).fetchall()
            return (
                {
                    "ok": True,
                    "posts": [
                        {
                            "id": r[0],
                            "slug": r[1],
                            "title": r[2],
                            "summary": r[3],
                            "is_published": r[4],
                            "publish_at": r[5].isoformat() if r[5] else None,
                        }
                        for r in rows
                    ],
                },
                None,
            )

        if name == "update_blog_post":
            target = _find_cms_record(conn, "blog_posts", args.get("post_id"), str(args.get("title_match") or args.get("title") or ""), has_slug=True)
            if not target:
                return ({"ok": False, "error": "Blog post not found. Use list_blog_posts to find the post ID or exact title."}, None)
            pid, _ = target
            sets = ["updated_at = now()"]
            params_bu: list = []
            if args.get("title"):
                sets.append("title = %s")
                params_bu.append(str(args["title"]).strip())
            if "summary" in args and args["summary"] is not None:
                sets.append("lead_in = %s")
                params_bu.append(str(args["summary"]).strip())
            if args.get("body"):
                sets.append("body = %s")
                params_bu.append(_format_blog_body(str(args["body"])))
            if "is_published" in args and args["is_published"] is not None:
                sets.append("is_published = %s")
                params_bu.append(bool(args["is_published"]))
            params_bu.append(pid)
            row = conn.execute(
                f"UPDATE blog_posts SET {', '.join(sets)} WHERE id = %s RETURNING id, slug, title, is_published",
                tuple(params_bu),
            ).fetchone()
            return (
                {"ok": True, "post_id": row[0], "slug": row[1], "title": row[2], "is_published": row[3]},
                {"tool": name, "summary": f"Updated blog post '{row[2]}' ({'published' if row[3] else 'draft'})", "route": "/app/blog-manage"},
            )

        if name == "create_calendar_event":
            title = str(args.get("title") or "").strip()
            ev_date = date.fromisoformat(str(args["event_date"]).strip())
            start_time = str(args.get("start_time") or "").strip()
            location = str(args.get("location") or "").strip()
            desc = str(args.get("description") or "").strip()
            row = conn.execute(
                "INSERT INTO calendar_events (title, event_date, start_time, location, description, is_public, created_by) "
                "VALUES (%s, %s, %s, %s, %s, TRUE, %s) RETURNING id",
                (title, ev_date, start_time, location, desc, username),
            ).fetchone()
            return (
                {"ok": True, "event_id": row[0], "title": title, "event_date": ev_date.isoformat()},
                {"tool": name, "summary": f"Created calendar event: {title} ({ev_date.isoformat()})", "route": "/app/calendar-manage"},
            )

        if name == "update_urgent_alert":
            enabled = bool(args.get("enabled", False))
            msg = str(args.get("message") or "").strip()
            conn.execute(
                "UPDATE agenda_preferences SET alert_enabled = %s, alert_message = %s, updated_at = now() WHERE id = 1",
                (enabled, msg if enabled else ""),
            )
            return (
                {"ok": True, "urgent_alert_enabled": enabled, "message": msg},
                {"tool": name, "summary": f"{'Enabled' if enabled else 'Cleared'} urgent alert banner", "route": "/app/preferences-general"},
            )

        if name == "list_agendas":
            lim = max(1, min(int(args.get("limit") or 8), 20))
            rows = conn.execute(
                "SELECT id, title, body, meeting_date, meeting_time, status FROM agendas ORDER BY meeting_date DESC NULLS LAST, id DESC LIMIT %s",
                (lim,),
            ).fetchall()
            return (
                {
                    "ok": True,
                    "agendas": [
                        {
                            "id": r[0],
                            "title": r[1],
                            "body": r[2],
                            "meeting_date": r[3].isoformat() if r[3] else None,
                            "meeting_time": r[4],
                            "status": r[5],
                        }
                        for r in rows
                    ],
                },
                None,
            )

        if name == "finalize_agenda":
            ag_id = int(args["agenda_id"])
            cat_row = conn.execute("SELECT categories FROM agenda_preferences WHERE id = 1").fetchone()
            fin_status = "Finalized Agendas"
            if cat_row and isinstance(cat_row[0], list):
                for c in cat_row[0]:
                    if isinstance(c, dict) and (c.get("warn_on_leave") or str(c.get("name", "")).lower().startswith("finalized")):
                        fin_status = c["name"]
                        break
            row = conn.execute(
                "UPDATE agendas SET status = %s, finalized_at = COALESCE(finalized_at, now()), updated_at = now() "
                "WHERE id = %s RETURNING id, title, status",
                (fin_status, ag_id),
            ).fetchone()
            if not row:
                return {"ok": False, "error": f"Agenda #{ag_id} not found"}, None
            return (
                {"ok": True, "agenda_id": row[0], "title": row[1], "status": row[2]},
                {"tool": name, "summary": f"Finalized agenda #{row[0]}: {row[1]}", "route": f"/app/agendas/{row[0]}"},
            )

        if name == "create_permit":
            req_type = str(args.get("permit_type_name") or "").strip()
            req_use = str(args.get("permit_use_name") or "").strip()
            prop_addr = str(args.get("property_address") or "").strip()
            app_name = str(args.get("applicant_name") or username or "Admin Intake").strip()
            app_email = str(args.get("applicant_email") or "").strip()
            app_phone = str(args.get("applicant_phone") or "").strip()
            desc = str(args.get("description") or "").strip()

            t_row = conn.execute(
                "SELECT id, name, kind FROM permit_types WHERE LOWER(name) = LOWER(%s) "
                "UNION ALL SELECT id, name, kind FROM permit_types WHERE name ILIKE %s LIMIT 1",
                (req_type, f"%{req_type}%"),
            ).fetchone()
            if not t_row:
                return {"ok": False, "error": f"Permit type '{req_type}' not found"}, None
            t_id, t_name, t_kind = t_row

            u_row = None
            if req_use:
                u_row = conn.execute(
                    "SELECT id, name, fee_amount FROM permit_uses WHERE permit_type_id = %s AND (LOWER(name) = LOWER(%s) OR name ILIKE %s) LIMIT 1",
                    (t_id, req_use, f"%{req_use}%"),
                ).fetchone()
            if not u_row:
                u_row = conn.execute(
                    "SELECT id, name, fee_amount FROM permit_uses WHERE permit_type_id = %s ORDER BY sort_order ASC, id ASC LIMIT 1",
                    (t_id,),
                ).fetchone()
            u_id = u_row[0] if u_row else None
            u_name = u_row[1] if u_row else t_name
            fee_amt = u_row[2] if u_row else ""

            year = datetime.now(timezone.utc).year
            row = conn.execute(
                "INSERT INTO permits "
                "(permit_number, applicant_username, permit_type_id, permit_use_id, permit_type_name, permit_use_name, "
                " applicant_name, applicant_email, applicant_phone, property_address, project_description, fee_amount, accepted_terms, permit_kind, status) "
                "VALUES ('TEMP', %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, TRUE, %s, 'submitted') RETURNING id",
                (username, t_id, u_id, t_name, u_name, app_name, app_email, app_phone, prop_addr, desc, fee_amt, t_kind or "construction"),
            ).fetchone()
            pid = row[0]
            pnum = f"PRM-{year}-{pid:04d}"
            conn.execute("UPDATE permits SET permit_number = %s WHERE id = %s", (pnum, pid))
            return (
                {"ok": True, "permit_id": pid, "permit_number": pnum, "permit_type": t_name, "permit_use": u_name, "property_address": prop_addr, "fee_amount": fee_amt},
                {"tool": name, "summary": f"Created {t_name} ({pnum}) for {prop_addr}", "route": "/app/permits-review"},
            )

        if name == "update_permit_status":
            pnum = str(args.get("permit_number") or "").strip()
            status = str(args.get("status") or "").strip().lower()
            notes = str(args.get("notes") or "").strip()
            row = conn.execute(
                "UPDATE permits SET status = %s, review_notes = CASE WHEN %s <> '' THEN %s ELSE review_notes END, "
                "reviewed_by = %s, updated_at = now() WHERE UPPER(permit_number) = UPPER(%s) RETURNING id, permit_number, status",
                (status, notes, notes, username, pnum),
            ).fetchone()
            if not row:
                return {"ok": False, "error": f"Permit '{pnum}' not found"}, None
            return (
                {"ok": True, "permit_number": row[1], "status": row[2]},
                {"tool": name, "summary": f"Updated {row[1]} status to {row[2]}", "route": "/app/permits-review"},
            )

        if name == "schedule_inspection":
            pnum = str(args.get("permit_number") or "").strip()
            itype = str(args.get("inspection_type") or "Site Inspection").strip()
            sdate = str(args.get("scheduled_date") or "").strip()
            insp = str(args.get("inspector") or "").strip()
            notes = str(args.get("notes") or "").strip()
            p_row = conn.execute("SELECT id, permit_number FROM permits WHERE UPPER(permit_number) = UPPER(%s)", (pnum,)).fetchone()
            if not p_row:
                return {"ok": False, "error": f"Permit '{pnum}' not found"}, None
            row = conn.execute(
                "INSERT INTO permit_inspections (permit_id, inspection_type, scheduled_date, inspector, result, notes) "
                "VALUES (%s, %s, %s, %s, 'scheduled', %s) RETURNING id",
                (p_row[0], itype, sdate, insp, notes),
            ).fetchone()
            return (
                {"ok": True, "inspection_id": row[0], "permit_number": p_row[1], "inspection_type": itype, "scheduled_date": sdate},
                {"tool": name, "summary": f"Scheduled {itype} on {p_row[1]} for {sdate}", "route": "/app/field-inspector"},
            )

        if name == "list_permits":
            q = str(args.get("query") or "").strip()
            st_f = str(args.get("status") or "").strip().lower()
            like = f"%{q}%"
            rows = conn.execute(
                "SELECT permit_number, permit_type_name, permit_use_name, property_address, status, fee_amount "
                "FROM permits WHERE (%s = '' OR property_address ILIKE %s OR permit_number ILIKE %s OR permit_type_name ILIKE %s) "
                "AND (%s = '' OR status = %s) ORDER BY id DESC LIMIT 12",
                (q, like, like, like, st_f, st_f),
            ).fetchall()
            return (
                {"ok": True, "permits": [{"permit_number": r[0], "type": r[1], "use": r[2], "address": r[3], "status": r[4], "fee": r[5]} for r in rows]},
                None,
            )

        if name == "get_permit_details":
            pnum = str(args.get("permit_number") or "").strip()
            row = conn.execute(
                "SELECT id, permit_number, permit_type_name, permit_use_name, applicant_name, applicant_email, "
                "applicant_phone, owner_name, property_address, parcel_id, project_description, estimated_value, "
                "status, fee_amount, payment_status, review_notes, custom_data, planning_data "
                "FROM permits WHERE UPPER(permit_number) = UPPER(%s)",
                (pnum,),
            ).fetchone()
            if not row:
                return {"ok": False, "error": f"Permit '{pnum}' not found"}, None
            docs = conn.execute(
                "SELECT filename, doc_type, content_type, size_bytes FROM permit_documents WHERE permit_id = %s ORDER BY id ASC",
                (row[0],),
            ).fetchall()
            return (
                {
                    "ok": True,
                    "permit": {
                        "permit_number": row[1],
                        "type": row[2],
                        "use": row[3],
                        "applicant_name": row[4],
                        "applicant_email": row[5],
                        "applicant_phone": row[6],
                        "owner_name": row[7],
                        "property_address": row[8],
                        "parcel_id": row[9],
                        "project_description": row[10],
                        "estimated_value": row[11],
                        "status": row[12],
                        "fee_amount": row[13],
                        "payment_status": row[14],
                        "review_notes": row[15],
                        "custom_data": row[16] or {},
                        "planning_data": row[17] or {},
                        "documents": [
                            {"filename": d[0], "doc_type": d[1], "content_type": d[2], "size_bytes": d[3]}
                            for d in docs
                        ],
                    },
                },
                None,
            )

        if name == "list_complaints":
            q = str(args.get("query") or "").strip()
            st_f = str(args.get("status") or "").strip().lower()
            like = f"%{q}%"
            rows = conn.execute(
                "SELECT complaint_number, subject_property_address, ordinance_section, conduct_description, status, enforcement_stage, date_observed "
                "FROM complaints WHERE (%s = '' OR complaint_number ILIKE %s OR subject_property_address ILIKE %s OR ordinance_section ILIKE %s OR conduct_description ILIKE %s) "
                "AND (%s = '' OR LOWER(status) = %s) ORDER BY id DESC LIMIT 12",
                (q, like, like, like, like, st_f, st_f),
            ).fetchall()
            return (
                {
                    "ok": True,
                    "complaints": [
                        {
                            "complaint_number": r[0],
                            "property_address": r[1],
                            "ordinance_section": r[2],
                            "description": (r[3] or "")[:300],
                            "status": r[4],
                            "enforcement_stage": r[5],
                            "date_observed": r[6],
                        }
                        for r in rows
                    ],
                },
                None,
            )

        if name == "get_complaint_details":
            cnum = str(args.get("complaint_number") or "").strip()
            candidates = [cnum]
            m_cmp = re.match(r"^(CMP-\d{4}-)(\d+)$", cnum, re.IGNORECASE)
            if m_cmp:
                candidates.append(f"{m_cmp.group(1)}{int(m_cmp.group(2)):04d}")
            row = None
            for cand in candidates:
                row = conn.execute(
                    "SELECT id, complaint_number, intake_channel, is_anonymous, complainant_name, "
                    "subject_property_address, subject_person_name, ordinance_section, conduct_description, "
                    "date_observed, status, assigned_to, investigation_report, enforcement_stage, "
                    "nov_required_action, nov_compliance_deadline, final_resolution "
                    "FROM complaints WHERE UPPER(complaint_number) = UPPER(%s)",
                    (cand,),
                ).fetchone()
                if row:
                    break
            if not row:
                return {"ok": False, "error": f"Complaint '{cnum}' not found"}, None
            can_private = has_permission(user, "complaints.view_private")
            docs = conn.execute(
                "SELECT filename, doc_category, title, content_type, size_bytes, is_confidential "
                "FROM complaint_documents WHERE complaint_id = %s ORDER BY id ASC",
                (row[0],),
            ).fetchall()
            return (
                {
                    "ok": True,
                    "complaint": {
                        "complaint_number": row[1],
                        "intake_channel": row[2],
                        "is_anonymous": row[3],
                        "complainant_name": (row[4] if can_private and not row[3] else "[Redacted]"),
                        "subject_property_address": row[5],
                        "subject_person_name": row[6],
                        "ordinance_section": row[7],
                        "conduct_description": row[8],
                        "date_observed": row[9],
                        "status": row[10],
                        "assigned_to": row[11],
                        "investigation_report": row[12],
                        "enforcement_stage": row[13],
                        "nov_required_action": row[14],
                        "nov_compliance_deadline": row[15],
                        "final_resolution": row[16],
                        "documents": [
                            {"filename": d[0], "category": d[1], "title": d[2], "content_type": d[3], "size_bytes": d[4]}
                            for d in docs
                            if can_private or not d[5]
                        ],
                    },
                },
                None,
            )

        if name == "create_complaint":
            addr = str(args.get("property_address") or "").strip()
            desc = str(args.get("description") or "").strip()
            ord_sec = str(args.get("ordinance_section") or "").strip()
            cname = str(args.get("complainant_name") or "").strip()
            anon = bool(args.get("is_anonymous", not bool(cname)))
            year = datetime.now(timezone.utc).year
            row = conn.execute(
                "INSERT INTO complaints (complaint_number, intake_channel, is_anonymous, complainant_name, subject_property_address, ordinance_section, conduct_description) "
                "VALUES ('TEMP', 'staff_oral', %s, %s, %s, %s, %s) RETURNING id",
                (anon, cname, addr, ord_sec, desc),
            ).fetchone()
            cid = row[0]
            cnum = f"CMP-{year}-{cid:04d}"
            conn.execute("UPDATE complaints SET complaint_number = %s WHERE id = %s", (cnum, cid))
            return (
                {"ok": True, "complaint_id": cid, "complaint_number": cnum, "property_address": addr},
                {"tool": name, "summary": f"Logged complaint {cnum}" + (f" ({addr})" if addr else ""), "route": "/app/complaints-manage"},
            )

        if name == "create_work_order":
            cat = str(args.get("category") or "Pothole / Street").strip()
            loc = str(args.get("location") or "").strip()
            desc = str(args.get("description") or "").strip()
            prio = str(args.get("priority") or "normal").strip().lower()
            if prio not in ("low", "normal", "high", "urgent"):
                prio = "normal"
            year = datetime.now(timezone.utc).year
            row = conn.execute(
                "INSERT INTO public_works_orders (work_order_number, category, location, description, priority) "
                "VALUES ('TEMP', %s, %s, %s, %s) RETURNING id",
                (cat, loc, desc, prio),
            ).fetchone()
            wid = row[0]
            wnum = f"WO-{year}-{wid:04d}"
            conn.execute("UPDATE public_works_orders SET work_order_number = %s WHERE id = %s", (wnum, wid))
            return (
                {"ok": True, "work_order_id": wid, "work_order_number": wnum, "location": loc},
                {"tool": name, "summary": f"Created work order {wnum} ({loc})", "route": "/app/complaints-manage"},
            )

        if name == "create_public_record":
            title = str(args.get("title") or "").strip()
            cat = str(args.get("category") or "Policy").strip()
            cp = str(args.get("counterparty") or "").strip()
            notes = str(args.get("notes") or "").strip()
            is_pub = bool(args.get("is_public", True))
            year = datetime.now(timezone.utc).year
            row = conn.execute(
                "INSERT INTO repository_documents (doc_number, category, title, counterparty, notes, is_public, created_by) "
                "VALUES ('TEMP', %s, %s, %s, %s, %s, %s) RETURNING id",
                (cat, title, cp, notes, is_pub, username),
            ).fetchone()
            did = row[0]
            dnum = f"REC-{year}-{did:04d}"
            conn.execute("UPDATE repository_documents SET doc_number = %s WHERE id = %s", (dnum, did))
            return (
                {"ok": True, "record_id": did, "doc_number": dnum, "title": title, "category": cat},
                {"tool": name, "summary": f"Created {cat} {dnum}: {title}", "route": "/app/records-repo"},
            )

        if name == "search_records":
            q = str(args.get("query") or "").strip()
            terms = _extract_search_terms(q)
            if not terms:
                rows = conn.execute(
                    "SELECT id, doc_number, category, title, notes, tags, is_public FROM repository_documents "
                    "ORDER BY id DESC LIMIT 10"
                ).fetchall()
            else:
                conds = " OR ".join(
                    "(d.title ILIKE %s OR d.notes ILIKE %s OR d.tags ILIKE %s OR d.doc_number ILIKE %s OR f.filename ILIKE %s)"
                    for _ in terms
                )
                params: list = []
                for t in terms:
                    like = f"%{t}%"
                    params.extend([like, like, like, like, like])
                rows = conn.execute(
                    f"SELECT DISTINCT d.id, d.doc_number, d.category, d.title, d.notes, d.tags, d.is_public "
                    f"FROM repository_documents d LEFT JOIN repository_files f ON f.document_id = d.id "
                    f"WHERE {conds} ORDER BY d.id DESC LIMIT 10",
                    tuple(params),
                ).fetchall()
            records = []
            for r in rows:
                files = conn.execute(
                    "SELECT id, filename, content_type, size_bytes FROM repository_files WHERE document_id = %s ORDER BY id ASC",
                    (r[0],),
                ).fetchall()
                records.append({
                    "id": r[0],
                    "doc_number": r[1],
                    "category": r[2],
                    "title": r[3],
                    "notes": (r[4] or "")[:500],
                    "tags": r[5] or "",
                    "is_public": r[6],
                    "files": [
                        {"file_id": f[0], "filename": f[1], "content_type": f[2], "size_bytes": f[3]}
                        for f in files
                    ],
                })
            return ({"ok": True, "records": records}, None)

        if name == "read_record_file":
            fid = int(args.get("file_id"))
            frow = conn.execute(
                "SELECT filename, content_type, object_key FROM repository_files WHERE id = %s",
                (fid,),
            ).fetchone()
            if not frow:
                return ({"ok": False, "error": f"File id {fid} not found"}, None)
            fname_doc, ctype, obj_key = frow[0], frow[1] or "", frow[2]
            from .storage import get_storage_client
            bucket = (os.environ.get("S3_BUCKET") or "civicdesk-records").strip()
            obj = get_storage_client().get_object(bucket, obj_key)
            try:
                data = obj.read()
            finally:
                obj.close()
                obj.release_conn()
            text, truncated = _extract_document_text(fname_doc, ctype, data)
            return (
                {"ok": True, "file_id": fid, "filename": fname_doc, "text": text, "truncated": truncated},
                None,
            )

        if name == "search_city_code":
            q = str(args.get("query") or "").strip()
            terms = _extract_search_terms(q)
            if not terms:
                rows = conn.execute(
                    "SELECT section_number, title, body FROM code_sections ORDER BY sort_order ASC, id ASC LIMIT 10"
                ).fetchall()
                index_rows = [(r[0], r[1]) for r in rows]
            else:
                # Score title/section matches higher than body-only matches
                score_parts = []
                score_params: list = []
                where_parts = []
                where_params: list = []
                for t in terms:
                    like = f"%{t}%"
                    where_parts.append("(section_number ILIKE %s OR title ILIKE %s OR body ILIKE %s)")
                    where_params.extend([like, like, like])
                    score_parts.append("(CASE WHEN section_number ILIKE %s THEN 5 WHEN title ILIKE %s THEN 3 WHEN body ILIKE %s THEN 1 ELSE 0 END)")
                    score_params.extend([like, like, like])
                score_expr = " + ".join(score_parts)
                where_expr = " OR ".join(where_parts)
                rows = conn.execute(
                    f"SELECT section_number, title, body, ({score_expr}) AS score "
                    f"FROM code_sections WHERE {where_expr} "
                    f"ORDER BY score DESC, sort_order ASC, id ASC LIMIT 12",
                    tuple(score_params + where_params),
                ).fetchall()
                index_rows = conn.execute(
                    f"SELECT section_number, title FROM code_sections WHERE {where_expr} "
                    f"ORDER BY sort_order ASC, id ASC LIMIT 30",
                    tuple(where_params),
                ).fetchall()
            sections = []
            for r in rows:
                body_txt = (r[2] or "").strip()
                sections.append({
                    "section_number": r[0],
                    "title": r[1],
                    "body": body_txt[:4500],
                    "truncated": len(body_txt) > 4500,
                })
            return (
                {
                    "ok": True,
                    "sections": sections,
                    "matching_index": [{"section_number": ir[0], "title": ir[1]} for ir in index_rows],
                },
                None,
            )

        if name == "get_city_code_section":
            sec = str(args.get("section_number") or "").strip()
            row = conn.execute(
                "SELECT section_number, title, body FROM code_sections WHERE section_number = %s",
                (sec,),
            ).fetchone()
            if not row:
                row = conn.execute(
                    "SELECT section_number, title, body FROM code_sections WHERE section_number ILIKE %s ORDER BY id ASC LIMIT 1",
                    (f"%{sec}%",),
                ).fetchone()
            if not row:
                return ({"ok": False, "error": f"Code section '{sec}' not found"}, None)
            body_txt = (row[2] or "").strip()
            return (
                {
                    "ok": True,
                    "section_number": row[0],
                    "title": row[1],
                    "body": body_txt[:16000],
                    "truncated": len(body_txt) > 16000,
                },
                None,
            )

        if name == "search_portal_info":
            q = str(args.get("query") or "").strip()
            terms = _extract_search_terms(q) or [q]
            like_clauses_pages = " OR ".join("(title ILIKE %s OR summary ILIKE %s OR body ILIKE %s)" for _ in terms)
            p_params = [f"%{t}%" for t in terms for _ in range(3)]
            pages = conn.execute(
                f"SELECT title, summary, body FROM city_pages WHERE {like_clauses_pages} ORDER BY sort_order ASC LIMIT 5",
                tuple(p_params),
            ).fetchall()
            like_clauses_faqs = " OR ".join("(question ILIKE %s OR answer ILIKE %s)" for _ in terms)
            f_params = [f"%{t}%" for t in terms for _ in range(2)]
            faqs = conn.execute(
                f"SELECT question, answer FROM city_faqs WHERE {like_clauses_faqs} ORDER BY sort_order ASC LIMIT 5",
                tuple(f_params),
            ).fetchall()
            like_clauses_notices = " OR ".join("(title ILIKE %s OR summary ILIKE %s OR body ILIKE %s)" for _ in terms)
            notices = conn.execute(
                f"SELECT title, summary, body FROM city_notices WHERE {like_clauses_notices} ORDER BY id DESC LIMIT 5",
                tuple(p_params),
            ).fetchall()
            like_clauses_blog = " OR ".join("(title ILIKE %s OR lead_in ILIKE %s OR body ILIKE %s)" for _ in terms)
            posts = conn.execute(
                f"SELECT title, lead_in, body FROM blog_posts WHERE {like_clauses_blog} ORDER BY id DESC LIMIT 5",
                tuple(p_params),
            ).fetchall()
            return (
                {
                    "ok": True,
                    "pages": [{"title": r[0], "summary": r[1], "body": (r[2] or "")[:1500]} for r in pages],
                    "faqs": [{"question": r[0], "answer": (r[1] or "")[:1000]} for r in faqs],
                    "notices": [{"title": r[0], "summary": r[1], "body": (r[2] or "")[:1000]} for r in notices],
                    "blog_posts": [{"title": r[0], "lead_in": r[1], "body": (r[2] or "")[:1000]} for r in posts],
                },
                None,
            )

        if name == "create_directory_entry":
            entry_name = str(args.get("name") or "").strip()
            role = str(args.get("title_role") or "").strip()
            dept = str(args.get("department") or "").strip()
            email = str(args.get("email") or "").strip()
            phone = str(args.get("phone") or "").strip()
            elected = bool(args.get("is_elected", False))
            row = conn.execute(
                "INSERT INTO city_directory_entries (name, title_role, department, email, phone, is_elected) "
                "VALUES (%s, %s, %s, %s, %s, %s) RETURNING id",
                (entry_name, role, dept, email, phone, elected),
            ).fetchone()
            return (
                {"ok": True, "entry_id": row[0], "name": entry_name},
                {"tool": name, "summary": f"Added directory contact: {entry_name}", "route": "/app/directory-manage"},
            )

        if name == "create_faq":
            q = str(args.get("question") or "").strip()
            a = str(args.get("answer") or "").strip()
            cat = str(args.get("category") or "General").strip()
            row = conn.execute(
                "INSERT INTO city_faqs (question, answer, category) VALUES (%s, %s, %s) RETURNING id",
                (q, a, cat),
            ).fetchone()
            return (
                {"ok": True, "faq_id": row[0], "question": q},
                {"tool": name, "summary": f"Added FAQ: {q[:60]}", "route": "/app/directory-manage"},
            )

        if name == "create_page":
            title = str(args.get("title") or "").strip()
            summary = str(args.get("summary") or "").strip()
            body_txt = str(args.get("body") or "").strip()
            is_pub = bool(args.get("is_public", True))
            slug = _slugify(title, "page")
            existing = conn.execute(
                "SELECT id, is_public, slug FROM city_pages WHERE slug = %s OR LOWER(trim(title)) = LOWER(%s) ORDER BY id DESC LIMIT 1",
                (slug, title),
            ).fetchone()
            if existing:
                if not existing[1] and is_pub:
                    conn.execute(
                        "UPDATE city_pages SET "
                        "summary = COALESCE(NULLIF(%s, ''), summary), "
                        "body = COALESCE(NULLIF(%s, ''), body), "
                        "is_public = TRUE, updated_by = %s, updated_at = now() WHERE id = %s",
                        (summary, body_txt, username, existing[0]),
                    )
                    return (
                        {"ok": True, "page_id": existing[0], "slug": existing[2], "title": title, "is_public": True, "updated_existing": True},
                        {"tool": name, "summary": f"Published existing page: {title}", "route": "/app/pages-manage"},
                    )
                return (
                    {"ok": False, "error": f"A page titled '{title}' already exists (page_id={existing[0]}, slug={existing[2]}). Use update_page to modify or publish/unpublish it."},
                    None,
                )
            row = conn.execute(
                "INSERT INTO city_pages (slug, title, summary, body, is_public, updated_by) "
                "VALUES (%s, %s, %s, %s, %s, %s) RETURNING id, slug",
                (slug, title, summary, body_txt, is_pub, username),
            ).fetchone()
            return (
                {"ok": True, "page_id": row[0], "slug": row[1], "title": title, "is_public": is_pub},
                {"tool": name, "summary": f"Created page: {title}", "route": "/app/pages-manage"},
            )

        if name == "list_pages":
            lim = max(1, min(int(args.get("limit") or 10), 25))
            q = str(args.get("search") or "").strip()
            if q:
                rows = conn.execute(
                    "SELECT id, slug, title, summary, is_public, updated_at FROM city_pages WHERE title ILIKE %s OR summary ILIKE %s OR slug ILIKE %s ORDER BY id DESC LIMIT %s",
                    (f"%{q}%", f"%{q}%", f"%{q}%", lim),
                ).fetchall()
            else:
                rows = conn.execute(
                    "SELECT id, slug, title, summary, is_public, updated_at FROM city_pages ORDER BY id DESC LIMIT %s",
                    (lim,),
                ).fetchall()
            return (
                {
                    "ok": True,
                    "pages": [
                        {
                            "id": r[0],
                            "slug": r[1],
                            "title": r[2],
                            "summary": r[3],
                            "is_public": r[4],
                            "updated_at": r[5].isoformat() if r[5] else None,
                        }
                        for r in rows
                    ],
                },
                None,
            )

        if name == "update_page":
            target = _find_cms_record(conn, "city_pages", args.get("page_id"), str(args.get("title_match") or args.get("title") or ""), has_slug=True)
            if not target:
                return ({"ok": False, "error": "Page not found. Use list_pages to find the page ID or exact title."}, None)
            pg_id, _ = target
            sets = ["updated_by = %s", "updated_at = now()"]
            params_p: list = [username]
            if args.get("title"):
                sets.append("title = %s")
                params_p.append(str(args["title"]).strip())
            if "summary" in args and args["summary"] is not None:
                sets.append("summary = %s")
                params_p.append(str(args["summary"]).strip())
            if args.get("body"):
                sets.append("body = %s")
                params_p.append(str(args["body"]).strip())
            if "is_public" in args and args["is_public"] is not None:
                sets.append("is_public = %s")
                params_p.append(bool(args["is_public"]))
            params_p.append(pg_id)
            row = conn.execute(
                f"UPDATE city_pages SET {', '.join(sets)} WHERE id = %s RETURNING id, slug, title, is_public",
                tuple(params_p),
            ).fetchone()
            return (
                {"ok": True, "page_id": row[0], "slug": row[1], "title": row[2], "is_public": row[3]},
                {"tool": name, "summary": f"Updated page '{row[2]}' ({'published' if row[3] else 'draft'})", "route": "/app/pages-manage"},
            )

        if name == "add_contractor_license":
            bname = str(args.get("business_name") or "").strip()
            lnum = str(args.get("license_number") or "").strip()
            ltype = str(args.get("license_type") or "General Contractor").strip()
            email = str(args.get("email") or "").strip()
            phone = str(args.get("phone") or "").strip()
            row = conn.execute(
                "INSERT INTO contractor_licenses (business_name, license_number, license_type, email, phone) "
                "VALUES (%s, %s, %s, %s, %s) RETURNING id",
                (bname, lnum, ltype, email, phone),
            ).fetchone()
            return (
                {"ok": True, "contractor_id": row[0], "business_name": bname, "license_number": lnum},
                {"tool": name, "summary": f"Added contractor: {bname} ({lnum})", "route": "/app/contractors"},
            )

        if name == "create_utility_bill":
            acct = str(args.get("account_number") or "").strip()
            pname = str(args.get("payer_name") or "").strip()
            addr = str(args.get("service_address") or "").strip()
            amt = str(args.get("amount_due") or "0.00").strip().lstrip("$")
            due = str(args.get("due_date") or "").strip()
            desc = str(args.get("description") or "Quarterly Utility Bill").strip()
            year = datetime.now(timezone.utc).year
            row = conn.execute(
                "INSERT INTO municipal_bills (reference_number, bill_type, account_number, payer_name, service_address, description, amount_due, due_date, created_by) "
                "VALUES ('TEMP', 'utility', %s, %s, %s, %s, %s, %s, %s) RETURNING id",
                (acct, pname, addr, desc, amt, due, username),
            ).fetchone()
            bid = row[0]
            ref = f"UTL-{year}-{bid:04d}"
            conn.execute("UPDATE municipal_bills SET reference_number = %s WHERE id = %s", (ref, bid))
            return (
                {"ok": True, "bill_id": bid, "reference_number": ref, "payer_name": pname, "amount_due": amt},
                {"tool": name, "summary": f"Created utility bill {ref} (${amt}) for {pname}", "route": "/app/utilities-manage"},
            )

        if name == "create_citation":
            pname = str(args.get("payer_name") or "").strip()
            addr = str(args.get("service_address") or "").strip()
            desc = str(args.get("description") or "").strip()
            amt = str(args.get("amount_due") or "0.00").strip().lstrip("$")
            due = str(args.get("due_date") or "").strip()
            year = datetime.now(timezone.utc).year
            row = conn.execute(
                "INSERT INTO municipal_bills (reference_number, bill_type, payer_name, service_address, description, amount_due, due_date, created_by) "
                "VALUES ('TEMP', 'citation', %s, %s, %s, %s, %s, %s) RETURNING id",
                (pname, addr, desc, amt, due, username),
            ).fetchone()
            cid = row[0]
            ref = f"CIT-{year}-{cid:04d}"
            conn.execute("UPDATE municipal_bills SET reference_number = %s WHERE id = %s", (ref, cid))
            return (
                {"ok": True, "citation_id": cid, "reference_number": ref, "payer_name": pname, "amount_due": amt},
                {"tool": name, "summary": f"Issued citation {ref} (${amt}) to {pname}", "route": "/app/citations-manage"},
            )

        if name == "toggle_module":
            mid = str(args.get("module_id") or "").strip().lower()
            en = bool(args.get("enabled", True))
            conn.execute(
                "INSERT INTO core_modules (module_id, enabled, updated_at) VALUES (%s, %s, now()) "
                "ON CONFLICT (module_id) DO UPDATE SET enabled = EXCLUDED.enabled, updated_at = now()",
                (mid, en),
            )
            return (
                {"ok": True, "module_id": mid, "enabled": en},
                {"tool": name, "summary": f"{'Enabled' if en else 'Disabled'} module '{mid}'", "route": "/app/modules"},
            )

        if name == "update_branding":
            updates = []
            params = []
            for col in ("city_title", "meeting_time", "meeting_location", "footer_text"):
                if args.get(col) is not None and str(args[col]).strip():
                    updates.append(f"{col} = %s")
                    params.append(str(args[col]).strip())
            if updates:
                conn.execute(f"UPDATE agenda_preferences SET {', '.join(updates)}, updated_at = now() WHERE id = 1", tuple(params))
            return (
                {"ok": True, "updated": list(args.keys())},
                {"tool": name, "summary": "Updated city branding/preferences", "route": "/app/preferences-general"},
            )

        if name == "get_agenda_details":
            ag_id = int(args["agenda_id"])
            ag = conn.execute(
                "SELECT id, title, body, meeting_date, meeting_time, status, finalized_at, minutes_status "
                "FROM agendas WHERE id = %s",
                (ag_id,),
            ).fetchone()
            if not ag:
                return {"ok": False, "error": f"Agenda #{ag_id} not found"}, None
            items = conn.execute(
                "SELECT id, position, section, title, description, presenter, recommended_motion "
                "FROM agenda_items WHERE agenda_id = %s ORDER BY position, id",
                (ag_id,),
            ).fetchall()
            return (
                {
                    "ok": True,
                    "agenda": {
                        "id": ag[0],
                        "title": ag[1],
                        "body": ag[2],
                        "meeting_date": ag[3].isoformat() if ag[3] else None,
                        "meeting_time": ag[4],
                        "status": ag[5],
                        "finalized_at": ag[6].isoformat() if ag[6] else None,
                        "minutes_status": ag[7],
                        "items": [
                            {"id": it[0], "position": it[1], "section": it[2], "title": it[3], "description": (it[4] or "")[:300], "presenter": it[5], "recommended_motion": it[6]}
                            for it in items
                        ],
                    },
                },
                None,
            )

        if name == "list_backlog_todos":
            q = str(args.get("query") or "").strip()
            st_f = str(args.get("status") or "").strip().lower()
            like = f"%{q}%"
            rows = conn.execute(
                "SELECT id, title, description, target_body, target_date, todo_status, assigned_to "
                "FROM agenda_items WHERE agenda_id IS NULL "
                "AND (%s = '' OR title ILIKE %s OR description ILIKE %s) "
                "AND (%s = '' OR LOWER(todo_status) = %s) ORDER BY id DESC LIMIT 20",
                (q, like, like, st_f, st_f),
            ).fetchall()
            return (
                {
                    "ok": True,
                    "todos": [
                        {
                            "id": r[0],
                            "title": r[1],
                            "description": (r[2] or "")[:250],
                            "target_body": r[3],
                            "target_date": r[4].isoformat() if r[4] else None,
                            "status": r[5],
                            "assigned_to": r[6],
                        }
                        for r in rows
                    ],
                },
                None,
            )

        if name == "list_inspections":
            pnum = str(args.get("permit_number") or "").strip()
            res_f = str(args.get("result") or "").strip().lower()
            rows = conn.execute(
                "SELECT p.permit_number, p.property_address, i.inspection_type, i.scheduled_date, i.inspector, i.result, i.notes "
                "FROM permit_inspections i JOIN permits p ON p.id = i.permit_id "
                "WHERE (%s = '' OR UPPER(p.permit_number) = UPPER(%s)) "
                "AND (%s = '' OR LOWER(i.result) = %s) ORDER BY i.id DESC LIMIT 20",
                (pnum, pnum, res_f, res_f),
            ).fetchall()
            return (
                {
                    "ok": True,
                    "inspections": [
                        {"permit_number": r[0], "property_address": r[1], "inspection_type": r[2], "scheduled_date": r[3], "inspector": r[4], "result": r[5], "notes": (r[6] or "")[:200]}
                        for r in rows
                    ],
                },
                None,
            )

        if name == "list_work_orders":
            q = str(args.get("query") or "").strip()
            st_f = str(args.get("status") or "").strip().lower()
            like = f"%{q}%"
            rows = conn.execute(
                "SELECT work_order_number, category, location, description, priority, status, assigned_crew "
                "FROM public_works_orders "
                "WHERE (%s = '' OR work_order_number ILIKE %s OR location ILIKE %s OR description ILIKE %s OR category ILIKE %s) "
                "AND (%s = '' OR LOWER(status) = %s) ORDER BY id DESC LIMIT 15",
                (q, like, like, like, like, st_f, st_f),
            ).fetchall()
            return (
                {
                    "ok": True,
                    "work_orders": [
                        {"work_order_number": r[0], "category": r[1], "location": r[2], "description": (r[3] or "")[:250], "priority": r[4], "status": r[5], "assigned_crew": r[6]}
                        for r in rows
                    ],
                },
                None,
            )

        if name == "list_foia_requests":
            q = str(args.get("query") or "").strip()
            st_f = str(args.get("status") or "").strip().lower()
            like = f"%{q}%"
            rows = conn.execute(
                "SELECT request_number, requester_name, subject, department, status, due_date, assigned_to "
                "FROM public_records_requests "
                "WHERE (%s = '' OR request_number ILIKE %s OR subject ILIKE %s OR requester_name ILIKE %s) "
                "AND (%s = '' OR LOWER(status) = %s) ORDER BY id DESC LIMIT 15",
                (q, like, like, like, st_f, st_f),
            ).fetchall()
            return (
                {
                    "ok": True,
                    "foia_requests": [
                        {"request_number": r[0], "requester_name": r[1], "subject": r[2], "department": r[3], "status": r[4], "due_date": r[5], "assigned_to": r[6]}
                        for r in rows
                    ],
                },
                None,
            )

        if name == "list_calendar_events":
            q = str(args.get("query") or "").strip()
            from_raw = str(args.get("from_date") or "").strip()
            from_d = date.fromisoformat(from_raw) if from_raw else None
            like = f"%{q}%"
            if from_d is not None:
                rows = conn.execute(
                    "SELECT id, title, event_date, start_time, location, category, description "
                    "FROM calendar_events "
                    "WHERE (%s = '' OR title ILIKE %s OR location ILIKE %s OR description ILIKE %s) "
                    "AND event_date >= %s ORDER BY event_date ASC, id ASC LIMIT 20",
                    (q, like, like, like, from_d),
                ).fetchall()
            else:
                rows = conn.execute(
                    "SELECT id, title, event_date, start_time, location, category, description "
                    "FROM calendar_events "
                    "WHERE (%s = '' OR title ILIKE %s OR location ILIKE %s OR description ILIKE %s) "
                    "ORDER BY event_date ASC, id ASC LIMIT 20",
                    (q, like, like, like),
                ).fetchall()
            return (
                {
                    "ok": True,
                    "events": [
                        {"id": r[0], "title": r[1], "event_date": r[2].isoformat() if r[2] else None, "start_time": r[3], "location": r[4], "category": r[5], "description": (r[6] or "")[:200]}
                        for r in rows
                    ],
                },
                None,
            )

        if name == "search_directory":
            q = str(args.get("query") or "").strip()
            like = f"%{q}%"
            rows = conn.execute(
                "SELECT name, title_role, department, email, phone, office_hours, is_elected "
                "FROM city_directory_entries "
                "WHERE (%s = '' OR name ILIKE %s OR title_role ILIKE %s OR department ILIKE %s) "
                "ORDER BY is_elected DESC, sort_order ASC, id ASC LIMIT 20",
                (q, like, like, like),
            ).fetchall()
            return (
                {
                    "ok": True,
                    "contacts": [
                        {"name": r[0], "title_role": r[1], "department": r[2], "email": r[3], "phone": r[4], "office_hours": r[5], "is_elected": r[6]}
                        for r in rows
                    ],
                },
                None,
            )

        if name == "list_forms":
            q = str(args.get("query") or "").strip()
            like = f"%{q}%"
            rows = conn.execute(
                "SELECT slug, title, form_kind, description, closes_at, is_public "
                "FROM city_forms "
                "WHERE (%s = '' OR title ILIKE %s OR description ILIKE %s) "
                "ORDER BY sort_order ASC, id ASC LIMIT 20",
                (q, like, like),
            ).fetchall()
            return (
                {
                    "ok": True,
                    "forms": [
                        {"slug": r[0], "title": r[1], "kind": r[2], "description": (r[3] or "")[:200], "closes_at": r[4].isoformat() if r[4] else None, "is_public": r[5]}
                        for r in rows
                    ],
                },
                None,
            )

        if name == "list_contractor_licenses":
            q = str(args.get("query") or "").strip()
            st_f = str(args.get("status") or "").strip().lower()
            like = f"%{q}%"
            rows = conn.execute(
                "SELECT license_number, business_name, license_type, contact_name, email, phone, license_expires_at, status "
                "FROM contractor_licenses "
                "WHERE (%s = '' OR business_name ILIKE %s OR license_number ILIKE %s OR license_type ILIKE %s) "
                "AND (%s = '' OR LOWER(status) = %s) ORDER BY id DESC LIMIT 20",
                (q, like, like, like, st_f, st_f),
            ).fetchall()
            return (
                {
                    "ok": True,
                    "contractors": [
                        {"license_number": r[0], "business_name": r[1], "license_type": r[2], "contact_name": r[3], "email": r[4], "phone": r[5], "expires_at": r[6].isoformat() if r[6] else None, "status": r[7]}
                        for r in rows
                    ],
                },
                None,
            )

        if name == "list_utility_bills":
            q = str(args.get("query") or "").strip()
            st_f = str(args.get("payment_status") or "").strip().lower()
            like = f"%{q}%"
            rows = conn.execute(
                "SELECT reference_number, account_number, payer_name, service_address, amount_due, due_date, payment_status "
                "FROM municipal_bills WHERE bill_type = 'utility' "
                "AND (%s = '' OR reference_number ILIKE %s OR account_number ILIKE %s OR payer_name ILIKE %s OR service_address ILIKE %s) "
                "AND (%s = '' OR LOWER(payment_status) = %s) ORDER BY id DESC LIMIT 20",
                (q, like, like, like, like, st_f, st_f),
            ).fetchall()
            return (
                {
                    "ok": True,
                    "utility_bills": [
                        {"reference_number": r[0], "account_number": r[1], "payer_name": r[2], "service_address": r[3], "amount_due": r[4], "due_date": r[5], "payment_status": r[6]}
                        for r in rows
                    ],
                },
                None,
            )

        if name == "list_citations":
            q = str(args.get("query") or "").strip()
            st_f = str(args.get("payment_status") or "").strip().lower()
            like = f"%{q}%"
            rows = conn.execute(
                "SELECT reference_number, payer_name, service_address, description, amount_due, due_date, payment_status "
                "FROM municipal_bills WHERE bill_type = 'citation' "
                "AND (%s = '' OR reference_number ILIKE %s OR payer_name ILIKE %s OR service_address ILIKE %s OR description ILIKE %s) "
                "AND (%s = '' OR LOWER(payment_status) = %s) ORDER BY id DESC LIMIT 20",
                (q, like, like, like, like, st_f, st_f),
            ).fetchall()
            return (
                {
                    "ok": True,
                    "citations": [
                        {"reference_number": r[0], "payer_name": r[1], "service_address": r[2], "description": (r[3] or "")[:200], "amount_due": r[4], "due_date": r[5], "payment_status": r[6]}
                        for r in rows
                    ],
                },
                None,
            )

        if name == "list_compliance_programs":
            q = str(args.get("query") or "").strip()
            ptype = str(args.get("program_type") or "").strip()
            st_f = str(args.get("status") or "").strip().lower()
            terms = _extract_search_terms(q)
            where_parts = []
            params: list = []
            if terms:
                term_clauses = " AND ".join(
                    "(property_address ILIKE %s OR parcel_id ILIKE %s OR owner_name ILIKE %s OR certificate_number ILIKE %s OR program_type ILIKE %s)"
                    for _ in terms
                )
                where_parts.append(f"({term_clauses})")
                for t in terms:
                    like = f"%{t}%"
                    params.extend([like, like, like, like, like])
            if ptype:
                where_parts.append("program_type ILIKE %s")
                params.append(f"%{ptype}%")
            if st_f:
                where_parts.append("LOWER(status) = %s")
                params.append(st_f)
            where_sql = ("WHERE " + " AND ".join(where_parts)) if where_parts else ""
            rows = conn.execute(
                f"SELECT id, program_type, property_address, parcel_id, unit_count, owner_name, local_agent_name, "
                f"cycle_months, last_inspected_date, next_inspection_date, last_result, inspector, certificate_number, status, notes "
                f"FROM recurring_compliance_programs {where_sql} ORDER BY next_inspection_date ASC NULLS LAST, id DESC LIMIT 20",
                tuple(params),
            ).fetchall()
            return (
                {
                    "ok": True,
                    "compliance_programs": [
                        {
                            "id": r[0],
                            "program_type": r[1],
                            "property_address": r[2],
                            "parcel_id": r[3],
                            "unit_count": r[4],
                            "owner_name": r[5],
                            "local_agent_name": r[6],
                            "cycle_months": r[7],
                            "last_inspected_date": r[8].isoformat() if r[8] else None,
                            "next_inspection_date": r[9].isoformat() if r[9] else None,
                            "last_result": r[10],
                            "inspector": r[11],
                            "certificate_number": r[12],
                            "status": r[13],
                            "notes": (r[14] or "")[:300],
                        }
                        for r in rows
                    ],
                },
                None,
            )

        if name == "list_facility_reservations":
            q = str(args.get("query") or "").strip()
            st_f = str(args.get("status") or "").strip().lower()
            like = f"%{q}%"
            rows = conn.execute(
                "SELECT reservation_number, facility_name, event_date, start_time, end_time, event_title, requester_name, status, payment_status, fee_amount "
                "FROM facility_reservations "
                "WHERE (%s = '' OR reservation_number ILIKE %s OR facility_name ILIKE %s OR event_title ILIKE %s OR requester_name ILIKE %s) "
                "AND (%s = '' OR LOWER(status) = %s) ORDER BY event_date DESC, id DESC LIMIT 20",
                (q, like, like, like, like, st_f, st_f),
            ).fetchall()
            return (
                {
                    "ok": True,
                    "reservations": [
                        {
                            "reservation_number": r[0],
                            "facility_name": r[1],
                            "event_date": r[2].isoformat() if r[2] else None,
                            "start_time": r[3],
                            "end_time": r[4],
                            "event_title": r[5],
                            "requester_name": r[6],
                            "status": r[7],
                            "payment_status": r[8],
                            "fee_amount": r[9],
                        }
                        for r in rows
                    ],
                },
                None,
            )

        if name == "list_facilities":
            rows = conn.execute(
                "SELECT id, name, description, daily_fee, hourly_fee, capacity, is_active "
                "FROM reservable_facilities WHERE is_active = TRUE ORDER BY sort_order ASC, id ASC"
            ).fetchall()
            return (
                {
                    "ok": True,
                    "facilities": [
                        {
                            "id": r[0],
                            "name": r[1],
                            "description": (r[2] or "")[:200],
                            "daily_fee": r[3],
                            "hourly_fee": r[4],
                            "capacity": r[5],
                        }
                        for r in rows
                    ],
                },
                None,
            )

        if name == "create_facility":
            fac_name = str(args.get("name") or "").strip()
            if not fac_name:
                return {"ok": False, "error": "Facility name is required"}, None
            desc = str(args.get("description") or "").strip()
            dfee = str(args.get("daily_fee") or "$0.00").strip() or "$0.00"
            hfee = str(args.get("hourly_fee") or "").strip()
            cap = str(args.get("capacity") or "").strip()
            existing = conn.execute("SELECT id, name FROM reservable_facilities WHERE LOWER(name) = LOWER(%s)", (fac_name,)).fetchone()
            if existing:
                conn.execute("UPDATE reservable_facilities SET is_active = TRUE WHERE id = %s", (existing[0],))
                return (
                    {"ok": True, "facility_id": existing[0], "name": existing[1]},
                    {"tool": name, "summary": f"Activated facility '{existing[1]}'", "route": "/app/preferences-calendar"},
                )
            row = conn.execute(
                "INSERT INTO reservable_facilities (name, description, daily_fee, hourly_fee, capacity, is_active) "
                "VALUES (%s, %s, %s, %s, %s, TRUE) RETURNING id",
                (fac_name, desc, dfee, hfee, cap),
            ).fetchone()
            return (
                {"ok": True, "facility_id": row[0], "name": fac_name},
                {"tool": name, "summary": f"Created reservable facility '{fac_name}'", "route": "/app/preferences-calendar"},
            )

        if name == "create_facility_reservation":
            fname_req = str(args.get("facility_name") or "").strip()
            ev_date = date.fromisoformat(str(args["event_date"]).strip())
            ev_title = str(args.get("event_title") or "Park / Facility Reservation").strip()
            req_name = str(args.get("requester_name") or username).strip() or username
            st_time = str(args.get("start_time") or "").strip()
            en_time = str(args.get("end_time") or "").strip()
            req_email = str(args.get("requester_email") or "").strip()
            req_phone = str(args.get("requester_phone") or "").strip()
            notes = str(args.get("notes") or "").strip()
            fac = _find_active_facility(conn, fname_req)
            if not fac:
                return {
                    "ok": False,
                    "error": f"Active facility matching '{fname_req}' not found. Ask the user if they would like to create it first.",
                }, None
            rental_mode = "hourly" if (st_time or en_time) else "full_day"
            fee_amt = fac[3] if (rental_mode == "hourly" and fac[3]) else fac[2]
            year = datetime.now(timezone.utc).year
            row = conn.execute(
                "INSERT INTO facility_reservations "
                "(reservation_number, facility_id, facility_name, event_date, event_title, requester_name, "
                "requester_email, requester_phone, notes, fee_amount, rental_mode, start_time, end_time, status) "
                "VALUES ('TEMP', %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, 'pending') RETURNING id",
                (fac[0], fac[1], ev_date, ev_title, req_name, req_email, req_phone, notes, fee_amt, rental_mode, st_time, en_time),
            ).fetchone()
            rid = row[0]
            rnum = f"RES-{year}-{rid:04d}"
            conn.execute("UPDATE facility_reservations SET reservation_number = %s WHERE id = %s", (rnum, rid))
            return (
                {"ok": True, "reservation_id": rid, "reservation_number": rnum, "facility_name": fac[1], "event_date": ev_date.isoformat(), "status": "pending"},
                {"tool": name, "summary": f"Created reservation request {rnum} for {fac[1]} on {ev_date.isoformat()}", "route": "/app/calendar-manage"},
            )

        ext_res = execute_ext_tool(conn, name, args, user)
        if ext_res is not None:
            return ext_res

    return {"ok": False, "error": f"Unknown tool: {name}"}, None


class AiConfigIn(BaseModel):
    api_key: str | None = Field(default=None, max_length=300)
    model: str = DEFAULT_GEMINI_MODEL
    daily_spend_limit_usd: float | None = Field(default=None, ge=0, le=10000)


class AiHistoryMsg(BaseModel):
    role: str
    text: str


class AiPageContextIn(BaseModel):
    route: str = Field(default="", max_length=300)
    title: str = Field(default="", max_length=300)


class AiCommandIn(BaseModel):
    prompt: str = Field(..., min_length=2, max_length=2000)
    history: list[AiHistoryMsg] = Field(default_factory=list, max_length=20)
    page_context: AiPageContextIn | None = None


def _require_ai_user(request: Request) -> dict:
    user = current_user(request)
    if not user:
        raise HTTPException(status_code=401, detail="Not authenticated")
    if user.get("role") == "read_only":
        raise HTTPException(status_code=403, detail="Staff or administrator access required")
    return user


def _require_ai_module_enabled() -> None:
    if not is_module_enabled("ai_assistant"):
        raise HTTPException(status_code=403, detail="AI Admin Assistant module is disabled. Enable it in Manage Modules.")


@router.get("/status")
def get_ai_status(user: dict = Depends(_require_ai_user)):
    key, model, source, limit = _load_gemini_settings()
    today_spend, today_requests = _get_today_usage()
    remaining = round(max(0.0, limit - today_spend), 6) if limit > 0 else None
    demo = is_demo_mode()
    return {
        "enabled": is_module_enabled("ai_assistant"),
        "configured": bool(key),
        "can_configure": (False if demo else user.get("role") == "admin"),
        "allowed_tools_count": len(_allowed_tools_for_user(user)),
        "model": model,
        "source": source,
        "available_models": ([DEMO_GEMINI_MODEL] if demo else list(_ALLOWED_MODELS)),
        "daily_spend_limit_usd": limit,
        "today_spend_usd": round(today_spend, 6),
        "today_requests": today_requests,
        "budget_remaining_usd": remaining,
    }


@router.put("/config")
def save_ai_config(body: AiConfigIn, user: dict = Depends(require_admin)):
    _require_ai_module_enabled()
    require_not_demo_mode("Configuring Gemini AI key")
    existing_key, _, existing_source, existing_limit = _load_gemini_settings()
    key = (body.api_key or "").strip() or existing_key
    if len(key) < 10:
        raise HTTPException(status_code=400, detail="Gemini API key is required")
    model = body.model.strip() if body.model.strip() in _ALLOWED_MODELS else DEFAULT_GEMINI_MODEL
    limit = round(float(body.daily_spend_limit_usd), 2) if body.daily_spend_limit_usd is not None else existing_limit
    # Quick verification call to Gemini (bypass budget so admins can adjust limits)
    _call_gemini(
        key,
        model,
        {"contents": [{"role": "user", "parts": [{"text": "Reply with OK"}]}]},
        enforce_budget=False,
    )
    with pool.connection() as conn:
        conn.execute(
            "INSERT INTO core_integrations (provider, enabled, api_key, config, validated_at, last_status, updated_by, updated_at) "
            "VALUES ('gemini_ai', TRUE, %s, %s, now(), 'ok', %s, now()) "
            "ON CONFLICT (provider) DO UPDATE SET "
            "enabled = TRUE, api_key = EXCLUDED.api_key, config = EXCLUDED.config, "
            "validated_at = now(), last_status = 'ok', updated_by = EXCLUDED.updated_by, updated_at = now()",
            (key, Jsonb({"model": model, "daily_spend_limit_usd": limit}), user["username"]),
        )
    record_audit(user["username"], "ai.configure", f"Configured Gemini AI ({model}, cap=${limit:.2f}/day)")
    return {
        "configured": True,
        "model": model,
        "source": existing_source if not (body.api_key or "").strip() else "integrations",
        "daily_spend_limit_usd": limit,
    }


@router.delete("/config")
def delete_ai_config(user: dict = Depends(require_admin)):
    _require_ai_module_enabled()
    require_not_demo_mode("Removing Gemini AI key")
    with pool.connection() as conn:
        conn.execute("DELETE FROM core_integrations WHERE provider = 'gemini_ai'")
    record_audit(user["username"], "ai.clear_config", "Removed Gemini AI key")
    return {"configured": False, "model": DEFAULT_GEMINI_MODEL, "source": "none"}


_SEARCH_STOPWORDS = {
    "a", "an", "and", "are", "as", "at", "be", "by", "can", "city", "do", "does",
    "for", "from", "have", "how", "i", "in", "is", "it", "many", "much", "my",
    "of", "on", "or", "the", "this", "to", "what", "when", "where", "which",
    "who", "with", "you", "your",
}


def _extract_search_terms(query: str) -> list[str]:
    words = [w.strip(".,?!;:\"'()[]{}") for w in (query or "").lower().split()]
    terms = [w for w in words if len(w) >= 2 and w not in _SEARCH_STOPWORDS]
    if not terms and (query or "").strip():
        terms = [(query or "").strip()]
    return terms[:6]


def _extract_document_text(filename: str, content_type: str, data: bytes, max_chars: int = 12000) -> tuple[str, bool]:
    lower = (filename or "").lower()
    ctype = (content_type or "").lower()
    text = ""
    if lower.endswith(".pdf") or "pdf" in ctype:
        import fitz
        doc = fitz.open(stream=data, filetype="pdf")
        try:
            chunks = []
            total = 0
            for page in doc:
                t = page.get_text("text") or ""
                chunks.append(t)
                total += len(t)
                if total >= max_chars:
                    break
            text = "\n".join(chunks)
        finally:
            doc.close()
    elif lower.endswith(".docx") or "wordprocessingml" in ctype:
        import io
        import xml.etree.ElementTree as ET
        import zipfile
        with zipfile.ZipFile(io.BytesIO(data)) as zf:
            xml_bytes = zf.read("word/document.xml")
        root = ET.fromstring(xml_bytes)
        text = " ".join(t.strip() for t in root.itertext() if t and t.strip())
    elif lower.endswith((".txt", ".md", ".csv", ".json", ".html", ".xml")) or ctype.startswith("text/"):
        text = data.decode("utf-8", errors="replace")
    else:
        return (f"[Binary file {filename} ({ctype or 'unknown'}, {len(data)} bytes) cannot be extracted as plain text.]", False)
    text = text.strip()
    return (text[:max_chars], len(text) > max_chars)


_READ_ONLY_TOOLS = {
    "list_agendas",
    "get_agenda_details",
    "list_backlog_todos",
    "list_permits",
    "get_permit_details",
    "list_inspections",
    "list_complaints",
    "get_complaint_details",
    "list_work_orders",
    "search_records",
    "read_record_file",
    "list_foia_requests",
    "search_city_code",
    "get_city_code_section",
    "search_portal_info",
    "list_calendar_events",
    "search_directory",
    "list_forms",
    "list_contractor_licenses",
    "list_compliance_programs",
    "list_facility_reservations",
    "list_facilities",
    "list_utility_bills",
    "list_citations",
    "list_notices",
    "list_blog_posts",
    "list_pages",
} | EXT_READ_ONLY_TOOLS


def _describe_proposed_action(name: str, args: dict) -> str:
    """Return a concise human-readable summary of a proposed write action."""
    a = args or {}
    if name == "create_agenda":
        return f"Create agenda '{a.get('title') or 'Meeting Agenda'}' on {a.get('meeting_date', '')} at {a.get('meeting_time') or '6:30 PM'}"
    if name == "add_agenda_item":
        return f"Add agenda item '{a.get('title', '')}' to agenda #{a.get('agenda_id', '')} ({a.get('section_name') or 'New Business'})"
    if name == "update_agenda_item":
        return f"Update agenda item #{a.get('item_id', '')} on agenda #{a.get('agenda_id', '')}" + (f" ('{a['title']}')" if a.get("title") else "")
    if name == "add_agenda_item_attachment":
        return f"Attach '{a.get('title', '')}' to agenda #{a.get('agenda_id', '')}"
    if name == "finalize_agenda":
        return f"Finalize agenda #{a.get('agenda_id', '')}"
    if name == "create_todo":
        due = f" (due {a['due_date']})" if a.get("due_date") else ""
        return f"Add backlog todo '{a.get('title', '')}'{due}"
    if name == "create_notice":
        return f"Post notice '{a.get('title', '')}' ({a.get('category') or 'general'})"
    if name == "update_notice":
        verb = "Publish" if a.get("is_public") is True else ("Unpublish" if a.get("is_public") is False else "Update")
        return f"{verb} notice {a.get('title') or a.get('title_match') or '#' + str(a.get('notice_id', ''))}"
    if name == "create_blog_post":
        verb = "Publish" if a.get("is_published") else "Create draft"
        return f"{verb} blog post '{a.get('title', '')}'"
    if name == "update_blog_post":
        verb = "Publish" if a.get("is_published") is True else ("Unpublish" if a.get("is_published") is False else "Update")
        return f"{verb} blog post {a.get('title') or a.get('title_match') or '#' + str(a.get('post_id', ''))}"
    if name == "create_calendar_event":
        return f"Create calendar event '{a.get('title', '')}' on {a.get('event_date', '')}"
    if name == "create_facility":
        return f"Add reservable facility '{a.get('name', '')}'"
    if name == "create_facility_reservation":
        t_range = f" ({a['start_time']} - {a['end_time']})" if a.get("start_time") or a.get("end_time") else ""
        return f"Create reservation request for '{a.get('facility_name', '')}' on {a.get('event_date', '')}{t_range}"
    if name == "update_urgent_alert":
        return f"{'Enable' if a.get('enabled') else 'Clear'} urgent alert banner" + (f": {a.get('message')}" if a.get("enabled") and a.get("message") else "")
    if name == "create_permit":
        return f"Create {a.get('permit_type_name', 'permit')} application for {a.get('property_address', '')}"
    if name == "update_permit_status":
        return f"Update permit {a.get('permit_number', '')} status to '{a.get('status', '')}'"
    if name == "schedule_inspection":
        return f"Schedule {a.get('inspection_type', 'inspection')} for permit {a.get('permit_number', '')} on {a.get('scheduled_date', '')}"
    if name == "create_complaint":
        return f"Log code-enforcement complaint at {a.get('property_address', '')}"
    if name == "create_work_order":
        return f"Create 311 work order ({a.get('category', 'Public Works')}) at {a.get('location', '')}"
    if name == "create_public_record":
        return f"Create {a.get('category', 'Record')}: '{a.get('title', '')}'"
    if name == "create_directory_entry":
        return f"Add directory contact '{a.get('name', '')}'"
    if name == "create_faq":
        return f"Add FAQ: '{a.get('question', '')}'"
    if name == "create_page":
        return f"Create info page '{a.get('title', '')}'"
    if name == "update_page":
        verb = "Publish" if a.get("is_public") is True else ("Unpublish" if a.get("is_public") is False else "Update")
        return f"{verb} info page {a.get('title') or a.get('title_match') or '#' + str(a.get('page_id', ''))}"
    if name == "add_contractor_license":
        return f"Add contractor license '{a.get('business_name', '')}' ({a.get('license_number', '')})"
    if name == "create_utility_bill":
        return f"Create utility bill (${a.get('amount_due', '')}) for {a.get('payer_name', '')}"
    if name == "create_citation":
        return f"Issue municipal citation (${a.get('amount_due', '')}) to {a.get('payer_name', '')}"
    if name == "toggle_module":
        return f"{'Enable' if a.get('enabled', True) else 'Disable'} module '{a.get('module_id', '')}'"
    if name == "update_branding":
        return "Update city preferences / branding"
    ext_desc = describe_ext_action(name, a)
    if ext_desc is not None:
        return ext_desc
    return f"Execute {name}"


def _run_ai_command(prompt: str, history: list[dict], user: dict, page_context: dict | None = None) -> dict:
    username = user["username"]
    api_key, model, _ = _load_gemini_config()
    if not api_key:
        raise HTTPException(status_code=400, detail="Gemini API key is not configured. Ask an administrator to add it in the AI Assistant settings.")

    allowed_decls = _allowed_tools_for_user(user)
    if not allowed_decls:
        raise HTTPException(status_code=403, detail="Your account does not have permission to use any AI Assistant tools.")

    today_str = date.today().isoformat()
    city_label = "the municipality"
    with pool.connection() as conn:
        crow = conn.execute(
            "SELECT COALESCE(NULLIF(trim(city_title), ''), NULLIF(trim(city_name), ''), '') FROM agenda_preferences WHERE id = 1"
        ).fetchone()
        if crow and crow[0]:
            city_label = crow[0]
    sys_instruction = (
        f"You are the DocketHall municipal admin assistant for {city_label}. Today's date is {today_str}. "
        "DocketHall is an all-in-one municipal operations platform covering: Agendas & Live Meetings, "
        "Permits & Land-Use/Variance Applications, Inspections, Contractor Licensing, Municipal City Code, "
        "Public Records & FOIA, Code-Enforcement Complaints & 311 Work Orders, Public Notices, City Blog, "
        "Calendar, City Directory & FAQs, Info Pages, Utility Billing, Municipal Citations, and Site Modules/Branding. "
        f"SCOPE GUARDRAIL: You are strictly limited to {city_label} municipal administration and DocketHall tasks. "
        f"If the user asks for anything unrelated to {city_label} governance, city code/documents, permits, agendas, "
        "or DocketHall operations (such as general trivia, personal tasks, creative writing, or outside topics), "
        "politely decline and explain that you can only assist with municipal tasks in DocketHall. "
        "1) When the user asks a QUESTION about city rules, ordinances, limits, permits, policies, records, or schedules, "
        "ALWAYS search the relevant data using your read/search tools (search_city_code, get_city_code_section, "
        "search_records, read_record_file, search_portal_info, list_agendas, list_permits, get_permit_details, list_complaints, get_complaint_details), "
        "read the returned text, and give a clear, accurate answer citing the specific Code Section or document title. "
        "2) When the user asks to CREATE, UPDATE, or DO something, call the appropriate action tool(s) with clean, properly "
        "formatted arguments (YYYY-MM-DD dates, '6:00 PM' times; if the year is omitted for a future date like 'December 1', "
        "choose the next upcoming occurrence relative to today). When asked to PUBLISH, UNPUBLISH, or EDIT an existing "
        "blog post, notice, or info page, ALWAYS use list_blog_posts / list_notices / list_pages to find it and call "
        "update_blog_post / update_notice / update_page—NEVER call create_* to publish or edit an existing item. "
        "When asked to attach a memo, summary, or city code note to an agenda or agenda item, use add_agenda_item_attachment "
        "(after searching city code/records if needed). Recording or proposing an agenda item, backlog todo, complaint, "
        "or notice is an administrative workflow for official council/staff review—do not refuse to stage a valid DocketHall "
        "agenda item or record just because the topic is controversial or unusual. IMPORTANT: Write actions are ONLY staged "
        "for the Confirm/Cancel buttons when you actually call the write tool—never ask the user to confirm without calling the write tool."
    )
    if page_context and (page_context.get("route") or page_context.get("title")):
        ctx_route = str(page_context.get("route") or "").strip()[:200]
        ctx_title = str(page_context.get("title") or "").strip()[:200]
        sys_instruction += (
            f" CURRENTLY OPEN PAGE IN UI: route='{ctx_route}'"
            + (f", heading='{ctx_title}'" if ctx_title else "")
            + ". If the user refers to 'this page', 'this agenda', 'this permit', 'this item', or omits an ID while viewing an entity page, "
            "use the route/ID from this currently open page context (or call get_agenda_details/get_permit_details with its ID)."
        )

    contents = []
    for h in history[-12:]:
        role = "model" if h.get("role") == "model" else "user"
        txt = str(h.get("text") or "").strip()
        if txt:
            contents.append({"role": role, "parts": [{"text": txt}]})
    contents.append({"role": "user", "parts": [{"text": prompt}]})
    tools = [{"functionDeclarations": allowed_decls}]
    actions: list[dict] = []
    pending_actions: list[dict] = []
    used_tools: set[str] = set()
    final_text = ""

    for _ in range(8):
        resp = _call_gemini(
            api_key,
            model,
            {
                "systemInstruction": {"parts": [{"text": sys_instruction}]},
                "contents": contents,
                "tools": tools,
            },
        )
        cands = resp.get("candidates") or []
        if not cands:
            break
        model_content = cands[0].get("content") or {}
        parts = model_content.get("parts") or []
        contents.append({"role": "model", "parts": parts})

        fn_calls = [p["functionCall"] for p in parts if isinstance(p, dict) and "functionCall" in p]
        text_parts = [p["text"] for p in parts if isinstance(p, dict) and p.get("text") and not p.get("thought")]
        if text_parts:
            final_text = "\n".join(text_parts).strip()

        if not fn_calls:
            break

        fn_responses = []
        for fc in fn_calls:
            fname = fc.get("name", "")
            fargs = fc.get("args") or {}
            used_tools.add(fname)
            if fname in _READ_ONLY_TOOLS:
                try:
                    result_obj, action_card = _execute_tool(fname, fargs, user)
                except Exception as exc:
                    result_obj, action_card = {"ok": False, "error": str(exc)}, None
                if action_card:
                    actions.append(action_card)
            else:
                denied = _check_tool_access(fname, user)
                if denied:
                    result_obj = {"ok": False, "error": denied}
                elif fname == "create_facility_reservation" and not any(p["tool"] == "create_facility" for p in pending_actions):
                    fname_req = str(fargs.get("facility_name") or "").strip()
                    with pool.connection() as conn:
                        fac = _find_active_facility(conn, fname_req)
                        avail = [r[0] for r in conn.execute("SELECT name FROM reservable_facilities WHERE is_active = TRUE ORDER BY sort_order, id").fetchall()]
                    if not fac:
                        result_obj = {
                            "ok": False,
                            "error": (
                                f"Active reservable facility '{fname_req}' does not exist yet. "
                                f"Available facilities: {avail or 'none'}. "
                                f"Ask the user whether they would like to create '{fname_req}' as a new reservable facility first."
                            ),
                        }
                    else:
                        summary = _describe_proposed_action(fname, fargs)
                        pending_actions.append({"tool": fname, "args": fargs, "summary": summary})
                        result_obj = {"ok": True, "status": "pending_confirmation", "proposed": summary}
                else:
                    summary = _describe_proposed_action(fname, fargs)
                    pending_actions.append({"tool": fname, "args": fargs, "summary": summary})
                    result_obj = {"ok": True, "status": "pending_confirmation", "proposed": summary}
            fn_resp_obj = {
                "name": fname,
                "response": result_obj,
            }
            if fc.get("id"):
                fn_resp_obj["id"] = fc["id"]
            fn_responses.append({"functionResponse": fn_resp_obj})
        contents.append({"role": "user", "parts": fn_responses})

    if not final_text and not actions and not pending_actions:
        contents.append({
            "role": "user",
            "parts": [{"text": "Based on the search results above, please answer the question directly. If the municipal code or documents do not specify a limit, state that clearly and cite the relevant sections you checked."}],
        })
        resp = _call_gemini(
            api_key,
            model,
            {
                "systemInstruction": {"parts": [{"text": sys_instruction}]},
                "contents": contents,
                "tools": tools,
                "toolConfig": {"functionCallingConfig": {"mode": "NONE"}},
            },
        )
        cands = resp.get("candidates") or []
        if cands:
            parts = (cands[0].get("content") or {}).get("parts") or []
            text_parts = [p["text"] for p in parts if isinstance(p, dict) and p.get("text") and not p.get("thought")]
            if text_parts:
                final_text = "\n".join(text_parts).strip()

    if not final_text and pending_actions:
        final_text = "Proposed change (please confirm): " + "; ".join(p["summary"] for p in pending_actions)
    elif not final_text and actions:
        final_text = "Done: " + "; ".join(a["summary"] for a in actions)
    if final_text and ("get_permit_details" in used_tools or "get_complaint_details" in used_tools):
        final_text += (
            "\n\n*Note: This AI-generated analysis is advisory only and may contain errors or omissions. "
            "All findings and code interpretations must be independently verified by qualified municipal staff "
            "before making a determination.*"
        )
    record_audit(username, "ai.command", f"Prompt: {prompt[:120]} | Proposed: {len(pending_actions)}")
    return {
        "reply": final_text or "I couldn't find an answer or propose an action for that request.",
        "actions": actions,
        "pending_actions": pending_actions,
    }


class AiPendingActionIn(BaseModel):
    tool: str
    args: dict = Field(default_factory=dict)


class AiConfirmIn(BaseModel):
    pending_actions: list[AiPendingActionIn] = Field(..., min_length=1, max_length=10)


def _execute_confirmed_actions(pending: list[AiPendingActionIn], user: dict) -> dict:
    actions: list[dict] = []
    errors: list[str] = []
    for item in pending:
        try:
            result_obj, action_card = _execute_tool(item.tool, item.args, user)
            if not result_obj.get("ok"):
                errors.append(result_obj.get("error") or f"Failed: {item.tool}")
            elif action_card:
                actions.append(action_card)
        except Exception as exc:
            errors.append(str(exc))
    parts = []
    if actions:
        parts.append("Done: " + "; ".join(a["summary"] for a in actions))
    if errors:
        parts.append("Errors: " + "; ".join(errors))
    record_audit(user["username"], "ai.confirm", f"Confirmed {len(actions)} action(s), {len(errors)} error(s)")
    return {"reply": "\n".join(parts) or "No changes made.", "actions": actions}


@router.post("/command")
async def run_ai_command(body: AiCommandIn, user: dict = Depends(_require_ai_user)):
    _require_ai_module_enabled()
    hist = [{"role": m.role, "text": m.text} for m in body.history]
    pctx = body.page_context.model_dump() if body.page_context else None
    return await run_in_threadpool(_run_ai_command, body.prompt.strip(), hist, user, pctx)


@router.post("/confirm")
async def confirm_ai_actions(body: AiConfirmIn, user: dict = Depends(_require_ai_user)):
    _require_ai_module_enabled()
    return await run_in_threadpool(_execute_confirmed_actions, body.pending_actions, user)


def _ensure_permit_ai_reviews_table(conn) -> None:
    conn.execute(
        """
        CREATE TABLE IF NOT EXISTS permit_ai_reviews (
            id BIGSERIAL PRIMARY KEY,
            permit_id BIGINT NOT NULL REFERENCES permits(id) ON DELETE CASCADE,
            check_type TEXT NOT NULL,
            model TEXT NOT NULL DEFAULT '',
            report TEXT NOT NULL,
            created_by TEXT NOT NULL DEFAULT '',
            created_at TIMESTAMPTZ NOT NULL DEFAULT now()
        );
        CREATE INDEX IF NOT EXISTS permit_ai_reviews_permit_idx ON permit_ai_reviews (permit_id, id DESC);
        """
    )


def ensure_ai_assistant_schema() -> None:
    """Ensure AI assistant database tables exist."""
    with pool.connection() as conn:
        _ensure_permit_ai_reviews_table(conn)
        _ensure_ai_daily_usage_table(conn)


class PermitEvaluateIn(BaseModel):
    check_type: str = Field(..., pattern="^(completeness|code_check)$")


def _permit_last_modified(conn, permit_id: int):
    row = conn.execute(
        "SELECT GREATEST("
        "  p.updated_at, "
        "  COALESCE((SELECT MAX(d.created_at) FROM permit_documents d WHERE d.permit_id = p.id), p.updated_at)"
        ") FROM permits p WHERE p.id = %s",
        (permit_id,),
    ).fetchone()
    return row[0] if row else None


@router.get("/permits/{permit_id}/reviews")
def list_permit_ai_reviews(permit_id: int, _: dict = Depends(require_permission("permits.manage"))):
    if not is_module_enabled("ai_assistant"):
        return {"enabled": False, "configured": False, "reviews": [], "up_to_date": {"completeness": False, "code_check": False}}
    key, _, _ = _load_gemini_config()
    with pool.connection() as conn:
        _ensure_permit_ai_reviews_table(conn)
        last_mod = _permit_last_modified(conn, permit_id)
        rows = conn.execute(
            "SELECT id, check_type, model, report, created_by, created_at "
            "FROM permit_ai_reviews WHERE permit_id = %s ORDER BY id DESC LIMIT 20",
            (permit_id,),
        ).fetchall()
    up_to_date = {"completeness": False, "code_check": False}
    reviews = []
    for r in rows:
        ctype, created_at = r[1], r[5]
        is_current = bool(last_mod and created_at and created_at >= last_mod)
        if ctype in up_to_date and not up_to_date[ctype] and is_current:
            up_to_date[ctype] = True
        reviews.append({
            "id": r[0],
            "check_type": ctype,
            "model": r[2],
            "report": r[3],
            "created_by": r[4],
            "created_at": created_at.isoformat() if created_at else "",
            "is_current": is_current,
        })
    return {
        "enabled": True,
        "configured": bool(key),
        "reviews": reviews,
        "up_to_date": up_to_date,
    }


def _run_and_save_permit_evaluation(permit_id: int, check_type: str, user: dict) -> dict:
    with pool.connection() as conn:
        _ensure_permit_ai_reviews_table(conn)
        p = conn.execute(
            "SELECT permit_number, permit_type_name, permit_use_name, property_address FROM permits WHERE id = %s",
            (permit_id,),
        ).fetchone()
        if not p:
            raise HTTPException(status_code=404, detail="Permit not found")
        last_mod = _permit_last_modified(conn, permit_id)
        latest = conn.execute(
            "SELECT id, model, report, created_by, created_at "
            "FROM permit_ai_reviews WHERE permit_id = %s AND check_type = %s ORDER BY id DESC LIMIT 1",
            (permit_id, check_type),
        ).fetchone()
        if latest and last_mod and latest[4] and latest[4] >= last_mod:
            return {
                "cached": True,
                "message": "Permit has not changed since the last check.",
                "review": {
                    "id": latest[0],
                    "check_type": check_type,
                    "model": latest[1],
                    "report": latest[2],
                    "created_by": latest[3],
                    "created_at": latest[4].isoformat(),
                    "is_current": True,
                },
            }
    pnum, ptype, puse, addr = p[0], p[1] or "Permit", p[2] or "", p[3] or "no address"
    label = f"{ptype}{f' - {puse}' if puse else ''}, {addr}"
    if check_type == "completeness":
        prompt = (
            f"Evaluate permit {pnum} ({label}) for application completeness against the Municipal City Code: "
            "use get_permit_details and search_city_code to list every required item, document, fee, and form field, "
            "what is currently provided, and what is missing."
        )
    else:
        prompt = (
            f"Evaluate permit {pnum} ({label}) substantively against the Municipal City Code "
            "(regardless of whether the application is complete or incomplete): use get_permit_details and "
            "search_city_code to check zoning, setbacks, lot/impervious coverage, use rules, and approval standards, "
            "and identify any compliance issues, required variances, or conditions."
        )
    res = _run_ai_command(prompt, [], user)
    report = (res.get("reply") or "").strip()
    if not report:
        raise HTTPException(status_code=500, detail="AI returned an empty evaluation.")
    _, model, _ = _load_gemini_config()
    with pool.connection() as conn:
        row = conn.execute(
            "INSERT INTO permit_ai_reviews (permit_id, check_type, model, report, created_by) "
            "VALUES (%s, %s, %s, %s, %s) RETURNING id, created_at",
            (permit_id, check_type, model, report, user["username"]),
        ).fetchone()
    record_audit(user["username"], "ai.permit_evaluate", f"{pnum} ({check_type})")
    return {
        "review": {
            "id": row[0],
            "check_type": check_type,
            "model": model,
            "report": report,
            "created_by": user["username"],
            "created_at": row[1].isoformat() if row[1] else "",
        }
    }


@router.post("/permits/{permit_id}/evaluate")
async def evaluate_permit_ai(
    permit_id: int,
    body: PermitEvaluateIn,
    user: dict = Depends(require_permission("permits.manage")),
):
    _require_ai_module_enabled()
    return await run_in_threadpool(_run_and_save_permit_evaluation, permit_id, body.check_type, user)
