# Phase 2: Market Data & BSM Engine - Context

**Gathered:** 2026-06-10
**Status:** Ready for planning

<domain>
## Phase Boundary

A delayed SPX option chain flows from CBOE through Zod parsing into `leg_observations` on a
30-minute RTH schedule, and a property-tested BSM engine inverts IV and computes greeks for
every stored observation — filling the `bsm_*` columns that Phase 3 snapshots will read.
Three scheduled pg-boss jobs (`fetch-cboe-chain`, `fetch-rates`, `compute-bsm-greeks`) plus
`lastJobRuns` status visibility. No Schwab, no snapshot job, no analytics.

</domain>

<spec_lock>
## Requirements (locked via SPEC.md)

**7 requirements are locked.** See `02-SPEC.md` for full requirements, boundaries, and acceptance criteria.

Downstream agents MUST read `02-SPEC.md` before planning or implementing. Requirements are not duplicated here.

**In scope (from SPEC.md):**
- `ForFetchingChain` + rate ports in core; CBOE + FRED driven adapters (+ in-memory twins)
- BSM IV inversion + greeks as pure core functions (property-tested)
- Persistence: filtered chain → `leg_observations`, rates → `rate_observations`, first-seen metadata → `contracts`
- `compute-bsm-greeks` use-case
- pg-boss scheduling for the three jobs in `apps/worker`
- `lastJobRuns` reporting in status (HTTP + MCP)

**Out of scope (from SPEC.md):**
- Schwab chain/auth — Phase 4 (`ForFetchingChain` must be vendor-agnostic so Schwab slots in later)
- `snapshot-calendars` job and journal reads — Phase 3
- Full job-queue hardening (dedupe keys audit, refresh-tokens, sync-fills) — Phase 5
- Skew / term-structure analytics — Phase 6
- American-exercise pricing — SPX/SPXW are European; not needed
- Sub-minute or streaming market data — deferred v2 (D17)

</spec_lock>

<decisions>
## Implementation Decisions

### BSM model inputs
- **D-01:** Dividend yield `q` is a fixed Zod-config value, default 1.3% (trade-advisor's
  working value). Calibrated (r, q) per `docs/iv-engine-discrepancy-and-solver.md` is a
  deliberate later upgrade — only once TOS readings are available (Phase 4+). Do not build
  calibration now.
- **D-02:** Risk-free rate `r` comes from the stored FRED DGS3MO rate (SPEC req 2); 4.5%
  fallback when no rate row exists.

### Solver & time convention
- **D-03:** IV inversion = Newton-Raphson (analytic vega) with bisection fallback when
  Newton diverges or vega is too flat (deep ITM/OTM, near expiry). Property tests must
  cover the fallback path.
- **D-04:** Time to expiry = calendar days + intraday fraction: T = exact minutes to the
  expiration cutoff / minutes-per-year (365.25-day basis). Cutoff is settlement-aware:
  PM-settled (SPXW weeklies/dailies, PM monthlies) → 16:00 ET; AM-settled (SPX 3rd-Friday
  monthlies) → 09:30 ET. Resolves open question #3 in `docs/iv-engine-discrepancy-and-solver.md`.

### Prior art usage
- **D-05:** trade-advisor's `bsm.ts` and `cboe.ts` (paths in `docs/trade-advisor-inventory.md`)
  are READ-ONLY references — mine them for the CBOE endpoint URL, OSI parsing logic, payload
  shape, and edge cases. Morai code is written fresh, TDD red→green. Do not copy files; they
  are impure (module cache, hardcoded r/q, no Result) and violate strict-TS rules.

### Jobs & scheduling
- **D-06:** RTH gating is double-layered: pg-boss cron expressions scheduled in ET
  (TZ=America/New_York handles DST) fire only during market hours, AND the handler
  self-checks RTH and no-ops with a log when outside. NYSE holiday awareness is Phase 3
  (CAL-05); holiday fetches in Phase 2 are tolerated (harmless extra rows).
- **D-07:** `fetch-cboe-chain` enqueues `compute-bsm-greeks` via pg-boss on successful
  persist (chained, no gap). Compute additionally keeps a sparse fallback schedule
  (~hourly during RTH) to sweep anything missed.
- **D-08:** No manual trigger surface in Phase 2 — `trigger_job` is Phase 5 (MCP-01).
  Dev convenience via direct use-case calls in tests / a bun script if ever needed.

### Failure handling & visibility
- **D-09:** Rows whose IV inversion is mathematically unsolvable (mark below intrinsic,
  etc.) are stamped `bsm_iv = 'NaN'` (Postgres numeric supports NaN). They drop out of the
  pending partial index, vendor columns stay untouched, reads fall back to raw per BSM-03,
  failures stay queryable (`WHERE bsm_iv = 'NaN'`). No schema migration.
- **D-10:** `lastJobRuns` in the status payload carries BOTH `lastSuccessAt` and
  `lastErrorAt` + error message per job — one `/api/status` (or MCP `get_status`) glance
  shows collection broke and why.

### Data shape
- **D-11:** Store BOTH roots (SPX and SPXW) within the DTE/strike filter; `contracts.root`
  distinguishes them. Calendars may pair across roots. D-04's settlement-aware cutoff
  handles the AM/PM difference per root.
- **D-12:** Greeks stored in TOS-convention display units: theta per calendar day
  (negative = decay), vega per 1 vol point, delta/gamma raw per-share; ×100 contract
  multiplier applied at read/display, never at storage. Document the convention in
  `docs/architecture/data-model.md` when implementing.

### Config
- **D-13:** All tunables (DTE bound 90, strike band ±10%, q 1.3%, fallback rate 4.5%,
  cadences) live in the Zod config schema with hardcoded defaults; env vars override when
  set. Railway env stays minimal (secrets + URLs). Extends Phase 1's `parseConfig` pattern.

### Claude's Discretion
- Exact CBOE delayed-quotes URL + retry/backoff numbers (mine `cboe.ts` reference).
- FRED API usage (API key exists in trade-advisor env; planner decides key vs no-key CSV endpoint).
- Upsert SQL shape (`ON CONFLICT DO NOTHING` vs equivalent) for append-only idempotency.
- Which rate row matches an observation (latest date ≤ observation date is the obvious choice).
- Calibration fixture sources for the 1e-4 greek reference tests.
- pg-boss queue/job naming + payload Zod schemas.

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Locked requirements
- `.planning/phases/02-market-data-bsm-engine/02-SPEC.md` — locked requirements, boundaries, acceptance criteria. MUST read first.

### Domain decisions (user-flagged, high priority)
- `docs/iv-engine-discrepancy-and-solver.md` — WHY we build our own solver (no canonical IV; Schwab vs TOS 2-pt gap), Newton solver design, calibration deferral, DTE open question (resolved by D-04).
- `docs/trade-advisor-inventory.md` — locations of reference implementations: `mcp-server/src/lib/bsm.ts` (BSM, bisection, r=4.5%/q=1.3%), `mcp-server/src/lib/cboe.ts` (delayed chain fetch, OSI parsing, cache). Reference only per D-05.

### Architecture (source of truth)
- `docs/architecture/overview.md` — system context, hard rules.
- `docs/architecture/hexagonal-ddd.md` — port naming (`ForVerbingNoun`), layers, dependency law.
- `docs/architecture/data-model.md` — `leg_observations`, `rate_observations`, `contracts` shapes, time-leading composite keys, migration discipline.
- `docs/architecture/api-design.md` — route shape, Result→HTTP mapping (status payload extension).
- `docs/architecture/mcp-and-plugins.md` — MCP-02 rule, `get_status` tool surface.
- `docs/architecture/testing-tdd.md` — test pyramid, property tests, testcontainers, msw, calibration gates.
- `docs/architecture/stack-decisions.md` — D5/D6 (Postgres+Drizzle), D14 (Zod), D17 (no streaming), D18 (Supabase-as-Postgres).

### Rules (mechanical)
- `.claude/rules/tdd.md` — red→green; numerical code REQUIRES fast-check property tests; msw for external HTTP; testcontainers for repos.
- `.claude/rules/typescript.md` — no any/as/!; Result<T,E>; parse don't cast.
- `.claude/rules/architecture-boundaries.md` — core imports shared only; in-memory twin per driven port; HTTP+MCP in same PR.
- `.claude/rules/workflow.md` — docs-before-architecture-changes, verification before done.

### Prior phase
- `.planning/phases/01-walking-skeleton/01-CONTEXT.md` — D-05 postgres.js driver rationale, contract-test harness pattern, composition-root wiring.

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- `packages/adapters/src/postgres/schema.ts` — `legObservations`, `rateObservations`, `contracts` tables complete with `bsm_*` columns and the pending-BSM partial index (`bsm_iv IS NULL AND mark IS NOT NULL`). No migration expected this phase.
- `packages/shared` — `Result`, `assertDefined`, `OccSymbol` (use for contract symbols from CBOE OSI strings).
- `packages/adapters/src/__contract__/` — contract-test harness from the `calendars` repo; replicate for new repos/ports.
- `packages/adapters/src/memory/` — in-memory adapter pattern to twin every new driven port.
- Phase 1 `parseConfig(env)` pattern in `apps/*` — extend with Phase 2 tunables (D-13).
- `statusResponse` Zod contract in `packages/contracts/src/status.ts` — extend `lastJobRuns` from literal "none yet" to per-job success/error records (D-10).

### Established Patterns
- MCP-02: one use-case → HTTP route + MCP tool sharing one contracts schema (`get_status` extension follows automatically).
- TEST_DATABASE_URL escape hatch in `packages/adapters/test/globalSetup.ts` for local Postgres testing (Docker Desktop testcontainers stall workaround).
- Vitest 4 root `vitest.config.ts` with `test.projects` — new test files slot into per-package configs.

### Integration Points
- `apps/worker` composition root: currently boots pg-boss + migrates, schedules nothing — Phase 2 registers the three jobs here.
- `apps/server` composition root: status use-case gains job-run reads; MCP `get_status` follows via shared schema.
- `statusResponse` schema change ripples: contracts → core StatusPayload → both adapters → tests. `tokenFreshness` stays "none yet" (Phase 4).

</code_context>

<specifics>
## Specific Ideas

- Journal numbers must be eyeball-comparable to the TOS screen (D-12 units choice) — the
  whole point of the own-solver path is trusting our values against the trader's screen.
- `docs/iv-engine-discrepancy-and-solver.md` is the intellectual backbone for this phase:
  raw quotes in, our solver out, vendor-derived fields never drive decisions.

</specifics>

<deferred>
## Deferred Ideas

- **(r, q) calibration against TOS readings** — least-squares fit per iv-engine doc; needs
  manual TOS chain readings + params storage. Revisit Phase 4+ when Schwab/TOS comparison is live.
- **Retention/pruning policy for `leg_observations`** — decide at Phase 6 when analytics
  query patterns are real. No pruning until then; Supabase 500MB free-tier is the watch-item
  (~2-3 yrs headroom). Timescale hypertable remains the D7 v2 trigger.
- **Manual `trigger_job` surface** — Phase 5 (MCP-01) owns it; do not build early.
- **NYSE holiday calendar** — Phase 3 (CAL-05); Phase 2 tolerates holiday fetches.

</deferred>

---

*Phase: 2-Market Data & BSM Engine*
*Context gathered: 2026-06-10*
