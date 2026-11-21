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

"""Municipal Blog categories, rich-text posts, custom header text, RSS feeds, and resident comment moderation."""
from __future__ import annotations

from datetime import date, datetime, timezone
import io
import os
import re
from typing import Literal
import uuid

from fastapi import APIRouter, Depends, File, HTTPException, Request, UploadFile
from fastapi.responses import Response
from psycopg.types.json import Jsonb
from pydantic import BaseModel

from .agendas import _bucket, _minio, _remove_minio_objects
from .audit import record_audit
from .auth import current_user, has_permission, require_permission
from .blog_utils import (
    COMMENT_POLICIES,
    COMMENT_STATUSES,
    POST_COMMENT_OVERRIDES,
    RSS_POLICIES,
    build_rss_xml,
    compute_post_status,
    detect_safe_image_type,
    effective_comment_policy,
    is_post_publicly_visible,
    normalize_tags,
    post_included_in_rss,
    slugify,
    validate_comment_input,
)
from .db import pool
from .integrations import get_app_base_url, send_notification_email
from .subscriptions import notify_topic_subscribers
from .tenancy import tenant_object_key

_MAX_IMAGE_BYTES = 10 * 1024 * 1024
_SAFE_FILE_RE = re.compile(r"[^A-Za-z0-9._-]+")

SCHEMA = """
CREATE TABLE IF NOT EXISTS blog_categories (
    id                  BIGSERIAL PRIMARY KEY,
    slug                TEXT NOT NULL UNIQUE,
    name                TEXT NOT NULL,
    description         TEXT NOT NULL DEFAULT '',
    header_text         TEXT NOT NULL DEFAULT '',
    image_key           TEXT NOT NULL DEFAULT '',
    image_filename      TEXT NOT NULL DEFAULT '',
    comment_policy      TEXT NOT NULL DEFAULT 'moderated',
    allow_subscriptions BOOLEAN NOT NULL DEFAULT TRUE,
    rss_policy          TEXT NOT NULL DEFAULT 'always_ask',
    show_on_home        BOOLEAN NOT NULL DEFAULT TRUE,
    sort_order          INTEGER NOT NULL DEFAULT 0,
    is_public           BOOLEAN NOT NULL DEFAULT TRUE,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS blog_posts (
    id                      BIGSERIAL PRIMARY KEY,
    category_id             BIGINT NOT NULL REFERENCES blog_categories(id) ON DELETE CASCADE,
    slug                    TEXT NOT NULL UNIQUE,
    title                   TEXT NOT NULL,
    lead_in                 TEXT NOT NULL DEFAULT '',
    body                    TEXT NOT NULL DEFAULT '',
    tags                    JSONB NOT NULL DEFAULT '[]'::jsonb,
    author_name             TEXT NOT NULL DEFAULT '',
    image_key               TEXT NOT NULL DEFAULT '',
    image_filename          TEXT NOT NULL DEFAULT '',
    is_featured             BOOLEAN NOT NULL DEFAULT FALSE,
    is_published            BOOLEAN NOT NULL DEFAULT FALSE,
    publish_at              TIMESTAMPTZ NOT NULL DEFAULT now(),
    expires_at              DATE,
    include_in_rss          BOOLEAN NOT NULL DEFAULT TRUE,
    comment_policy_override TEXT NOT NULL DEFAULT 'inherit',
    created_by              TEXT NOT NULL DEFAULT '',
    created_at              TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at              TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS blog_posts_pub_idx ON blog_posts(category_id, is_published, publish_at DESC);
CREATE TABLE IF NOT EXISTS blog_comments (
    id           BIGSERIAL PRIMARY KEY,
    post_id      BIGINT NOT NULL REFERENCES blog_posts(id) ON DELETE CASCADE,
    author_name  TEXT NOT NULL,
    author_email TEXT NOT NULL DEFAULT '',
    body         TEXT NOT NULL,
    status       TEXT NOT NULL DEFAULT 'pending',
    moderated_by TEXT NOT NULL DEFAULT '',
    moderated_at TIMESTAMPTZ,
    created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS blog_comments_post_status_idx ON blog_comments(post_id, status, id DESC);
"""

_SEED_CATEGORIES = [
    {
        "slug": "city-updates",
        "name": "City Updates",
        "description": "Official updates from City Hall, department projects, and seasonal service reminders.",
        "header_text": (
            "## Welcome to City Updates\n\n"
            "Stay informed on public works projects, council initiatives, seasonal service schedules, "
            "and municipal programs affecting our community."
        ),
        "comment_policy": "moderated",
        "allow_subscriptions": True,
        "rss_policy": "always_ask",
        "show_on_home": True,
        "sort_order": 1,
    },
    {
        "slug": "community-spotlight",
        "name": "Community Spotlight",
        "description": "Local highlights, volunteer recognition, parks programs, and neighborhood stories.",
        "header_text": (
            "## Community Spotlight\n\n"
            "Celebrating local initiatives, seasonal events, and civic partnerships across town."
        ),
        "comment_policy": "moderated",
        "allow_subscriptions": True,
        "rss_policy": "include",
        "show_on_home": True,
        "sort_order": 2,
    },
]

_SEED_POST = {
    "category_slug": "city-updates",
    "slug": "welcome-to-our-community-blog",
    "title": "Welcome to Our Community Blog",
    "lead_in": (
        "Follow city updates, project milestones, and seasonal reminders — subscribe by email or RSS "
        "and share your feedback."
    ),
    "body": (
        "Welcome to the municipal blog! Here city departments and leadership can publish detailed updates, "
        "explain upcoming capital improvements, and highlight community programs.\n\n"
        "### Ways to Stay Connected\n\n"
        "- **Email Subscriptions:** Sign up on the Public Portal to receive automatic alerts when new posts go live.\n"
        "- **RSS Feeds:** Subscribe to the full blog feed or individual categories in your preferred reader.\n"
        "- **Resident Comments:** Share questions or feedback below on articles where commenting is enabled.\n\n"
        "> Tip for Staff: Sign in with Blog permissions to edit this welcome post, customize category header text, "
        "or create new articles using Live Edit."
    ),
    "tags": ["City Hall", "Announcements"],
    "author_name": "City Communications",
    "is_featured": True,
    "is_published": True,
    "include_in_rss": True,
}


def bootstrap() -> None:
    """Create blog tables and seed initial categories and starter post when empty."""
    with pool.connection() as conn:
        conn.execute("SELECT pg_advisory_xact_lock(424258)")
        conn.execute(SCHEMA)
        if conn.execute("SELECT COUNT(*) FROM blog_categories").fetchone()[0] == 0:
            cat_ids: dict[str, int] = {}
            for cat in _SEED_CATEGORIES:
                row = conn.execute(
                    "INSERT INTO blog_categories "
                    "(slug, name, description, header_text, comment_policy, allow_subscriptions, "
                    " rss_policy, show_on_home, sort_order, is_public) "
                    "VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, TRUE) "
                    "ON CONFLICT (slug) DO NOTHING RETURNING id",
                    (
                        cat["slug"],
                        cat["name"],
                        cat["description"],
                        cat["header_text"],
                        cat["comment_policy"],
                        cat["allow_subscriptions"],
                        cat["rss_policy"],
                        cat["show_on_home"],
                        cat["sort_order"],
                    ),
                ).fetchone()
                if row:
                    cat_ids[cat["slug"]] = row[0]
            cid = cat_ids.get(_SEED_POST["category_slug"])
            if cid:
                conn.execute(
                    "INSERT INTO blog_posts "
                    "(category_id, slug, title, lead_in, body, tags, author_name, is_featured, "
                    " is_published, include_in_rss, created_by) "
                    "VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, 'system') "
                    "ON CONFLICT (slug) DO NOTHING",
                    (
                        cid,
                        _SEED_POST["slug"],
                        _SEED_POST["title"],
                        _SEED_POST["lead_in"],
                        _SEED_POST["body"],
                        Jsonb(_SEED_POST["tags"]),
                        _SEED_POST["author_name"],
                        _SEED_POST["is_featured"],
                        _SEED_POST["is_published"],
                        _SEED_POST["include_in_rss"],
                    ),
                )


router = APIRouter(prefix="/api/blog", tags=["blog"])


class CategoryIn(BaseModel):
    name: str
    slug: str = ""
    description: str = ""
    header_text: str = ""
    comment_policy: Literal["disabled", "moderated", "open"] = "moderated"
    allow_subscriptions: bool = True
    rss_policy: Literal["always_ask", "include", "exclude"] = "always_ask"
    show_on_home: bool = True
    sort_order: int = 0
    is_public: bool = True


class CategoryPatch(BaseModel):
    name: str | None = None
    description: str | None = None
    header_text: str | None = None
    comment_policy: Literal["disabled", "moderated", "open"] | None = None
    allow_subscriptions: bool | None = None
    rss_policy: Literal["always_ask", "include", "exclude"] | None = None
    show_on_home: bool | None = None
    sort_order: int | None = None
    is_public: bool | None = None


class PostIn(BaseModel):
    category_id: int
    title: str
    slug: str = ""
    lead_in: str = ""
    body: str = ""
    tags: list[str] | str = []
    author_name: str = ""
    is_featured: bool = False
    is_published: bool = False
    publish_at: str | None = None
    expires_at: str | None = None
    include_in_rss: bool = True
    comment_policy_override: Literal["inherit", "disabled", "moderated", "open"] = "inherit"
    notify_subscribers: bool = False


class PostPatch(BaseModel):
    category_id: int | None = None
    title: str | None = None
    lead_in: str | None = None
    body: str | None = None
    tags: list[str] | str | None = None
    author_name: str | None = None
    is_featured: bool | None = None
    is_published: bool | None = None
    publish_at: str | None = None
    expires_at: str | None = None
    include_in_rss: bool | None = None
    comment_policy_override: Literal["inherit", "disabled", "moderated", "open"] | None = None
    notify_subscribers: bool = False


class CommentIn(BaseModel):
    author_name: str
    author_email: str = ""
    body: str
    website: str = ""


class CommentModerateIn(BaseModel):
    status: Literal["pending", "approved", "rejected"]


def _unique_slug(conn, table: str, raw: str, fallback: str, exclude_id: int | None = None) -> str:
    base = slugify(raw, fallback=fallback, max_len=64)
    candidate = base
    n = 2
    while True:
        if exclude_id is not None:
            hit = conn.execute(
                f"SELECT 1 FROM {table} WHERE slug = %s AND id <> %s",
                (candidate, exclude_id),
            ).fetchone()
        else:
            hit = conn.execute(f"SELECT 1 FROM {table} WHERE slug = %s", (candidate,)).fetchone()
        if not hit:
            return candidate
        suffix = f"-{n}"
        candidate = f"{base[: max(1, 64 - len(suffix))]}{suffix}"
        n += 1


def _parse_publish_at(raw: str | None) -> datetime | None:
    if raw is None:
        return None
    s = raw.strip()
    if not s:
        return None
    if len(s) == 10:
        try:
            d = date.fromisoformat(s)
            return datetime(d.year, d.month, d.day, 0, 0, 0, tzinfo=timezone.utc)
        except ValueError:
            raise HTTPException(status_code=400, detail=f"Invalid publish date '{s}'; expected ISO date or datetime")
    normalized = s[:-1] + "+00:00" if s.endswith("Z") else s
    try:
        dt = datetime.fromisoformat(normalized)
    except ValueError:
        raise HTTPException(status_code=400, detail=f"Invalid publish date '{s}'; expected ISO date or datetime")
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=timezone.utc)
    return dt


def _parse_expires_at(raw: str | None) -> date | None:
    if raw is None:
        return None
    s = raw.strip()
    if not s:
        return None
    try:
        return date.fromisoformat(s[:10])
    except ValueError:
        raise HTTPException(status_code=400, detail=f"Invalid stop date '{s}'; expected YYYY-MM-DD")


def _row_to_category(r, post_count: int = 0, published_count: int = 0) -> dict:
    has_img = bool(r[5])
    return {
        "id": r[0],
        "slug": r[1],
        "name": r[2],
        "description": r[3],
        "header_text": r[4],
        "has_image": has_img,
        "image_url": f"/api/blog/public/categories/{r[0]}/image" if has_img else "",
        "image_filename": r[6],
        "comment_policy": r[7],
        "allow_subscriptions": bool(r[8]),
        "rss_policy": r[9],
        "show_on_home": bool(r[10]),
        "sort_order": r[11],
        "is_public": bool(r[12]),
        "created_at": r[13].isoformat() if r[13] else None,
        "updated_at": r[14].isoformat() if r[14] else None,
        "post_count": post_count,
        "published_count": published_count,
    }


_CAT_COLS = (
    "id, slug, name, description, header_text, image_key, image_filename, "
    "comment_policy, allow_subscriptions, rss_policy, show_on_home, sort_order, "
    "is_public, created_at, updated_at"
)

_POST_JOIN_COLS = (
    "p.id, p.category_id, p.slug, p.title, p.lead_in, p.body, p.tags, p.author_name, "
    "p.image_key, p.image_filename, p.is_featured, p.is_published, p.publish_at, p.expires_at, "
    "p.include_in_rss, p.comment_policy_override, p.created_by, p.created_at, p.updated_at, "
    "c.slug, c.name, c.comment_policy, c.rss_policy, c.allow_subscriptions, c.is_public, "
    "COALESCE(cm.approved_cnt, 0), COALESCE(cm.pending_cnt, 0)"
)

_POST_COMMENT_COUNTS_JOIN = (
    "LEFT JOIN ("
    "  SELECT post_id, "
    "         COUNT(*) FILTER (WHERE status = 'approved') AS approved_cnt, "
    "         COUNT(*) FILTER (WHERE status = 'pending') AS pending_cnt "
    "  FROM blog_comments GROUP BY post_id"
    ") cm ON cm.post_id = p.id"
)


def _row_to_post(r) -> dict:
    has_img = bool(r[8])
    pub_at = r[12]
    exp_at = r[13]
    is_pub = bool(r[11])
    cat_pol = r[21]
    cat_rss = r[22]
    override = r[15]
    return {
        "id": r[0],
        "category_id": r[1],
        "slug": r[2],
        "title": r[3],
        "lead_in": r[4],
        "body": r[5],
        "tags": list(r[6]) if isinstance(r[6], list) else [],
        "author_name": r[7],
        "has_image": has_img,
        "image_url": f"/api/blog/public/posts/{r[0]}/image" if has_img else "",
        "image_filename": r[9],
        "is_featured": bool(r[10]),
        "is_published": is_pub,
        "publish_at": pub_at.isoformat() if pub_at else None,
        "expires_at": exp_at.isoformat() if exp_at else None,
        "include_in_rss": bool(r[14]),
        "in_rss": post_included_in_rss(cat_rss, bool(r[14])),
        "comment_policy_override": override,
        "effective_comment_policy": effective_comment_policy(cat_pol, override),
        "created_by": r[16],
        "created_at": r[17].isoformat() if r[17] else None,
        "updated_at": r[18].isoformat() if r[18] else None,
        "category_slug": r[19],
        "category_name": r[20],
        "category_comment_policy": cat_pol,
        "category_rss_policy": cat_rss,
        "category_allow_subscriptions": bool(r[23]),
        "category_is_public": bool(r[24]),
        "computed_status": compute_post_status(is_pub, pub_at, exp_at),
        "approved_comment_count": int(r[25] or 0),
        "pending_comment_count": int(r[26] or 0),
    }


def _row_to_public_comment(r) -> dict:
    return {
        "id": r[0],
        "post_id": r[1],
        "author_name": r[2],
        "body": r[3],
        "created_at": r[4].isoformat() if r[4] else None,
    }


# ------------------------------------------------------------------ Public endpoints


@router.get("/public")
def list_public_blog(
    category: str = "",
    tag: str = "",
    q: str = "",
    home_only: bool = False,
    limit: int = 50,
):
    """Return public blog categories, published in-schedule posts, and available tags."""
    safe_limit = max(1, min(int(limit or 50), 100))
    cat_filter = category.strip().lower()
    tag_filter = tag.strip().lower()
    q_clean = q.strip()

    with pool.connection() as conn:
        cat_rows = conn.execute(
            f"SELECT {_CAT_COLS}, "
            "(SELECT COUNT(*) FROM blog_posts bp "
            " WHERE bp.category_id = blog_categories.id AND bp.is_published = TRUE "
            " AND bp.publish_at <= now() AND (bp.expires_at IS NULL OR bp.expires_at >= CURRENT_DATE)) "
            "FROM blog_categories WHERE is_public = TRUE "
            "ORDER BY sort_order ASC, name ASC"
        ).fetchall()
        categories = [_row_to_category(r[:15], post_count=int(r[15] or 0), published_count=int(r[15] or 0)) for r in cat_rows]

        clauses = [
            "c.is_public = TRUE",
            "p.is_published = TRUE",
            "p.publish_at <= now()",
            "(p.expires_at IS NULL OR p.expires_at >= CURRENT_DATE)",
        ]
        params: list = []
        if home_only:
            clauses.append("c.show_on_home = TRUE")
        if cat_filter:
            clauses.append("LOWER(c.slug) = %s")
            params.append(cat_filter)
        if q_clean:
            like = f"%{q_clean}%"
            clauses.append("(p.title ILIKE %s OR p.lead_in ILIKE %s OR p.body ILIKE %s OR p.tags::text ILIKE %s)")
            params.extend([like, like, like, like])

        where = "WHERE " + " AND ".join(clauses)
        post_rows = conn.execute(
            f"SELECT {_POST_JOIN_COLS} FROM blog_posts p "
            "JOIN blog_categories c ON c.id = p.category_id "
            f"{_POST_COMMENT_COUNTS_JOIN} "
            f"{where} "
            "ORDER BY p.is_featured DESC, p.publish_at DESC, p.id DESC LIMIT %s",
            tuple(params + [safe_limit * 2 if tag_filter else safe_limit]),
        ).fetchall()

        tag_rows = conn.execute(
            "SELECT p.tags FROM blog_posts p "
            "JOIN blog_categories c ON c.id = p.category_id "
            "WHERE c.is_public = TRUE AND p.is_published = TRUE "
            "AND p.publish_at <= now() AND (p.expires_at IS NULL OR p.expires_at >= CURRENT_DATE)"
        ).fetchall()

    posts = [_row_to_post(r) for r in post_rows]
    if tag_filter:
        posts = [
            p for p in posts
            if any(str(t).lower() == tag_filter for t in p["tags"])
        ][:safe_limit]

    all_tags_map: dict[str, str] = {}
    for (tlist,) in tag_rows:
        if isinstance(tlist, list):
            for t in tlist:
                s = str(t or "").strip()
                if s and s.lower() not in all_tags_map:
                    all_tags_map[s.lower()] = s

    return {
        "categories": categories,
        "posts": posts,
        "tags": sorted(all_tags_map.values(), key=lambda s: s.lower()),
    }


@router.get("/public/posts/{slug_or_id}")
def get_public_blog_post(slug_or_id: str, request: Request, preview: int = 0):
    """Fetch a single published blog post and its approved comments (or preview for staff)."""
    can_preview = False
    if preview:
        user = current_user(request)
        can_preview = bool(user and has_permission(user, "blog.manage"))

    key = slug_or_id.strip()
    is_num = key.isdigit()
    with pool.connection() as conn:
        post_row = conn.execute(
            f"SELECT {_POST_JOIN_COLS} FROM blog_posts p "
            "JOIN blog_categories c ON c.id = p.category_id "
            f"{_POST_COMMENT_COUNTS_JOIN} "
            f"WHERE {'p.id = %s' if is_num else 'p.slug = %s'}",
            (int(key) if is_num else key,),
        ).fetchone()
        if not post_row:
            raise HTTPException(status_code=404, detail="Blog post not found")
        if not can_preview and not is_post_publicly_visible(
            bool(post_row[11]), bool(post_row[24]), post_row[12], post_row[13]
        ):
            raise HTTPException(status_code=404, detail="Blog post not found")

        cat_row = conn.execute(
            f"SELECT {_CAT_COLS} FROM blog_categories WHERE id = %s",
            (post_row[1],),
        ).fetchone()
        comment_rows = conn.execute(
            "SELECT id, post_id, author_name, body, created_at "
            "FROM blog_comments WHERE post_id = %s AND status = 'approved' "
            "ORDER BY id ASC",
            (post_row[0],),
        ).fetchall()

    return {
        "post": _row_to_post(post_row),
        "category": _row_to_category(cat_row) if cat_row else None,
        "comments": [_row_to_public_comment(c) for c in comment_rows],
    }


@router.post("/public/posts/{post_id}/comments", status_code=201)
def submit_public_comment(post_id: int, body: CommentIn, request: Request):
    """Submit a resident comment on a published blog post respecting its moderation policy."""
    if body.website.strip():
        return {
            "id": 0,
            "post_id": post_id,
            "author_name": body.author_name.strip()[:80] or "Resident",
            "status": "pending",
            "message": "Thank you for your comment. It is awaiting moderator approval.",
        }

    try:
        author_name, author_email, text = validate_comment_input(
            body.author_name, body.author_email, body.body
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))

    with pool.connection() as conn:
        row = conn.execute(
            "SELECT p.id, p.title, p.slug, p.is_published, p.publish_at, p.expires_at, "
            "       p.comment_policy_override, c.comment_policy, c.is_public "
            "FROM blog_posts p "
            "JOIN blog_categories c ON c.id = p.category_id "
            "WHERE p.id = %s",
            (post_id,),
        ).fetchone()
        if not row or not is_post_publicly_visible(bool(row[3]), bool(row[8]), row[4], row[5]):
            raise HTTPException(status_code=404, detail="Blog post not found")

        policy = effective_comment_policy(row[7], row[6])
        if policy == "disabled":
            raise HTTPException(status_code=403, detail="Comments are disabled for this post.")

        status = "pending" if policy == "moderated" else "approved"
        inserted = conn.execute(
            "INSERT INTO blog_comments (post_id, author_name, author_email, body, status) "
            "VALUES (%s, %s, %s, %s, %s) "
            "RETURNING id, post_id, author_name, body, status, created_at",
            (post_id, author_name, author_email, text, status),
        ).fetchone()

    if status == "pending":
        send_notification_email(
            "blog_comment_pending",
            f"[DocketHall] Blog Comment Awaiting Moderation: {row[1]}",
            f"A new resident comment was submitted by {author_name} on \"{row[1]}\":\n\n{text}",
            link_path="/app#blog-manage",
            request=request,
        )
        msg = "Thank you! Your comment has been submitted and is awaiting staff approval."
    else:
        msg = "Your comment has been published."

    return {
        "id": inserted[0],
        "post_id": inserted[1],
        "author_name": inserted[2],
        "body": inserted[3],
        "status": inserted[4],
        "created_at": inserted[5].isoformat() if inserted[5] else None,
        "message": msg,
    }


def _serve_blog_image(key: str, filename: str, is_visible: bool, request: Request) -> Response:
    if not key:
        raise HTTPException(status_code=404, detail="Image not found")
    if not is_visible:
        user = current_user(request)
        if not user or not has_permission(user, "blog.manage"):
            raise HTTPException(status_code=404, detail="Image not found")
    resp = _minio().get_object(_bucket(), key)
    try:
        data = resp.read()
    finally:
        resp.close()
        resp.release_conn()
    detected = detect_safe_image_type(data)
    media = detected[1] if detected else "application/octet-stream"
    fname = _SAFE_FILE_RE.sub("_", filename or "image")
    return Response(
        content=data,
        media_type=media,
        headers={
            "Content-Disposition": f'inline; filename="{fname}"',
            "Cache-Control": "public, max-age=300",
        },
    )


@router.get("/public/categories/{category_id}/image")
def get_category_image(category_id: int, request: Request):
    """Serve the header image for a blog category."""
    with pool.connection() as conn:
        row = conn.execute(
            "SELECT image_key, image_filename, is_public FROM blog_categories WHERE id = %s",
            (category_id,),
        ).fetchone()
    if not row:
        raise HTTPException(status_code=404, detail="Category not found")
    return _serve_blog_image(row[0], row[1], bool(row[2]), request)


@router.get("/public/posts/{post_id}/image")
def get_post_image(post_id: int, request: Request):
    """Serve the featured cover image for a blog post."""
    with pool.connection() as conn:
        row = conn.execute(
            "SELECT p.image_key, p.image_filename, p.is_published, c.is_public, p.publish_at, p.expires_at "
            "FROM blog_posts p JOIN blog_categories c ON c.id = p.category_id WHERE p.id = %s",
            (post_id,),
        ).fetchone()
    if not row:
        raise HTTPException(status_code=404, detail="Post not found")
    visible = is_post_publicly_visible(bool(row[2]), bool(row[3]), row[4], row[5])
    return _serve_blog_image(row[0], row[1], visible, request)


@router.get("/rss.xml")
def get_blog_rss(request: Request, category: str = ""):
    """Serve an RSS 2.0 XML syndication feed for published municipal blog posts."""
    base = get_app_base_url(request).rstrip("/")
    cat_filter = category.strip().lower()
    with pool.connection() as conn:
        pref = conn.execute("SELECT city_title FROM agenda_preferences WHERE id = 1").fetchone()
        city_title = (pref[0] or "").strip() if pref else ""

        clauses = [
            "c.is_public = TRUE",
            "p.is_published = TRUE",
            "p.publish_at <= now()",
            "(p.expires_at IS NULL OR p.expires_at >= CURRENT_DATE)",
            "c.rss_policy <> 'exclude'",
            "(c.rss_policy = 'include' OR p.include_in_rss = TRUE)",
        ]
        params: list = []
        cat_label = ""
        if cat_filter:
            clauses.append("LOWER(c.slug) = %s")
            params.append(cat_filter)
            c_row = conn.execute(
                "SELECT name FROM blog_categories WHERE LOWER(slug) = %s AND is_public = TRUE",
                (cat_filter,),
            ).fetchone()
            if c_row:
                cat_label = c_row[0]

        where = "WHERE " + " AND ".join(clauses)
        rows = conn.execute(
            "SELECT p.slug, p.title, p.lead_in, p.body, p.tags, p.author_name, p.publish_at, c.name "
            "FROM blog_posts p JOIN blog_categories c ON c.id = p.category_id "
            f"{where} ORDER BY p.publish_at DESC, p.id DESC LIMIT 50",
            tuple(params),
        ).fetchall()

    prefix = f"{city_title} " if city_title else ""
    channel_title = f"{prefix}Blog — {cat_label}" if cat_label else f"{prefix}Community Blog"
    channel_link = f"{base}/#blog" if base else "/#blog"
    items = [
        {
            "title": r[1],
            "link": f"{base}/#blog/{r[0]}" if base else f"/#blog/{r[0]}",
            "guid": f"{base}/#blog/{r[0]}" if base else f"/#blog/{r[0]}",
            "lead_in": r[2],
            "body": r[3],
            "tags": r[4] if isinstance(r[4], list) else [],
            "author": r[5],
            "pub_date": r[6],
            "category": r[7],
        }
        for r in rows
    ]
    xml_str = build_rss_xml(
        channel_title,
        channel_link,
        f"Latest updates and community articles from {city_title or 'City Hall'}.",
        items,
    )
    return Response(content=xml_str, media_type="application/rss+xml; charset=utf-8")


# ------------------------------------------------------------------ Staff endpoints


@router.get("/categories")
def list_categories(_: dict = Depends(require_permission("blog.manage"))):
    """List all blog categories for staff management."""
    with pool.connection() as conn:
        rows = conn.execute(
            f"SELECT {_CAT_COLS}, "
            "(SELECT COUNT(*) FROM blog_posts bp WHERE bp.category_id = blog_categories.id), "
            "(SELECT COUNT(*) FROM blog_posts bp WHERE bp.category_id = blog_categories.id AND bp.is_published = TRUE) "
            "FROM blog_categories ORDER BY sort_order ASC, name ASC"
        ).fetchall()
    return [
        _row_to_category(r[:15], post_count=int(r[15] or 0), published_count=int(r[16] or 0))
        for r in rows
    ]


@router.post("/categories", status_code=201)
def create_category(body: CategoryIn, user: dict = Depends(require_permission("blog.manage"))):
    """Create a new blog category with custom header text, comment policy, and RSS settings."""
    name = body.name.strip()
    if not name:
        raise HTTPException(status_code=400, detail="Category name is required")
    with pool.connection() as conn:
        slug = _unique_slug(conn, "blog_categories", body.slug or name, "category")
        row = conn.execute(
            f"INSERT INTO blog_categories "
            "(slug, name, description, header_text, comment_policy, allow_subscriptions, "
            " rss_policy, show_on_home, sort_order, is_public) "
            "VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s) "
            f"RETURNING {_CAT_COLS}",
            (
                slug,
                name,
                body.description.strip(),
                body.header_text.strip(),
                body.comment_policy,
                body.allow_subscriptions,
                body.rss_policy,
                body.show_on_home,
                body.sort_order,
                body.is_public,
            ),
        ).fetchone()
    record_audit(user["username"], "blog.category_create", f"Created blog category '{name}'")
    return _row_to_category(row)


@router.patch("/categories/{category_id}")
def update_category(
    category_id: int,
    body: CategoryPatch,
    user: dict = Depends(require_permission("blog.manage")),
):
    """Update an existing blog category."""
    if body.name is not None and not body.name.strip():
        raise HTTPException(status_code=400, detail="Category name cannot be empty")
    with pool.connection() as conn:
        row = conn.execute(
            f"UPDATE blog_categories SET "
            "name = COALESCE(%s, name), "
            "description = COALESCE(%s, description), "
            "header_text = COALESCE(%s, header_text), "
            "comment_policy = COALESCE(%s, comment_policy), "
            "allow_subscriptions = COALESCE(%s, allow_subscriptions), "
            "rss_policy = COALESCE(%s, rss_policy), "
            "show_on_home = COALESCE(%s, show_on_home), "
            "sort_order = COALESCE(%s, sort_order), "
            "is_public = COALESCE(%s, is_public), "
            "updated_at = now() "
            f"WHERE id = %s RETURNING {_CAT_COLS}",
            (
                body.name.strip() if body.name is not None else None,
                body.description.strip() if body.description is not None else None,
                body.header_text.strip() if body.header_text is not None else None,
                body.comment_policy,
                body.allow_subscriptions,
                body.rss_policy,
                body.show_on_home,
                body.sort_order,
                body.is_public,
                category_id,
            ),
        ).fetchone()
        if not row:
            raise HTTPException(status_code=404, detail="Blog category not found")
    record_audit(user["username"], "blog.category_update", f"Updated blog category #{category_id}")
    return _row_to_category(row)


@router.delete("/categories/{category_id}")
def delete_category(category_id: int, user: dict = Depends(require_permission("blog.manage"))):
    """Delete a blog category, its posts/comments, and clean up stored images."""
    with pool.connection() as conn:
        cat_row = conn.execute(
            "SELECT id, name, image_key FROM blog_categories WHERE id = %s",
            (category_id,),
        ).fetchone()
        if not cat_row:
            raise HTTPException(status_code=404, detail="Blog category not found")
        post_imgs = conn.execute(
            "SELECT image_key FROM blog_posts WHERE category_id = %s AND image_key <> ''",
            (category_id,),
        ).fetchall()
        conn.execute("DELETE FROM blog_categories WHERE id = %s", (category_id,))
    keys = [k for k in ([cat_row[2]] + [r[0] for r in post_imgs]) if k]
    _remove_minio_objects(keys)
    record_audit(user["username"], "blog.category_delete", f"Deleted blog category #{category_id}: {cat_row[1]}")
    return {"deleted": True, "id": category_id}


async def _upload_validated_image(file: UploadFile, prefix: str) -> tuple[str, str, str]:
    raw = await file.read()
    if not raw or len(raw) > _MAX_IMAGE_BYTES:
        raise HTTPException(status_code=400, detail="Image must be non-empty and under 10 MB")
    detected = detect_safe_image_type(raw)
    if not detected:
        raise HTTPException(status_code=400, detail="Only PNG, JPEG, GIF, or WEBP images are supported")
    ext, ctype = detected
    orig = _SAFE_FILE_RE.sub("_", os.path.basename(file.filename or f"image.{ext}")) or f"image.{ext}"
    obj_key = tenant_object_key(f"{prefix}/{uuid.uuid4().hex[:12]}-{orig}")
    _minio().put_object(_bucket(), obj_key, io.BytesIO(raw), length=len(raw), content_type=ctype)
    return obj_key, orig, ctype


@router.post("/categories/{category_id}/image")
async def upload_category_image(
    category_id: int,
    file: UploadFile = File(...),
    user: dict = Depends(require_permission("blog.manage")),
):
    """Upload a header image for a blog category."""
    with pool.connection() as conn:
        existing = conn.execute(
            "SELECT image_key FROM blog_categories WHERE id = %s",
            (category_id,),
        ).fetchone()
        if not existing:
            raise HTTPException(status_code=404, detail="Blog category not found")
        old_key = existing[0]
    obj_key, orig, _ = await _upload_validated_image(file, f"blog/categories/{category_id}")
    with pool.connection() as conn:
        row = conn.execute(
            f"UPDATE blog_categories SET image_key = %s, image_filename = %s, updated_at = now() "
            f"WHERE id = %s RETURNING {_CAT_COLS}",
            (obj_key, orig, category_id),
        ).fetchone()
    if old_key:
        _remove_minio_objects([old_key])
    record_audit(user["username"], "blog.category_image", f"Uploaded {orig} to category #{category_id}")
    return _row_to_category(row)


@router.delete("/categories/{category_id}/image")
def delete_category_image(category_id: int, user: dict = Depends(require_permission("blog.manage"))):
    """Remove the header image from a blog category."""
    with pool.connection() as conn:
        existing = conn.execute(
            "SELECT image_key FROM blog_categories WHERE id = %s",
            (category_id,),
        ).fetchone()
        if not existing:
            raise HTTPException(status_code=404, detail="Blog category not found")
        old_key = existing[0]
        row = conn.execute(
            f"UPDATE blog_categories SET image_key = '', image_filename = '', updated_at = now() "
            f"WHERE id = %s RETURNING {_CAT_COLS}",
            (category_id,),
        ).fetchone()
    if old_key:
        _remove_minio_objects([old_key])
    record_audit(user["username"], "blog.category_image_delete", f"Removed image from category #{category_id}")
    return _row_to_category(row)


@router.get("/posts")
def list_posts(
    category_id: int | None = None,
    status: str = "",
    q: str = "",
    _: dict = Depends(require_permission("blog.manage")),
):
    """List all blog posts (including drafts, scheduled, and expired) for staff."""
    clauses: list[str] = []
    params: list = []
    if category_id is not None:
        clauses.append("p.category_id = %s")
        params.append(category_id)
    if q.strip():
        like = f"%{q.strip()}%"
        clauses.append("(p.title ILIKE %s OR p.lead_in ILIKE %s OR p.body ILIKE %s OR p.tags::text ILIKE %s)")
        params.extend([like, like, like, like])
    where = ("WHERE " + " AND ".join(clauses)) if clauses else ""
    with pool.connection() as conn:
        rows = conn.execute(
            f"SELECT {_POST_JOIN_COLS} FROM blog_posts p "
            "JOIN blog_categories c ON c.id = p.category_id "
            f"{_POST_COMMENT_COUNTS_JOIN} "
            f"{where} "
            "ORDER BY p.is_featured DESC, p.publish_at DESC, p.id DESC LIMIT 300",
            tuple(params),
        ).fetchall()
    posts = [_row_to_post(r) for r in rows]
    st_clean = status.strip().lower()
    if st_clean in ("draft", "scheduled", "expired", "published"):
        posts = [p for p in posts if p["computed_status"] == st_clean]
    return posts


def _maybe_notify_on_publish(
    post: dict,
    *,
    send_subscribers: bool,
    request: Request,
) -> None:
    if post["computed_status"] != "published" or not post["category_is_public"]:
        return
    link_path = f"/#blog/{post['slug']}"
    summary_text = post["lead_in"] or post["title"]
    send_notification_email(
        "blog_published",
        f"[DocketHall] New Blog Post: {post['title']}",
        f"A blog article was published in {post['category_name']}: {post['title']}\n\n{summary_text}",
        link_path=link_path,
        request=request,
    )
    if send_subscribers and post["category_allow_subscriptions"]:
        notify_topic_subscribers(
            "blog",
            f"[DocketHall] {post['category_name']}: {post['title']}",
            f"{post['title']}\n\n{summary_text}",
            link_path=link_path,
            request=request,
        )


@router.post("/posts", status_code=201)
def create_post(
    body: PostIn,
    request: Request,
    user: dict = Depends(require_permission("blog.manage")),
):
    """Create a blog post in a category with tags, rich text, scheduling, RSS, and alerts."""
    title = body.title.strip()
    if not title:
        raise HTTPException(status_code=400, detail="Post title is required")
    tags = normalize_tags(body.tags)
    pub_dt = _parse_publish_at(body.publish_at) or datetime.now(timezone.utc)
    exp_date = _parse_expires_at(body.expires_at)

    with pool.connection() as conn:
        cat = conn.execute(
            "SELECT id, rss_policy, allow_subscriptions FROM blog_categories WHERE id = %s",
            (body.category_id,),
        ).fetchone()
        if not cat:
            raise HTTPException(status_code=404, detail="Selected blog category not found")
        cat_rss = cat[1]
        in_rss = post_included_in_rss(cat_rss, body.include_in_rss)
        slug = _unique_slug(conn, "blog_posts", body.slug or title, "post")
        row_id = conn.execute(
            "INSERT INTO blog_posts "
            "(category_id, slug, title, lead_in, body, tags, author_name, is_featured, "
            " is_published, publish_at, expires_at, include_in_rss, comment_policy_override, created_by) "
            "VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s) RETURNING id",
            (
                body.category_id,
                slug,
                title,
                body.lead_in.strip(),
                body.body.strip(),
                Jsonb(tags),
                body.author_name.strip() or user["username"],
                body.is_featured,
                body.is_published,
                pub_dt,
                exp_date,
                in_rss,
                body.comment_policy_override,
                user["username"],
            ),
        ).fetchone()[0]
        full_row = conn.execute(
            f"SELECT {_POST_JOIN_COLS} FROM blog_posts p "
            "JOIN blog_categories c ON c.id = p.category_id "
            f"{_POST_COMMENT_COUNTS_JOIN} WHERE p.id = %s",
            (row_id,),
        ).fetchone()

    post = _row_to_post(full_row)
    record_audit(user["username"], "blog.post_create", f"Created blog post '{title}' ({post['computed_status']})")
    _maybe_notify_on_publish(post, send_subscribers=body.notify_subscribers, request=request)
    return post


@router.patch("/posts/{post_id}")
def update_post(
    post_id: int,
    body: PostPatch,
    request: Request,
    user: dict = Depends(require_permission("blog.manage")),
):
    """Update a blog post's content, category, schedule, RSS flag, or publish state."""
    if body.title is not None and not body.title.strip():
        raise HTTPException(status_code=400, detail="Post title cannot be empty")
    pub_dt = _parse_publish_at(body.publish_at) if body.publish_at is not None else None
    clear_exp = body.expires_at is not None and not body.expires_at.strip()
    exp_date = _parse_expires_at(body.expires_at) if (body.expires_at is not None and not clear_exp) else None
    tags_json = Jsonb(normalize_tags(body.tags)) if body.tags is not None else None

    with pool.connection() as conn:
        prev = conn.execute(
            "SELECT is_published, category_id FROM blog_posts WHERE id = %s",
            (post_id,),
        ).fetchone()
        if not prev:
            raise HTTPException(status_code=404, detail="Blog post not found")
        was_published = bool(prev[0])
        target_cat_id = body.category_id if body.category_id is not None else prev[1]
        cat_row = conn.execute(
            "SELECT rss_policy FROM blog_categories WHERE id = %s",
            (target_cat_id,),
        ).fetchone()
        if not cat_row:
            raise HTTPException(status_code=404, detail="Selected blog category not found")
        rss_val: bool | None = None
        if body.include_in_rss is not None or body.category_id is not None:
            cat_rss = cat_row[0]
            if cat_rss == "exclude":
                rss_val = False
            elif cat_rss == "include":
                rss_val = True
            elif body.include_in_rss is not None:
                rss_val = bool(body.include_in_rss)

        conn.execute(
            "UPDATE blog_posts SET "
            "category_id = COALESCE(%s, category_id), "
            "title = COALESCE(%s, title), "
            "lead_in = COALESCE(%s, lead_in), "
            "body = COALESCE(%s, body), "
            "tags = COALESCE(%s, tags), "
            "author_name = COALESCE(%s, author_name), "
            "is_featured = COALESCE(%s, is_featured), "
            "is_published = COALESCE(%s, is_published), "
            "publish_at = COALESCE(%s, publish_at), "
            "expires_at = CASE WHEN %s THEN NULL ELSE COALESCE(%s, expires_at) END, "
            "include_in_rss = COALESCE(%s, include_in_rss), "
            "comment_policy_override = COALESCE(%s, comment_policy_override), "
            "updated_at = now() "
            "WHERE id = %s",
            (
                body.category_id,
                body.title.strip() if body.title is not None else None,
                body.lead_in.strip() if body.lead_in is not None else None,
                body.body.strip() if body.body is not None else None,
                tags_json,
                body.author_name.strip() if body.author_name is not None else None,
                body.is_featured,
                body.is_published,
                pub_dt,
                clear_exp,
                exp_date,
                rss_val,
                body.comment_policy_override,
                post_id,
            ),
        )
        full_row = conn.execute(
            f"SELECT {_POST_JOIN_COLS} FROM blog_posts p "
            "JOIN blog_categories c ON c.id = p.category_id "
            f"{_POST_COMMENT_COUNTS_JOIN} WHERE p.id = %s",
            (post_id,),
        ).fetchone()

    post = _row_to_post(full_row)
    record_audit(user["username"], "blog.post_update", f"Updated blog post #{post_id}")
    if (not was_published and post["is_published"]) or (body.notify_subscribers and post["is_published"]):
        _maybe_notify_on_publish(post, send_subscribers=body.notify_subscribers, request=request)
    return post


@router.delete("/posts/{post_id}")
def delete_post(post_id: int, user: dict = Depends(require_permission("blog.manage"))):
    """Delete a blog post and remove its uploaded cover image."""
    with pool.connection() as conn:
        row = conn.execute(
            "DELETE FROM blog_posts WHERE id = %s RETURNING id, title, image_key",
            (post_id,),
        ).fetchone()
        if not row:
            raise HTTPException(status_code=404, detail="Blog post not found")
    if row[2]:
        _remove_minio_objects([row[2]])
    record_audit(user["username"], "blog.post_delete", f"Deleted blog post #{post_id}: {row[1]}")
    return {"deleted": True, "id": post_id}


@router.post("/posts/{post_id}/image")
async def upload_post_image(
    post_id: int,
    file: UploadFile = File(...),
    user: dict = Depends(require_permission("blog.manage")),
):
    """Upload a featured cover image for a blog post."""
    with pool.connection() as conn:
        existing = conn.execute("SELECT image_key FROM blog_posts WHERE id = %s", (post_id,)).fetchone()
        if not existing:
            raise HTTPException(status_code=404, detail="Blog post not found")
        old_key = existing[0]
    obj_key, orig, _ = await _upload_validated_image(file, f"blog/posts/{post_id}")
    with pool.connection() as conn:
        conn.execute(
            "UPDATE blog_posts SET image_key = %s, image_filename = %s, updated_at = now() WHERE id = %s",
            (obj_key, orig, post_id),
        )
        full_row = conn.execute(
            f"SELECT {_POST_JOIN_COLS} FROM blog_posts p "
            "JOIN blog_categories c ON c.id = p.category_id "
            f"{_POST_COMMENT_COUNTS_JOIN} WHERE p.id = %s",
            (post_id,),
        ).fetchone()
    if old_key:
        _remove_minio_objects([old_key])
    record_audit(user["username"], "blog.post_image", f"Uploaded {orig} to blog post #{post_id}")
    return _row_to_post(full_row)


@router.delete("/posts/{post_id}/image")
def delete_post_image(post_id: int, user: dict = Depends(require_permission("blog.manage"))):
    """Remove the featured cover image from a blog post."""
    with pool.connection() as conn:
        existing = conn.execute("SELECT image_key FROM blog_posts WHERE id = %s", (post_id,)).fetchone()
        if not existing:
            raise HTTPException(status_code=404, detail="Blog post not found")
        old_key = existing[0]
        conn.execute(
            "UPDATE blog_posts SET image_key = '', image_filename = '', updated_at = now() WHERE id = %s",
            (post_id,),
        )
        full_row = conn.execute(
            f"SELECT {_POST_JOIN_COLS} FROM blog_posts p "
            "JOIN blog_categories c ON c.id = p.category_id "
            f"{_POST_COMMENT_COUNTS_JOIN} WHERE p.id = %s",
            (post_id,),
        ).fetchone()
    if old_key:
        _remove_minio_objects([old_key])
    record_audit(user["username"], "blog.post_image_delete", f"Removed image from blog post #{post_id}")
    return _row_to_post(full_row)


@router.get("/comments")
def list_comments(
    status: str = "pending",
    post_id: int | None = None,
    _: dict = Depends(require_permission("blog.manage")),
):
    """List blog comments for staff moderation filtered by status or post."""
    clauses: list[str] = []
    params: list = []
    st = status.strip().lower()
    if st in COMMENT_STATUSES:
        clauses.append("cm.status = %s")
        params.append(st)
    if post_id is not None:
        clauses.append("cm.post_id = %s")
        params.append(post_id)
    where = ("WHERE " + " AND ".join(clauses)) if clauses else ""
    with pool.connection() as conn:
        rows = conn.execute(
            "SELECT cm.id, cm.post_id, cm.author_name, cm.author_email, cm.body, cm.status, "
            "       cm.moderated_by, cm.moderated_at, cm.created_at, p.title, p.slug, c.name "
            "FROM blog_comments cm "
            "JOIN blog_posts p ON p.id = cm.post_id "
            "JOIN blog_categories c ON c.id = p.category_id "
            f"{where} ORDER BY cm.created_at DESC, cm.id DESC LIMIT 300",
            tuple(params),
        ).fetchall()
        cnt_rows = conn.execute(
            "SELECT status, COUNT(*) FROM blog_comments GROUP BY status"
        ).fetchall()
    counts = {s: 0 for s in COMMENT_STATUSES}
    for s, n in cnt_rows:
        if s in counts:
            counts[s] = int(n)
    return {
        "counts": counts,
        "items": [
            {
                "id": r[0],
                "post_id": r[1],
                "author_name": r[2],
                "author_email": r[3],
                "body": r[4],
                "status": r[5],
                "moderated_by": r[6],
                "moderated_at": r[7].isoformat() if r[7] else None,
                "created_at": r[8].isoformat() if r[8] else None,
                "post_title": r[9],
                "post_slug": r[10],
                "category_name": r[11],
            }
            for r in rows
        ],
    }


@router.patch("/comments/{comment_id}")
def moderate_comment(
    comment_id: int,
    body: CommentModerateIn,
    user: dict = Depends(require_permission("blog.manage")),
):
    """Approve, reject, or return a blog comment to pending moderation."""
    with pool.connection() as conn:
        row = conn.execute(
            "UPDATE blog_comments SET status = %s, moderated_by = %s, moderated_at = now() "
            "WHERE id = %s RETURNING id, post_id, status, moderated_by, moderated_at",
            (body.status, user["username"], comment_id),
        ).fetchone()
        if not row:
            raise HTTPException(status_code=404, detail="Comment not found")
    record_audit(user["username"], "blog.comment_moderate", f"Set comment #{comment_id} -> {body.status}")
    return {
        "id": row[0],
        "post_id": row[1],
        "status": row[2],
        "moderated_by": row[3],
        "moderated_at": row[4].isoformat() if row[4] else None,
    }


@router.delete("/comments/{comment_id}")
def delete_comment(comment_id: int, user: dict = Depends(require_permission("blog.manage"))):
    """Permanently delete a blog comment."""
    with pool.connection() as conn:
        row = conn.execute(
            "DELETE FROM blog_comments WHERE id = %s RETURNING id, author_name",
            (comment_id,),
        ).fetchone()
        if not row:
            raise HTTPException(status_code=404, detail="Comment not found")
    record_audit(user["username"], "blog.comment_delete", f"Deleted comment #{comment_id} by {row[1]}")
    return {"deleted": True, "id": comment_id}
