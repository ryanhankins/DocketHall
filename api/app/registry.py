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
from pydantic import BaseModel

from .auth import current_user, has_permission, require_admin
from .db import pool


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

SCHEMA = """
CREATE TABLE IF NOT EXISTS core_modules (
    module_id   TEXT PRIMARY KEY,
    enabled     BOOLEAN NOT NULL DEFAULT TRUE,
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
"""


def register_module(mod: CivicModule) -> None:
    _REGISTERED[mod.id] = mod


def _default_enabled_set() -> set[str]:
    raw = os.environ.get("ENABLED_MODULES", "agendas,permits,codification")
    return {m.strip() for m in raw.split(",") if m.strip()}


def bootstrap() -> None:
    defaults = _default_enabled_set()
    with pool.connection() as conn:
        conn.execute("SELECT pg_advisory_xact_lock(424246)")
        conn.execute(SCHEMA)
        for mid in _REGISTERED:
            conn.execute(
                "INSERT INTO core_modules (module_id, enabled) "
                "VALUES (%s, %s) ON CONFLICT (module_id) DO NOTHING",
                (mid, mid in defaults),
            )


def get_enabled_module_ids() -> list[str]:
    try:
        with pool.connection() as conn:
            rows = conn.execute(
                "SELECT module_id FROM core_modules WHERE enabled = TRUE"
            ).fetchall()
        enabled = {r[0] for r in rows}
        return [mid for mid in _REGISTERED if mid in enabled]
    except Exception:
        defaults = _default_enabled_set()
        return [mid for mid in _REGISTERED if mid in defaults]


def get_all_registered_modules() -> list[CivicModule]:
    return list(_REGISTERED.values())


def get_enabled_modules() -> list[CivicModule]:
    enabled_ids = set(get_enabled_module_ids())
    return [m for mid, m in _REGISTERED.items() if mid in enabled_ids]


def is_module_enabled(module_id: str) -> bool:
    return module_id in set(get_enabled_module_ids())


def require_module_enabled(module_id: str):
    def _dep():
        if not is_module_enabled(module_id):
            raise HTTPException(status_code=404, detail=f'Module "{module_id}" is disabled')
    return _dep


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


class ModuleToggleIn(BaseModel):
    enabled: bool


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


@router.get("/modules/admin")
def list_modules_admin(_: dict = Depends(require_admin)):
    enabled_ids = set(get_enabled_module_ids())
    return [
        {
            "id": mod.id,
            "name": mod.name,
            "description": mod.description,
            "enabled": mod.id in enabled_ids,
            "permissions": mod.permissions,
        }
        for mod in get_all_registered_modules()
    ]


@router.patch("/modules/admin/{module_id}")
def toggle_module_admin(
    module_id: str,
    body: ModuleToggleIn,
    _: dict = Depends(require_admin),
):
    if module_id not in _REGISTERED:
        raise HTTPException(status_code=404, detail="Module not found")
    with pool.connection() as conn:
        conn.execute(
            "INSERT INTO core_modules (module_id, enabled, updated_at) "
            "VALUES (%s, %s, now()) "
            "ON CONFLICT (module_id) DO UPDATE SET enabled = EXCLUDED.enabled, updated_at = now()",
            (module_id, body.enabled),
        )
    return list_modules_admin()
