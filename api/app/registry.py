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

"""Pluggable module registry for DocketHall."""
from dataclasses import dataclass, field
import os
from typing import Callable

from fastapi import APIRouter, Depends, HTTPException, Request
from psycopg.types.json import Jsonb
from pydantic import BaseModel

from .audit import record_audit
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
    features: list[dict] = field(default_factory=list)
    backup_tables: list[tuple[str, list[str], set[str], bool]] = field(default_factory=list)


_REGISTERED: dict[str, CivicModule] = {}

MODULE_PRESETS: dict[str, dict] = {
    "starter": {
        "label": "Starter Town",
        "description": "Essential city website & council basics: Agendas & Minutes, Website & Communications, and basic 311 Complaints.",
        "enabled_modules": ["agendas", "communications", "complaints"],
        "features": {
            "agendas": {"backlog": False, "council_submissions": False},
            "communications": {"bids": False, "jobs": False, "resources": False},
            "complaints": {"work_orders": False, "nov_enforcement": False},
        },
    },
    "standard": {
        "label": "Growing Municipality",
        "description": "Adds Online Permits, Public Records/FOIA, City Calendar, and Municipal Citations.",
        "enabled_modules": ["agendas", "permits", "records", "complaints", "calendar", "communications", "citations"],
        "features": {
            "agendas": {"backlog": True, "council_submissions": True},
            "permits": {"property_360": True, "reports": False},
            "records": {"foia_requests": True},
            "complaints": {"work_orders": True, "nov_enforcement": False},
            "calendar": {"reservations": False},
            "communications": {"bids": True, "jobs": True, "resources": True},
        },
    },
    "full": {
        "label": "Full Civic Suite",
        "description": "All 10 municipal modules and every advanced capability enabled (Licensing, Utility Billing, Citations, Code, and Website & Comms).",
        "enabled_modules": None,  # all registered modules
        "features": {},  # all features true
    },
}

SCHEMA = """
CREATE TABLE IF NOT EXISTS core_modules (
    module_id   TEXT PRIMARY KEY,
    enabled     BOOLEAN NOT NULL DEFAULT TRUE,
    features    JSONB NOT NULL DEFAULT '{}'::jsonb,
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE core_modules ADD COLUMN IF NOT EXISTS features JSONB NOT NULL DEFAULT '{}'::jsonb;
"""


def register_module(mod: CivicModule) -> None:
    _REGISTERED[mod.id] = mod


def _default_enabled_set() -> set[str]:
    raw = os.environ.get("ENABLED_MODULES", "agendas,permits,codification,records,complaints,calendar")
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


def get_all_module_features() -> dict[str, dict[str, bool]]:
    stored: dict[str, dict] = {}
    try:
        with pool.connection() as conn:
            rows = conn.execute("SELECT module_id, features FROM core_modules").fetchall()
        for mid, feats in rows:
            if isinstance(feats, dict):
                stored[mid] = feats
    except Exception:
        pass
    out: dict[str, dict[str, bool]] = {}
    for mid, mod in _REGISTERED.items():
        mod_stored = stored.get(mid, {})
        out[mid] = {
            f["key"]: bool(mod_stored[f["key"]]) if f["key"] in mod_stored else bool(f.get("default", True))
            for f in mod.features
        }
    return out


def get_module_features(module_id: str) -> dict[str, bool]:
    return get_all_module_features().get(module_id, {})


def is_feature_enabled(module_id: str, feature_key: str) -> bool:
    if not is_module_enabled(module_id):
        return False
    return get_module_features(module_id).get(feature_key, True)


def require_feature_enabled(module_id: str, feature_key: str):
    def _dep():
        if not is_feature_enabled(module_id, feature_key):
            raise HTTPException(status_code=404, detail=f'Feature "{feature_key}" in "{module_id}" is disabled')
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
    enabled: bool | None = None
    features: dict[str, bool] | None = None


class PresetApplyIn(BaseModel):
    preset: str


@router.get("/modules/public")
def list_public_modules():
    """Return IDs of currently enabled modules and their enabled sub-features for the public portal."""
    enabled_ids = get_enabled_module_ids()
    all_feats = get_all_module_features()
    return {
        "enabled": enabled_ids,
        "features": {mid: all_feats.get(mid, {}) for mid in enabled_ids},
    }


@router.get("/modules")
def list_modules(request: Request):
    user = current_user(request)
    if not user:
        raise HTTPException(status_code=401, detail="Not authenticated")

    all_feats = get_all_module_features()
    modules_out = []
    for mod in get_enabled_modules():
        mod_feats = all_feats.get(mod.id, {})
        visible_groups = []
        for grp in mod.nav_groups:
            req_perm = grp.get("permission")
            if req_perm and not has_permission(user, req_perm):
                continue
            visible_items = []
            for it in grp.get("items", []):
                if it.get("permission") and not has_permission(user, it["permission"]):
                    continue
                feat_key = it.get("feature")
                if feat_key and not mod_feats.get(feat_key, True):
                    continue
                visible_items.append(it)
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
            "enabled_features": mod_feats,
            "nav_groups": visible_groups,
        })

    return {
        "modules": modules_out,
        "permissions_catalog": all_permissions_catalog(),
    }


@router.get("/modules/admin")
def list_modules_admin(_: dict = Depends(require_admin)):
    enabled_ids = set(get_enabled_module_ids())
    all_feats = get_all_module_features()
    return [
        {
            "id": mod.id,
            "name": mod.name,
            "description": mod.description,
            "enabled": mod.id in enabled_ids,
            "permissions": mod.permissions,
            "features": [
                {
                    "key": f["key"],
                    "label": f["label"],
                    "description": f.get("description", ""),
                    "default": bool(f.get("default", True)),
                    "enabled": all_feats.get(mod.id, {}).get(f["key"], bool(f.get("default", True))),
                }
                for f in mod.features
            ],
        }
        for mod in get_all_registered_modules()
    ]


@router.get("/modules/admin/presets")
def list_module_presets(_: dict = Depends(require_admin)):
    return [
        {
            "id": pid,
            "label": p["label"],
            "description": p["description"],
            "enabled_modules": p["enabled_modules"] if p["enabled_modules"] is not None else list(_REGISTERED.keys()),
        }
        for pid, p in MODULE_PRESETS.items()
    ]


@router.post("/modules/admin/preset")
def apply_module_preset(body: PresetApplyIn, admin: dict = Depends(require_admin)):
    preset = MODULE_PRESETS.get(body.preset)
    if not preset:
        raise HTTPException(status_code=400, detail="Unknown preset")
    enabled_set = set(preset["enabled_modules"]) if preset["enabled_modules"] is not None else set(_REGISTERED.keys())
    feat_overrides = preset.get("features") or {}
    with pool.connection() as conn:
        for mid, mod in _REGISTERED.items():
            is_on = mid in enabled_set
            if body.preset == "full":
                feats_map = {f["key"]: True for f in mod.features}
            else:
                ov = feat_overrides.get(mid, {})
                feats_map = {f["key"]: bool(ov.get(f["key"], f.get("default", True))) for f in mod.features}
            conn.execute(
                "INSERT INTO core_modules (module_id, enabled, features, updated_at) "
                "VALUES (%s, %s, %s, now()) "
                "ON CONFLICT (module_id) DO UPDATE SET enabled = EXCLUDED.enabled, features = EXCLUDED.features, updated_at = now()",
                (mid, is_on, Jsonb(feats_map)),
            )
    record_audit(admin["username"], "module.preset_applied", "modules", body.preset, f"Applied module preset '{body.preset}'")
    return list_modules_admin()


@router.patch("/modules/admin/{module_id}")
def toggle_module_admin(
    module_id: str,
    body: ModuleToggleIn,
    admin: dict = Depends(require_admin),
):
    if module_id not in _REGISTERED:
        raise HTTPException(status_code=404, detail="Module not found")
    mod = _REGISTERED[module_id]
    valid_keys = {f["key"] for f in mod.features}
    with pool.connection() as conn:
        cur = conn.execute(
            "SELECT enabled, features FROM core_modules WHERE module_id = %s",
            (module_id,),
        ).fetchone()
        cur_enabled = bool(cur[0]) if cur else True
        cur_feats = dict(cur[1]) if (cur and isinstance(cur[1], dict)) else {}

        new_enabled = cur_enabled if body.enabled is None else bool(body.enabled)
        if body.features is not None:
            for k, v in body.features.items():
                if k in valid_keys:
                    cur_feats[k] = bool(v)

        conn.execute(
            "INSERT INTO core_modules (module_id, enabled, features, updated_at) "
            "VALUES (%s, %s, %s, now()) "
            "ON CONFLICT (module_id) DO UPDATE SET enabled = EXCLUDED.enabled, features = EXCLUDED.features, updated_at = now()",
            (module_id, new_enabled, Jsonb(cur_feats)),
        )
    if body.enabled is not None:
        record_audit(
            admin["username"],
            "module.enabled" if new_enabled else "module.disabled",
            "modules",
            module_id,
            f"{'Enabled' if new_enabled else 'Disabled'} module '{module_id}'",
        )
    if body.features is not None:
        record_audit(
            admin["username"],
            "module.features_updated",
            "modules",
            module_id,
            f"Updated features for '{module_id}': {body.features}",
        )
    return list_modules_admin()
