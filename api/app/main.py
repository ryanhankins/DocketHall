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

from fastapi import Depends, FastAPI

from . import auth, backup, branding, registry, users
from .db import open_pool, pool
from .modules import register_builtin_modules

register_builtin_modules()


@asynccontextmanager
async def lifespan(app: FastAPI):
    open_pool()
    auth.bootstrap()
    registry.bootstrap()
    for mod in registry.get_all_registered_modules():
        mod.bootstrap()
    yield
    pool.close()


app = FastAPI(title="CivicDesk API", lifespan=lifespan)
app.include_router(auth.router)
app.include_router(users.router)
app.include_router(branding.router)
app.include_router(backup.router)
app.include_router(registry.router)

for mod in registry.get_all_registered_modules():
    for r in mod.routers:
        app.include_router(r, dependencies=[Depends(registry.require_module_enabled(mod.id))])


@app.get("/api/health")
def health():
    return {"status": "ok"}
