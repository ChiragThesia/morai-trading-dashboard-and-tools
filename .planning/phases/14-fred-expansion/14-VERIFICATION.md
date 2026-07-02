---
phase: 14-fred-expansion
verified: 2026-07-02T22:26:00Z
status: passed
score: 10/10 code-level must-haves verified; 2/2 human verification items passed 2026-07-02 (evidence in 14-UAT.md)
behavior_unverified: 0
overrides_applied: 0
human_verification:
  - test: "Set FRED_API_KEY on the Railway WORKER service and in local .env (14-USER-SETUP.md, D-13), then confirm a live fetch-rates run (09:00 or 18:30 ET, or a manual trigger_job) populates macro_observations with rows for all 8 series (DFF, DGS1MO, DGS3MO, SOFR, T10Y2Y, T10Y3M, VIXCLS, VVIX) and /api/status shows no lastErr for fetch-rates."
    expected: "macro_observations has today's-date rows for all 8 series; /api/status fetch-rates lastErr is null; MacroCard on the deployed web app shows populated tiles (VVIX ~80-120, DFF ~4-5%, not a /100-scaled value)."
    why_human: "Requires a secret only a human with FRED account + Railway project access can provision (D-13); the code path is fully implemented and covered by msw/testcontainers tests, but no test can prove the literal production table state without the key."
  - test: "Run the one-time prod cleanup: DELETE FROM pgboss.schedule WHERE name = 'fetch-rates' AND key = ''; (documented in 14-REVIEW-FIX.md CR-01 fix and in a schedule.ts comment)."
    expected: "Only two fetch-rates schedule rows remain in pgboss.schedule — key='morning' (0 9 * * 1-5) and key='evening' (30 18 * * 1-5); the stale pre-fix keyless row is gone."
    why_human: "The CR-01 code fix (distinct schedule keys) does not retroactively remove the old keyless row already present in the live pgboss.schedule table from before the fix deployed; this is a one-time manual SQL step against production, not something code can self-heal on boot."
---

# Phase 14: FRED Expansion Verification Report

**Phase Goal:** The `fetch-rates` job is extended to an expanded FRED series set (DFF, DGS1MO,
DGS3MO, SOFR, T10Y2Y, T10Y3M, VIXCLS); VVIX is sourced via the existing CBOE adapter; the
production `FRED_API_KEY` is set; `GET /api/analytics/macro` and MCP `get_macro` expose the full
macro series.

**Verified:** 2026-07-02T22:26:00Z
**Status:** passed — human verification completed 2026-07-02: FRED_API_KEY set on Railway worker, fetch-rates ran twice (8 series populated, idempotent, VVIX 89.04 sane), pgboss stale row deleted (morning/evening rows verified), user visually confirmed MacroCard on prod Overview. Evidence: 14-UAT.md.
**Re-verification:** No — initial verification

## Goal Achievement

### Observable Truths

| # | Truth | Status | Evidence |
|---|-------|--------|----------|
| 1 | `macro_observations` table exists live with composite `(date, series_id)` PK + RLS | ✓ VERIFIED | `packages/adapters/src/postgres/schema.ts:429-442` matches `packages/adapters/src/postgres/migrations/0013_macro_observations.sql` (clean `CREATE TABLE` + `ENABLE ROW LEVEL SECURITY`, no `DROP`/`rate_observations` touch); journal entry `0013_macro_observations` present; 14-02-SUMMARY.md documents `bun run migrate` applied live twice (2nd run no-op) |
| 2 | `fetchMacroSeries` fetches 7 FRED series + VVIX independently (allSettled), persists every success, fails loud naming failed series (D-07) | ✓ VERIFIED | `packages/core/src/journal/application/fetchMacroSeries.ts` — `Promise.allSettled`, per-task try/catch absorbs rejection, best-effort persist loop, `err` names every failed id; `fetchMacroSeries.test.ts` passes (mixed-failure case asserted) |
| 3 | FRED series adapter returns RAW value (no `/100`), hard-fails (no fallback) on missing key; existing DGS3MO/BSM rate path unchanged (D-02/D-09/D-14) | ✓ VERIFIED | `packages/adapters/src/http/fred.ts` (`makeFredSeriesAdapter`); `fred.test.ts` green including the DGS3MO regression case |
| 4 | VVIX sourced via CBOE `_VVIX.json`, raw value, date derived from the **ET** trading day (not UTC) | ✓ VERIFIED | `packages/adapters/src/http/cboe-vvix.ts` uses `Intl.DateTimeFormat("en-CA", {timeZone:"America/New_York"...})` — review WR-02 fix confirmed in code, not just the fix report; `cboe-vvix.test.ts` green |
| 5 | `macro_observations` repo upserts on `(date, series_id)` — idempotent, revises on duplicate | ✓ VERIFIED | `packages/adapters/src/postgres/repos/macro-observations.ts` uses `onConflictDoUpdate`; shared contract suite (`macro-observations.contract.ts`) passes against both Postgres (testcontainers) and in-memory twin — 8/8 tests green |
| 6 | `fetch-rates` job is scheduled **twice** daily (09:00 + 18:30 ET) and both crons actually survive in pg-boss (not silently overwritten) | ✓ VERIFIED | `apps/worker/src/schedule.ts` gives each cron a distinct `key` (`"morning"`/`"evening"`) — this is the CR-01 blocker fix (commit `a29075f`), confirmed live in code (not just claimed in the fix report); `schedule.test.ts` models the pg-boss `(name,key)` upsert in a `scheduleStore` map and asserts 2 surviving rows with distinct keys — a regression test that fails on the pre-fix code |
| 7 | `fetch-rates` handler runs the macro fetch additively; throws on macro error (fail-loud, D-07); existing rate-fetch path untouched | ✓ VERIFIED | `apps/worker/src/handlers/fetch-rates.ts` calls `fetchRateUseCase()` (unchanged) then `fetchMacroSeriesUseCase()`, throws on either err; `fetch-rates.test.ts` green |
| 8 | Worker composition wires the FRED-series adapter, CBOE VVIX adapter, macro repo, and `fetchMacroSeries` into the handler | ✓ VERIFIED | `apps/worker/src/main.ts:37-39,55,123,152-167,229` — all four wired, `config.FRED_API_KEY` passed through, rate/BSM wiring untouched |
| 9 | `GET /api/analytics/macro` returns a `macroResponse`-shaped map, validates `days`/`series` (400 on invalid), 500 on internal error, inherits Supabase JWT auth | ✓ VERIFIED | `apps/server/src/adapters/http/analytics.routes.ts` — `macroQuery.safeParse` before the use-case call, `macroResponse.parse` before send, `{error:"internal"}` 500 on `Result.err`; route mounted inside `apiRouter` → `authReadGroup` (`apps/server/src/main.ts:239,266,271`) — JWT-gated; `analytics.routes.test.ts` green (54/54 across the analytics+mcp test files) |
| 10 | MCP `get_macro` returns the identical payload over the shared `macroResponse` contract (MCP-02), optional-injected | ✓ VERIFIED | `apps/server/src/adapters/mcp/tools.ts:595-641` (`registerGetMacroTool`), `server.ts:71,104-105` (optional injection), wired from `main.ts:150-151,239,285-295` with one `getMacro` use-case shared by both adapters; `mcp.test.ts` green (route/MCP parity asserted) |
| 11 | Web `MacroCard` renders live macro data in Overview, replacing the "FRED macro" stub, human-approved | ✓ VERIFIED | `apps/web/src/hooks/useMacro.ts` + `apps/web/src/components/MacroCard.tsx` + `apps/web/src/screens/Overview.tsx:13,441` (stub gone: `title="FRED macro"` no longer present); 14-07-SUMMARY.md records the blocking human-verify checkpoint as **approved** (empty-state confirmed live; populated-state deferred to prod UAT, consistent with truth #12) |
| 12 | Production `FRED_API_KEY` is set and a live `fetch-rates` run has populated `macro_observations` for all 8 series | ⚠️ NOT YET TRUE (operator-gated) | `14-USER-SETUP.md` status: "Incomplete"; `.planning/STATE.md:33,347` confirms `FRED_API_KEY` still unset in prod. Code path is complete and tested; this is the documented D-13 operator prerequisite, not a code gap — routed to human verification below |

**Score:** 10/10 code-completeness truths verified; 2 items require human/operator action to close (not code defects) — see Human Verification.

### Required Artifacts

| Artifact | Expected | Status | Details |
|----------|----------|--------|---------|
| `packages/contracts/src/macro.ts` | `macroSeriesPoint`/`macroResponse`/`macroQuery`/`MACRO_SERIES_IDS` (8 ids incl. VVIX) | ✓ VERIFIED | Present, barrel-exported, `macro.test.ts` green |
| `packages/core/src/journal/application/ports.ts` | `MacroObservationRow` + 4 macro ports | ✓ VERIFIED | Present; rate/BSM ports (`ForFetchingRate` etc.) unchanged (D-02, `rg` confirmed) |
| `packages/adapters/src/postgres/schema.ts` + `migrations/0013_macro_observations.sql` | `macroObservations` pgTable + generated migration | ✓ VERIFIED | Composite PK, RLS, applied live (SUMMARY-documented, journal entry present) |
| `packages/adapters/src/http/fred.ts` | `makeFredSeriesAdapter` | ✓ VERIFIED | Raw value, no-fallback, DGS3MO regression preserved |
| `packages/adapters/src/http/cboe-vvix.ts` | `makeCboeVvixAdapter` | ✓ VERIFIED | ET-date fix present |
| `packages/adapters/src/postgres/repos/macro-observations.ts` + `memory/macro-observations.ts` | Repo + twin, shared contract suite | ✓ VERIFIED | 8/8 contract tests pass across both |
| `packages/adapters/src/memory/fred-series.ts` + `memory/vvix.ts` | In-memory twins for the 2 new fetch ports (WR-03 fix) | ✓ VERIFIED | Both present, D-09 no-fallback parity, barrel-exported |
| `packages/core/src/journal/application/fetchMacroSeries.ts` + `getMacro.ts` | Use-cases | ✓ VERIFIED | Pure hexagon (only `./ports.ts` + `@morai/shared` imports) |
| `apps/worker/src/handlers/fetch-rates.ts` + `schedule.ts` + `main.ts` | Extended handler, 2x cron with distinct keys, composition wiring | ✓ VERIFIED | CR-01 fix confirmed live in schedule.ts |
| `apps/server/src/adapters/http/analytics.routes.ts` + `adapters/mcp/tools.ts`/`server.ts` + `main.ts` | Route + MCP tool + wiring | ✓ VERIFIED | One `macroResponse` contract shared (MCP-02) |
| `apps/web/src/hooks/useMacro.ts` + `components/MacroCard.tsx` + `screens/Overview.tsx` | Live web surface | ✓ VERIFIED | Stub replaced; human-verify approved |

### Key Link Verification

| From | To | Via | Status | Details |
|------|----|----|--------|---------|
| `apps/server/src/main.ts` `apiRouter` | `authReadGroup` | Hono chained sub-router mount | ✓ WIRED | `/analytics/macro` inherits Supabase JWT — not a separate unauthenticated route |
| `apps/worker/src/schedule.ts` | pg-boss `(name,key)` schedule table | distinct `key: "morning"`/`"evening"` | ✓ WIRED | Regression test models the real upsert semantics (not a naive call-count fake) |
| `apps/server/src/adapters/http/analytics.routes.ts` + `adapters/mcp/tools.ts` | `packages/contracts/src/macro.ts` | `macroResponse.parse` on both sides | ✓ WIRED | One schema; a one-sided change fails typecheck (MCP-02 guarantee) |
| `apps/worker/src/main.ts` | `packages/adapters` (FRED/VVIX/repo) + `packages/core` (`fetchMacroSeries`) | composition-root construction | ✓ WIRED | All 4 symbols wired, `FRED_API_KEY` threaded from Zod config |
| `packages/adapters/.../macro-observations.ts` | Postgres | `db.select()` / `db.insert().onConflictDoUpdate()` | ✓ FLOWING (Level 4) | Real parameterized queries, no static/empty return; testcontainers prove round-trip |

### Behavioral Spot-Checks

| Behavior | Command | Result | Status |
|----------|---------|--------|--------|
| Contract round-trip + rejection | `bun run test -- packages/contracts/src/macro.test.ts` | pass | ✓ PASS |
| fetchMacroSeries per-series independence + fail-loud | `bun run test -- packages/core/src/journal/application/fetchMacroSeries.test.ts` | pass | ✓ PASS |
| getMacro grouping/window/filter | `bun run test -- packages/core/src/journal/application/getMacro.test.ts` | pass | ✓ PASS |
| FRED series adapter raw-value/no-fallback | `bun run test -- packages/adapters/src/http/fred.test.ts` | pass | ✓ PASS |
| CBOE VVIX ET-date adapter | `bun run test -- packages/adapters/src/http/cboe-vvix.test.ts` | pass | ✓ PASS |
| macro_observations repo/twin idempotent upsert | `bun run test -- --project packages/adapters macro-observations` | 8/8 pass (testcontainers + memory) | ✓ PASS |
| fetch-rates handler + schedule (CR-01 regression) | `bun run test -- --project apps/worker fetch-rates` / `schedule` | pass; 2 surviving distinct-key rows asserted | ✓ PASS |
| HTTP route + MCP tool parity | `bun run test -- --project server analytics.routes mcp` | 54/54 pass | ✓ PASS |
| Web hook/component/Overview integration | `bun run test -- --project web useMacro MacroCard Overview` | 16/16 pass | ✓ PASS |
| Full workspace suite (run once) | `bun run test` | 170 files / 1520 tests pass | ✓ PASS |
| Typecheck | `bun run typecheck` | clean | ✓ PASS |
| Lint | `bun run lint` | clean (only pre-existing boundaries-plugin legacy-selector warning) | ✓ PASS |

### Requirements Coverage

| Requirement | Source Plan(s) | Description | Status | Evidence |
|-------------|-----------------|-------------|--------|----------|
| MAC-01 | 14-01, 14-02, 14-03, 14-04, 14-05 | fetch-rates extended to 7 FRED + VVIX series, idempotent, prod FRED_API_KEY set | ⚠️ SATISFIED (code) / NEEDS HUMAN (prod key) | Code + tests fully cover ingestion + idempotency; the literal "prod FRED_API_KEY set" clause named in the requirement text is not yet true (`14-USER-SETUP.md` status Incomplete) — REQUIREMENTS.md marks this `[x]` Complete, which is premature against its own literal text until the operator step closes |
| MAC-02 | 14-01, 14-04, 14-06, 14-07 | GET /api/analytics/macro + MCP get_macro expose the series | ✓ SATISFIED | Route + MCP tool + web surface all live and tested |
| MCP-02 (cross-cutting) | 14-06 | Route + MCP tool ship in the same change over one Zod schema | ✓ SATISFIED | One `macroResponse` contract; parity test |

No orphaned requirements — `.planning/REQUIREMENTS.md` maps only MAC-01/MAC-02 to Phase 14, both declared across the plan set.

### Anti-Patterns Found

None. Scanned all 18 phase-touched core/adapter/worker/server/web files for `TBD|FIXME|XXX|TODO|HACK|PLACEHOLDER` and stub-shaped empty returns — zero matches. `IN-01`/`IN-02`/`IN-03` from 14-REVIEW.md remain unfixed but are Info-severity, explicitly marked out-of-scope in 14-REVIEW-FIX.md, and do not block phase goal achievement (silent `source` coercion to `"fred"`, misleading empty-state copy on fetch error, structural-type re-declaration in the worker handler — none affect the delivered behavior under test).

### Human Verification Required

### 1. Prod FRED_API_KEY + live macro population

**Test:** Set `FRED_API_KEY` on the Railway `WORKER` service and in local `.env` (14-USER-SETUP.md), then let a scheduled or manually-triggered `fetch-rates` run complete.
**Expected:** `macro_observations` gains rows for all 8 series (`DFF, DGS1MO, DGS3MO, SOFR, T10Y2Y, T10Y3M, VIXCLS, VVIX`) dated today; `/api/status` shows no `lastErr` for `fetch-rates`; the deployed MacroCard shows populated tiles with sane values (VVIX ~80-120 index level, DFF ~4-5%, not a `/100`-scaled value — D-14 regression check).
**Why human:** Requires a secret provisioned by a human with FRED account + Railway project access; no test can substitute for observing the actual production table state.

### 2. One-time prod pgboss schedule cleanup (CR-01 residue)

**Test:** Run `DELETE FROM pgboss.schedule WHERE name = 'fetch-rates' AND key = '';` against the production database once, after the CR-01 fix (commit `a29075f`) is deployed.
**Expected:** Only the two new keyed rows (`morning`, `evening`) remain for `fetch-rates` in `pgboss.schedule`; the pre-fix keyless row — which would otherwise keep firing at whatever cron it last held, on top of the two new schedules — is gone.
**Why human:** This is a direct one-time SQL statement against production infrastructure; the code fix cannot retroactively clean up a row that already existed in the live schedule table before the fix deployed, and no `unschedule`-on-boot exists in `apps/worker/src/main.ts` to self-heal it.

### Gaps Summary

No code gaps. All 12 goal-backward truths trace to real, tested, wired code — including both
findings the code review flagged as blocking (CR-01 pg-boss schedule-key overwrite) and warning
(VVIX UTC-vs-ET date mislabeling, missing in-memory twins), which were fixed in commits
`a29075f`/`fca8c9d`/`58c766a` and independently re-verified here by reading the current code (not
by trusting the fix report). The only two open items are pre-flagged, documented operator actions
(FRED_API_KEY provisioning; one-time stale-schedule-row cleanup) that require production
infrastructure access no automated check can substitute for. Both are captured as human
verification items rather than gaps, consistent with the phase's own D-13 operator-step framing.

---

_Verified: 2026-07-02T22:26:00Z_
_Verifier: Claude (gsd-verifier)_
