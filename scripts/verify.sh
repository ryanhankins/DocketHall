#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

echo "=== Tier 1: Python unit & static checks ==="
cd "$ROOT"
python3 -m unittest discover -s tests -v

echo "=== Tier 1b: Frontend Vitest + Vite build ==="
cd "$ROOT/web"
npm test
npm run build

if [[ -n "${CIVICDESK_LIVE_URL:-}" ]]; then
  echo "=== Tier 3: Live smoke + Playwright E2E ($CIVICDESK_LIVE_URL) ==="
  cd "$ROOT"
  python3 -m unittest tests/test_live_smoke.py -v
  cd "$ROOT/e2e"
  npx playwright test
fi
