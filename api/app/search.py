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

"""Global Public Portal search across all enabled modules."""
from datetime import date

from fastapi import APIRouter

from .db import pool
from .registry import get_enabled_module_ids

router = APIRouter(prefix="/api/public", tags=["public-search"])


@router.get("/search")
def global_public_search(q: str = ""):
    term = q.strip()
    if len(term) < 2:
        return {"query": term, "results": []}
    like = f"%{term}%"
    enabled = set(get_enabled_module_ids())
    results: list[dict] = []

    with pool.connection() as conn:
        if "pages" in enabled:
            for r in conn.execute(
                "SELECT title, summary, category FROM city_pages "
                "WHERE is_public = TRUE AND (title ILIKE %s OR summary ILIKE %s OR body ILIKE %s) "
                "ORDER BY sort_order ASC, title ASC LIMIT 6",
                (like, like, like),
            ).fetchall():
                results.append({
                    "module_id": "pages",
                    "module_label": "City Info",
                    "title": r[0],
                    "subtitle": r[1] or r[2] or "",
                    "tab": "pages",
                })
            for r in conn.execute(
                "SELECT label, description, url FROM city_quick_links "
                "WHERE is_public = TRUE AND (label ILIKE %s OR description ILIKE %s) "
                "ORDER BY sort_order ASC LIMIT 4",
                (like, like),
            ).fetchall():
                results.append({
                    "module_id": "pages",
                    "module_label": "Quick Link",
                    "title": r[0],
                    "subtitle": r[1] or r[2],
                    "tab": "pages",
                    "href": r[2],
                })

        if "notices" in enabled:
            for r in conn.execute(
                "SELECT title, summary, category FROM city_notices "
                "WHERE is_published = TRUE AND (expires_at IS NULL OR expires_at >= CURRENT_DATE) "
                "AND (title ILIKE %s OR summary ILIKE %s OR body ILIKE %s) "
                "ORDER BY is_pinned DESC, publish_at DESC LIMIT 6",
                (like, like, like),
            ).fetchall():
                results.append({
                    "module_id": "notices",
                    "module_label": "Notice / News",
                    "title": r[0],
                    "subtitle": r[1] or r[2].replace("_", " ").title(),
                    "tab": "notices",
                })

        if "forms" in enabled:
            for r in conn.execute(
                "SELECT title, description, form_kind FROM city_forms "
                "WHERE is_public = TRUE AND (closes_at IS NULL OR closes_at >= CURRENT_DATE) "
                "AND (title ILIKE %s OR description ILIKE %s) "
                "ORDER BY sort_order ASC LIMIT 6",
                (like, like),
            ).fetchall():
                results.append({
                    "module_id": "forms",
                    "module_label": "Poll" if r[2] == "poll" else "Form",
                    "title": r[0],
                    "subtitle": r[1] or "",
                    "tab": "forms",
                })

        if "directory" in enabled:
            for r in conn.execute(
                "SELECT name, title_role, department FROM city_directory_entries "
                "WHERE is_public = TRUE AND (name ILIKE %s OR title_role ILIKE %s OR department ILIKE %s) "
                "ORDER BY is_elected DESC, sort_order ASC LIMIT 5",
                (like, like, like),
            ).fetchall():
                results.append({
                    "module_id": "directory",
                    "module_label": "Directory",
                    "title": r[0],
                    "subtitle": " · ".join(x for x in (r[1], r[2]) if x),
                    "tab": "directory",
                })
            for r in conn.execute(
                "SELECT question, category FROM city_faqs "
                "WHERE is_public = TRUE AND (question ILIKE %s OR answer ILIKE %s) "
                "ORDER BY sort_order ASC LIMIT 5",
                (like, like),
            ).fetchall():
                results.append({
                    "module_id": "directory",
                    "module_label": "FAQ",
                    "title": r[0],
                    "subtitle": r[1],
                    "tab": "directory",
                })
            for r in conn.execute(
                "SELECT name, category, address FROM city_community_resources "
                "WHERE is_public = TRUE AND (name ILIKE %s OR category ILIKE %s OR description ILIKE %s OR address ILIKE %s) "
                "ORDER BY is_featured DESC, sort_order ASC, name ASC LIMIT 5",
                (like, like, like, like),
            ).fetchall():
                results.append({
                    "module_id": "directory",
                    "module_label": "Community Resource",
                    "title": r[0],
                    "subtitle": " · ".join(x for x in (r[1], r[2]) if x),
                    "tab": "directory",
                })

        if "agendas" in enabled:
            for r in conn.execute(
                "SELECT title, body, meeting_date FROM agendas "
                "WHERE status = 'finalized' AND (title ILIKE %s OR body ILIKE %s) "
                "ORDER BY meeting_date DESC NULLS LAST LIMIT 6",
                (like, like),
            ).fetchall():
                results.append({
                    "module_id": "agendas",
                    "module_label": "Agenda",
                    "title": r[0],
                    "subtitle": " · ".join(x for x in (r[1], r[2].isoformat() if r[2] else "") if x),
                    "tab": "agendas",
                })

        if "codification" in enabled:
            for r in conn.execute(
                "SELECT section_number, title FROM code_sections "
                "WHERE is_published = TRUE AND (section_number ILIKE %s OR title ILIKE %s OR body ILIKE %s) "
                "ORDER BY sort_order ASC, section_number ASC LIMIT 6",
                (like, like, like),
            ).fetchall():
                results.append({
                    "module_id": "codification",
                    "module_label": "City Code",
                    "title": f"§ {r[0]} — {r[1]}",
                    "subtitle": "Municipal Code Section",
                    "tab": "codification",
                })

        if "records" in enabled:
            today = date.today()
            added = 0
            for r in conn.execute(
                "SELECT title, category, doc_number, expiration_date, auto_unpublish_on_expire "
                "FROM repository_documents WHERE is_public = TRUE "
                "AND (title ILIKE %s OR notes ILIKE %s OR tags ILIKE %s OR doc_number ILIKE %s) "
                "ORDER BY id DESC LIMIT 12",
                (like, like, like, like),
            ).fetchall():
                if r[4] and r[3]:
                    try:
                        if date.fromisoformat(r[3]) < today:
                            continue
                    except ValueError:
                        pass
                results.append({
                    "module_id": "records",
                    "module_label": "Public Record",
                    "title": r[0],
                    "subtitle": " · ".join(x for x in (r[1], r[2]) if x),
                    "tab": "records",
                })
                added += 1
                if added >= 6:
                    break

        if "calendar" in enabled:
            for r in conn.execute(
                "SELECT title, event_date, location FROM calendar_events "
                "WHERE is_public = TRUE AND (title ILIKE %s OR description ILIKE %s OR location ILIKE %s) "
                "ORDER BY event_date DESC LIMIT 5",
                (like, like, like),
            ).fetchall():
                results.append({
                    "module_id": "calendar",
                    "module_label": "Calendar",
                    "title": r[0],
                    "subtitle": " · ".join(x for x in (r[1].isoformat() if r[1] else "", r[2]) if x),
                    "tab": "calendar",
                })

        if "permits" in enabled:
            for r in conn.execute(
                "SELECT t.name, u.name, u.fee_amount FROM permit_uses u "
                "JOIN permit_types t ON t.id = u.permit_type_id "
                "WHERE t.is_active = TRUE AND u.is_active = TRUE AND (t.name ILIKE %s OR u.name ILIKE %s) "
                "ORDER BY t.sort_order ASC, u.sort_order ASC LIMIT 6",
                (like, like),
            ).fetchall():
                results.append({
                    "module_id": "permits",
                    "module_label": "Permit",
                    "title": f"{r[0]} — {r[1]}",
                    "subtitle": f"Fee: {r[2]}" if r[2] else "Apply online",
                    "tab": "permits",
                    "href": "/portal",
                })

    return {"query": term, "results": results[:40]}
