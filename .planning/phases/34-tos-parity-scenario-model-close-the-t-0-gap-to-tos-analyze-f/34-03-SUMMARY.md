---
phase: 34-tos-parity-scenario-model-close-the-t-0-gap-to-tos-analyze-f
plan: 03
subsystem: quant
tags: [put-call-parity, dividend-yield, gex, leg-observations, tos-parity]

requires:
  - phase: 34-01
    provides: "settlementTimestamp helper (unrelated to this plan's math, but same phase)"
provides:
  - "impliedDivYield(callMark, putMark, spot, strike, T, r): number | null exported from @morai/core"
  - "LegObsForGex.mark: string — raw option mark carried through the existing GEX cohort read (Postgres + in-memory)"
affects: ["34-04 (compute-gex use-case wiring: per-expiry ATM-bracket carry computation)"]

tech-stack:
  added: []
  patterns:
    - "Single-unknown parity solve (fix r externally, solve q) as a pure domain function, hand-verified against a bsmPrice-forward-priced oracle before trusting the formula"
    - "Additive leg-obs read widening (mark) — same cohort, same query, one new SELECT column; in-memory twin needs zero code change because it stores LegObsForGex objects verbatim"

key-files:
  created:
    - packages/core/src/analytics/domain/implied-carry.ts
    - packages/core/src/analytics/domain/implied-carry.test.ts
  modified:
    - packages/core/src/analytics/index.ts
    - packages/core/src/index.ts
    - packages/core/src/analytics/application/ports.ts
    - packages/adapters/src/postgres/gex-snapshot.repo.ts
    - packages/adapters/src/postgres/gex-snapshot.repo.contract.test.ts
    - packages/adapters/src/__contract__/gex-snapshot.contract.ts
    - packages/core/src/analytics/domain/gex.test.ts
    - packages/core/src/analytics/application/computeGexSnapshot.test.ts

key-decisions:
  - "34-RESEARCH.md's literally-quoted Pattern 2 formula (q = -ln[(S-(C-P)-K*e^{-rT})/S]/T) has a sign error and does not round-trip a known q. Corrected via hand-computed oracle + algebraic re-derivation to rhs = (C-P) + K*e^{-rT}, q = -ln(rhs/S)/T -- verified to recover a known q to ~1e-13 (machine precision) both by direct node computation and the shipped fast-check property (200 runs, bounded q/r/T/spot/strike/sigma)."
  - "packages/adapters/src/memory/gex-snapshot.ts needed NO code change for rule 8 -- it stores/returns LegObsForGex objects verbatim (no field-by-field reconstruction), so the widened type flows through generically. Verified by running the memory contract suite with the new mark-passthrough assertion."
  - "impliedDivYield returns a plain number | null (not Result<T,E>) -- matches 34-01's settlementTimestamp precedent (plain Date) for pure domain helpers in this analytics module; the plan's own acceptance criteria specify number | null."

patterns-established:
  - "Pattern 2 from 34-RESEARCH.md (fix r, solve q) implemented with a CORRECTED formula -- the plan's must_haves truths (parity round-trip recovers a known q) took precedence over the RESEARCH doc's literal algebra per deviation Rule 1 (auto-fix bugs)."

requirements-completed: [TOSP-02]

coverage:
  - id: D1
    description: "impliedDivYield(callMark, putMark, spot, strike, T, r) recovers a known q from bsmPrice-forward-priced synthetic call/put marks (hand-computed oracle + fast-check round-trip property, 200 runs)"
    requirement: "TOSP-02"
    verification:
      - kind: unit
        ref: "packages/core/src/analytics/domain/implied-carry.test.ts#impliedDivYield — parity round-trip oracle"
        status: pass
      - kind: unit
        ref: "packages/core/src/analytics/domain/implied-carry.test.ts#impliedDivYield — fast-check round-trip property"
        status: pass
    human_judgment: false
  - id: D2
    description: "impliedDivYield degrades to null (never NaN) on T<=0, spot<=0, a stale/wide-quote-driven non-positive parity RHS, or a non-finite input mark"
    requirement: "TOSP-02"
    verification:
      - kind: unit
        ref: "packages/core/src/analytics/domain/implied-carry.test.ts#impliedDivYield — degenerate input guards (never NaN)"
        status: pass
    human_judgment: false
  - id: D3
    description: "LegObsForGex carries the raw mark; Postgres readLegObsForGex SELECT and the in-memory twin both return it, proven by the shared contract test against real Postgres (testcontainers) and the in-memory suite"
    requirement: "TOSP-02"
    verification:
      - kind: integration
        ref: "packages/adapters/src/postgres/gex-snapshot.repo.contract.test.ts#readLegObsForGex — returns the raw mark for each leg in the cohort"
        status: pass
      - kind: unit
        ref: "packages/adapters/src/memory/gex-snapshot.contract.test.ts#readLegObsForGex — returns the raw mark for each leg in the cohort"
        status: pass
    human_judgment: false

duration: 45min
completed: 2026-07-11
status: complete
---

# Phase 34 Plan 03: implied-carry parity solver + GEX leg-obs mark widening Summary

**Pure `impliedDivYield` put-call-parity solver in `@morai/core` (with a corrected formula — RESEARCH's quoted algebra had a sign error) and `LegObsForGex.mark` widening the GEX cohort read across Postgres + the in-memory twin, both prerequisites for plan 34-04's per-expiry carry computation.**

## Performance

- **Duration:** ~45 min
- **Tasks:** 2 (both TDD: RED → GREEN)
- **Files modified:** 8 (2 created, 6 modified) + 1 SUMMARY

## Accomplishments

- `impliedDivYield(callMark, putMark, spot, strike, T, r): number | null` — a pure, single-unknown put-call-parity solve (r fixed externally, e.g. FRED in plan 34-04; solves only q). Hand-computed oracle (forward-price synthetic C/P via `bsmPrice` with a known q=0.013, recover it to ~1e-13) plus a fast-check round-trip property (200 runs, bounded q/r/T/spot/strike/sigma) prove the math; degrades to `null` — never `NaN` — on `T<=0`, `spot<=0`, or a parity right-hand side that is non-positive or non-finite (stale/wide AH quotes, corrupted marks).
- **Found and fixed a genuine bug in 34-RESEARCH.md's cited formula** before it ever reached production: the doc's literal `q = -ln[(S-(C-P)-K·e^{-rT})/S]/T` does not round-trip (verified: recovering q=0.013 produced 21.1). Re-derived algebraically and confirmed by direct numerical computation that the correct form is `rhs = (C-P) + K·e^{-rT}`, `q = -ln(rhs/S)/T` — this is what shipped.
- `LegObsForGex` gains `readonly mark: string` (raw option mark, numeric PG column convention — matches `bsmGamma`/`bsmIv`). The Postgres `readLegObsForGex` SELECT projects and maps it (no migration — `leg_observations.mark` already exists as a notNull numeric column); the shared contract test seeds a mark and asserts it round-trips through **both** the Postgres adapter (testcontainers, real SQL) and the in-memory twin.
- The in-memory twin needed zero code changes for architecture rule 8 — `makeMemoryGexSnapshotRepo` stores and returns `LegObsForGex` objects verbatim (no field-by-field reconstruction), so the widened type flows through generically. Verified by running the memory contract suite with the new mark-passthrough assertion.

## Task Commits

Each task was committed atomically per the plan-level TDD gate:

1. **Task 1 RED** — `2a4a132` (test): add failing test for impliedDivYield parity solver
2. **Task 1 GREEN** — `43c0d9d` (feat): add impliedDivYield parity-implied carry solver
3. **Fix** — `828028b` (fix): drop as-assertions from implied-carry test in favor of null narrowing (lint gate: no `any`/`as`/`!`)
4. **Task 2 RED** — `da4b797` (test): extend GEX leg-obs contract test with raw mark
5. **Task 2 GREEN** — `5c33ef1` (feat): widen LegObsForGex with the raw option mark

## Files Created/Modified

- `packages/core/src/analytics/domain/implied-carry.ts` — pure `impliedDivYield` parity solver.
- `packages/core/src/analytics/domain/implied-carry.test.ts` — hand-computed oracle, fast-check round-trip property, degenerate-input guard tests.
- `packages/core/src/analytics/index.ts`, `packages/core/src/index.ts` — barrel exports.
- `packages/core/src/analytics/application/ports.ts` — `LegObsForGex.mark: string`.
- `packages/adapters/src/postgres/gex-snapshot.repo.ts` — SELECT projection + row map add `mark`.
- `packages/adapters/src/postgres/gex-snapshot.repo.contract.test.ts` — seed wiring inserts `leg.mark` instead of a hardcoded value.
- `packages/adapters/src/__contract__/gex-snapshot.contract.ts` — shared fixture type + new mark-passthrough contract test.
- `packages/core/src/analytics/domain/gex.test.ts`, `packages/core/src/analytics/application/computeGexSnapshot.test.ts` — existing `makeLeg` fixtures gain a default `mark` to satisfy the widened type.

## Decisions Made

- **Corrected the parity formula** (see Deviations) — the plan's must_haves truths ("recovers a KNOWN q ... parity round-trip") are the actual contract; RESEARCH's literal algebra is not.
- **No memory-adapter code change** for the mark widening — the twin's generic passthrough already satisfies architecture-boundaries §8 once the shared `LegObsForGex` type carries the field. Verified rather than assumed (ran the memory contract suite).
- `impliedDivYield` returns plain `number | null`, matching 34-01's `settlementTimestamp` (plain `Date`) precedent for pure domain helpers here, and the plan's own acceptance-criteria signature.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Corrected a sign error in 34-RESEARCH.md's parity formula**
- **Found during:** Task 1, GREEN attempt (oracle test failed: recovered 21.1 instead of the input q=0.013)
- **Issue:** RESEARCH Pattern 2's literally-quoted formula `rhs = S - (C-P) - K·e^{-rT}`, `q = -ln(rhs/S)/T` does not invert put-call parity correctly — algebraically it computes `-ln(1-e^{-qT})/T`, not `q`. Verified by direct hand computation (node) before touching the test, then by the oracle/property tests themselves.
- **Fix:** Re-derived from `C - P = S·e^{-qT} - K·e^{-rT}` → `rhs = (C-P) + K·e^{-rT}`, `q = -ln(rhs/S)/T`. Verified this recovers a known q to ~1e-13 (both by direct node computation and the shipped fast-check property).
- **Files modified:** `packages/core/src/analytics/domain/implied-carry.ts`, `implied-carry.test.ts` (guard-case test also flipped: overpriced put, not overpriced call, drives the corrected `rhs` negative).
- **Commit:** `43c0d9d`

**2. [Rule 3 - Blocking] Removed `as number` type assertions to satisfy lint**
- **Found during:** post-Task-1 `bun run lint`
- **Issue:** `no-explicit-any`/`consistent-type-assertions` (CLAUDE.md's no-`as` rule) flagged `recovered as number` after a `not.toBeNull()` check.
- **Fix:** Replaced with `if (recovered === null) return;` narrowing before the numeric assertion.
- **Files modified:** `implied-carry.test.ts`
- **Commit:** `828028b`

---

**Total deviations:** 2 auto-fixed (1 bug, 1 blocking/lint). The formula fix is the load-bearing one — it directly serves the plan's must_haves truth ("recovers a KNOWN q ... parity round-trip"); without it the solver would have shipped mathematically broken despite passing a naively-written test. No scope creep — no files touched beyond what Tasks 1/2 specified plus the fixture defaults Task 2's type-widening required.

## Issues Encountered

None beyond the formula bug documented above (caught by the TDD RED→GREEN discipline itself — the money-path oracle did its job).

## User Setup Required

None — no external service configuration required.

## Next Phase Readiness

- `impliedDivYield(callMark, putMark, spot, strike, T, r): number | null` is importable from `@morai/core` — plan 34-04 wires it into `computeGexSnapshotUseCase`, grouping legs by expiry, picking the ATM-bracket strike(s), and passing the FRED-sourced `r`.
- `LegObsForGex.mark` is live end-to-end (Postgres SELECT + in-memory twin + shared contract test) — 34-04 can read raw call/put marks directly from the same `readLegObsForGex()` cohort GEX already fetches every cycle. Zero new queries.
- **Signature note for 34-04:** `impliedDivYield`'s formula is `rhs = (callMark - putMark) + strike * Math.exp(-r * T)`, `q = -ln(rhs / spot) / T` — NOT the form literally quoted in 34-RESEARCH.md's Pattern 2 section (that form has a sign error and was not implemented). If 34-04 or any later plan re-reads 34-RESEARCH.md for this formula, use this SUMMARY's corrected version instead.
- Full workspace gate green: `bun run typecheck` clean, `bun run lint` clean (only the pre-existing legacy-boundaries-selector warning, unrelated), `bun run test` — 292 test files / 3198 tests passed (includes the 24 new/modified assertions across both tasks).

## Self-Check: PASSED

All created files and commit hashes verified present (see below).

---
*Phase: 34-tos-parity-scenario-model-close-the-t-0-gap-to-tos-analyze-f*
*Completed: 2026-07-11*
