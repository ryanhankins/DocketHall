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

"""Global Public Portal search and performance transparency across all enabled modules."""
import csv
from datetime import date, datetime, timezone
import io

from fastapi import APIRouter
from fastapi.responses import Response

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
        if "communications" in enabled:
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
            for r in conn.execute(
                "SELECT board_name, seat_name, member_name, is_vacant FROM city_board_members "
                "WHERE is_public = TRUE AND (board_name ILIKE %s OR seat_name ILIKE %s OR member_name ILIKE %s) "
                "ORDER BY board_name ASC, sort_order ASC LIMIT 5",
                (like, like, like),
            ).fetchall():
                results.append({
                    "module_id": "directory",
                    "module_label": "Board / Commission",
                    "title": f"{r[0]}{f' — {r[1]}' if r[1] else ''}",
                    "subtitle": "Vacant Seat (Open)" if r[3] else (r[2] or "Appointed Seat"),
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


@router.get("/transparency")
def public_transparency_snapshot():
    """Return anonymized YTD & active civic metrics across enabled public modules (no PII)."""
    enabled = set(get_enabled_module_ids())
    metrics: list[dict] = []
    with pool.connection() as conn:
        if "permits" in enabled:
            try:
                p_sub = conn.execute(
                    "SELECT COUNT(*) FROM permits WHERE EXTRACT(YEAR FROM created_at) = EXTRACT(YEAR FROM CURRENT_DATE)"
                ).fetchone()[0]
                p_iss = conn.execute(
                    "SELECT COUNT(*) FROM permits WHERE status IN ('issued','closed') "
                    "AND EXTRACT(YEAR FROM COALESCE(issued_at, created_at)) = EXTRACT(YEAR FROM CURRENT_DATE)"
                ).fetchone()[0]
                metrics.append({"label": "Permits Issued (YTD)", "value": int(p_iss), "tab": "permits"})
                metrics.append({"label": "Permit Applications (YTD)", "value": int(p_sub), "tab": "permits"})
            except Exception:
                pass
        if "agendas" in enabled:
            try:
                ag = conn.execute(
                    "SELECT COUNT(*) FROM agendas WHERE status = 'finalized' AND meeting_date >= CURRENT_DATE"
                ).fetchone()[0]
                metrics.append({"label": "Upcoming Finalized Meetings", "value": int(ag), "tab": "agendas"})
            except Exception:
                pass
        if "complaints" in enabled:
            try:
                ce = conn.execute(
                    "SELECT COUNT(*) FROM complaints WHERE status IN ('resolved','dismissed') "
                    "AND EXTRACT(YEAR FROM COALESCE(resolved_at, updated_at)) = EXTRACT(YEAR FROM CURRENT_DATE)"
                ).fetchone()[0]
                metrics.append({"label": "Code Cases Resolved (YTD)", "value": int(ce), "tab": "complaints"})
            except Exception:
                pass
        if "communications" in enabled:
            try:
                nt = conn.execute(
                    "SELECT COUNT(*) FROM city_notices WHERE is_published = TRUE AND category IN ('bid','bid_rfp','job') "
                    "AND (expires_at IS NULL OR expires_at >= CURRENT_DATE)"
                ).fetchone()[0]
                metrics.append({"label": "Open RFPs / Bids & Jobs", "value": int(nt), "tab": "notices"})
            except Exception:
                pass
        if "records" in enabled:
            try:
                rc = conn.execute("SELECT COUNT(*) FROM repository_documents WHERE is_public = TRUE").fetchone()[0]
                metrics.append({"label": "Published Public Records", "value": int(rc), "tab": "records"})
            except Exception:
                pass
    return {"metrics": metrics}


def _build_performance_metrics() -> dict:
    enabled = set(get_enabled_module_ids())
    complaints_by_cat: list[dict] = []
    permits_by_type: list[dict] = []
    foia_by_dept: list[dict] = []
    foia_summary = {
        "total_requests": 0,
        "fulfilled_count": 0,
        "on_time_count": 0,
        "compliance_rate_pct": None,
        "avg_fulfillment_days": None,
    }
    overall_311_avg = None
    overall_permit_avg = None

    with pool.connection() as conn:
        if "complaints" in enabled:
            try:
                rows = conn.execute(
                    "SELECT COALESCE(NULLIF(TRIM(ordinance_section), ''), 'General 311 / Code') AS cat, "
                    "       COUNT(*), "
                    "       COUNT(*) FILTER (WHERE status IN ('resolved', 'dismissed')), "
                    "       ROUND(AVG(EXTRACT(EPOCH FROM (COALESCE(resolved_at, updated_at) - created_at)) / 86400.0) "
                    "             FILTER (WHERE status IN ('resolved', 'dismissed'))::numeric, 1) "
                    "FROM complaints "
                    "GROUP BY 1 ORDER BY 2 DESC, 1 ASC"
                ).fetchall()
                for r in rows:
                    complaints_by_cat.append({
                        "category": r[0],
                        "total_cases": int(r[1]),
                        "resolved_cases": int(r[2]),
                        "avg_resolution_days": float(r[3]) if r[3] is not None else None,
                    })
                ov = conn.execute(
                    "SELECT ROUND(AVG(EXTRACT(EPOCH FROM (COALESCE(resolved_at, updated_at) - created_at)) / 86400.0)::numeric, 1) "
                    "FROM complaints WHERE status IN ('resolved', 'dismissed')"
                ).fetchone()
                if ov and ov[0] is not None:
                    overall_311_avg = float(ov[0])
            except Exception:
                pass

        if "permits" in enabled:
            try:
                rows = conn.execute(
                    "SELECT COALESCE(NULLIF(TRIM(permit_type_name), ''), 'General Permit') AS ptype, "
                    "       COUNT(*), "
                    "       COUNT(*) FILTER (WHERE status IN ('approved', 'issued', 'closed')), "
                    "       ROUND(AVG(EXTRACT(EPOCH FROM (COALESCE(issued_at, closed_at, updated_at) - created_at)) / 86400.0) "
                    "             FILTER (WHERE status IN ('approved', 'issued', 'closed'))::numeric, 1) "
                    "FROM permits "
                    "GROUP BY 1 ORDER BY 2 DESC, 1 ASC"
                ).fetchall()
                for r in rows:
                    permits_by_type.append({
                        "permit_type": r[0],
                        "total_applications": int(r[1]),
                        "issued_count": int(r[2]),
                        "avg_turnaround_days": float(r[3]) if r[3] is not None else None,
                    })
                ov = conn.execute(
                    "SELECT ROUND(AVG(EXTRACT(EPOCH FROM (COALESCE(issued_at, closed_at, updated_at) - created_at)) / 86400.0)::numeric, 1) "
                    "FROM permits WHERE status IN ('approved', 'issued', 'closed')"
                ).fetchone()
                if ov and ov[0] is not None:
                    overall_permit_avg = float(ov[0])
            except Exception:
                pass

        if "records" in enabled:
            try:
                rows = conn.execute(
                    "SELECT COALESCE(NULLIF(TRIM(department), ''), 'City Clerk') AS dept, "
                    "       COUNT(*), "
                    "       COUNT(*) FILTER (WHERE status IN ('fulfilled', 'closed', 'ready')), "
                    "       COUNT(*) FILTER (WHERE status IN ('fulfilled', 'closed', 'ready') "
                    "             AND (due_date = '' OR COALESCE(fulfilled_at, updated_at)::date <= NULLIF(due_date, '')::date)), "
                    "       ROUND(AVG(EXTRACT(EPOCH FROM (COALESCE(fulfilled_at, updated_at) - created_at)) / 86400.0) "
                    "             FILTER (WHERE status IN ('fulfilled', 'closed', 'ready'))::numeric, 1) "
                    "FROM public_records_requests "
                    "GROUP BY 1 ORDER BY 2 DESC, 1 ASC"
                ).fetchall()
                tot_req = 0
                tot_ful = 0
                tot_on = 0
                for r in rows:
                    t_c, f_c, o_c = int(r[1]), int(r[2]), int(r[3])
                    tot_req += t_c
                    tot_ful += f_c
                    tot_on += o_c
                    foia_by_dept.append({
                        "department": r[0],
                        "total_requests": t_c,
                        "fulfilled_count": f_c,
                        "on_time_count": o_c,
                        "compliance_rate_pct": round((o_c / f_c) * 100, 1) if f_c > 0 else None,
                        "avg_fulfillment_days": float(r[4]) if r[4] is not None else None,
                    })
                ov_f = conn.execute(
                    "SELECT ROUND(AVG(EXTRACT(EPOCH FROM (COALESCE(fulfilled_at, updated_at) - created_at)) / 86400.0)::numeric, 1) "
                    "FROM public_records_requests WHERE status IN ('fulfilled', 'closed', 'ready')"
                ).fetchone()
                foia_summary = {
                    "total_requests": tot_req,
                    "fulfilled_count": tot_ful,
                    "on_time_count": tot_on,
                    "compliance_rate_pct": round((tot_on / tot_ful) * 100, 1) if tot_ful > 0 else None,
                    "avg_fulfillment_days": float(ov_f[0]) if ov_f and ov_f[0] is not None else None,
                }
            except Exception:
                pass

    return {
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "summary": {
            "complaints_avg_resolution_days": overall_311_avg,
            "permits_avg_turnaround_days": overall_permit_avg,
            "foia": foia_summary,
        },
        "complaints_by_category": complaints_by_cat,
        "permits_by_type": permits_by_type,
        "foia_by_department": foia_by_dept,
    }


@router.get("/performance")
def public_performance_dashboard(download: int = 0):
    """Return anonymized public performance metrics (311 response times, permit turnaround, FOIA compliance)."""
    data = _build_performance_metrics()
    if download:
        return Response(
            content=io.StringIO(__import__("json").dumps(data, indent=2)).getvalue(),
            media_type="application/json",
            headers={"Content-Disposition": 'attachment; filename="dockethall-performance-metrics.json"'},
        )
    return data


@router.get("/performance.csv")
def public_performance_csv():
    """Export public performance metrics as an open-data CSV file."""
    data = _build_performance_metrics()
    buf = io.StringIO()
    w = csv.writer(buf)
    w.writerow(["Dataset", "Group / Category", "Total", "Completed / Resolved", "On-Time / Rate", "Avg Days"])
    for c in data["complaints_by_category"]:
        w.writerow([
            "311 & Code Enforcement",
            c["category"],
            c["total_cases"],
            c["resolved_cases"],
            "",
            c["avg_resolution_days"] if c["avg_resolution_days"] is not None else "",
        ])
    for p in data["permits_by_type"]:
        w.writerow([
            "Permit Turnaround",
            p["permit_type"],
            p["total_applications"],
            p["issued_count"],
            "",
            p["avg_turnaround_days"] if p["avg_turnaround_days"] is not None else "",
        ])
    for f in data["foia_by_department"]:
        rate = f"{f['compliance_rate_pct']}%" if f["compliance_rate_pct"] is not None else ""
        w.writerow([
            "FOIA Compliance",
            f["department"],
            f["total_requests"],
            f["fulfilled_count"],
            rate,
            f["avg_fulfillment_days"] if f["avg_fulfillment_days"] is not None else "",
        ])
    return Response(
        content=buf.getvalue(),
        media_type="text/csv; charset=utf-8",
        headers={"Content-Disposition": 'attachment; filename="dockethall-performance-metrics.csv"'},
    )
