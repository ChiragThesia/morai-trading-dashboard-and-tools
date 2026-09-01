# Phase 06: User Setup Required

**Generated:** 2026-09-01
**Phase:** 06-raw-ingest-and-backfill
**Status:** Incomplete

Complete this item for the Railway **worker** service to boot correctly. Claude
automated everything else -- the code already routes the worker's ingest
session through `get_app_engine()` (the `morai_app` role), which requires
this password to build its connection string.

## Environment Variables

| Status | Variable | Source | Add to |
|--------|----------|--------|--------|
| [ ] | `MORAI_APP_DB_PASSWORD` | The same value already set on the `web` Railway service -- Railway Dashboard → `web` → Variables → copy the value | Railway Dashboard → `worker` → Variables |

## Dashboard Configuration

- [ ] **Declare the variable on the worker service in infra-as-code**
  - Location: `.railway/railway.ts`
  - Task: Add `MORAI_APP_DB_PASSWORD` to the `worker` service's variables using
    `preserve()`, alongside the `web` service's own existing declaration --
    matching that file's existing convention for shared secrets.
  - Why: without it, the worker process boots successfully (nothing at import
    time touches `morai_app_db_password`), but every `sync_user` job fails at
    `get_app_engine()` construction the first time it runs, since
    `Settings.app_async_dsn` raises `RuntimeError` when the password is unset.

## Verification

After completing setup, verify with:

```bash
# On Railway, tail the worker service's logs after redeploy and confirm no
# RuntimeError naming morai_app_db_password appears when a sync_user job runs.
railway logs --service worker
```

Expected results:
- The worker service redeploys cleanly.
- A deferred `sync_user` job (once plan 06-02's periodic fan-out is live)
  reaches `succeeded` rather than `failed` with a `Configuration rejected`
  error naming `morai_app_db_password`.

---

**Once complete:** Mark status as "Complete" at top of file.
