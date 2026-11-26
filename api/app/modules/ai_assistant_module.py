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

"""AI Admin Assistant module definition."""
from .. import ai_assistant
from ..registry import CivicModule

AI_ASSISTANT_BACKUP_TABLES: list[tuple[str, list[str], set[str], bool]] = [
    (
        "permit_ai_reviews",
        ["id", "permit_id", "check_type", "model", "report", "created_by", "created_at"],
        set(),
        True,
    ),
    (
        "ai_daily_usage",
        ["usage_date", "prompt_tokens", "output_tokens", "request_count", "estimated_cost_usd", "updated_at"],
        set(),
        False,
    ),
]

MODULE = CivicModule(
    id="ai_assistant",
    name="AI Admin Assistant",
    description="Floating Gemini-powered chat assistant that answers questions from city documents and executes administrative actions across DocketHall.",
    routers=[],
    bootstrap=ai_assistant.ensure_ai_assistant_schema,
    permissions=[],
    features=[],
    nav_groups=[],
    backup_tables=AI_ASSISTANT_BACKUP_TABLES,
)
