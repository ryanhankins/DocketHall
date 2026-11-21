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
import logging
import os

from fastapi import Depends, FastAPI, Request
from fastapi.concurrency import run_in_threadpool
from fastapi.responses import JSONResponse

from . import audit, auth, backup, branding, docs, integrations, my_account, payments, pdf_check, permits, registry, search, sla, subscriptions, tenancy, updates, users
from .db import open_pool, pool
from .modules import register_builtin_modules

logger = logging.getLogger(__name__)
register_builtin_modules()


def _bootstrap_tenant_schema(slug: str, schema: str) -> None:
    with tenancy.tenant_context(slug, schema):
        auth.bootstrap()
        audit.bootstrap()
        integrations.bootstrap()
        sla.bootstrap()
        payments.bootstrap()
        subscriptions.bootstrap()
        docs.bootstrap()
        registry.bootstrap()
        for mod in registry.get_all_registered_modules():
            mod.bootstrap()


tenancy.register_schema_bootstrapper(_bootstrap_tenant_schema)


def _run_daily_jobs_for_all_tenants() -> None:
    tenants = tenancy.list_active_tenants() if tenancy.is_multi_tenant() else [("default", "public")]
    for slug, schema in tenants:
        with tenancy.tenant_context(slug, schema):
            for label, fn in (
                ("compliance_digest", permits.run_daily_compliance_digest),
                ("sla_escalation_digest", sla.run_sla_escalation_digest),
                ("recurring_renewals", lambda: permits.run_recurring_renewals(days_ahead=60, send_emails=True)),
                ("scheduled_offsite_backup", backup.run_scheduled_offsite_backup),
                ("retention_policies", backup.run_retention_policies),
            ):
                try:
                    fn()
                except Exception:
                    logger.exception("Daily job %s failed for tenant %s", label, slug)


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
                    await run_in_threadpool(_run_daily_jobs_for_all_tenants)
                except Exception:
                    logger.exception("Daily digest loop failed")
        digest_task = asyncio.create_task(_digest_loop())
    yield
    if digest_task:
        digest_task.cancel()
    pool.close()


app = FastAPI(title="DocketHall API", lifespan=lifespan)


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
app.include_router(sla.router)
app.include_router(payments.router)
app.include_router(pdf_check.router)
app.include_router(my_account.router)
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
