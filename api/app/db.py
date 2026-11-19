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

"""Postgres connection pool with schema-per-tenant search_path isolation."""
from contextlib import contextmanager
import os
import time

import psycopg
from psycopg_pool import ConnectionPool


def _read_secret(path_env: str, fallback_env: str) -> str:
    path = os.environ.get(path_env)
    if path and os.path.exists(path):
        with open(path) as f:
            return f.read().strip()
    return os.environ.get(fallback_env, "")


def conninfo() -> str:
    return psycopg.conninfo.make_conninfo(
        host=os.environ.get("POSTGRES_HOST", "db"),
        port=os.environ.get("POSTGRES_PORT", "5432"),
        dbname=os.environ.get("POSTGRES_DB", "civicdesk"),
        user=os.environ.get("POSTGRES_USER", "civicdesk"),
        password=_read_secret("POSTGRES_PASSWORD_FILE", "POSTGRES_PASSWORD"),
    )


_raw_pool = ConnectionPool(conninfo(), min_size=1, max_size=10, open=False)


@contextmanager
def raw_connection():
    """Checkout a connection pinned to the public schema (used for tenant lookup)."""
    with _raw_pool.connection() as conn:
        conn.execute("SET search_path TO public")
        if not conn.autocommit:
            conn.commit()
        yield conn


class _TenantAwarePool:
    """Drop-in wrapper around ConnectionPool that applies the active tenant schema."""

    @contextmanager
    def connection(self):
        from .tenancy import get_current_tenant_schema

        schema = get_current_tenant_schema()
        with _raw_pool.connection() as conn:
            conn.execute(f"SET search_path TO {schema}")
            if not conn.autocommit:
                conn.commit()
            try:
                yield conn
            finally:
                if schema != "public":
                    try:
                        if conn.autocommit or conn.info.transaction_status == psycopg.pq.TransactionStatus.IDLE:
                            conn.execute("SET search_path TO public")
                            if not conn.autocommit:
                                conn.commit()
                    except Exception:
                        pass

    def open(self, *args, **kwargs):
        return _raw_pool.open(*args, **kwargs)

    def close(self, *args, **kwargs):
        return _raw_pool.close(*args, **kwargs)


pool = _TenantAwarePool()


def open_pool(timeout_s: int = 60) -> None:
    """Open the pool, waiting for Postgres to come up (Swarm has no depends_on)."""
    deadline = time.monotonic() + timeout_s
    while True:
        try:
            _raw_pool.open(wait=True, timeout=5)
            return
        except Exception:
            if time.monotonic() > deadline:
                raise
            time.sleep(2)
