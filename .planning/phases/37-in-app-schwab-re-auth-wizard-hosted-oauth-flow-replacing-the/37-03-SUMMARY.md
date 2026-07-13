---
phase: 37-in-app-schwab-re-auth-wizard-hosted-oauth-flow-replacing-the
plan: 03
subsystem: auth
tags: [fastapi, psycopg2, schwab-py, asyncio, oauth]

requires:
  - phase: 37-01
    provides: reauth_nonces migration + docs-first stack-decisions entry
provides:
  - "SidecarConfig gains SIDECAR_ADMIN_TOKEN (required secret) + SCHWAB_WEB_CALLBACK_URL (defaulted https://morai.wtf)"
  - "token_store.make_reauth_writer — anchors refresh_issued_at on every write (unlike the routine token_write_func)"
  - "main.reinit_schwab_session(app, cfg) — cancels+recreates keepalive/streamer tasks, rebuilds Schwab clients, never touches the advisory lock"
  - "app.state.cfg + app.state.keepalive_task/streamer_task available to route handlers (Phase 37 admin routes)"
affects: [37-04, 37-07]

tech-stack:
  added: []
  patterns:
    - "One anchoring token writer (make_reauth_writer) instead of a hand-copied UPSERT, ready for both the CLI seed path and the wizard exchange route to share"
    - "Background asyncio tasks stored on app.state (not local vars) so an out-of-band re-init helper can cancel+recreate the SAME task objects the lifespan's own finally block already cancels"

key-files:
  created:
    - apps/sidecar/tests/test_reinit_session.py
  modified:
    - apps/sidecar/config.py
    - apps/sidecar/token_store.py
    - apps/sidecar/tests/test_token_store.py
    - apps/sidecar/main.py

key-decisions:
  - "seed_token.py was left untouched (out of this plan's file scope) — make_reauth_writer duplicates seed_token.py's UPSERT shape rather than refactoring the CLI path to call it; RESEARCH's own Don't-Hand-Roll table marks that refactor optional, not required for correctness."
  - "reinit_schwab_session always bounces both keepalive_task and streamer_task on any app's re-auth (even market-only), matching RESEARCH's accepted-redundancy call — simpler than conditional per-app task targeting for a twice-per-7-days event."

requirements-completed: [REAUTH-03, REAUTH-04]

coverage:
  - id: D1
    description: "SidecarConfig declares SIDECAR_ADMIN_TOKEN (required, no default) and SCHWAB_WEB_CALLBACK_URL (defaulted to https://morai.wtf)"
    requirement: REAUTH-03
    verification:
      - kind: unit
        ref: "apps/sidecar/config.py grep + ast.parse check (plan's own automated verify)"
        status: pass
    human_judgment: false
  - id: D2
    description: "make_reauth_writer anchors refresh_issued_at within 5 minutes and writes token_json (round-trip readable); tolerates both wrapped and raw schwab-py blob shapes"
    requirement: REAUTH-03
    verification:
      - kind: unit
        ref: "apps/sidecar/tests/test_token_store.py#test_make_reauth_writer_anchors_refresh_issued_at"
        status: pass
      - kind: unit
        ref: "apps/sidecar/tests/test_token_store.py#test_make_reauth_writer_wraps_raw_token_dict"
        status: pass
    human_judgment: false
  - id: D3
    description: "reinit_schwab_session no-ops (returns False) when has_lock is False; when True, cancels+awaits old keepalive/streamer tasks, rebuilds clients, recreates both tasks with new identity, and never touches the advisory lock"
    requirement: REAUTH-04
    verification:
      - kind: unit
        ref: "apps/sidecar/tests/test_reinit_session.py#test_reinit_noop_when_lock_not_held"
        status: pass
      - kind: unit
        ref: "apps/sidecar/tests/test_reinit_session.py#test_reinit_cancels_old_tasks_and_creates_new_ones"
        status: pass
    human_judgment: false

duration: ~20min
completed: 2026-07-13
status: complete
---

# Phase 37 Plan 03: Sidecar re-init plumbing + reauth token writer + config Summary

**Sidecar gains `SIDECAR_ADMIN_TOKEN`/`SCHWAB_WEB_CALLBACK_URL` config, a `make_reauth_writer` that anchors `refresh_issued_at` on every write (closing the wizard's own freshness-gate trap), and a `reinit_schwab_session` helper that cancels+recreates the keepalive/streamer background tasks and rebuilds both Schwab clients while never releasing the GW-04 advisory lock.**

## Performance

- **Duration:** ~20 min
- **Started:** 2026-07-13T11:15Z (approx.)
- **Completed:** 2026-07-13T11:24Z
- **Tasks:** 3/3 completed
- **Files modified:** 4 (config.py, token_store.py, main.py, test_token_store.py) + 1 created (test_reinit_session.py)

## Accomplishments
- `SidecarConfig` gained two Phase-37 fields with the same "never logged, field-names-only-on-failure" discipline as every other field.
- `token_store.make_reauth_writer(db_url, app_id, encryption_key)` closes RESEARCH's Pitfall 1 (the routine writer never anchors `refresh_issued_at`, so a fresh dance would otherwise never reset the 7-day clock) — verified against real Postgres, not mocked.
- `main.reinit_schwab_session(app, cfg)` closes RESEARCH's Pitfall 2 (streamer/keepalive tasks capture the client in a local variable once — rebuilding `app.state.trader_client` alone never reaches a running task) while respecting T-37-05 (never two live streamer sessions, lock held continuously).

## Task Commits

Each task was committed atomically:

1. **Task 1: Add SIDECAR_ADMIN_TOKEN + SCHWAB_WEB_CALLBACK_URL to sidecar config** - `b5cf30b` (feat)
2. **Task 2: make_reauth_writer — anchors refresh_issued_at** - `93b13b7` (test+feat, combined — see Deviations)
3. **Task 3: reinit_schwab_session + tasks on app.state** - `3c2d2e1` (test, RED) + `60c7fad` (feat, GREEN)

**Plan metadata:** this commit (docs: complete plan)

_Note: TDD tasks may have multiple commits (test → feat → refactor)_

## Files Created/Modified
- `apps/sidecar/config.py` - +`SIDECAR_ADMIN_TOKEN: str` (required), +`SCHWAB_WEB_CALLBACK_URL: str = "https://morai.wtf"`
- `apps/sidecar/token_store.py` - +`make_reauth_writer(db_url, app_id, encryption_key)` — UPSERT shape mirrors `seed_token.py`'s `_make_seed_writer`, anchors `refresh_issued_at = now()`, tolerates wrapped/raw token shapes
- `apps/sidecar/tests/test_token_store.py` - +2 tests (`test_make_reauth_writer_anchors_refresh_issued_at`, `test_make_reauth_writer_wraps_raw_token_dict`), +`datetime` import, extended the RED-scaffold import line
- `apps/sidecar/main.py` - `app.state.cfg` set in `lifespan()`; `keepalive_task`/`streamer_task` moved from local vars onto `app.state` (both in `_acquire_lock_and_init` and its `finally` cancellation, plus the two `app.state` defaults blocks); new `reinit_schwab_session(app, cfg) -> bool`
- `apps/sidecar/tests/test_reinit_session.py` - new file, 2 tests covering the has_lock guard and the cancel-old/create-new/rebuild-clients/lock-untouched lifecycle

## Decisions Made
- Left `apps/sidecar/seed_token.py` untouched — out of this plan's declared file scope (`files_modified` in the plan frontmatter lists only config.py/token_store.py/main.py + the two test files). `make_reauth_writer`'s UPSERT SQL is a same-shape copy of `_make_seed_writer`'s, not a shared call — RESEARCH's own "Don't Hand-Roll" table marks refactoring `seed_token.py` to reuse it as optional, not required for this phase's correctness. 37-04 (the caller) is what actually gets "one anchoring writer, not two hand-copies" — it uses `make_reauth_writer`, never re-implementing the UPSERT a third time.
- `reinit_schwab_session` bounces both background tasks on any app's re-auth (trader-only or market-only) rather than targeting just the affected app — matches RESEARCH's explicitly accepted redundancy (a brief reconnect blip is cheaper than conditional logic for a twice-per-7-days event).

## Deviations from Plan

### Auto-fixed Issues

**1. [Process deviation, not a Rule 1-4 auto-fix] Task 2 committed as a single test+feat commit instead of separate RED/GREEN commits**
- **Found during:** Task 2 (make_reauth_writer)
- **Issue:** The executor instructions describe RED and GREEN as separate commits for `tdd="true"` tasks. Task 2's RED test was written, confirmed failing (`ImportError: cannot import name 'make_reauth_writer'`), then implemented and confirmed green — but committed as one combined commit (`93b13b7`) rather than a RED-only commit followed by a GREEN-only commit.
- **Fix:** None needed for correctness — the suite is green and the test genuinely failed for the right reason before implementation (verified via `pytest -x -q` showing the ImportError). Task 3 was executed with proper separate RED (`3c2d2e1`) and GREEN (`60c7fad`) commits, matching the intended protocol.
- **Files modified:** `apps/sidecar/token_store.py`, `apps/sidecar/tests/test_token_store.py`
- **Verification:** `pytest tests/test_token_store.py -x -q` → 5 passed; full suite 71 passed at that point.
- **Committed in:** `93b13b7`

---

**Total deviations:** 1 (process/commit-granularity only — no code correctness impact).
**Impact on plan:** None on functionality; git history for Task 2 has one commit instead of two. RED-then-GREEN was still genuinely followed (test written and confirmed failing before implementation), only the commit split was collapsed.

## Issues Encountered
- The sidecar's test Postgres container (expected on `localhost:5499` per `conftest.py`'s defaults) was not running at the start of this session — started a fresh `postgres:16` container (`morai-sidecar-test-pg`, port 5499, `testdb`/`testuser`/`testpw` matching `conftest.py`'s defaults) so the full suite (which requires real Postgres, never mocked per `tdd.md`) could run. No code change required.

## User Setup Required
None — no external service configuration required. (The ephemeral test-Postgres container started for this session is local/dev-only, not part of the deliverable.)

## Next Phase Readiness
`token_store.make_reauth_writer` and `main.reinit_schwab_session` are both importable and unit-proven — 37-04's exchange endpoint can call them directly (`make_reauth_writer(cfg.DATABASE_URL, app_id, cfg.TOKEN_ENCRYPTION_KEY)` as the `token_write_func` passed to `schwab.auth.client_from_received_url`, then `await reinit_schwab_session(request.app, request.app.state.cfg)` after a successful exchange). `app.state.cfg` is now populated in `lifespan()`, so 37-04's route handlers can read config without needing the lifespan closure. Full sidecar suite green (73 passed) at hand-off.

---
*Phase: 37-in-app-schwab-re-auth-wizard-hosted-oauth-flow-replacing-the*
*Completed: 2026-07-13*
