---
gsd_state_version: 1.0
milestone: v1.0
milestone_name: milestone
status: Phase 04 complete — ready for Phase 05
stopped_at: Phase 04 Plan 06 complete
last_updated: "2026-06-20T18:30:00.000Z"
last_activity: 2026-06-20 -- Phase 04 Plan 06 executed
progress:
  total_phases: 6
  completed_phases: 3
  total_plans: 31
  completed_plans: 30
  percent: 52
---

# Project State

## Project Reference

See: .planning/PROJECT.md (updated 2026-06-07)

**Core value:** For any calendar, answer "how did price and greeks move over the life of this trade?" — collected automatically, queryable by API and Claude Code.
**Current focus:** Phase 04 — schwab-auth-brokerage

## Current Position

Phase: 04 (schwab-auth-brokerage) — COMPLETE
Plan: 6 of 6 complete (Plan 06 complete — AUTH-04 degradation loop: per-app status contract + worker Schwab-primary job guard)
UAT: UAT-1 (live MCP transport) PASS 2026-06-18 (PR #2). UAT-2/3 pending — need a registered prod test calendar + RTH snapshot (ops-gated, non-blocking).
Next: Phase 05 — Jobs, Fill Rebuild & Integrity
Last activity: 2026-06-20 -- Phase 04 Plan 06 executed

Progress: [██████████████] Phase 04 100% · milestone 67% (4/6 phases)

## Performance Metrics

**Velocity:**

- Total plans completed: 15
- Average duration: ~13 min
- Total execution time: ~40 min

**By Phase:**

| Phase | Plans | Total | Avg/Plan |
|-------|-------|-------|----------|
| 01-walking-skeleton | P01+P02+P03 | ~40 min | ~13 min |
| 02 | 12 | - | - |

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

## Accumulated Context

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

### Pending Todos

None yet.

### Blockers/Concerns

None yet.

## Deferred Items

| Category | Item | Status | Deferred At |
|----------|------|--------|-------------|
| Web UI | apps/web React SPA (D19) | v2 | Architecture |
| Streaming | Sub-minute market data (D17) | v2 | Architecture |
| Scale | Timescale hypertable migration (D7) | v2 trigger | Architecture |
| Multi-user | API auth beyond single bearer token | v2 | Architecture |
| Test isolation | Postgres leg-observations contract tests have cross-test contamination (re-persist/large-batch idempotency failures are flaky) | future | Phase 03 P06 |
| Live DB push | broker_tokens migration (0003_broker_tokens.sql + pgcrypto) not yet applied to live Supabase DB | blocking for 04-02 | Phase 04 P01 Task 5 |

## Session Continuity

Last session: 2026-06-20T18:30:00.000Z
Stopped at: Phase 04 Plan 06 complete
Resume file: .planning/phases/04-schwab-auth-brokerage/04-06-SUMMARY.md
