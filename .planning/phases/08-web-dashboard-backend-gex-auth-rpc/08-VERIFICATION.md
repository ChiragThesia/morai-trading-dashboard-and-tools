---
phase: 08-web-dashboard-backend-gex-auth-rpc
verified: 2026-06-24T00:00:00Z
status: passed
score: 4/4
behavior_unverified: 0
overrides_applied: 0
---

# Phase 8: Web Dashboard Backend — GEX Auth RPC — Verification Report

**Phase Goal:** Build the typed, authenticated API surface the web SPA consumes — a GEX analytics endpoint backed by a scheduled snapshot job (computed from leg_observations into a gex_snapshot table, served cached not per-request), its Zod contract in packages/contracts, export the Hono AppType so hc<AppType>() typed RPC works from apps/web, and gate read endpoints behind Supabase Auth + CORS for the Vercel origin.

**Verified:** 2026-06-24T00:00:00Z
**Status:** passed
**Re-verification:** No — initial verification

---

## Goal Achievement

### Observable Truths

| # | Truth | Status | Evidence |
|---|-------|--------|----------|
| 1 | A read endpoint returns a gexSnapshot over a shared Zod contract (spot, flip, callWall, putWall, netGammaAtSpot, profile[], strikes[], byExpiry[]), served from a stored snapshot row — not recomputed per request | VERIFIED | `gex.routes.ts:27-59` — GET /gex calls `getGex()` (read use-case) and parses result through `gexSnapshotResponse` (contract from `@morai/contracts`). All 8 contract fields present: `packages/contracts/src/gex.ts:33-50`. No `buildProfile`/`strikeGex` call in route — D-01 honored. |
| 2 | A scheduled pg-boss job computes GEX from latest leg_observations each RTH cycle and writes a gex_snapshot row; re-run within a cycle is idempotent (0 duplicate rows) | VERIFIED | `schedule.ts:75` — `compute-gex-snapshot` queue registered with `boss.work()`; chain-triggered by `compute-analytics` via `boss.send("compute-gex-snapshot", ...)` at `compute-analytics.ts:51-55`. `gex-snapshot.repo.ts:122` — `.onConflictDoNothing()` on `cycle_time` PK (schema.ts:356). Idempotency tested at `gex-snapshot.contract.ts:156-169`: "re-persisting the same cycleTime produces exactly 1 row". |
| 3 | apps/server exports AppType; a typed hc<AppType>() client compiles against it | VERIFIED | `main.ts:254` — `export type AppType = typeof app;`. Routes chained via `new Hono().route(...)` pattern (main.ts:197-206) per RESEARCH A5/Pattern 6. Typecheck assertion in `app-type.assert.ts:15-22`: `import type { AppType } from "./main.ts"` and `hc<AppType>("http://localhost:3000")`. Full workspace typecheck is clean. |
| 4 | Read endpoints (status, journal, brokerage, analytics, gex) require a valid Supabase Auth session; CORS allows the Vercel web origin; unauthenticated request returns 401 | VERIFIED | `main.ts:184-214`: CORS applied first (before JWT group) with exact `config.WEB_ORIGIN` origin + `credentials:true`. `authReadGroup.use("/*", jwt({ secret: config.SUPABASE_JWT_SECRET, alg: "HS256" }))` wraps all read routes. Auth integration tests at `auth-integration.test.ts`: (a) no-JWT → 401 on status and gex, (b) valid HS256 JWT passes gate, (c) tampered/wrong-secret JWT → 401, (d) preflight OPTIONS returns exact WEB_ORIGIN (never `*`), (e) foreign origin gets no allow-origin. |

**Score:** 4/4 truths verified

---

## CR-01 and CR-02 Fix Verification (post-review)

Both critical issues from 08-REVIEW.md were fixed via strict TDD (commits b8f998a and 39aeaa4, both confirmed present in git log).

### CR-01: netGammaAtSpot — profile-at-spot semantics (commit b8f998a)

**Verified FIXED.**

- `computeGexSnapshot.ts:141-142` — `const [spotPoint] = buildProfile(legs, [spot]); const netGammaAtSpot = spotPoint?.gamma ?? 0;`
- The old `computeNetGammaAtSpot` helper is ABSENT (grep returns no matches).
- The dead `_now =` assignment is ABSENT (coincident IN-01 cleanup).
- Value-level regression test added at `computeGexSnapshot.test.ts:198-224`:
  - Asserts `row.netGammaAtSpot` is `toBeCloseTo(buildProfile(FIXTURE_LEGS, [spot])[0].gamma, 6)` — epsilon 1e-6.
  - Magnitude guard: `Math.abs(row.netGammaAtSpot) < 1e6` (rules out per-strike billions magnitude).
- RED failure confirmed in fix SUMMARY: `AssertionError: expected -1.015... to be close to -5.912...`

### CR-02: computedAt column persisted faithfully (commit 39aeaa4)

**Verified FIXED.**

- `packages/adapters/src/postgres/migrations/0009_gex_computed_at.sql` EXISTS: `ALTER TABLE "gex_snapshots" ADD COLUMN "computed_at" timestamp with time zone NOT NULL;`
- `schema.ts:371` — `computedAt: timestamp("computed_at", { withTimezone: true }).notNull()` present in `gexSnapshots` table definition.
- `gex-snapshot.repo.ts:120` — `computedAt: row.computedAt` in `.values({...})` (persist path).
- `gex-snapshot.repo.ts:160` — `computedAt: row.computedAt` in read mapping (no `cycleTime` substitution).
- Contract round-trip test at `gex-snapshot.contract.ts:201-227`:
  - Persists a row where `computedAt` (14:07:42Z) is 7m42s after `cycleTime` (14:00:00Z).
  - Asserts `found.computedAt.getTime() === computedAt.getTime()` and `!== cycleTime.getTime()`.
  - RED failure confirmed: `expected 1782223200000 to be 1782223662000` (cycleTime returned instead of computedAt).

---

## Required Artifacts

| Artifact | Expected | Status | Details |
|----------|----------|--------|---------|
| `packages/contracts/src/gex.ts` | Zod contract with all 8 SC-1 fields | VERIFIED | spot, flip, callWall, putWall, netGammaAtSpot, profile[], strikes[], byExpiry[] + computedAt all present |
| `packages/core/src/analytics/application/computeGexSnapshot.ts` | Use-case: compute GEX from leg_observations, persist snapshot | VERIFIED | Full 197-line implementation; CR-01 fix at line 141-142 |
| `packages/core/src/analytics/application/getGex.ts` | Use-case: read latest snapshot (never recompute) | VERIFIED | 30-line thin forwarder over `ForReadingGexSnapshot` port |
| `packages/adapters/src/postgres/gex-snapshot.repo.ts` | Postgres repo: read legs JOIN, persist, read snapshot | VERIFIED | 176 lines, all three port methods, CR-02 fix at lines 120 and 160 |
| `packages/adapters/src/memory/gex-snapshot.ts` | In-memory twin (architecture-boundaries §8) | VERIFIED | 89 lines, mirrors Postgres idempotency via `has(key)` guard |
| `packages/adapters/src/postgres/migrations/0009_gex_computed_at.sql` | Migration adding computed_at column | VERIFIED | Single ALTER TABLE statement; file at migrations/0009_gex_computed_at.sql |
| `packages/adapters/src/postgres/schema.ts` (gexSnapshots) | Drizzle schema with computed_at column | VERIFIED | computedAt column at schema.ts:371 |
| `apps/server/src/adapters/http/gex.routes.ts` | GET /api/analytics/gex route, no recompute | VERIFIED | 63 lines; calls getGex() use-case; parses through gexSnapshotResponse contract |
| `apps/server/src/main.ts` | CORS-first + JWT authReadGroup + chained apiRouter + AppType export | VERIFIED | CORS at 184-192, JWT gate at 212-213, chained router at 197-206, AppType at 254 |
| `apps/server/src/app-type.assert.ts` | Typecheck-only hc<AppType>() assertion | VERIFIED | Imports AppType, constructs hc client, suppresses unused var warning |
| `apps/server/src/config.ts` | SUPABASE_JWT_SECRET + WEB_ORIGIN env vars Zod-parsed | VERIFIED | configSchema.ts lines 23-27; both required, WEB_ORIGIN validated as URL |
| `apps/server/src/adapters/mcp/server.ts` | get_gex MCP tool registered (GEX-02) | VERIFIED | Lines 86-88: `if (getGex !== undefined) registerGetGexTool(server, getGex)` |
| `apps/worker/src/handlers/compute-gex-snapshot.ts` | RTH-gated handler wrapping computeGexSnapshot use-case | VERIFIED | 44 lines; RTH+holiday gate at lines 31-35; terminal handler (no further boss.send) |
| `apps/worker/src/schedule.ts` | compute-gex-snapshot queue registered (10th queue) | VERIFIED | createQueue at line 75, boss.work at line 135 |
| `apps/server/src/adapters/http/auth-integration.test.ts` | SC-4/AUTH-01 integration tests (401/CORS/HS256) | VERIFIED | 235 lines, 10 tests covering no-JWT→401, valid JWT passes, tamper→401, CORS exact origin, credentials header |

---

## Key Link Verification

| From | To | Via | Status | Details |
|------|-----|-----|--------|---------|
| `compute-analytics.ts` | `compute-gex-snapshot` queue | `boss.send("compute-gex-snapshot", {}, { singletonKey: "triggered-by-analytics" })` | WIRED | compute-analytics.ts:51-55 |
| `apps/server/src/main.ts` | `gexRoutes(getGex)` | `.route("/analytics", gexRoutes(getGex))` | WIRED | main.ts:206 |
| `apps/server/src/main.ts` | `makeMcpRouter(..., getGex, ...)` | positional arg at call site | WIRED | main.ts:234; `getGex` is non-undefined (constructed at lines 124-126) |
| `apps/server/src/main.ts` | `gexSnapshotRepo` | `makePostgresGexSnapshotRepo(db)` → `readGexSnapshot` injected into `makeGetGexUseCase` | WIRED | main.ts:123-126 |
| `gex.routes.ts` | `gexSnapshotResponse` contract | `import { gexSnapshotResponse } from "@morai/contracts"` + `gexSnapshotResponse.parse(...)` | WIRED | gex.routes.ts:2,44 |
| `schema.ts` | `0009_gex_computed_at.sql` | `computedAt: timestamp("computed_at", ...).notNull()` | WIRED | schema.ts:371; migration file exists |
| CORS middleware | `authReadGroup` JWT gate | `app.use("/*", cors(...))` declared BEFORE `app.route("/api", authReadGroup)` | WIRED | main.ts:184-214; Pitfall 7 ordering correct |

---

## Behavioral Spot-Checks

Step 7b checks omitted: no runnable entry points available without a live Supabase/Railway connection. The auth behavior is exercised by the in-process Hono test harness in `auth-integration.test.ts` which runs without a server (uses `app.request()`). Idempotency behavior is tested via testcontainers Postgres in `gex-snapshot.contract.ts`.

---

## Requirements Coverage

| Requirement | Source Plan | Description | Status | Evidence |
|-------------|------------|-------------|--------|----------|
| GEX-01 | 08-07 | GET /api/analytics/gex returns stored GEX snapshot | SATISFIED | gex.routes.ts + getGex use-case |
| GEX-02 | 08-07 | get_gex MCP tool shares gexSnapshotResponse contract | SATISFIED | tools.ts:476-510, server.ts:86-88 |
| MCP-02 | 08-07 | Single Zod schema source for HTTP + MCP (no duplicate inline schema) | SATISFIED | gexSnapshotResponse = gexSnapshotEntry (packages/contracts/src/gex.ts:59) |
| RPC-01 | 08-07 | AppType exported; hc<AppType>() compiles | SATISFIED | main.ts:254, app-type.assert.ts |
| AUTH-01 | 08-07 | Supabase JWT HS256 offline verify; CORS WEB_ORIGIN exact match | SATISFIED | main.ts:184-214; auth-integration.test.ts |
| SC-1 | 08 | gexSnapshot response shape matches contract fields | SATISFIED | packages/contracts/src/gex.ts — all 8 fields present + computedAt |
| SC-2 | 08 | GEX snapshot job runs on RTH cycle and is idempotent | SATISFIED | compute-gex-snapshot handler + onConflictDoNothing PK |
| SC-3 | 08 | AppType export + hc client compiles | SATISFIED | main.ts:254, app-type.assert.ts:19 |
| SC-4 | 08 | Auth + CORS gate; unauth → 401; CORS exact origin | SATISFIED | auth-integration.test.ts: 10 passing tests |

---

## Anti-Pattern Scan

Debt markers scanned on: computeGexSnapshot.ts, gex-snapshot.repo.ts, main.ts, gex.routes.ts, compute-gex-snapshot.ts. No TBD/FIXME/XXX markers found.

| File | Pattern | Severity | Notes |
|------|---------|----------|-------|
| `computeGexSnapshot.ts:163` | `void k` with explanatory comment | Info | Acknowledged in IN-01; `k` computed in `strikeGex` context, `void` used intentionally per TypeScript floating-expression suppression. Not a blocker. |
| `gex-snapshot.repo.ts` | No ORDER BY in JOIN query | Warning (WR-03/IN-04) | `legs[0]` used for spot — non-deterministic if multiple rows have differing `underlyingPrice`. Acknowledged advisory; not a success-criterion blocker (WR-03/IN-04 from 08-REVIEW.md). |
| `server.ts:61` | `getGex?: ForRunningGetGex` optional parameter | Info (IN-03) | Silent optional; degrades to "tool missing" if wiring regresses. In main.ts `getGex` is always passed as a concrete value (line 234), so the guard fires. Advisory only. |

---

## Deferred Operator Items (Non-Blocking)

Per Phases 03-06 precedent, two items are operator-deferred:

| Item | Description | Why Deferred |
|------|-------------|-------------|
| 08-04 live migration push | `0008_gex_snapshot.sql` and `0009_gex_computed_at.sql` applied to production Supabase | Requires live Supabase credentials + migration run; gated by prod deploy sequence (per prod-live-pipeline-state.md) |
| 08-07 Supabase JWT algorithm confirmation | Confirm production Supabase project uses HS256 (not RS256) | HS256 path is test-proven via offline verify (auth-integration.test.ts); production Supabase dashboard confirmation is an operator step |

---

## Unaddressed Advisory Findings from 08-REVIEW.md

These 6 warnings + 4 info items were explicitly NOT fixed (advisory, not blocking any success criterion):

| ID | Finding | Impact | Deferred |
|----|---------|--------|---------|
| WR-01 | `flip` uses grid-spot field named `strike` — naming confusion | Cosmetic / future-bug risk | Future cleanup |
| WR-02 | `dollarGammaContrib` private copy duplicates domain `dollarGamma` formula | Drift risk if formula changes | Future cleanup |
| WR-03 | `spot` taken from `legs[0]` only, not averaged; no `ORDER BY` in JOIN | Minor — non-deterministic for multi-price cohorts | WR-03/IN-04 paired |
| WR-04 | `callWall`/`putWall` stored as `integer`; non-1000-multiple strikes would silently truncate | Acceptable for SPX ×1000 convention today | Future cleanup if strike convention changes |
| WR-05 | `putWall` selection has no `gex < 0` gate — can return a positive-GEX strike | Spec violation in all-positive-GEX edge case (uncommon) | Future cleanup |
| WR-06 | JSONB blobs not Zod-validated at read boundary — malformed blob → flat 500 | Diagnosability risk, not correctness today | Future cleanup |
| IN-01 | `void k` noise in byExpiry loop | Cosmetic | Can clean without test |
| IN-02 | `buildSpotGrid` may not include exact `spot` as a grid node | Minor charting precision | Future cleanup |
| IN-03 | `getGex?` optional in `makeMcpRouter` — silent tool-drop on wiring regression | Low risk (main.ts always wires it) | Future: make required |
| IN-04 | Repo `readLegObsForGex` JOIN has no `ORDER BY` — paired with WR-03 | Same fix scope as WR-03 | Future cleanup |

None of these break a success criterion. They are recorded here for future-phase planning.

---

## Human Verification Required

None. All four success criteria are fully verifiable from code and tests.

---

_Verified: 2026-06-24T00:00:00Z_
_Verifier: Claude (gsd-verifier)_
