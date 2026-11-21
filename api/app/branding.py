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

"""Core site branding & general preferences endpoints."""
from typing import Literal

from fastapi import APIRouter, Depends, File, UploadFile
from pydantic import BaseModel

from . import agendas
from .auth import require_permission

router = APIRouter(prefix="/api/branding", tags=["branding"])


@router.get("")
def get_branding():
    return agendas.get_preferences_branding()


class HomeTextIn(BaseModel):
    home_heading: str = ""
    home_intro_body: str = ""
    home_blog_enabled: bool | None = None
    home_blog_count: int | None = None
    home_blog_style: Literal["cards", "full"] | None = None
    home_blog_position: Literal["above_services", "below_services"] | None = None
    home_blog_heading: str | None = None


@router.put("")
def update_branding(
    body: agendas.GeneralPreferencesIn,
    user: dict = Depends(require_permission("settings.manage", "agendas.manage")),
):
    return agendas.update_general_preferences(body, user)


@router.put("/home-text")
def update_branding_home_text(
    body: HomeTextIn,
    _: dict = Depends(require_permission("settings.manage", "pages.manage", "blog.manage", "agendas.manage")),
):
    return agendas.update_home_text(
        body.home_heading,
        body.home_intro_body,
        home_blog_enabled=body.home_blog_enabled,
        home_blog_count=body.home_blog_count,
        home_blog_style=body.home_blog_style,
        home_blog_position=body.home_blog_position,
        home_blog_heading=body.home_blog_heading,
    )


@router.get("/logo")
def get_branding_logo():
    return agendas.get_preferences_logo()


@router.post("/logo")
async def upload_branding_logo(
    file: UploadFile = File(...),
    user: dict = Depends(require_permission("settings.manage", "agendas.manage")),
):
    return await agendas.upload_preferences_logo(file=file, _=user)


@router.delete("/logo")
def delete_branding_logo(
    user: dict = Depends(require_permission("settings.manage", "agendas.manage")),
):
    return agendas.delete_preferences_logo(user)
