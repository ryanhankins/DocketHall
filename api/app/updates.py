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

"""System version check and host-assisted upgrade trigger endpoints."""
from datetime import datetime, timezone
import json
import os
import urllib.error
import urllib.request

from fastapi import APIRouter, Depends, HTTPException

from .audit import record_audit
from .auth import require_admin

router = APIRouter(prefix="/api/system", tags=["system"])

UPGRADE_DIR = os.environ.get("CIVICDESK_UPGRADE_DIR", "/upgrade")
GITHUB_REPO = os.environ.get("CIVICDESK_GITHUB_REPO", "ryanhankins/CivicDesk").strip()


def _current_commit() -> str:
    raw = os.environ.get("CIVICDESK_COMMIT", "unknown").strip()
    return raw[:7] if raw and raw != "unknown" else "unknown"


def _read_upgrade_state() -> tuple[bool, dict, str]:
    supported = (
        os.path.isdir(UPGRADE_DIR)
        and os.access(UPGRADE_DIR, os.W_OK)
        and os.path.exists(os.path.join(UPGRADE_DIR, ".host-watcher-enabled"))
    )
    status_path = os.path.join(UPGRADE_DIR, "status.json")
    log_path = os.path.join(UPGRADE_DIR, "upgrade.log")
    status_data: dict = {"state": "idle"}
    if os.path.exists(status_path):
        try:
            with open(status_path, "r", encoding="utf-8") as f:
                loaded = json.load(f)
                if isinstance(loaded, dict):
                    status_data = loaded
        except Exception:
            pass
    log_tail = ""
    if os.path.exists(log_path):
        try:
            with open(log_path, "r", encoding="utf-8", errors="replace") as f:
                lines = f.readlines()[-80:]
                log_tail = "".join(lines)
        except Exception:
            pass
    return supported, status_data, log_tail


def _fetch_github_commits(repo: str) -> tuple[list[dict], str]:
    if not repo or "/" not in repo:
        return [], "Invalid GitHub repository configured"
    url = f"https://api.github.com/repos/{repo}/commits?per_page=5"
    req = urllib.request.Request(
        url,
        headers={
            "Accept": "application/vnd.github+json",
            "User-Agent": "DocketHall-Updater",
        },
    )
    try:
        with urllib.request.urlopen(req, timeout=6) as resp:
            raw = json.loads(resp.read().decode("utf-8"))
        commits = []
        for item in raw if isinstance(raw, list) else []:
            sha = str(item.get("sha") or "")
            commit_info = item.get("commit") or {}
            msg = str(commit_info.get("message") or "").splitlines()[0]
            date_str = str((commit_info.get("author") or {}).get("date") or "")
            commits.append({
                "sha": sha[:7],
                "full_sha": sha,
                "message": msg,
                "date": date_str,
                "url": item.get("html_url") or "",
            })
        return commits, ""
    except urllib.error.HTTPError as e:
        return [], f"GitHub API HTTP {e.code}"
    except Exception as e:
        return [], str(e)


@router.get("/updates")
def get_system_updates(_: dict = Depends(require_admin)):
    current = _current_commit()
    commits, gh_error = _fetch_github_commits(GITHUB_REPO)
    latest = commits[0]["sha"] if commits else ""
    update_available = bool(latest and current != "unknown" and latest != current)
    supported, upgrade_status, upgrade_log = _read_upgrade_state()
    return {
        "repo": GITHUB_REPO,
        "current_commit": current,
        "latest_commit": latest or "unknown",
        "latest_message": commits[0]["message"] if commits else "",
        "latest_date": commits[0]["date"] if commits else "",
        "update_available": update_available,
        "recent_commits": commits,
        "github_error": gh_error,
        "upgrade_supported": supported,
        "upgrade_status": upgrade_status,
        "upgrade_log": upgrade_log,
    }


@router.post("/upgrade")
def trigger_system_upgrade(user: dict = Depends(require_admin)):
    supported, cur_status, _ = _read_upgrade_state()
    if not supported:
        raise HTTPException(
            status_code=400,
            detail="In-app upgrades require the host systemd updater (installed automatically by scripts/install-vps.sh).",
        )
    if cur_status.get("state") in ("queued", "running"):
        raise HTTPException(status_code=409, detail="An upgrade is already in progress.")

    now_iso = datetime.now(timezone.utc).isoformat()
    req_payload = {
        "requested_by": user.get("username", "admin"),
        "requested_at": now_iso,
    }
    status_payload = {
        "state": "queued",
        "requested_by": user.get("username", "admin"),
        "requested_at": now_iso,
        "message": "Upgrade queued for host updater...",
    }
    with open(os.path.join(UPGRADE_DIR, "status.json"), "w", encoding="utf-8") as f:
        json.dump(status_payload, f)
    with open(os.path.join(UPGRADE_DIR, "request.json"), "w", encoding="utf-8") as f:
        json.dump(req_payload, f)
    try:
        record_audit(user.get("username", "admin"), "system.upgrade_requested", "Requested in-app DocketHall upgrade")
    except Exception:
        pass
    return {"queued": True, "upgrade_status": status_payload}
