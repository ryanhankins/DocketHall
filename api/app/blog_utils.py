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

"""Pure helper functions for municipal blog posts, moderation, images, and RSS feeds."""
from __future__ import annotations

from datetime import date, datetime, timezone
from email.utils import format_datetime
import re
import xml.etree.ElementTree as ET

COMMENT_POLICIES = ("disabled", "moderated", "open")
POST_COMMENT_OVERRIDES = ("inherit", "disabled", "moderated", "open")
RSS_POLICIES = ("always_ask", "include", "exclude")
COMMENT_STATUSES = ("pending", "approved", "rejected")

_EMAIL_RE = re.compile(r"^[^@\s]+@[^@\s]+\.[^@\s]+$")
_NON_ALNUM_RE = re.compile(r"[^a-z0-9]+")


def slugify(raw: str, fallback: str = "post", max_len: int = 72) -> str:
    """Return a URL-safe lowercase slug trimmed to max_len characters."""
    cleaned = _NON_ALNUM_RE.sub("-", (raw or "").strip().lower()).strip("-")
    if max_len > 0:
        cleaned = cleaned[:max_len].strip("-")
    return cleaned or fallback


def normalize_tags(raw: list[str] | str | None) -> list[str]:
    """Normalize tags from comma-separated text or list into deduplicated labels."""
    if raw is None:
        return []
    parts = raw.split(",") if isinstance(raw, str) else list(raw)
    out: list[str] = []
    seen: set[str] = set()
    for part in parts:
        clean = " ".join(str(part or "").split()).strip()
        if not clean:
            continue
        clean = clean[:40].strip()
        key = clean.lower()
        if key in seen:
            continue
        seen.add(key)
        out.append(clean)
        if len(out) >= 20:
            break
    return out


def effective_comment_policy(category_policy: str, post_override: str = "inherit") -> str:
    """Resolve the active comment policy for a post given its category and override."""
    cat_pol = category_policy if category_policy in COMMENT_POLICIES else "moderated"
    if post_override in COMMENT_POLICIES:
        return post_override
    return cat_pol


def _as_utc(dt: datetime) -> datetime:
    if dt.tzinfo is None:
        return dt.replace(tzinfo=timezone.utc)
    return dt.astimezone(timezone.utc)


def compute_post_status(
    is_published: bool,
    publish_at: datetime | None,
    expires_at: date | None,
    now_utc: datetime | None = None,
) -> str:
    """Return computed lifecycle status: draft, scheduled, expired, or published."""
    if not is_published:
        return "draft"
    ref = _as_utc(now_utc) if now_utc is not None else datetime.now(timezone.utc)
    if publish_at is not None and _as_utc(publish_at) > ref:
        return "scheduled"
    if expires_at is not None and expires_at < ref.date():
        return "expired"
    return "published"


def is_post_publicly_visible(
    is_published: bool,
    category_is_public: bool,
    publish_at: datetime | None,
    expires_at: date | None,
    now_utc: datetime | None = None,
) -> bool:
    """Return True when both category and post are published within the active schedule."""
    if not category_is_public:
        return False
    return compute_post_status(is_published, publish_at, expires_at, now_utc) == "published"


def post_included_in_rss(category_rss_policy: str, post_include_in_rss: bool) -> bool:
    """Determine whether a post appears in RSS feeds based on category policy and post flag."""
    if category_rss_policy == "exclude":
        return False
    if category_rss_policy == "include":
        return True
    return bool(post_include_in_rss)


def detect_safe_image_type(data: bytes) -> tuple[str, str] | None:
    """Inspect binary header bytes and allow only PNG, JPEG, GIF, or WEBP images."""
    if not data or len(data) < 12:
        return None
    if data.startswith(b"\x89PNG\r\n\x1a\n"):
        return ("png", "image/png")
    if data.startswith(b"\xff\xd8\xff"):
        return ("jpg", "image/jpeg")
    if data.startswith((b"GIF87a", b"GIF89a")):
        return ("gif", "image/gif")
    if data[:4] == b"RIFF" and data[8:12] == b"WEBP":
        return ("webp", "image/webp")
    return None


def validate_comment_input(author_name: str, author_email: str, body: str) -> tuple[str, str, str]:
    """Validate and clean a public blog comment submission."""
    name = " ".join((author_name or "").split()).strip()
    email = (author_email or "").strip().lower()
    text = (body or "").strip()
    if len(name) < 1 or len(name) > 120:
        raise ValueError("Name is required and must be 120 characters or fewer.")
    if email:
        if len(email) > 254 or not _EMAIL_RE.match(email):
            raise ValueError("Please enter a valid email address or leave email blank.")
    if len(text) < 2 or len(text) > 4000:
        raise ValueError("Comment must be between 2 and 4,000 characters.")
    return name, email, text


def _strip_markdown_summary(text: str, max_len: int = 500) -> str:
    plain = re.sub(r"!\[([^\]]*)\]\([^)]+\)", r"\1", text or "")
    plain = re.sub(r"\[([^\]]+)\]\([^)]+\)", r"\1", plain)
    plain = re.sub(r"[#>*_`]+", " ", plain)
    plain = " ".join(plain.split())
    if len(plain) > max_len:
        return plain[: max_len - 1].rstrip() + "…"
    return plain


def build_rss_xml(
    channel_title: str,
    channel_link: str,
    channel_description: str,
    items: list[dict],
) -> str:
    """Build valid UTF-8 RSS 2.0 XML for published blog posts."""
    rss = ET.Element("rss", {"version": "2.0"})
    channel = ET.SubElement(rss, "channel")
    ET.SubElement(channel, "title").text = channel_title or "Community Blog"
    ET.SubElement(channel, "link").text = channel_link or "/"
    ET.SubElement(channel, "description").text = channel_description or "Municipal updates and community articles."
    ET.SubElement(channel, "lastBuildDate").text = format_datetime(datetime.now(timezone.utc))

    for it in items:
        item_el = ET.SubElement(channel, "item")
        ET.SubElement(item_el, "title").text = str(it.get("title") or "Untitled Post")
        link = str(it.get("link") or channel_link or "/")
        ET.SubElement(item_el, "link").text = link
        guid = ET.SubElement(item_el, "guid", {"isPermaLink": "true"})
        guid.text = str(it.get("guid") or link)

        pub_dt = it.get("pub_date")
        if isinstance(pub_dt, datetime):
            ET.SubElement(item_el, "pubDate").text = format_datetime(_as_utc(pub_dt))

        author = str(it.get("author") or "").strip()
        if author:
            ET.SubElement(item_el, "author").text = author

        cat_name = str(it.get("category") or "").strip()
        if cat_name:
            ET.SubElement(item_el, "category").text = cat_name

        for tag in it.get("tags") or []:
            clean_tag = str(tag or "").strip()
            if clean_tag:
                ET.SubElement(item_el, "category").text = clean_tag

        desc = str(it.get("lead_in") or "").strip() or _strip_markdown_summary(str(it.get("body") or ""))
        ET.SubElement(item_el, "description").text = desc

    xml_bytes = ET.tostring(rss, encoding="utf-8", xml_declaration=True)
    return xml_bytes.decode("utf-8")
