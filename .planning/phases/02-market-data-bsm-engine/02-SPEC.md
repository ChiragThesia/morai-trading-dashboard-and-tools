# Phase 2: Market Data & BSM Engine — Specification

**Created:** 2026-06-10
**Ambiguity score:** 0.17 (gate: ≤ 0.20)
**Requirements:** 7 locked

## Goal

A delayed SPX option chain flows from CBOE through Zod parsing into `leg_observations` on
a 30-minute RTH schedule, and a property-tested BSM engine inverts IV and computes greeks
for every stored observation — filling the `bsm_*` columns that Phase 3 snapshots will
read.

## Background

Phase 1 shipped the walking skeleton: hexagon enforced, Supabase Postgres migrated (7
tables, RLS on), `GET /api/status` + MCP `get_status` live on Railway, worker running
pg-boss. The schema already carries everything this phase writes to:

- `leg_observations` — vendor quote columns (`bid/ask/mark/iv/delta/...`), nullable
  `bsm_iv/bsm_delta/bsm_gamma/bsm_theta/bsm_vega`, and a partial index
  (`bsm_iv IS NULL AND mark IS NOT NULL`) for the pending-compute scan.
- `rate_observations` — `(date, rate)` for FRED DGS3MO.
- `contracts` — first-seen contract metadata keyed by OCC symbol.

What does NOT exist: market-data ports in `packages/core`, CBOE/FRED adapters, any BSM
math, any registered jobs. The worker boots pg-boss but schedules nothing.

## Requirements

1. **CBOE chain port + adapter (MKT-01)**: A `ForFetchingChain` driven port with a CBOE
   adapter fetching the delayed SPX option chain, Zod-parsed before core, no auth.
   - Current: No market-data port or adapter exists.
   - Target: `packages/core` defines `ForFetchingChain`; `packages/adapters` has a CBOE
     implementation (delayed quotes endpoint, no API key) whose response is Zod-parsed
     into typed chain quotes, plus an in-memory twin.
   - Acceptance: msw-backed adapter test parses a recorded CBOE SPX payload into typed
     quotes; malformed payload yields `Result.err`, not a throw. In-memory twin passes
     the same contract test.

2. **FRED rate port + adapter (MKT-02)**: A rate port with a FRED DGS3MO adapter and a
   4.5% fallback when FRED is unreachable.
   - Current: No rate port or adapter exists; `rate_observations` is empty.
   - Target: Port returns the latest DGS3MO rate; on fetch/parse failure the adapter
     falls back to 4.5% and logs the fallback. Fetched rates persist to
     `rate_observations`.
   - Acceptance: msw test: FRED 200 → numeric rate returned and row upserted; FRED
     unreachable (network error / 500) → 4.5% returned and fallback logged (asserted).

3. **Filtered chain persistence (MKT-03)**: Fetched quotes land append-only in
   `leg_observations` with `source = 'cboe'`, filtered to near-term + near-money.
   - Current: `leg_observations` has zero rows; no writer exists.
   - Target: Each fetch stores only contracts with expiration ≤ 90 DTE and strike within
     ±10% of spot; rows tagged `source = 'cboe'`; `bsm_*` columns left NULL; first-seen
     contracts upserted into `contracts`. Re-running the same fetch window does not
     duplicate rows (composite PK `(time, contract)` honored via upsert/ignore).
   - Acceptance: testcontainers repo test: persisting a parsed fixture chain writes only
     in-filter contracts, all `source = 'cboe'`, all `bsm_iv IS NULL`; second persist of
     the same payload adds zero rows.

4. **BSM IV inversion (BSM-01)**: Invert implied vol from a European option mark,
   property-tested.
   - Current: No BSM code exists anywhere.
   - Target: Pure function in `packages/core` (imports `shared` only) recovering IV from
     (mark, spot, strike, rate, DTE, type); returns `Result.err` for unattainable marks
     (below intrinsic / above bound) instead of NaN.
   - Acceptance: fast-check suite passes 1000+ random inputs: price is monotonic in vol,
     and round-trip |recomputed mark − input mark| ≤ 1e-6. Degenerate inputs (mark below
     intrinsic, DTE 0) yield `Result.err`.

5. **BSM greeks (BSM-02)**: Delta, gamma, theta, vega from spot, strike, rate, IV, DTE.
   - Current: Does not exist.
   - Target: Pure greeks function in `packages/core` for European calls and puts.
   - Acceptance: At least 3 calibration fixtures with published reference values pass
     with |error| ≤ 1e-4 per greek; fast-check sanity properties hold (call delta ∈
     [0,1], put delta ∈ [−1,0], gamma ≥ 0, vega ≥ 0).

6. **compute-bsm-greeks fills stored rows (BSM-03)**: A use-case scans pending
   observations and writes computed values alongside vendor-raw ones.
   - Current: `bsm_*` columns exist but nothing writes them.
   - Target: Use-case reads rows where `bsm_iv IS NULL AND mark IS NOT NULL` (partial
     index), inverts IV using the stored rate (fallback 4.5% when no rate row), computes
     greeks, updates the row. Rows whose IV inversion fails are marked handled (no
     infinite re-scan) and logged.
   - Acceptance: testcontainers test: after seeding cboe rows and running the use-case,
     previously-pending rows have non-null `bsm_iv/bsm_delta/bsm_gamma/bsm_theta/bsm_vega`;
     vendor columns unchanged; re-run is a no-op.

7. **Scheduled jobs + status visibility**: `fetch-cboe-chain`, `fetch-rates`, and
   `compute-bsm-greeks` run as scheduled pg-boss jobs; status reports their last runs.
   - Current: Worker boots pg-boss but registers no jobs; `lastJobRuns` reports
     "none yet".
   - Target: Worker schedules: chain fetch every 30 min during RTH, rate fetch daily,
     greeks compute after each chain fetch. Handlers are thin (parse payload → call
     use-case → map Result). `GET /api/status` and MCP `get_status` report last
     successful run per job.
   - Acceptance: Job handler tests pass with in-memory adapters; in production,
     `GET /api/status` shows a successful `fetch-cboe-chain` run and
     `SELECT count(*) FROM leg_observations WHERE source = 'cboe'` > 0.

## Boundaries

**In scope:**
- `ForFetchingChain` + rate ports in core; CBOE + FRED driven adapters (+ in-memory twins)
- BSM IV inversion + greeks as pure core functions (property-tested)
- Persistence: filtered chain → `leg_observations`, rates → `rate_observations`,
  first-seen metadata → `contracts`
- `compute-bsm-greeks` use-case
- pg-boss scheduling for the three jobs in `apps/worker`
- `lastJobRuns` reporting in status (HTTP + MCP)

**Out of scope:**
- Schwab chain/auth — Phase 4 (`ForFetchingChain` must be vendor-agnostic so Schwab slots in later)
- `snapshot-calendars` job and journal reads — Phase 3
- Full job-queue hardening (dedupe keys audit, refresh-tokens, sync-fills) — Phase 5
- Skew / term-structure analytics — Phase 6
- American-exercise pricing — SPX/SPXW are European; not needed
- Sub-minute or streaming market data — deferred v2 (D17)

## Constraints

- Hexagon law: BSM math and use-cases live in `packages/core`, import `shared` only.
  Drizzle confined to `packages/adapters/src/postgres/`.
- TDD red→green; numerical code requires fast-check property tests (tdd.md).
- Tolerances (documented here, referenced by tests): IV round-trip ≤ 1e-6 on mark;
  greeks vs reference fixtures ≤ 1e-4.
- Chain filter: expiration ≤ 90 DTE AND strike within ±10% of spot. Constants live in
  Zod-parsed config so Phase 3+ can tune without code change.
- CBOE delayed-quotes endpoint requires no auth; adapter must tolerate the ~15-min data
  delay (timestamps come from the payload, not wall clock).
- Append-only `leg_observations`: computed `bsm_*` updates are the only permitted UPDATE.
- No new tables or migrations expected; schema from Phase 1 already fits. Any schema
  change discovered during planning must update `docs/architecture/` first.

## Acceptance Criteria

- [ ] `bun run test` green across workspace, 0 skipped; typecheck + lint clean
- [ ] msw tests cover CBOE parse-success, CBOE malformed-payload, FRED success, FRED fallback (4.5% + logged)
- [ ] fast-check IV suite: monotonicity + round-trip ≤ 1e-6 over 1000+ random inputs
- [ ] ≥ 3 greek calibration fixtures pass at ≤ 1e-4
- [ ] testcontainers: filtered persist writes `source='cboe'` rows with `bsm_iv IS NULL`; duplicate persist adds zero rows
- [ ] testcontainers: compute-bsm-greeks fills all five `bsm_*` columns on pending rows; re-run no-op
- [ ] Production: `GET /api/status` shows successful `fetch-cboe-chain` run; `leg_observations` has `source='cboe'` rows
- [ ] Every new driven port has an in-memory twin passing the shared contract test

## Ambiguity Report

| Dimension          | Score | Min  | Status | Notes                                    |
|--------------------|-------|------|--------|------------------------------------------|
| Goal Clarity       | 0.88  | 0.75 | ✓      | Execution model locked round 1           |
| Boundary Clarity   | 0.78  | 0.70 | ✓      | Jobs in scope; Schwab/snapshot excluded  |
| Constraint Clarity | 0.80  | 0.65 | ✓      | Tolerances + filter bounds locked        |
| Acceptance Criteria| 0.85  | 0.70 | ✓      | 8 pass/fail criteria                     |
| **Ambiguity**      | 0.17  | ≤0.20| ✓      |                                          |

## Interview Log

| Round | Perspective | Question summary                          | Decision locked                                          |
|-------|-------------|-------------------------------------------|----------------------------------------------------------|
| 1     | Researcher  | How do fetch/compute execute in Phase 2?  | Scheduled pg-boss jobs now (30-min RTH chain, daily rate) |
| 1     | Researcher  | Store full 20k-contract chain or slice?   | Filtered: ≤ 90 DTE, strike ±10% of spot, config-tunable   |
| 1     | Researcher  | Numeric tolerances?                       | IV round-trip 1e-6; greeks vs reference 1e-4              |
| 1     | Gate        | Ambiguity 0.17 ≤ 0.20 — proceed?          | User approved; defaults accepted (cadence, filter, status)|

---

*Phase: 02-market-data-bsm-engine*
*Spec created: 2026-06-10*
*Next step: /gsd-discuss-phase 2 — implementation decisions (how to build what's specified above)*
