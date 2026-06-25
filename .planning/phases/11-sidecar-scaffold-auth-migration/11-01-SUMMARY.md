---
phase: 11-sidecar-scaffold-auth-migration
plan: "01"
subsystem: infra
tags: [python, fastapi, schwab-py, drizzle, postgres, jsonb, tdd, pytest, vitest]

requires:
  - phase: 10-documentation
    provides: D22 sidecar decision, D16/D17 supersession/lift records in stack-decisions.md

provides:
  - GW-01 relaxation recorded in stack-decisions.md §D22 (docs-before-code gate satisfied)
  - broker_tokens.token_json nullable JSONB column added to Drizzle schema (additive)
  - Python pytest CI lane scaffold (pytest.ini + tests/__init__.py)
  - RED test scaffolds: test_token_store.py, test_advisory_lock.py, test_chain_proxy.py
  - RED TS adapter test scaffold: packages/adapters/src/sidecar/chain-adapter.test.ts

affects:
  - 11-02-PLAN (schema → drizzle-kit generate + bun run migrate)
  - 11-03-PLAN (token_store.py + main.py turn test_token_store + test_chain_proxy green)
  - 11-04-PLAN (advisory_lock.py turns test_advisory_lock green)
  - 11-05-PLAN (chain-adapter.ts turns TS RED test green)

tech-stack:
  added:
    - Python pytest CI lane (pytest.ini in apps/sidecar/)
    - Drizzle jsonb column (token_json on broker_tokens — already imported, additive use)
  patterns:
    - docs-before-code: GW-01 relaxation in stack-decisions.md before schema column
    - TDD red-first: Python pytest RED imports + TS Vitest RED import both fail for right reason
    - dual-write decompose: sidecar writes blob + discrete columns; TS reads discrete only

key-files:
  created:
    - docs/architecture/stack-decisions.md (extended §D22 with GW-01 relaxation sub-section)
    - apps/sidecar/pytest.ini
    - apps/sidecar/tests/__init__.py
    - apps/sidecar/tests/test_token_store.py
    - apps/sidecar/tests/test_advisory_lock.py
    - apps/sidecar/tests/test_chain_proxy.py
    - packages/adapters/src/sidecar/chain-adapter.test.ts
  modified:
    - packages/adapters/src/postgres/schema.ts (token_json column added to brokerTokens)

key-decisions:
  - "GW-01 relaxation (D-02): add token_json JSONB column to broker_tokens; dual-write decompose keeps TS reader on discrete columns unchanged"
  - "refresh_issued_at invariant preserved: sidecar token_write_func never updates refresh_issued_at on access-token rotation (Phase 4 P02 rule)"
  - "Python/pytest CI lane established in apps/sidecar/ as Wave-0 TDD baseline"
  - "TS sidecar adapter test scaffold (chain-adapter.test.ts) is RED on missing chain-adapter.ts — turns green in 11-05"

patterns-established:
  - "Pattern: Python RED tests import non-existent SUT modules (ImportError = right reason to fail)"
  - "Pattern: TS RED tests import non-existent SUT file (Cannot find module = right reason to fail)"

requirements-completed: [GW-01, JRNL-02]

duration: 3min
completed: 2026-06-25
status: complete
---

# Phase 11 Plan 01: Sidecar Scaffold Foundation Summary

**GW-01 relaxation documented in stack-decisions.md, token_json JSONB column added to broker_tokens Drizzle schema, and TDD RED scaffolds committed for Python/pytest + TS/Vitest CI lanes**

## Performance

- **Duration:** 3 min
- **Started:** 2026-06-25T21:34:46Z
- **Completed:** 2026-06-25T21:37:50Z
- **Tasks:** 3
- **Files modified:** 7 (1 doc, 1 schema, 5 test scaffolds)

## Accomplishments

- Recorded the GW-01 relaxation in stack-decisions.md §D22 (docs-before-code gate satisfied before the schema column landed, per D-02 pre-authorization and the docs-before-code workflow rule)
- Added `tokenJson: jsonb("token_json")` nullable column to `brokerTokens` pgTable in schema.ts — additive only, no existing column changed, typecheck passes
- Established the Python pytest CI lane in `apps/sidecar/` with minimal `pytest.ini` (testpaths=tests, asyncio_mode=auto) and three RED test files covering GW-01 (token round-trip + refresh_issued_at invariant), GW-04 (advisory lock two-instance failure), and GW-02 (chain shape + AUTH_EXPIRED 503)
- Committed the TS RED adapter test scaffold `chain-adapter.test.ts` which fails on `Cannot find module './chain-adapter.ts'` — the correct TDD red-first failure for JRNL-02

## Task Commits

1. **Task 1: Record GW-01 relaxation in stack-decisions.md** - `e911216` (docs)
2. **Task 2: Add token_json JSONB column to broker_tokens schema** - `9354c98` (feat)
3. **Task 3: Scaffold Python pytest lane + 3 RED tests + 1 TS RED test** - `fd79432` (test)

## Files Created/Modified

- `docs/architecture/stack-decisions.md` — §D22 extended with GW-01 relaxation sub-section: dual-write decompose rationale, refresh_issued_at invariant, column properties, D-02/GW-01 citations
- `packages/adapters/src/postgres/schema.ts` — `tokenJson: jsonb("token_json")` added after `lastRefreshError` in `brokerTokens` pgTable (nullable, additive)
- `apps/sidecar/pytest.ini` — minimal pytest config for Python CI lane
- `apps/sidecar/tests/__init__.py` — empty package marker
- `apps/sidecar/tests/test_token_store.py` — RED: imports `make_token_callbacks` from non-existent `token_store.py`; pins GW-01 round-trip + refresh_issued_at invariant
- `apps/sidecar/tests/test_advisory_lock.py` — RED: imports `acquire_sidecar_lock` from non-existent `advisory_lock.py`; pins GW-04 two-instance lock failure
- `apps/sidecar/tests/test_chain_proxy.py` — RED: imports FastAPI `app` from non-existent `main.py`; pins GW-02 chain shape + AUTH_EXPIRED 503
- `packages/adapters/src/sidecar/chain-adapter.test.ts` — RED: imports `makeSidecarChainAdapter` from non-existent `./chain-adapter.ts`; pins JRNL-02 Zod-parse + AUTH_EXPIRED err mapping

## Decisions Made

- GW-01 relaxation recorded before schema column (docs-before-code): D22 extended with token_json dual-write decompose pattern + refresh_issued_at never-reset invariant
- Column placed after `lastRefreshError` in schema.ts so the diff is contained and easy to review
- Python pytest scaffold does not include `conftest.py` or fixtures (those land with the production implementation in 11-03/11-04 which need a test DB URL)
- TS test uses injected `fake fetch` pattern matching the existing msw-at-boundary pattern — no live HTTP

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered

None.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

- 11-02: `drizzle-kit generate` will see the new `token_json` column and produce the migration SQL; `bun run migrate` applies it (the BLOCKING task)
- 11-03: `token_store.py` + `main.py` implementation turns `test_token_store.py` and `test_chain_proxy.py` GREEN
- 11-04: `advisory_lock.py` implementation turns `test_advisory_lock.py` GREEN
- 11-05: `chain-adapter.ts` implementation turns `chain-adapter.test.ts` GREEN

Blockers: none from this plan. The prod deploy debt (dead DATABASE_URL) is a pre-existing blocker tracked in STATE.md.

## Self-Check: PASSED

- docs/architecture/stack-decisions.md: contains `token_json` ✓
- packages/adapters/src/postgres/schema.ts: contains `token_json` ✓
- apps/sidecar/pytest.ini: exists ✓
- apps/sidecar/tests/test_token_store.py: exists ✓
- apps/sidecar/tests/test_advisory_lock.py: exists ✓
- apps/sidecar/tests/test_chain_proxy.py: exists ✓
- packages/adapters/src/sidecar/chain-adapter.test.ts: exists + RED on missing import ✓
- bun run typecheck: passes ✓
- Commits: e911216, 9354c98, fd79432 ✓

---
*Phase: 11-sidecar-scaffold-auth-migration*
*Completed: 2026-06-25*
