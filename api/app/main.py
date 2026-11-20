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

from contextlib import asynccontextmanager
import asyncio
import os

from fastapi import Depends, FastAPI, Request
from fastapi.responses import JSONResponse

from . import audit, auth, backup, branding, docs, integrations, payments, permits, registry, search, subscriptions, tenancy, updates, users
from .db import open_pool, pool
from .modules import register_builtin_modules

register_builtin_modules()


def _bootstrap_tenant_schema(slug: str, schema: str) -> None:
    with tenancy.tenant_context(slug, schema):
        auth.bootstrap()
        audit.bootstrap()
        integrations.bootstrap()
        subscriptions.bootstrap()
        docs.bootstrap()
        registry.bootstrap()
        for mod in registry.get_all_registered_modules():
            mod.bootstrap()


tenancy.register_schema_bootstrapper(_bootstrap_tenant_schema)


@asynccontextmanager
async def lifespan(app: FastAPI):
    open_pool()
    tenancy.bootstrap()
    tenants = tenancy.list_active_tenants() if tenancy.is_multi_tenant() else [("default", "public")]
    for slug, schema in tenants:
        _bootstrap_tenant_schema(slug, schema)
    digest_task = None
    if os.environ.get("DAILY_DIGEST_ENABLED", "").strip().lower() == "true":
        async def _digest_loop():
            while True:
                await asyncio.sleep(86400)
                try:
                    permits.run_daily_compliance_digest()
                except Exception:
                    pass
        digest_task = asyncio.create_task(_digest_loop())
    yield
    if digest_task:
        digest_task.cancel()
    pool.close()


app = FastAPI(title="CivicDesk API", lifespan=lifespan)


@app.middleware("http")
async def tenant_middleware(request: Request, call_next):
    path = request.url.path
    if path == "/api/health" or path.startswith("/api/platform/"):
        return await call_next(request)
    resolved = tenancy.resolve_tenant_for_request(
        request.headers.get("host", ""),
        request.headers.get("x-tenant-slug", ""),
    )
    if resolved is None:
        return JSONResponse(status_code=404, content={"detail": "Unknown tenant"})
    slug, schema = resolved
    with tenancy.tenant_context(slug, schema):
        return await call_next(request)


app.include_router(tenancy.router)
app.include_router(auth.router)
app.include_router(audit.router)
app.include_router(users.router)
app.include_router(branding.router)
app.include_router(integrations.router)
app.include_router(payments.router)
app.include_router(subscriptions.router)
app.include_router(docs.router)
app.include_router(backup.router)
app.include_router(registry.router)
app.include_router(search.router)
app.include_router(updates.router)

for mod in registry.get_all_registered_modules():
    for r in mod.routers:
        app.include_router(r, dependencies=[Depends(registry.require_module_enabled(mod.id))])


@app.get("/api/health")
def health():
    return {"status": "ok"}
