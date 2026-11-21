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

"""Pytest fixtures for DocketHall backend API + Postgres integration tests."""

import os
import sys
import tempfile
from pathlib import Path

import pytest

API_ROOT = Path(__file__).resolve().parent.parent / "api"
if str(API_ROOT) not in sys.path:
    sys.path.insert(0, str(API_ROOT))


def _postgres_configured() -> bool:
    return bool(
        os.environ.get("CIVICDESK_TEST_PG")
        or (os.environ.get("POSTGRES_HOST") and os.environ.get("POSTGRES_DB"))
    )


@pytest.fixture(scope="session")
def test_storage_dir():
    """Isolated temporary storage directory for local object storage tests."""
    with tempfile.TemporaryDirectory(prefix="dockethall_test_storage_") as tmpdir:
        os.environ["STORAGE_BACKEND"] = "local"
        os.environ["STORAGE_LOCAL_DIR"] = tmpdir
        yield Path(tmpdir)


@pytest.fixture(scope="session")
def api_app(test_storage_dir):
    """Return FastAPI app instance when Postgres integration testing is enabled."""
    if not _postgres_configured():
        pytest.skip("Postgres test environment not configured (set CIVICDESK_TEST_PG=1)")
    os.environ.setdefault("DAILY_DIGEST_ENABLED", "false")
    from app.main import app  # noqa: WPS433

    return app


@pytest.fixture(scope="session")
def api_client(api_app):
    """Session-scoped FastAPI TestClient running app lifespan against test Postgres."""
    from fastapi.testclient import TestClient  # noqa: WPS433

    with TestClient(api_app) as client:
        yield client


@pytest.fixture()
def admin_client(api_app):
    """Authenticated TestClient logged in as the seeded admin user."""
    from fastapi.testclient import TestClient  # noqa: WPS433

    username = os.environ.get("CIVICDESK_TEST_ADMIN_USER", "admin")
    password = os.environ.get("CIVICDESK_TEST_ADMIN_PASS", "admin")
    with TestClient(api_app) as client:
        res = client.post("/api/login", json={"username": username, "password": password})
        assert res.status_code == 200, f"Admin login failed: {res.status_code} {res.text}"
        yield client


@pytest.fixture()
def anon_client(api_app):
    """Fresh unauthenticated TestClient."""
    from fastapi.testclient import TestClient  # noqa: WPS433

    with TestClient(api_app) as client:
        yield client


@pytest.fixture()
def applicant_client(api_app):
    """Authenticated TestClient registered as a low-privilege applicant user."""
    import uuid
    from fastapi.testclient import TestClient  # noqa: WPS433

    uname = f"test_applicant_{uuid.uuid4().hex[:8]}"
    with TestClient(api_app) as client:
        res = client.post(
            "/api/register",
            json={"username": uname, "email": f"{uname}@example.com", "password": "TestPassword123!"},
        )
        assert res.status_code == 201, f"Applicant register failed: {res.status_code} {res.text}"
        yield client
