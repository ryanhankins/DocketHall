# Repository Guidelines for AI Agents

## Required Verification (Run Tests Before Finishing)

Before finishing or committing any code change in this repository, you **must** run the full test suites and verify that all checks pass:

1. **Backend & API test suite (Docker + PostgreSQL):**
   ```bash
   ./scripts/test-docker.sh
   ```
   This runs the Python `unittest` suite (`tests/test_*.py`) and the `pytest` API integration suite (`tests/api/test_*.py`) against a real PostgreSQL container.

2. **Frontend tests and production build:**
   ```bash
   cd web && npm test && npm run build
   ```
   This runs the Vitest unit/component suite and verifies that the Vite production bundle compiles cleanly.

## Key Conventions

- **Backend (`api/app/`):** FastAPI + `psycopg` (PostgreSQL). New modules or database tables must be registered in `api/app/modules/` with `*_BACKUP_TABLES` kept in sync with SQL schemas (validated by `tests/test_backup_schema.py`).
- **Frontend (`web/src/`):** React + Vite. Relative imports and JSX component references are checked by `tests/test_static_checks.py`.
- **AI Assistant (`api/app/ai_assistant.py`):** Update/publish actions must use `list_*` / `update_*` tools rather than creating duplicate records.
- **Local Docker Stack (`localhost:8080`):** Always redeploy/reinitialize in-place with `./scripts/deploy.sh` (which preserves `pgdata` and `records_data` volumes). Never run `./scripts/teardown.sh --purge` unless the user explicitly asks to wipe the database.
