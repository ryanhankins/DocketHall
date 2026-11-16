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

"""Pluggable module registry for CivicDesk."""
from dataclasses import dataclass, field
import os
from typing import Callable

from fastapi import APIRouter, Depends, HTTPException, Request

from .auth import current_user, has_permission


@dataclass
class CivicModule:
    id: str
    name: str
    description: str
    routers: list[APIRouter] = field(default_factory=list)
    bootstrap: Callable[[], None] = lambda: None
    permissions: list[dict] = field(default_factory=list)
    nav_groups: list[dict] = field(default_factory=list)
    backup_tables: list[tuple[str, list[str], set[str], bool]] = field(default_factory=list)


_REGISTERED: dict[str, CivicModule] = {}


def register_module(mod: CivicModule) -> None:
    _REGISTERED[mod.id] = mod


def get_enabled_module_ids() -> list[str]:
    raw = os.environ.get("ENABLED_MODULES", "agendas,permits,codification")
    return [m.strip() for m in raw.split(",") if m.strip()]


def get_enabled_modules() -> list[CivicModule]:
    return [_REGISTERED[mid] for mid in get_enabled_module_ids() if mid in _REGISTERED]


def all_permissions_catalog() -> list[dict]:
    perms: list[dict] = [
        {"module": "core", "key": "settings.manage", "label": "Manage General Preferences & Backups"},
    ]
    for mod in get_enabled_modules():
        for p in mod.permissions:
            perms.append({"module": mod.id, **p})
    return perms


def get_module_backup_tables() -> list[tuple[str, list[str], set[str], bool]]:
    tables: list[tuple[str, list[str], set[str], bool]] = []
    for mod in get_enabled_modules():
        tables.extend(mod.backup_tables)
    return tables


router = APIRouter(prefix="/api", tags=["modules"])


@router.get("/modules")
def list_modules(request: Request):
    user = current_user(request)
    if not user:
        raise HTTPException(status_code=401, detail="Not authenticated")

    modules_out = []
    for mod in get_enabled_modules():
        visible_groups = []
        for grp in mod.nav_groups:
            req_perm = grp.get("permission")
            if req_perm and not has_permission(user, req_perm):
                continue
            visible_items = [
                it for it in grp.get("items", [])
                if not it.get("permission") or has_permission(user, it["permission"])
            ]
            if visible_items:
                visible_groups.append({
                    "id": grp["id"],
                    "label": grp["label"],
                    "section_title": grp.get("section_title", mod.name),
                    "items": visible_items,
                })
        modules_out.append({
            "id": mod.id,
            "name": mod.name,
            "description": mod.description,
            "nav_groups": visible_groups,
        })

    return {
        "modules": modules_out,
        "permissions_catalog": all_permissions_catalog(),
    }
