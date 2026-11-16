/*
 * Copyright 2026 Ryan Hankins
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU Affero General Public License as
 * published by the Free Software Foundation, either version 3 of the
 * License, or (at your option) any later version.
 *
 * This program is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
 * GNU Affero General Public License for more details.
 *
 * You should have received a copy of the GNU Affero General Public License
 * along with this program.  If not, see <https://www.gnu.org/licenses/>.
 */

/**
 * Frontend pluggable module registry.
 * Each module registers:
 *   - id: string (matches backend CivicModule.id)
 *   - routes: Array<{ match: (hash) => object | null, component: React.LazyExoticComponent }>
 *   - prefNavItems: Array<{ section: string, label: string, permission?: string }>
 */
const MODULE_LOADERS = {
  agendas: () => import('../modules/agendas/index.jsx'),
  permits: () => import('../modules/permits/index.jsx'),
  codification: () => import('../modules/codification/index.jsx'),
};

export async function loadEnabledFrontendModules(enabledModuleIds) {
  const loaded = {};
  await Promise.all(
    enabledModuleIds
      .filter(id => typeof MODULE_LOADERS[id] === 'function')
      .map(async (id) => {
        const mod = await MODULE_LOADERS[id]();
        loaded[id] = mod.default || mod;
      }),
  );
  return loaded;
}
