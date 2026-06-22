---
phase: 06-derived-analytics
plan: 07
subsystem: analytics-domain
tags: [risk-reversal, numeric-guards, tdd, fast-check, defense-in-depth]
requires:
  - packages/core/src/analytics/domain/risk-reversal.ts (existing 06-03 interpolateRiskReversal)
  - packages/core/src/analytics/application/ports.ts (SmileQuote)
provides:
  - "delta-sign / |delta|<1 sanity filter in usablePoints (WR-04)"
  - "MAX_BRACKET_WIDTH gate in interpAtDelta + documented bracket-width policy (WR-02)"
affects:
  - packages/core/src/analytics/application/computeAnalytics.ts (consumer — signature unchanged)
tech-stack:
  added: []
  patterns:
    - "Domain self-protection: pure numeric guards inside the hexagon, defense-in-depth vs upstream filtering"
    - "fast-check gate properties with teeth: RED on unbounded code, GREEN after the policy"
key-files:
  created: []
  modified:
    - packages/core/src/analytics/domain/risk-reversal.ts
    - packages/core/src/analytics/domain/risk-reversal.test.ts
    - packages/core/src/analytics/domain/risk-reversal.property.test.ts
decisions:
  - "Bracket-width policy = Decision A (the gate): return null when the bracketing pair spans > MAX_BRACKET_WIDTH"
  - "MAX_BRACKET_WIDTH = 0.30 in delta units — admits a normal adjacent-OTM bracket straddling ±0.25, rejects the 0.40–0.60-wide non-adjacent spans flagged in review"
metrics:
  duration: "~25m"
  completed: 2026-06-22
  tasks: 2
  files: 3
status: complete
---

# Phase 6 Plan 07: Risk-Reversal Numeric Guards (WR-04 + WR-02) Summary

Two accuracy/safety hazards in the pure-domain `interpolateRiskReversal` closed via TDD: a
`|delta| >= 1` sanity filter so a mis-signed/unstable BSM delta can never land in the wrong ±25Δ
wing (WR-04), and a `MAX_BRACKET_WIDTH = 0.30` gate that returns null instead of interpolating
across a too-wide non-adjacent bracket (WR-02). No use-case or adapter changes — signature unchanged.

## What Was Built

### Task 1 — Delta-sign / non-physical sanity filter (WR-04 / W3)
- Added `if (Math.abs(delta) >= 1) continue;` to `usablePoints`, before the put/call split.
- A real option delta is strictly within `(-1, 1)`; a magnitude at/beyond 1 signals a mis-signed or
  numerically unstable deep-ITM solve. Dropping it keeps it out of either wing regardless of sign.
- Defense-in-depth: the strike band is enforced upstream in `fetchChain.isInFilter`, but the
  analytics layer no longer trusts that blindly.
- **Commit:** `c77bf6b`

### Task 2 — Bracket-width policy: decide, enforce, property-test (WR-02 / W2)
- **Decision A (the gate)** chosen — the SPEC R2 "never emit a wrong number" stance and the plan's
  recommended default. `interpAtDelta` returns null when `upper.delta - lower.delta > MAX_BRACKET_WIDTH`.
- `MAX_BRACKET_WIDTH = 0.30` (delta units), documented in a rationale comment block next to
  `PUT_TARGET_DELTA`/`CALL_TARGET_DELTA`. A too-sparse smile is treated as unbracketable, not guessed.
- **Commit:** `15ca5b6`

## Bracket-Width Decision (WR-02)

**Decision A — explicit gate, threshold 0.30 in delta space.**

Rationale: linear-in-delta interpolation between two points far apart in delta describes a smile too
sparse to trust a straight line — the result can land far from the true 25Δ vol yet still be a real
number. SPEC R2's intent is "never emit a wrong number," so a wide bracket is treated the same as an
unbracketable wing: null.

Threshold justification: typical near-the-money SPX strike grids give adjacent-strike delta steps
well under 0.30, so a legitimate shallow+deep pair straddling ±0.25 (e.g. −0.20/−0.35 = 0.15 wide,
or worked-example −0.20/−0.30 = 0.10 wide) passes; the 0.40–0.60-wide non-adjacent spans flagged in
06-REVIEW (WR-02) are rejected. The threshold is a delta-space distance, unit-consistent with the
interpolation axis.

Decision B (unbounded + tolerance property) was rejected: a gate that refuses to guess is strictly
safer for a trading analytic than one that bounds error after the fact, and it matches the existing
null-on-unbracketable contract exactly.

## Fast-check Results

- **`bracket-width gate: wide non-adjacent bracket → null`** — RED on the unbounded code (`Property
  failed by returning false` — it returned a guessed number), GREEN after the gate. 1000 runs.
- **`bracket-width gate: within-width bracket straddling ±0.25 → finite RR`** — complement property
  proving the gate does not reject legitimate tight smiles. 1000 runs, green throughout.
- Existing properties (no-overshoot, null-safety, order-independence) stay green; the no-overshoot
  property already short-circuits on null, so it is unaffected by the gate.

## Deviations from Plan

### Test-command syntax (informational, not a code deviation)
- The plan's verify command `bun run test --filter @morai/core -- risk-reversal.test` is not valid
  for this repo's vitest 4 (`--filter`/`--` are rejected by the root `vitest run` script). Used the
  working equivalent: `cd packages/core && bunx vitest run risk-reversal.test` for per-file runs and
  `bun run test` for the full workspace suite. No source/behavior impact.

### RED fixture design (Rule 1-adjacent — strengthening, no scope change)
- Initial Task 1 stray-point fixtures (`[...workedExampleSmile, strayPut@-1.4]`) did NOT go RED: a
  `|delta|>=1` point is always further from the target than a legitimate −0.30, so it can never
  become the *tightest* bracket when a physical deep point exists — the test passed pre-filter and
  had no teeth. Reworked the fixtures so the stray is the *only* point that deepens the wing past
  ±0.25; on unfiltered code that fabricates a wing IV across a non-physical gap (RED: returns
  ~0.076 instead of null), and the filter correctly yields null. Kept one harmless-stray regression
  test (well-bracketed smile + stray → unchanged 0.06) to guard against an over-aggressive filter.

## Known Stubs

None.

## Threat Flags

None — no new network/auth/file/schema surface. Both threat-register mitigations (T-06-25, T-06-26)
are now implemented and test-backed.

## Verification

- `cd packages/core && bunx vitest run risk-reversal.test risk-reversal.property` → 21 passed.
- `bun run test` (full workspace, incl. testcontainer Postgres) → **938 passed (102 files)**.
- `bun run typecheck` → clean. `bun run lint` → clean (only a pre-existing boundary-plugin legacy-
  selector warning, unrelated to this change).
- RED reproduced for both fixes before GREEN; no `any`/`as`/`!`; domain imports only the `SmileQuote`
  type from the same context's ports (hexagon purity preserved, no node builtins).

## Self-Check: PASSED

All modified source/test files and the SUMMARY exist on disk; both task commits (`c77bf6b`,
`15ca5b6`) are present in git history.
