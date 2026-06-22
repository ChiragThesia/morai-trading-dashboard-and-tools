# Phase 6: Derived Analytics — Specification

**Created:** 2026-06-22
**Ambiguity score:** 0.14 (gate: ≤ 0.20)
**Requirements:** 5 locked

## Goal

A `compute-analytics` job, chained to run after each `snapshot-calendars` cycle, writes (a) a full per-strike volatility **smile** to `skew_observations`, (b) a derived **25Δ risk-reversal** scalar with a **trailing-window percentile rank** per (underlying, expiration, snapshot time), and (c) **term-structure** observations (`back_iv − front_iv`, equal to the calendar's stored `term_slope`) — all append-only and idempotent — and these series are queryable via `GET /api/analytics/skew` and `GET /api/analytics/term-structure` plus the MCP `get_skew` / `get_term_structure` tools over one shared Zod contract.

## Background

Phase 2 fetches the option chain and computes per-contract `bsm_iv` into `leg_observations`, filtered to a strike-band around spot (`fetchChain.isInFilter`, DTE + `strikeBandPct` gates) — so multiple strikes per (underlying, expiration) exist at each snapshot time. Phase 3's `snapshot-calendars` writes per-calendar `calendar_snapshots` rows already carrying `front_iv`, `back_iv`, and `term_slope` (= `back_iv − front_iv`, the forward-vol signal). The `analytics` bounded context (per `hexagonal-ddd.md`) and the `skew_observations` / `term_structure_observations` tables (per `data-model.md`) are named but **do not exist** — no analytics tables, no `compute-analytics` job, no analytics use-cases. The MCP `get_skew` / `get_term_structure` tools are registered as typed-empty stubs (Phase 3, MCP-01) and the `GET /api/analytics/*` routes are documented (`api-design.md`) but not implemented. This phase builds the analytics context end-to-end: tables → job → use-cases → HTTP + MCP. The skew metric is `IV(OTM put) − IV(OTM call)` per the knowledge base (`volatility_skew.md`: skew is the tail-hedging-demand proxy; skew *rank* is the mean-reverting timing edge).

## Requirements

1. **Skew smile observations (ANLY-01)**: Persist the full per-strike IV smile each snapshot cycle.
   - Current: No `skew_observations` table; per-strike IV exists only transiently in `leg_observations`.
   - Target: After a snapshot cycle, `skew_observations` gains append-only rows — one per (underlying, expiration, strike) present in `leg_observations` for that snapshot time — carrying at least `iv` (from `bsm_iv`), `delta`, and `strike`/moneyness. Idempotent on (underlying, expiration, strike, snapshot_time): a duplicate run for the same snapshot time adds no rows.
   - Acceptance: Given a `leg_observations` fixture with N strikes across M expiries at one snapshot time, the job writes exactly N×M smile rows; a second run adds 0 rows (testcontainer count assertion).

2. **Risk-reversal scalar + trailing-window rank (ANLY-01)**: Derive the headline skew signal from the smile.
   - Current: No risk-reversal value, no skew rank anywhere.
   - Target: Per (underlying, expiration, snapshot_time), compute `risk_reversal = IV(25Δ put) − IV(25Δ call)`, interpolating IV to the ±25-delta points from the smile's (delta, iv) pairs; and `rr_rank` = percentile of that `risk_reversal` vs a trailing rolling window of prior values for the same (underlying, expiration) (window = last 252 trading days, or all available if shorter). Append-only, idempotent per (underlying, expiration, snapshot_time).
   - Acceptance: For a known smile fixture, the interpolated `risk_reversal` matches a hand-computed value within a fixed tolerance (fast-check/example); for a seeded history fixture, `rr_rank` equals the expected trailing percentile.

3. **Term-structure observations (ANLY-02)**: Capture the forward-vol signal per calendar.
   - Current: `term_slope` exists only inside `calendar_snapshots`; no `term_structure_observations` table.
   - Target: After a snapshot cycle, `term_structure_observations` gains one append-only row per calendar for that snapshot time, value = `back_iv − front_iv`, which MUST equal the `term_slope` stored in the corresponding `calendar_snapshots` row. Idempotent on (calendar_id, snapshot_time).
   - Acceptance: For each calendar snapshot in a cycle, the written term-structure value equals that row's `term_slope` exactly; a duplicate run adds no rows (testcontainer).

4. **compute-analytics job, chained + idempotent (ANLY-01/02)**: One job produces all of the above.
   - Current: No `compute-analytics` job; `schedule.ts` registers 8 queues, none for analytics.
   - Target: A `compute-analytics` job runs after `snapshot-calendars` completes a cycle (chain-triggered, same pattern as `compute-bsm-greeks`/`snapshot-calendars`), reading `leg_observations` + `calendar_snapshots` for the snapshot time and writing R1+R2+R3. Registered in `schedule.ts` and surfaced in `GET /api/status` `lastJobRuns`. Re-running for the same snapshot time produces no duplicate rows.
   - Acceptance: After the job runs in a testcontainer with seeded chain + snapshots, all three tables gain the expected rows; a second run is a no-op (0 new rows); the job appears in `lastJobRuns`.

5. **HTTP + MCP read surface over one contract (ANLY-03, MCP-02)**: Expose current + historical series.
   - Current: `GET /api/analytics/*` unimplemented; MCP `get_skew`/`get_term_structure` are typed-empty stubs.
   - Target: `GET /api/analytics/skew` returns a JSON array of `{ time, value, … }` (value = `risk_reversal`, with `rr_rank` and identifying fields; optionally smile detail), current + historical, queryable by underlying/expiration. `GET /api/analytics/term-structure` returns the same shape for term-structure data. MCP `get_skew` / `get_term_structure` return the identical series, validated against the **shared Zod contract** in `packages/contracts`.
   - Acceptance: With data present, `GET /api/analytics/skew` returns ≥1 entry matching the contract schema; the MCP `get_skew` tool returns a byte-equivalent series for the same query; one-sided contract change fails typecheck (MCP-02 invariant).

## Boundaries

**In scope:**
- New `analytics` bounded context: domain (risk-reversal interpolation, percentile rank, term-slope passthrough) + application use-cases + ports.
- New tables: `skew_observations` (per-strike smile), the risk-reversal + rank series (per underlying/expiration/snapshot), `term_structure_observations` (per calendar/snapshot). Drizzle migration + in-memory twins + testcontainer contract tests.
- `compute-analytics` job: chain-triggered after `snapshot-calendars`, idempotent, in `schedule.ts` + `lastJobRuns`.
- `GET /api/analytics/skew` + `GET /api/analytics/term-structure` HTTP routes.
- MCP `get_skew` + `get_term_structure` wired to real data over a shared `@morai/contracts` Zod schema.

**Out of scope:**
- Web UI / dashboard charts — deferred (D19, whole web track is deferred).
- GEX, regime metrics, P&L attribution — listed for the analytics context (`hexagonal-ddd.md`) but not this phase; separate future work.
- Per-strike IV rank (ranking every smile point) — explicitly rejected during spec; only the risk-reversal scalar is ranked.
- Backfilling analytics for historical snapshots predating this phase — the job is forward-only from when it ships (rank uses whatever history has accumulated).
- Skew across underlyings beyond what `leg_observations` already stores — no new chain breadth/fetch changes.

## Constraints

- Append-only, time-leading tables; plain Postgres (D7) — same shape as existing observation tables; idempotency enforced by a UNIQUE key per row grain, re-run is a no-op.
- Hexagonal: the `analytics` domain (interpolation, percentile) lives in `packages/core`, imports only `@morai/shared`; Drizzle confined to `packages/adapters/postgres`; the job handler is a thin driving adapter.
- `risk_reversal` requires per-contract `delta` to locate ±25Δ; when a smile lacks usable delta coverage to bracket ±25Δ, the value is recorded as null (not fabricated) and excluded from rank — never emit a wrong number.
- `term_structure_observations` value MUST equal the source `calendar_snapshots.term_slope` (no recomputation drift).
- MCP-02: HTTP route and MCP tool share exactly one Zod schema in `contracts`; a one-sided change must fail typecheck.
- TDD: testcontainers for repos (SQL never mocked); fast-check property tests for the interpolation + percentile numerics.

## Acceptance Criteria

- [ ] After `snapshot-calendars` completes, `skew_observations` gains per-strike smile rows for that snapshot time; duplicate run → 0 new rows.
- [ ] `risk_reversal` = IV(25Δ put) − IV(25Δ call) interpolated from the smile matches a hand-computed fixture within tolerance; null when ±25Δ cannot be bracketed.
- [ ] `rr_rank` equals the trailing-window percentile of `risk_reversal` for a seeded history fixture.
- [ ] `term_structure_observations` rows equal the corresponding `calendar_snapshots.term_slope`; duplicate run → 0 new rows.
- [ ] `compute-analytics` is chain-triggered after `snapshot-calendars`, registered in `schedule.ts`, visible in `GET /api/status` `lastJobRuns`, idempotent on re-run.
- [ ] `GET /api/analytics/skew` and `GET /api/analytics/term-structure` each return a contract-valid JSON array with ≥1 entry when data exists.
- [ ] MCP `get_skew` / `get_term_structure` return the same series as the HTTP routes, validated against the shared `contracts` Zod schema; a one-sided schema change fails `bun run typecheck`.

## Edge Coverage

**Coverage:** 6/6 applicable edges resolved · 0 unresolved

| Category | Requirement | Status | Resolution / Reason |
|----------|-------------|--------|---------------------|
| Idempotency | R1,R3,R4 | ✅ covered | UNIQUE per row grain; "duplicate run → 0 new rows" acceptance (testcontainer) |
| Numeric edge | R2 | ✅ covered | ±25Δ not bracketable → null risk_reversal, excluded from rank (acceptance + property test) |
| Sparse history | R2 | ✅ covered | rank uses trailing window OR all-available-if-shorter; forward-only (boundaries) |
| Source consistency | R3 | ✅ covered | term value MUST equal calendar_snapshots.term_slope (acceptance) |
| Contract parity | R5 | 🧪 backstop | one-sided Zod change fails typecheck — needs a compile-level/contract test asserting MCP↔HTTP share the schema |
| Missing data | R5 | ✅ covered | endpoints return contract-valid empty array when no data (typed-empty, not error) |

## Prohibitions (must-NOT)

**Coverage:** 3/3 applicable prohibitions resolved · 0 unresolved

| Prohibition (must-NOT statement) | Requirement | Status | Verification / Reason |
|----------------------------------|-------------|--------|------------------------|
| MUST NOT fabricate a risk_reversal when ±25Δ cannot be interpolated from the smile | R2 | resolved / test | property + example test asserts null, not a guessed value |
| MUST NOT recompute term-structure independently of `calendar_snapshots.term_slope` (no drift) | R3 | resolved / test | testcontainer asserts equality to the source row |
| MUST NOT let HTTP and MCP diverge — no second/inline analytics schema | R5 | resolved / test | shared `contracts` schema; one-sided change fails typecheck |

## Ambiguity Report

| Dimension          | Score | Min  | Status | Notes                                            |
|--------------------|-------|------|--------|--------------------------------------------------|
| Goal Clarity       | 0.88  | 0.75 | ✓      | Skew metric pinned (full smile + 25Δ RR + rank)  |
| Boundary Clarity   | 0.85  | 0.70 | ✓      | Explicit out-of-scope (GEX, web, per-strike rank)|
| Constraint Clarity | 0.80  | 0.65 | ✓      | append-only/idempotent, null-on-unbracketable    |
| Acceptance Criteria| 0.88  | 0.70 | ✓      | 7 falsifiable criteria                            |
| **Ambiguity**      | 0.14  | ≤0.20| ✓      |                                                  |

## Interview Log

| Round | Perspective     | Question summary                          | Decision locked                                                        |
|-------|-----------------|-------------------------------------------|-----------------------------------------------------------------------|
| 1     | Researcher      | Is skew computable from stored data?      | Yes — `leg_observations` holds a strike-band (multi-strike) per expiry |
| 1     | Researcher      | Is term-structure already computed?       | Yes — `calendar_snapshots.term_slope` = back_iv − front_iv; denormalize|
| 2     | Simplifier      | What skew metric?                         | Full per-strike smile stored as the skew_observations detail          |
| 2     | Simplifier      | Which expiries?                           | All expiries present in the stored band per snapshot                   |
| 3     | Boundary Keeper | Rank now or defer?                        | Include rank now                                                       |
| 4     | Failure Analyst | Smile is a curve — what does rank rank?   | Derived 25Δ risk-reversal scalar is the ranked headline; smile = detail|
| 4     | Failure Analyst | Rank over what history?                   | Trailing rolling window (252d, or all-available-if-shorter)           |

---

*Phase: 06-derived-analytics*
*Spec created: 2026-06-22*
*Next step: /gsd-discuss-phase 6 — implementation decisions (table count/shape, interpolation method, chain trigger wiring, contract shape)*
