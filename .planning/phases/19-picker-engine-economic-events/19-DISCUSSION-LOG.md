# Phase 19: Picker Engine + Economic Events - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in CONTEXT.md — this log preserves the alternatives considered.

**Date:** 2026-07-04
**Phase:** 19-picker-engine-economic-events
**Areas discussed:** Candidate universe, Scoring formula fidelity, Event-flag semantics,
Econ-events plumbing, Compute model, Snapshot source + staleness, Live-data states,
Snapshot storage + retention, Degraded-context honesty

---

## Candidate universe

| Option | Description | Selected |
|--------|-------------|----------|
| Delta-targeted OTM puts | ATM + ~30Δ/20Δ/10Δ; GEX stays a scoring bonus | ✓ |
| GEX-anchored strikes | Strikes at spot/put wall/flip/absGammaStrike | |
| Fixed %-OTM grid | Spot, −2/−4/−6% | |

**User's choice (strikes):** Delta-targeted OTM puts.

| Option | Description | Selected |
|--------|-------------|----------|
| Standard monthlies | Front nearest monthly ≥30 DTE; back next 1–2 monthlies | |
| Fixed DTE targets | Front ~30 / back ~60 snapped | |
| DTE grid (front×back) | 30/45 × 60/75/90 | |

**User's choice (expiries):** Free-text — "multitude of DTE but front usually 21–30 DTE. We'll
refine, go with some default for now." Captured as front ≥21 DTE (typ 21–30), flexible default,
planner sets grid.

| Option | Description | Selected |
|--------|-------------|----------|
| Top-N ranked (6–8) | Matches mockup card count | |
| All scored candidates | UI sorts client-side | |
| You decide | Planner picks | ✓ |

**User's choice (count):** You decide → default top-N 6–8.

---

## Scoring formula fidelity

| Option | Description | Selected |
|--------|-------------|----------|
| Keep as documented tunables | Port 40/25/15/10/10 verbatim as named constants, "tune later" | ✓ |
| Reweight now | Adjust up front (e.g. lean on slope) | |

**User's choice (weights):** Keep as documented tunables.

| Option | Description | Selected |
|--------|-------------|----------|
| Compute real BE-vs-EM | breakeven-width ÷ ±1σ EM, tunable threshold | ✓ |
| Keep ATM-strike proxy | Mockup's K===7500?1:0.7 | |
| You decide | Planner picks | |

**User's choice (5th term):** Compute real BE-vs-EM ratio.

---

## Event-flag semantics

| Option | Description | Selected |
|--------|-------------|----------|
| Whole leg life | Event in (today, legExpiry] | ✓ |
| Near-expiry window | Events within N days before expiry | |

**User's choice (window):** Whole leg life.

| Option | Description | Selected |
|--------|-------------|----------|
| All three, tunable weights | FOMC/CPI/NFP front-penalty, tunable (default 0.5) | |
| Mockup exact (FOMC/CPI only) | NFP flagged, never penalizes | |
| You decide | Planner picks | ✓ |

**User's choice (penalty):** You decide → default all-three, front-only, tunable weights.

---

## Econ-events plumbing

| Option | Description | Selected |
|--------|-------------|----------|
| TS constant, upserted by cron | FOMC dates as version-controlled TS constant | |
| DB seed script | Rows via seed/migration SQL | |
| JSON config file | FOMC dates in runtime JSON | |

**User's choice (FOMC seed):** Free-text — REJECTED all three static-seed options. "Build a module
that handles this right and saves things in our DB as a new table. Proper external module that gets
the dates accurate… maybe Schwab can give us this. **Research is required.**" Captured as D-12:
research the best accurate programmatic source (Schwab / FRED releases-dates / Fed-BLS); static seed
is fallback only.

| Option | Description | Selected |
|--------|-------------|----------|
| Weekly | Reuse fetch-cot cadence | |
| Monthly | Matches CPI/NFP rhythm | |
| You decide | Planner picks | ✓ |

**User's choice (cadence):** You decide → default weekly.

---

## Compute model

| Option | Description | Selected |
|--------|-------------|----------|
| On-demand per request | Route runs engine over latest snapshot each call; no new table/job | |
| Precomputed chain-triggered job | compute-picker job writes picker_snapshot row; route reads | ✓ |

**User's choice:** Precomputed chain-triggered job (over the recommended on-demand).
**Notes:** Chosen to match the GEX/analytics precompute architecture despite the heavier build.

---

## Snapshot source + staleness

| Option | Description | Selected |
|--------|-------------|----------|
| Add `source` enum (schwab/cboe) | Additive contract field mirroring chain provenance | ✓ |
| Keep asOf-only | Surface source out-of-band | |

**User's choice (source):** Add `source` enum — satisfies PICK-01's observedAt/source.

| Option | Description | Selected |
|--------|-------------|----------|
| One snapshot-level chip | Single header chip "as of · source" | |
| Per-card staleness | As-of/source on every card | ✓ |

**User's choice (display):** Per-card staleness (over the recommended single chip).

---

## Live-data states

| Option | Description | Selected |
|--------|-------------|----------|
| Distinct honest messages | Cold-start vs 0-passed-θ separate copy | ✓ |
| Single generic empty | One "No candidates" | |

**User's choice (empty):** Distinct honest messages.

| Option | Description | Selected |
|--------|-------------|----------|
| Mirror existing react-query hooks | useCot/useMacro skeleton + error + retry | |
| Minimal spinner + error text | Bare | |
| You decide | Planner picks | ✓ |

**User's choice (load/err):** You decide → default existing react-query hook pattern.

---

## Snapshot storage + retention

| Option | Description | Selected |
|--------|-------------|----------|
| Zod-validated JSONB blob | Whole response in one column, parse on read | ✓ |
| Normalized columns/tables | Relational candidate/breakdown rows | |

**User's choice (store):** Zod-validated JSONB blob.

| Option | Description | Selected |
|--------|-------------|----------|
| Keep history (append) | One blob per observedAt; feeds PICK-04 | ✓ |
| Latest-only (upsert) | Single current snapshot | |

**User's choice (retention):** Keep history (append).

---

## Degraded-context honesty

| Option | Description | Selected |
|--------|-------------|----------|
| Tag it (snapshot-level status) | gexContextStatus/eventsContextStatus ok\|stale\|missing; term→0 + UI tag | ✓ |
| Silent zero | Term scores 0, indistinguishable from genuine 0 | |

**User's choice:** Tag it — mirrors the fwdIv guard so no falsely-clean score ships.

---

## Claude's Discretion

- Exact delta rungs, default DTE grid, top-N cap value, score-tie determinism, fixture
  retention-for-tests.
- Which events penalize + exact per-event penalty weights (default all-three-tunable, front-only).
- Cron exact time (default weekly Friday like fetch-cot).
- `get_picker_candidates` MCP mirrors the HTTP `pickerSnapshotResponse` (trimmed-summary dropped).
- `picker_snapshot` DDL/index/pruning for the append-history table.

## Deferred Ideas

- PICK-04 slope backtest (fed by the append-history picker_snapshot table).
- PICK-05 event-premium surprise weighting.
- Separate economic-events HTTP/MCP surface (out of scope v1.2).
- Screener filters (strike-view/DTE-range user filters).
- Empirical calibration of weights + BE-vs-EM/θ/vega thresholds.
