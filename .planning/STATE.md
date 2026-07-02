---
gsd_state_version: 1.0
milestone: v1.1
milestone_name: — Real-Time Schwab Streaming
current_phase: 14
current_phase_name: fred-expansion
status: executing
stopped_at: Completed 14-07-PLAN.md
last_updated: "2026-07-02T02:57:47.266Z"
last_activity: 2026-07-02
last_activity_desc: Phase 14 execution — plan 07 (MacroCard web wiring) complete; all 7 plans done
progress:
  total_phases: 6
  completed_phases: 4
  total_plans: 28
  completed_plans: 28
  percent: 100
---

# Project State

## Project Reference

See: .planning/PROJECT.md (updated 2026-06-25)

**Core value:** For any calendar, answer "how did price and greeks move over the life of this trade?" — collected automatically, queryable by API and Claude Code.
**Current focus:** Phase 14 — fred-expansion

## Current Position

Phase: 14 (fred-expansion) — EXECUTING (all 7 plans complete)
Plan: 7 of 7 complete
Status: Ready for phase verification + prod UAT (FRED_API_KEY operator step pending, D-13)
Phases 10-13 complete. Phase 12 UAT closed 6/6 (2026-07-01); Phase 13 COT shipped + FE wired.
Last activity: 2026-07-02 — Phase 14 execution — plan 07 (MacroCard web wiring) complete

## Milestone v1.1 Summary

**6 phases, 18 requirements (GW-01..05, STRM-01..05, JRNL-02, COT-01..02, MAC-01..02, AUTH-05..06, DOC-01)**

Strict dependency chain:

- Phase 10 (DOC-01) → Phase 11 (GW-01..05, JRNL-02) → Phase 12 (STRM-01..05) → Phase 15 (AUTH-05..06)
- Phases 13 (COT-01..02) and 14 (MAC-01..02) are independent; can run parallel with 12 and each other.

Key risks carried into planning:

1. Dual-refresher rotating-token race — Phase 11 must retire TS refresh job BEFORE sidecar goes active.
2. One-streamer-per-account limit — Postgres advisory lock required before any streaming work.
3. 7-day headless re-auth gap — CBOE fallback must be confirmed live before Phase 12 go-live.
4. ACCT_ACTIVITY message types undocumented — discover empirically in Phase 12; do not hard-code.

Regression gates (must survive every phase):

- SPX OI=0 / SPY proxy (~10.048×)
- CBOE timestamps are UTC (not ET)
- GEX put-sign (negative gamma for puts)
- 65,534-param insert limit (chunk at ≤2,000 rows)

## Performance Metrics

**Velocity:**

- Total plans completed (v1.0): 76
- Average duration: ~13 min
- Total execution time: ~40 min

**By Phase:**

| Phase | Plans | Total | Avg/Plan |
|-------|-------|-------|----------|
| 01-walking-skeleton | P01+P02+P03 | ~40 min | ~13 min |
| 02 | 12 | - | - |
| 08 | 8 | - | - |
| 13 | 6 | - | - |

**Recent Trend:**

- Last 5 plans: P01 (~20 min), P02 (~8 min), P03 (~12 min), P04 (~8 min)
- Trend: Stable

*Updated after each plan completion*
| Phase 01-walking-skeleton P01 | 20 | 2 tasks | 15 files |
| Phase 01-walking-skeleton P02 | 8 | 2 tasks | 10 files |
| Phase 01-walking-skeleton P03 | 12 | 2 tasks | 15 files |
| Phase 01-walking-skeleton P04 | 8 | 2 tasks | 22 files |
| Phase 01-walking-skeleton P05 | 25 | 3 tasks | 21 files |
| Phase 03-calendar-journal-mvp P01 | 6 | 2 tasks | 7 files |
| Phase 03-calendar-journal-mvp P03 | 15 | 3 tasks | 18 files |
| Phase 03-calendar-journal-mvp P04 | 8 | 2 tasks | 6 files |
| Phase 03 P05 | 19 | 4 tasks | 17 files |
| Phase 03 P06 | 16 | 3 tasks | 20 files |
| Phase 04 P01 | 7 | 4 tasks (1 deferred) | 18 files |
| Phase 04 P02 | 20 | 4 tasks | 15 files |
| Phase 04 P04 | 13 | 5 tasks | 11 files |
| Phase 04-schwab-auth-brokerage P03 | 15 | - tasks | - files |
| Phase 04-schwab-auth-brokerage P05 | 70 | 11 tasks | 22 files |
| Phase 04-schwab-auth-brokerage P06 | 10 | 3 tasks | 4 files |
| Phase 05 P03 | 12 | 1 tasks | 2 files |
| Phase 05 P02 | 25 | - tasks | - files |
| Phase 05 P04 | 14 | 3 tasks | 14 files |
| Phase 05 P05 | 22 | 2 tasks | 19 files |
| Phase 05 P06 | 22 | 1 tasks | 2 files |
| Phase 05-jobs-fill-rebuild-integrity P07 | 11 | 3 tasks | 13 files |
| Phase 05-jobs-fill-rebuild-integrity P08 | 25 | 2 tasks | 12 files |
| Phase 05-jobs-fill-rebuild-integrity P10 | 10 | 2 tasks | 12 files |
| Phase 05-jobs-fill-rebuild-integrity P11 | 30 | 2 tasks | 5 files |
| Phase 05 P15 | 33min | 2 tasks | 16 files |
| Phase 06 P01 | 12 | 3 tasks | 15 files |
| Phase 06 P02 | 5min | 2 tasks | 5 files |
| Phase 06 P03 | 10min | 2 tasks | 8 files |
| Phase 06 P04 | 17min | 3 tasks | 30 files |
| Phase 06 P05 | 16min | 3 tasks | 33 files |
| Phase 06 P06 | 50m | 3 tasks | 10 files |
| Phase 06 P07 | 25m | 2 tasks | 3 files |
| Phase 06 P08 | 8min | 3 tasks | 12 files |
| Phase 07 P01 | 6min | 2 tasks | 2 files |
| Phase 07 P02 | 7min | 3 tasks | 9 files |
| Phase 08 P01 | 3 | 1 tasks | 1 files |
| Phase 08 P02 | 5 | 3 tasks | 8 files |
| Phase 08-web-dashboard-backend-gex-auth-rpc P04 | 2 | - tasks | - files |
| Phase 08 P05 | 11 | 2 tasks | 10 files |
| Phase 08 P06 | 7 | 2 tasks | 7 files |
| Phase 08 P07 | 9 | 3 tasks | 11 files |
| Phase 09 P01 | 5 | 3 tasks | 6 files |
| Phase 09 P02 | 334 | 3 tasks | 8 files |
| Phase 09 P03 | 13 | 3 tasks | 25 files |
| Phase 09 P04 | 17min | 3 tasks | 9 files |
| Phase 09 P09 | 10 | 2 tasks | 4 files |
| Phase 09 P06 | 10 | 3 tasks | 9 files |
| Phase 09 P07 | 9 | 3 tasks | 8 files |
| Phase 09 P08 | 11 | 3 tasks | 9 files |
| Phase 09 P10 | 75m | 3 tasks | 9 files |
| Phase 11 P01 | 3 | 3 tasks | 7 files |
| Phase 11 P03 | 5m | 4 tasks | 5 files |
| Phase 11 P05 | 8m | 2 tasks | 10 files |
| Phase 11-sidecar-scaffold-auth-migration P06 | 6 | 1 tasks | 4 files |
| Phase 11-sidecar-scaffold-auth-migration P07 | 3 | 2 tasks | 3 files |
| Phase 13 P01 | 8 | 3 tasks | 10 files |
| Phase 13-cot-adapter P03 | 8 | 2 tasks | 6 files |
| Phase 13-cot-adapter P04 | 415 | 3 tasks | 8 files |
| Phase 13-cot-adapter P05 | 6 | 2 tasks | 5 files |
| Phase 13 P06 | 9 | 2 tasks | 6 files |
| Phase 12 P07 | 13m | 3 tasks | 6 files |
| Phase 14 P01 | 18min | 3 tasks | 8 files |
| Phase 14 P02 | 12min | 1 tasks | 4 files |
| Phase 14 P03 | 15min | 3 tasks | 10 files |
| Phase 14 P04 | 10min | 2 tasks | 6 files |
| Phase 14 P05 | 20min | 3 tasks | 5 files |
| Phase 14 P06 | 15min | 3 tasks | 6 files |
| Phase 14 P07 | 15min | 3 tasks tasks | 6 files files |

## Accumulated Context

### Roadmap Evolution

- Phase 8 added (2026-06-23): Web Dashboard — React/Vite/Tailwind/shadcn frontend (apps/web) on Hono RPC + new GEX analytics endpoint. 5 screens prototyped as HTML mockups in `mockups/` (overview, analyzer, positions, journal, market).
- Phases 10-15 added (2026-06-25): Milestone v1.1 — Real-Time Schwab Streaming. schwab-py sidecar as sole Schwab boundary; live stream; COT + expanded FRED.

### Decisions

Decisions are logged in PROJECT.md Key Decisions table.
Recent decisions affecting current work:

- Roadmap: CBOE (no-auth) feeds journal before Schwab OAuth (Phase 2 → Phase 3 sequencing)
- Roadmap: BSM engine (Phase 2) precedes snapshot job (Phase 3) — snapshots store computed greeks
- Roadmap: MCP-02 is a cross-cutting constraint established in Phase 1; every use-case ships both HTTP + MCP adapters from day one
- [Phase ?]: emitDeclarationOnly instead of noEmit — TypeScript project references require composite packages to emit .d.ts files
- [Phase ?]: boundaries/dependencies (v6 rename) + **/packages/*/src/** patterns with mode:full — absolute path matching required for Bun monorepo ESLint integration
- [Phase 1 P02]: OccSymbol branded type requires `as` in the single constructor function; annotated with eslint-disable-next-line; consumer code never uses `as`
- [Phase 1 P02]: Test files excluded from tsconfig emit (exclude src/**/*.test.ts) to avoid .test.d.ts artifacts in dist/; syntactic ESLint block with project:false covers test files
- [Phase 1 P02]: boundaries allow shared→shared for intra-package relative imports within packages/shared/src
- [Phase 1 P02]: fc.date().filter(!isNaN) required in fast-check v4 — fc.date() can produce Invalid Date despite min/max bounds
- [Phase 1 P03]: StatusPayload is a plain core type — core never imports @morai/contracts; adapters parse through statusResponse.parse() at the boundary
- [Phase 1 P03]: Added main field to shared/package.json for Vite workspace resolver — Vite reads main/exports, not the module field (which is Rollup/Webpack convention)
- [Phase 1 P03]: boundaries allow core→core and contracts→contracts intra-package relative imports (same pattern as shared→shared)
- [Phase 1 P03]: try/catch around pingDb in getStatus use-case — absorbs both Result.err and thrown exceptions; maps both to db:down (T-01-06)
- [Phase 1 P04]: CalendarsRepo type lives in __contract__ (test-only); production adapters define own return types — no production code imports from __contract__
- [Phase 1 P04]: runMigrations uses fileURLToPath+dirname for CWD-independent migrations path
- [Phase 1 P04]: adapters→adapters allowed in eslint boundaries — same intra-package pattern as core→core
- [Phase 1 P04]: vitest workspace-mode skips Postgres tests (no globalSetup); per-package run required for Docker/testcontainers tests — in-memory always runs in workspace mode
- [Phase 1 P05]: parseConfig(env) takes explicit env param (testable without process.exit); bootConfig() is the thin loud-fail wrapper reading process.env — DATA-04 pattern
- [Phase 1 P05]: WebStandardStreamableHTTPServerTransport used instead of StreamableHTTPServerTransport + fetch-to-node — native Bun/Hono fetch API, no bridge needed, eliminates exactOptionalPropertyTypes incompatibility from getter/setter onclose
- [Phase 1 P05]: result.ok guard required before result.value even with Result<T, never> — exactOptionalPropertyTypes strictness
- [Phase 1 P05]: main field added to @morai/contracts, @morai/core, @morai/adapters package.json — Vite workspace resolver fix (same as @morai/shared in plan 03)
- [Phase ?]: Added optionType to schema.ts (calendars table) in Plan 01 so adapters compile against extended Calendar type; SQL migration deferred to plan 04 per D-01
- [Phase ?]: netGreek = (back - front) * qty * 100; NaN propagation when any leg NaN
- [Phase ?]: NAN_STAMP='NaN'; always write snapshot row even if legs unresolvable
- [Phase ?]: mustInclude bypass from getOpenCalendarLegs() skips DTE/band filter for open calendar legs
- [Phase ?]: compute-bsm-greeks fires boss.send(snapshot-calendars) on success fire-and-forget
- [Phase ?]: all 4 jobs gate on NYSE holiday; compute + snapshot also gate on RTH
- [Phase 3 P06]: getLiveGreeks uses formatOccSymbol(strike/1000) — same ×1000→points conversion as calendars.ts getOpenCalendarLegs
- [Phase 3 P06]: Zod v4 UUID regex: test fixtures must use valid RFC 4122 UUIDs (550e8400-... format); 00000000-...-0001 fails Zod v4 validation
- [Phase 3 P06]: journalRoutes accepts ForReadingJournal directly as the use-case is a thin forwarder
- [Phase 4 P01]: bytea customType uses customType<{data:string;driverData:Buffer}> from drizzle-orm/pg-core with dataType()='bytea'; round-trip verified in plan 04-02 testcontainers (RESEARCH A6)
- [Phase 4 P01]: Migration file renamed from drizzle-kit 0003_famous_azazel to 0003_broker_tokens; journal tag updated to match
- [Phase 4 P01]: pgcrypto CREATE EXTENSION hand-prepended as first SQL statement (drizzle-kit does not emit it)
- [Phase 4 P01]: makeMemoryBrokerTokensRepo accepts injectable getNow clock for testability
- [Phase 4 P01]: Cross-context import of StorageError + FetchError from journal/application/ports.ts allowed (application port type, not domain/ sub-path)
- [Phase 4 P02]: readTokenFreshness optional in makeGetStatusUseCase deps — backward compat for tests not injecting it
- [Phase 4 P02]: isAppId(value) type guard instead of as cast narrows Drizzle text → AppId union
- [Phase 4 P02]: refreshIssuedAt preserved from original row on token rotation — 7-day TTL anchored to first auth-code exchange
- [Phase 4 P02]: OAuthError and SchwabTokens defined in refreshToken.ts (core) to avoid core importing from adapters
- [Phase 4 P02]: statusResponse tokenFreshness: z.union([z.literal(''), tokenFreshnessMap]) — backward compat preserved
- [Phase 4 P04]: z.record(z.string(), z.record(z.string(), ...)) two-argument form required for Zod v4 (one-argument form TS2554)
- [Phase 4 P04]: Schwab symbol 21-char padded format is structurally identical to OCC; parseSchwabSymbol feeds formatOccSymbol directly
- [Phase 4 P04]: selectChainSource returns CBOE on AUTH_EXPIRED/none_yet/err — journal never stalls (D-08)
- [Phase 4 P04]: symbol parameter is caller-supplied ($SPX vs SPX) per RESEARCH A3 open question resolution
- [Phase 4 P04]: observedAt uses new Date() — Schwab chain has no top-level timestamp field
- [Phase 4 P05]: ForResolvingAccountHash resolves hashValue from /accounts/accountNumbers (Pitfall 5 — raw number forbidden in data-call URLs)
- [Phase 4 P05]: AUTH_EXPIRED → 200 with {paused:true,reason:AUTH_EXPIRED} (brokerageAuthExpiredPayload schema) not 503 — encodes D-09 business state
- [Phase 4 P05]: makeMcpRouter getPositions/Transactions/Orders optional params — backward compat with existing 4-arg call sites
- [Phase 4 P05]: traderGetAccessToken reads broker_tokens.readTokens at call time; on-demand refresh deferred to JOB-02 (Phase 5)
- [Phase 4 P06]: fetchChainUseCase pre-wired with selectChainSource closure in worker composition root — fetch-schwab-chain handler stays thin (architecture §3)
- [Phase 4 P06]: readTokenFreshness + logAuthExpiredFallback optional on handler for T-04-26 logging only — selectChainSource owns actual chain selection
- [Phase 4 P06]: fetch-cboe-chain queue replaced by fetch-schwab-chain (D-07 Schwab-primary); selectChainSource provides transparent CBOE fallback
- [Phase 4 P06]: fetch-rates, compute-bsm-greeks, snapshot-calendars schedules untouched — non-Schwab jobs continue on AUTH_EXPIRED (D-09)
- [Phase ?]: [Phase 4 P03]: doctor functions pure — checkEnvCompleteness/checkCallbackExactMatch/checkLiveRefresh take explicit inputs for unit testability
- [Phase ?]: [Phase 4 P03]: validateAndExchange: CSRF state check before any exchangeCode call (T-04-09 ordering invariant — callCount=0 proven by unit test)
- [Phase ?]: [Phase 4 P03]: Port from new URL(callbackUrl).port at runtime — no hardcoded port in auth setup (Open Question 1)
- [Phase 5 P03]: detectRoll uses orderId-only matching (RESEARCH Open Question 3) — ROLL_WINDOW_MS time-window extension documented as comment, not implemented
- [Phase 5 P03]: aggregatePartialFills sets calendarId="" — syncFills use-case (05-07) populates it during per-calendar partitioning; empty string is intentional design boundary
- [Phase 5 P03]: fc.float bounds require Math.fround() in fast-check v4 — same pattern as Phase 1 P02 fc.date().filter(!isNaN)
- [Phase ?]: Migration applied via session pooler (port 5432, max:1) — Supabase session pooler is migration-safe for DDL; transaction pooler (port 6543) would not be
- [Phase ?]: Migration rename: drizzle-kit generated 0004_supreme_snowbird renamed to 0004_calendar_events; journal tag updated (Phase 4 P01 precedent)
- [Phase ?]: [Phase 5 P04]: ForEnqueueingJob port 3-param: dedupeKey owned by use-case; adapter is thin boss.send wrapper with singletonKey
- [Phase ?]: [Phase 5 P04]: scheduledDedupeKey uses 10-min window; rebuildDedupeKey is calendar-scoped; null dedupeKey = no dedup
- [Phase ?]: [Phase 5 P04]: TRACKED_JOBS extended to 7; fetch-cboe-chain removed; SC1 complete
- [Phase 5 P05]: isNearExpiry threshold: age >= 6 days (REFRESH_TTL 7d - WARN_THRESHOLD 1d = 6d); Pitfall 3: refreshIssuedAt never reset on access-token rotation
- [Phase 5 P05]: lastRefreshError persisted on broker_tokens column (not in-memory map): worker and server are separate processes; option (a) per RESEARCH A4 = flag-only, no new table (D-14)
- [Phase 5 P05]: ForRecordingRefreshOutcome: null clears flag on success; non-null persists failure; writeTokens does NOT reset the flag — only recordRefreshOutcome owns last_refresh_error
- [Phase 5 P05]: makeRefreshTokensHandler.recordRefreshOutcome is optional dep (backward compat with 05-04 stub); rewired to real port in same commit as main.ts wiring
- [Phase 5 P06]: leg_observations.mark has NOT NULL DB constraint — no mark-NULL rows can exist; T-02-16 NaN-stamp exclusion (bsm_iv = 'NaN'::numeric) is the real skip mechanism
- [Phase 5 P06]: BSM fixture marks must be realistic: ATM call S=K=5500, T=0.277y needs mark≈200 (sigma≈0.15); mark=25 fails WR-01 residual check in invertIv → NaN-stamp
- [Phase ?]: id omitted from Postgres calendar_events INSERT: DB defaultRandom() generates PK; fillIdsHash UNIQUE is the sole idempotency key (SC4)
- [Phase 5 P08]: ForTriggeringJob (2-param) distinct from ForEnqueueingJob (3-param) — use-case output is the injection type for HTTP route + MCP tool; dedupeKey is internal to the use-case
- [Phase 5 P08]: bearer-guarded sub-group for /api/jobs/* only — existing /api/* unauthenticated routes unaffected; T-05-21 met without breaking existing behavior
- [Phase 5 P08]: makeEnqueueJobUseCase exported from @morai/core for first time (server needs it); dist/index.d.ts manually patched (tsc incremental cache did not regenerate barrel)
- [Phase ?]: parseSchwabSymbol not imported in core (adapters boundary): fill.occSymbol passed directly to readCalendarLegs; symbol validation is adapter concern at ingestion
- [Phase ?]: readUnprocessedFills/readCalendarLegs/resetCalendarAmounts stubbed as safe no-ops in main.ts; 05-08 wires real fills repo
- [Phase 5 P09]: realizedPnl = closeCredit − originalOpenDebit − feesOnClose (locked decision 2); null when no prior OPEN exists — never a wrong number; ROLL new-leg premium is cost basis not realized P&L
- [Phase 5 P09]: detectRoll delegates to shared parseOccSymbol (OSI 21-char padded canonical form); requires same root+strike+type + DIFFERENT expiry (WR-02)
- [Phase 5 P09]: aggregatePartialFills returns Result, takes caller calendarId/positionEffect, errors on empty/sumQty<=0 (no avgPrice 0 placeholder) (WR-03)
- [Phase 5 P09]: classifyFill drops dead side param — positionEffect is authoritative (WR-06)
- [Phase 5 P09]: C1 fix — fill-pairing.ts imports no node crypto; hashFillIds(ids, hasher) delegates sha256 to an injected HashFillIds port; adapter supplies sha256 hex (05-13)
- [Phase 5 P09]: 05-09 owns ALL fills data-path ports.ts additions (ForWritingFills/ForRecomputingCalendarAmounts/ForReadingUnprocessedFillsForCalendar/NewId/HashFillIds) — interface anchor for 05-11/05-12/05-13
- [Phase 5 P09]: syncFills.ts realizedPnl=null interim (prior-OPEN lookup + computeRealizedPnl call + crypto removal are 05-11 scope)
- [Phase 5 P10]: CR-02 — only invalid_grant/invalid_client are terminal (auth-expired); network/parse/unexpected-throws are retryable storage-error so pg-boss retries and status never falsely claims expiry
- [Phase 5 P10]: CR-03 — job-runs uses GROUP BY name with MAX(...) FILTER per state + correlated subselect for latest failed output; lastError only set when lastErrorAt non-null
- [Phase 5 P10]: WR-04 — triggerJobBodyFor(name) factory refines rebuild-journal⇒calendarId required without mutating triggerJobPayload.shape (MCP-02 stability); route parses body manually post-param-validation, 400 before enqueue
- [Phase 5 P10]: WR-05 — memory job-queue twin returns ok(null) on dedup hit, matching pg-boss singletonKey collision contract
- [Phase 5 P10]: IN-01 — worker does not enqueue triggers; dead pgBossJobQueue construction + import deleted (only server enqueues)
- [Phase 5 P11]: B1 — syncFills reads the prior OPEN event's netAmount as originalOpenDebit (per-calendar cache); realizedPnl = computeRealizedPnl(closeCredit, originalOpenDebit, feesOnClose), null when no prior OPEN; ROLL excludes the new leg's debit
- [Phase 5 P11]: B5 — UNKNOWN aggregate parks EACH underlying raw fill individually with real side/filledAt/UUID; zero-fill aggregate returns StorageError instead of synthesizing a non-UUID PK (WR-07)
- [Phase 5 P11]: C1 (use-case half) — syncFills imports no node crypto; deps.newId + deps.hashFillIds injected; composition root supplies node:crypto uuid/sha256; hashFillIds reference algo exported from core barrel
- [Phase 5 P11]: A2/CR-04 — extracted shared pairFills pipeline; makeSyncFillsForCalendarUseCase reads via readUnprocessedFillsForCalendar; worker rebuildJournal.syncFillsForCalendar rewired to the scoped use-case (was a full sweep discarding calendarId)
- [Phase 5 P14]: CR-A1 — MCP trigger_job now routes through triggerJobBodyFor(name) (same per-job refinement as the HTTP route, architecture-boundaries §9); rebuild-journal without calendarId returns error content and never calls enqueueJob (closes the agent-driven queue-flood path WR-04 missed); inputSchema advertised shape unchanged (MCP-02)
- [Phase 5 P14]: WR-A3 — hexToUuid is now a contiguous TOTAL nibble mapping; the v5 version/variant rewrite (which skipped input nibble 12) is removed because fills.id is a plain Postgres uuid; two (activityId,legIndex) keys differing only at nibble 12 no longer collide on the id PK (onConflictDoNothing no longer silently drops a real fill); hexToUuid exported for direct testing
- [Phase 5 P14]: IN-A1 — extractLastError uses a direct `in`+typeof narrow instead of an Object.entries scan for the single known 'message' key (behavior-preserving)
- [Phase 05]: 05-15: WR-A2 rebuild needs ForResettingFillsProcessedForCalendar — deleting events un-marks their fills so the scoped re-pair re-reads them (delete scope == sync scope)
- [Phase 05]: 05-15: ROLL split persisted as dedicated columns read by eventType-summing recompute, not re-parsed from legBreakdown JSON
- [Phase 05]: 05-16: fast-check property suite locks the round-2 invariants over randomized fill/roll/partial sequences (P1 no-double-count, P2 idempotent, P2b partial-growth, P3 rebuild reconciliation, P4 distinct-keys→distinct-uuid)
- [Phase 05]: 05-16: P1 exposed a real ROLL double-count — an OPEN consumed by a later ROLL was also emitted as a standalone OPEN. Fixed at root cause: ROLL pairing pre-computed before the emit loop (input-order independent, one fill in exactly one event)
- [Phase 05]: 05-16: P3 reconciles via the WR-A1 recompute RULE applied locally (not by importing the twin) — core tests import only @morai/shared; twin/Postgres parity already proven by 05-15's contract suite
- [Phase ?]: [Phase 06 P01]: analytics StorageError defined locally per-context (not re-exported via core barrel) to avoid duplicate-export with journal
- [Phase ?]: [Phase 06 P01]: analytics tables idempotency = time-leading composite PK as per-grain UNIQUE key (skew: snapshot_time,underlying,expiration,strike; RR: snapshot_time,underlying,expiration; term: snapshot_time,calendar_id)
- [Phase ?]: [Phase 06 P01]: analytics responses are bare z.array(entry) so .parse([]) is the contract-valid no-data case (SPEC R5); old typed-empty {observations:[]} stubs removed, stale journal.test.ts assertions relocated to analytics.test.ts
- [Phase ?]: [Phase 06 P01]: foundation plan ships RED scaffolds committed intentionally failing on unresolved SUT import (risk-reversal/percentile-rank/computeAnalytics) — 06-03/06-04/06-05 turn green
- [Phase ?]: 06-02: reconstructed missing meta/0006_snapshot.json (Phase 5 omitted it) so 0007 contains only the 3 analytics tables
- [Phase ?]: 06-02: live production Supabase migrate (0007) DEFERRED to operator (phases 03/04/05 precedent); validated against postgres:16 testcontainer
- [Phase ?]: 06-03: interpAtDelta returns null when ±0.25 not bracketed (SPEC R2)
- [Phase ?]: 06-03: percentileRank empty-history sentinel = 100; rr_rank null-ness handled by 06-05 caller
- [Phase ?]: 06-03: reconciled 06-01 percentile RED scaffold from [0,1]+null to plan-locked [0,100]+100-on-empty
- [Phase ?]: 06-04: term-structure value = calendar_snapshots.term_slope passed through unchanged (no recompute)
- [Phase ?]: 06-04: readSnapshotsForCycle = most recent snapshot time <= now, then all rows at that time (current cycle)
- [Phase ?]: 06-04: compute-analytics is the new terminal job; chain-triggered by snapshot-calendars via boss.send singletonKey
- [Phase ?]: skewResponse repurposed to headline 25Δ risk-reversal shape (value=risk_reversal); smile detail -> skewSmileResponse (SPEC R5)
- [Phase ?]: Added ForReadingSkewSmileDetail port (smile detail) distinct from ForReadingSkewSeries (headline RR series)
- [Phase ?]: [Phase 6 P06]: cycle-resolution seam fixed (CR-01/CR-02) — computeAnalytics resolves ONE data anchor (never now()); bounded latest-leg-cohort <= anchor smile read; all three analytics tables share one snapshot_time so re-runs are idempotent
- [Phase ?]: [Phase 6 P06]: ForReadingSmileSource returns {cycleTime, quotes} so the time-less smile carries the resolved DATA instant the use-case stamps with
- [Phase ?]: 06-07: risk-reversal bracket-width policy = Decision A (gate at MAX_BRACKET_WIDTH=0.30 delta units) — return null rather than interpolate across a wide non-adjacent bracket; pairs with the |delta|>=1 sign filter (WR-02/WR-04)
- [Phase ?]: MCP-02 transactions parity is enforced at runtime (transactionsResponse.parse), not compile time; a contract field rename fails the get_transactions tests but not bun run typecheck
- [Phase ?]: D20: Supabase Auth JWT (HS256 offline verify via hono/jwt) + exact-origin CORS decided for Phase 8 read endpoints
- [Phase ?]: 08-04: 0008_gex_snapshot.sql migration generated from gexSnapshots schema via drizzle-kit generate; renamed from random-word filename; live Supabase push operator-deferred
- [Phase ?]: 08-05: cycle_time derived from DATA cohort time via snapCycleTime(), never now() (SC-2/CR-01)
- [Phase ?]: 08-05: Drizzle jsonb dollar-type<T>() annotation eliminates as-casts at JSONB read time
- [Phase ?]: 08-06: compute-gex-snapshot is terminal (no boss.send) — GEX is the last step in the RTH chain (D-01, RESEARCH Open Question 2)
- [Phase ?]: 08-06: compute-analytics chain-triggers compute-gex-snapshot via boss.send(singletonKey: triggered-by-analytics) — T-08-10 dedupe
- [Phase ?]: 08-06: makePostgresGexSnapshotRepo added to @morai/adapters barrel (was missing from 08-05)
- [Phase ?]: CORS-first middleware (Pitfall 7): CORS applied before JWT group so preflight returns headers before auth rejects
- [Phase ?]: Chained apiRouter required for AppType inference (RESEARCH A5/Pattern 6): statement-style app.route() is not chainable
- [Phase ?]: A1 Supabase JWT algorithm gate operator-deferred: HS256 code path proven by integration tests using hono Jwt.sign()
- [Phase ?]: quant leaf below both core and web
- [Phase ?]: charting decision reconciled per D-05 + UI-SPEC
- [Phase ?]: BSM kernel relocated verbatim to packages/quant/src/bsm.ts — zero-import pure leaf
- [Phase ?]: packages/core/src/journal/domain/bsm.ts replaced with 5-line re-export shim to @morai/quant
- [Phase ?]: shadcn init rewrites :root to oklch light-mode defaults — override with Morai palette hex; @theme inline bridge required for bg-background resolution
- [Phase ?]: vitest project name:'web' required for --project web filter; auto-discovered by root apps/*/vitest.config.ts glob
- [Phase ?]: Date regex anchored to JAN|FEB|...|DEC month alternation to prevent false matches on '7500 PUT 30 NOV' producing '00 PUT 30'
- [Phase ?]: impliedFlatIv returns lo/hi bound (not null) when debit outside bracket; MAX_ITER=64 hard cap (T-09-07)
- [Phase ?]: POSITIONS-01 RESOLVED: brokerPosition has no computed greeks; client-side greeks via @morai/quant (D-01/D-03)
- [Phase ?]: hasSnapshots authoritative for classifyTradeHistory (JOURNAL-01)
- [Phase ?]: DialogClose uses render= prop (not asChild) for base-ui Dialog API
- [Phase ?]: Journal receives trades as props — real trade list wire-up deferred to Plan 09-10
- [Phase ?]: [Phase 09 P08]: classifyRegime pure fn — AMPLIFY when netGammaAtSpot<0, DAMPEN when >=0; drives regime strip + GEX note text
- [Phase ?]: [Phase 09 P08]: GexBars ToggleGroup uses base-ui value=[] array API (shadcn toggle-group wraps @base-ui/react/toggle-group, not Radix)
- [Phase ?]: [Phase 09 P08]: GammaProfile uses two AreaClosed instances clipped to zero line for teal/coral fills — no SVG clipPath required
- [Phase ?]: D-01 enforced: bsmPrice/bsmGreeks shared kernel across Analyzer and server for P&L consistency
- [Phase ?]: OCC strike inline extraction avoids circular import in scenario-engine
- [Phase ?]: D22 added: Python schwab-py sidecar as third Railway service; FastAPI + schwab-py v1.5.1; client_from_access_functions token callbacks; Railway private-net isolation
- [Phase ?]: D16 superseded by D22: dual-refresher rotating-token race + streamer-session ownership require single-process auth; TS OAuth client retired
- [Phase ?]: D17 lifted (v1.1): streaming scoped to position legs (LEVELONE_OPTION) + ACCT_ACTIVITY; ~500-symbol cap makes full-chain impossible
- [Phase ?]: D-08 enforced: SidecarChainResponseSchema adapter-local in packages/adapters, not packages/contracts
- [Phase ?]: OccSymbol branded via parseOccSymbol+formatOccSymbol round-trip — no 'as OccSymbol' type assertion
- [Phase ?]: timezone-aware datetime.now(UTC) in token_store.py for Python 3.14 compatibility
- [Phase ?]: 11-05: JSONResponse for 503 avoids FastAPI detail wrapper
- [Phase ?]: GW-03: refresh-tokens TS job retired in single hard-cut release (11-06, D-06); Python sidecar is sole Schwab token writer
- [Phase ?]: JRNL-02: worker chain source swapped from schwabMarketAdapter to sidecarAdapter; SIDECAR_URL added to worker config; CBOE fallback intact
- [Phase ?]: Stale tsconfig refs cause TS5012 ENOENT lint failures after deletion
- [Phase ?]: CFTC adapter + memory twin
- [Phase ?]: CotEntry defined in getCot.ts (not imported from contracts) to keep hexagon pure
- [Phase ?]: getCot.test.ts validates cotSeriesEntry shape inline — core tsconfig references only shared+quant
- [Phase ?]: Direct cotResponse.parse: CotEntry already plain strings/ints
- [Phase ?]: 12-07: Single positions table in Overview; live-overlay math in lib/live-position-greeks.ts
- [Phase ?]: 12-07: AdHocPicker/SC6 stays on Analyzer (D-06 scope boundary enforced)
- [Phase ?]: [Phase 14 P01]: macroQuery.series uses z.string().transform(split).pipe(z.array(macroSeriesId)).optional() to validate CSV tokens against MACRO_SERIES_IDS at the boundary
- [Phase ?]: [Phase 14 P01]: MacroObservationRow + 4 macro ports added as a parallel port trio beside existing rate ports; ForFetchingRate/ForPersistingRate/ForReadingRate/RateObservation left untouched (D-02)
- [Phase 14-02]: macro_observations composite PK (date, series_id) time-leading — the D-05 upsert idempotency key; source text column ('fred'|'cboe') included per Claude's Discretion — DATA-01 time-leading rule; provenance matches codebase source-tagging convention
- [Phase 14]: 14-03: shared FRED fetch helper returns internal discriminated result, not Result<T,E>, so makeFredRateAdapter/makeFredSeriesAdapter map to distinct fallback-vs-err semantics without duplicating fetch/parse/filter logic
- [Phase 14]: 14-03: macro_observations source text column read via ternary narrow (not 'as' cast) since it is plain text, not a pgEnum
- [Phase ?]: 14-04: fetch task try/catch converts rejections into Result.err before Promise.allSettled resolves, collapsing rejected/err into one accounting path in fetchMacroSeries
- [Phase ?]: 14-04: getMacro cutoffDateString compares now-minus-days as YYYY-MM-DD strings (toISOString().slice(0,10)) — no date-library dependency
- [Phase ?]: 14-05: FetchMacroSeriesUseCase local type in fetch-rates.ts mirrors FetchRateUseCase's existing {ok, error?} shape rather than importing ForRunningFetchMacroSeries directly
- [Phase ?]: 14-05: second fetch-rates schedule() call reuses the same queue/handler (no new queue) for the twice-daily D-06 cadence
- [Phase 14]: [Phase 14 P06]: exactOptionalPropertyTypes requires rebuilding macroQuery.safeParse output into a conditionally-spread object before calling getMacro (mirrors term-structure/skew route pattern)
- [Phase 14]: [Phase 14 P06]: get_macro MCP tool reuses macroQuery.safeParse directly on args (not a re-declared schema) - HTTP route and MCP tool share ONE validation schema, not just one response schema
- [Phase ?]: [Phase 14 P07]: useMacro refetch 30min/staleTime 15min — tighter than COT hourly since macro publishes twice daily (D-06)
- [Phase ?]: [Phase 14 P07]: MacroCard = plain value tiles (5 primary + 3 secondary), no sparklines — fits Overview half-width density; UnauthorizedError redeclared locally (all 6 sibling hooks do, no shared export)

### Pending Todos

None yet.

### Blockers/Concerns

- **Prod deploy debt** (carried from v1.0): Railway prod deploy is db-down + STALE. Before Phase 11 sidecar go-live, must: redeploy + fix DATABASE_URL → Schwab OAuth dance → backfill trades. Track in morai-prod-live-pipeline-state.md memory.
- **FRED_API_KEY unset in prod** (carried from Phase 2): must be set before Phase 14 can be verified live.

## Deferred Items

| Category | Item | Status | Deferred At |
|----------|------|--------|-------------|
| Web UI | apps/web React SPA (D19) | v2 | Architecture |
| Streaming | Sub-minute full-chain market data | v2 | Architecture (500-symbol cap) |
| Scale | Timescale hypertable migration (D7) | v2 trigger | Architecture |
| Multi-user | API auth beyond single bearer token | v2 | Architecture |
| Test isolation | Postgres leg-observations contract tests have cross-test contamination (re-persist/large-batch idempotency failures are flaky) | future | Phase 03 P06 |
| Realized P&L | IN-A2 — real per-leg commission/fees + intraday filledAt: BrokerTransaction domain type carries no time/commission/fees fields; needs docs-first brokerage domain + Schwab adapter change. Realized P&L stays fee-blind until a dedicated plan. | future | Phase 05 P14 |
| Event-triggered snapshot | Supplemental out-of-cycle snapshot on large underlying moves (via stream) | v1.2 | SUMMARY.md |
| Go-live: migration 0011 | `bun run migrate` (direct DATABASE_URL 5432) to apply token_json to live Supabase — file committed, testcontainer-applied; live apply pending prod-up | go-live UAT | Phase 11 P02 |
| Go-live: sidecar deploy | Create Railway sidecar service (railway.sidecar.toml, NO public domain GW-05), set 6 env vars + SIDECAR_URL on server/worker, run one-time Schwab OAuth dance to seed token_json, verify /sidecar/health ok + not public | go-live UAT | Phase 11 P05 |

## Session Continuity

Last session: 2026-07-02T02:57:37.668Z
Stopped at: Completed 14-07-PLAN.md — Phase 14 plans 7/7 done; prod UAT (FRED_API_KEY) pending
Resume file: None
