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

"""Website & Communications module (Blog, Notices/Bids/Jobs, Directory/FAQs, City Pages, Forms/Polls)."""
from .. import blog, directory, forms, notices, pages
from ..registry import CivicModule

COMMUNICATIONS_BACKUP_TABLES: list[tuple[str, list[str], set[str], bool]] = [
    (
        "city_notices",
        [
            "id", "title", "category", "summary", "body", "department",
            "contact_info", "attachment_url", "attachment_key", "attachment_filename",
            "publish_at", "expires_at",
            "deadline_at", "is_pinned", "is_published", "created_by",
            "created_at", "updated_at",
        ],
        set(),
        True,
    ),
    (
        "city_notice_responses",
        [
            "id", "notice_id", "response_type", "applicant_name", "applicant_email",
            "applicant_phone", "organization", "cover_note", "created_at",
        ],
        set(),
        True,
    ),
    (
        "city_directory_entries",
        [
            "id", "name", "title_role", "department", "email", "phone",
            "office_hours", "notes", "is_elected", "sort_order", "is_public", "created_at",
        ],
        set(),
        True,
    ),
    (
        "city_faqs",
        ["id", "question", "answer", "category", "sort_order", "is_public", "created_at", "updated_at"],
        set(),
        True,
    ),
    (
        "city_community_resources",
        [
            "id", "name", "category", "description", "address", "phone", "email",
            "website_url", "hours", "is_featured", "sort_order", "is_public",
            "created_at", "updated_at",
        ],
        set(),
        True,
    ),
    (
        "city_board_members",
        [
            "id", "board_name", "seat_name", "member_name", "email",
            "term_start", "term_end", "is_vacant", "is_public", "sort_order", "notes", "created_at",
        ],
        set(),
        True,
    ),
    (
        "city_pages",
        ["id", "slug", "title", "summary", "body", "category", "sort_order", "is_public", "updated_by", "created_at", "updated_at"],
        set(),
        True,
    ),
    (
        "city_quick_links",
        ["id", "label", "description", "url", "sort_order", "is_public", "created_at"],
        set(),
        True,
    ),
    (
        "city_forms",
        [
            "id", "slug", "title", "form_kind", "description", "fields",
            "allow_anonymous", "show_poll_results", "closes_at",
            "is_public", "sort_order", "created_by", "created_at", "updated_at",
        ],
        {"fields"},
        True,
    ),
    (
        "city_form_submissions",
        ["id", "form_id", "submitter_name", "submitter_email", "responses", "status", "staff_notes", "created_at"],
        {"responses"},
        True,
    ),
    (
        "blog_categories",
        [
            "id", "slug", "name", "description", "header_text", "image_key", "image_filename",
            "comment_policy", "allow_subscriptions", "rss_policy", "show_on_home",
            "sort_order", "is_public", "created_at", "updated_at",
        ],
        set(),
        True,
    ),
    (
        "blog_posts",
        [
            "id", "category_id", "slug", "title", "lead_in", "body", "tags", "author_name",
            "image_key", "image_filename", "is_featured", "is_published", "publish_at",
            "expires_at", "include_in_rss", "comment_policy_override", "created_by",
            "created_at", "updated_at",
        ],
        {"tags"},
        True,
    ),
    (
        "blog_comments",
        [
            "id", "post_id", "author_name", "author_email", "body", "status",
            "moderated_by", "moderated_at", "created_at",
        ],
        set(),
        True,
    ),
]


def _bootstrap_communications() -> None:
    notices.bootstrap()
    directory.bootstrap()
    pages.bootstrap()
    forms.bootstrap()
    blog.bootstrap()


MODULE = CivicModule(
    id="communications",
    name="Website & Communications",
    description="Publish blog articles, news, bids & jobs, staff/board directory & FAQs, custom city pages, and online forms/polls.",
    routers=[notices.router, directory.router, pages.router, forms.router, blog.router],
    bootstrap=_bootstrap_communications,
    permissions=[
        {"key": "blog.manage", "label": "Manage Blog Categories, Posts & Comments"},
        {"key": "notices.manage", "label": "Manage City News, Public Notices, Bids & Jobs"},
        {"key": "directory.manage", "label": "Manage Staff/Council Directory & Public FAQs"},
        {"key": "pages.manage", "label": "Manage City Info Pages & Quick Links"},
        {"key": "forms.manage", "label": "Manage Custom Forms, Polls & Submissions"},
    ],
    features=[
        {"key": "blog", "label": "Municipal Blog & Community Articles", "description": "Publish rich-text blog posts, category custom text, RSS feeds, and moderated resident comments.", "default": True},
        {"key": "bids", "label": "Bids, RFPs & Solicitations", "description": "Publish procurement solicitations and bid deadlines.", "default": True},
        {"key": "jobs", "label": "Job Postings", "description": "Publish municipal employment openings.", "default": True},
        {"key": "resources", "label": "Community Resources & Local Businesses", "description": "Directory of local businesses, nonprofits, utilities, and schools.", "default": True},
    ],
    nav_groups=[
        {
            "id": "communications-staff",
            "label": "Website & Comms",
            "section_title": "Staff",
            "items": [
                {"section": "blog-manage", "label": "Blog & Articles", "permission": "blog.manage", "feature": "blog"},
                {"section": "notices-manage", "label": "News, Notices, Bids & Jobs", "permission": "notices.manage"},
                {"section": "directory-manage", "label": "Directory & FAQs", "permission": "directory.manage"},
                {"section": "pages-manage", "label": "City Pages & Quick Links", "permission": "pages.manage"},
                {"section": "forms-manage", "label": "Forms & Opinion Polls", "permission": "forms.manage"},
            ],
        },
    ],
    backup_tables=COMMUNICATIONS_BACKUP_TABLES,
)
