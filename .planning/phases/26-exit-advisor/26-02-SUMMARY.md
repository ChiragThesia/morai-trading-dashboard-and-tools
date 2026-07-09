---
phase: 26-exit-advisor
plan: 02
subsystem: api
tags: [exits, hexagonal, fast-check, tdd, precedence, hysteresis]

requires:
  - phase: 26-01
    provides: exits domain types/ports, exported haircutFill(quote, side), exit-rules.md doc
provides:
  - packages/core/src/exits/domain/exit-rules.ts — EXIT_PRECEDENCE + threshold/hysteresis constants registry
  - packages/core/src/exits/domain/evaluate-exit.ts — evaluateExit(position, context, previousVerdict), the pure evaluator
affects: [26-03, 26-04, 26-05, 26-06, 27 (backtest replay)]

tech-stack:
  added: []
  patterns:
    - "exit-rules.ts registry mirrors picker/domain/rules.ts row style (id/label/kind/rationale/source), EXIT_PRECEDENCE as an explicit reviewable array"
    - "hysteresis via previousVerdict.ruleId+rung match — no stateful evaluator, arm/disarm bands as data on each rung row"
    - "GAMMA/TERM both surface as ExitVerdictKind 'STOP' (closed 5-value enum), distinguished by ruleId — not a copy-paste bug"
    - "ROLL prices via the shared haircutFill (26-01 extraction) — cross-context domain import explicitly sanctioned by 26-01/RESEARCH, verified eslint-clean"

key-files:
  created:
    - packages/core/src/exits/domain/exit-rules.ts
    - packages/core/src/exits/domain/exit-rules.test.ts
    - packages/core/src/exits/domain/evaluate-exit.ts
    - packages/core/src/exits/domain/evaluate-exit.test.ts
  modified:
    - packages/core/src/exits/index.ts

key-decisions:
  - "GAMMA and TERM triggers both emit verdict:'STOP' (not distinct verdict kinds) since ExitVerdictKind is a closed 5-value enum (HOLD/TAKE/STOP/ROLL/EXIT_PRE_EVENT, 26-01) — ruleId ('gamma'/'term'/'stop') and metric.name distinguish them; matches docs/architecture/exit-rules.md's Verdict column exactly"
  - "Hysteresis state derives ONLY from previousVerdict.ruleId+rung matching the candidate rung (no separate per-rung state store) — correctly modeled as a single-state finite automaton since only one verdict per calendar per cycle is ever persisted"
  - "ROLL replacement front selection: nearest to the [14,21] DTE window midpoint (17.5), tie-broken by earliest expiration — no locked tie-break rule existed, this is a documented, tested, deterministic choice"
  - "ROLL prices the shared haircutFill 'sell' side (mirrors the entry formula's front-leg-sell convention) — the currently-open front's closing quote isn't part of MarketContext/HeldPosition, so estDebit reflects only the new front's establishment cost"
  - "Staleness tolerance (45min) re-declared as a local exits-owned constant matching journal's SNAPSHOT_LEG_STALENESS_TOLERANCE_MS value, not cross-imported — domain layer imports only @morai/shared plus this context's own modules (haircutFill is the one explicit, RESEARCH-sanctioned exception)"

requirements-completed: [EXIT-01, EXIT-02, EXIT-03, EXIT-04, EXIT-05, EXIT-06, EXIT-09]

coverage:
  - id: D1
    description: "EXIT_PRECEDENCE is exhaustive over the 7-row registry, no duplicates/unknowns, and encodes STOP>EVT>GAMMA>TERM>TAKE>ROLL>HOLD exactly; every threshold/hysteresis constant equals the 26-CONTEXT.md-locked literal; refuted picker criteria never appear as an exit rule"
    requirement: "EXIT-01"
    verification:
      - kind: unit
        ref: "packages/core/src/exits/domain/exit-rules.test.ts"
        status: pass
    human_judgment: false
  - id: D2
    description: "evaluateExit resolves multi-trigger contexts to the single highest-precedence firing rule, deterministically, over 200 randomized fast-check runs"
    requirement: "EXIT-03"
    verification:
      - kind: unit
        ref: "packages/core/src/exits/domain/evaluate-exit.test.ts#evaluateExit — precedence (fast-check, multi-trigger contexts)"
        status: pass
    human_judgment: false
  - id: D3
    description: "TAKE and STOP rungs stay armed while pnlPct hovers inside the [disarm, arm] band across multiple consecutive cycles (previousVerdict fed forward) and disarm only once crossed, both directions"
    requirement: "EXIT-05"
    verification:
      - kind: unit
        ref: "packages/core/src/exits/domain/evaluate-exit.test.ts#evaluateExit — TAKE/STOP hysteresis (fast-check, no-flap both directions)"
        status: pass
    human_judgment: false
  - id: D4
    description: "AH/stale(>45min)/NaN-frontIv cohorts are indicative:true with escalate forced false, even when the underlying trigger would be STOP-worthy; a clean RTH/fresh/non-NaN cohort is not indicative"
    requirement: "EXIT-05"
    verification:
      - kind: unit
        ref: "packages/core/src/exits/domain/evaluate-exit.test.ts#evaluateExit — indicative gate runs first"
        status: pass
    human_judgment: false
  - id: D5
    description: "pnlPct === (netMark - openNetDebit)/openNetDebit for a known trade fixture (+10.0% exactly resolves the +10% TAKE rung)"
    requirement: "EXIT-02"
    verification:
      - kind: unit
        ref: "packages/core/src/exits/domain/evaluate-exit.test.ts#evaluateExit — P&L basis (never a parallel recompute)"
        status: pass
    human_judgment: false
  - id: D6
    description: "TERM fires at exactly 0.005 inversion, not at 0.00499; GAMMA requires both off-strike>2% AND frontDTE<7 halves independently, neither alone fires it"
    requirement: "EXIT-03"
    verification:
      - kind: unit
        ref: "packages/core/src/exits/domain/evaluate-exit.test.ts#evaluateExit — TERM boundary, evaluateExit — GAMMA requires BOTH halves of the AND"
        status: pass
    human_judgment: false
  - id: D7
    description: "EVT fires once cohortNow reaches the day-before-event deadline (not before); ROLL fires/doesn't at the 14-DTE/1%-spot/15%-profit boundaries, selects the nearest [14,21]-DTE candidate by midpoint distance, and prices it via the exact shared haircutFill call (not a re-derived formula)"
    requirement: "EXIT-06"
    verification:
      - kind: unit
        ref: "packages/core/src/exits/domain/evaluate-exit.test.ts#evaluateExit — EVT day-before stamp, evaluateExit — ROLL boundaries + haircutFill pricing"
        status: pass
    human_judgment: false
  - id: D8
    description: "escalate is true only for STOP-kind (incl. gamma/term) and EXIT_PRE_EVENT verdicts; TAKE/HOLD never escalate"
    requirement: "EXIT-09"
    verification:
      - kind: unit
        ref: "packages/core/src/exits/domain/evaluate-exit.test.ts#evaluateExit — escalate true only for STOP-kind and EXIT_PRE_EVENT verdicts"
        status: pass
    human_judgment: false

duration: 20min
completed: 2026-07-09
status: complete
---

# Phase 26 Plan 02: Exit rule registry + evaluateExit — the pure evaluator Summary

**The exit-rule registry (EXIT_PRECEDENCE + threshold/hysteresis constants) and evaluateExit(position, context, previousVerdict) — a pure, deterministic, session-gated, non-flapping exit-verdict evaluator — both fully unit- and fast-check-tested.**

## Performance

- **Duration:** 20 min
- **Tasks:** 2
- **Files modified:** 5 (4 created, 1 modified)

## Accomplishments

- `exit-rules.ts` — the 7-row typed registry (stop/evt/gamma/term/take/roll/hold) mirroring picker's `rules.ts` style, `EXIT_PRECEDENCE` as an explicit reviewable array, and every USER-LOCKED threshold + hysteresis disarm-band constant at the exact 26-CONTEXT.md literal (TAKE +5/+10/+15% disarm 2pp below each; STOP −25/−50% disarm 2pp above each; TERM 0.005/disarm 0.003; GAMMA 0.02-off-strike/disarm 0.015 + front-DTE<7; EVT 3-day blackout; ROLL front<14-DTE / ±1% spot / <15% profit / 14-21-DTE replacement window). Registry-invariants test asserts exhaustiveness, no duplicates, provenance on every row, and the Phase-19 refuted-criteria guard mirrored for exits.
- `evaluate-exit.ts` — the pure 3-arg `evaluateExit`. Gates first on AH/staleness(45min)/NaN(frontIv/backIv/netMark) and forces `indicative:true`+`escalate:false` without hiding which rule would have fired. Walks `EXIT_PRECEDENCE` with a per-rule evaluator; TAKE/STOP hysteresis holds a rung armed via `previousVerdict.ruleId+rung` matching, released only past the disarm band. GAMMA and TERM both surface as `verdict:"STOP"` (the closed 5-value `ExitVerdictKind` enum has no separate slots for them) distinguished by `ruleId`+`metric.name`. ROLL selects the nearest `[14,21]`-DTE replacement front to the window midpoint and prices it via the shared `haircutFill` import from picker's domain (26-01's extraction) — never a re-derived formula.
- 37 tests across both files: registry invariants, a P&L oracle (`+10.0%` exactly resolves the `+10%` rung), fast-check precedence over 200 randomized multi-trigger contexts, fast-check TAKE/STOP hysteresis no-flap in both directions, indicative-gate example tests, TERM/GAMMA boundary tests, EVT day-before-stamp tests, and 8 ROLL boundary/pricing/nearest-candidate tests.

## Task Commits

Each task was committed atomically (TDD RED confirmed by running the suite against the missing module before writing the implementation, per `.claude/rules/tdd.md`; no separate RED-only commit, matching Phase-25 precedent):

1. **Task 1: Exit-rule registry — rows + EXIT_PRECEDENCE + hysteresis constants** - `7c361f2` (feat)
2. **Task 2: evaluateExit — the pure 3-arg evaluator (gating, precedence, hysteresis, P&L, ROLL)** - `db2f428` (feat)

_Both tasks landed test+implementation in a single commit each (registry/evaluator + their test files together) since TDD RED was verified via a run-and-observe-failure step before the implementation file was written, not via a separate committed RED state._

## Files Created/Modified

- `packages/core/src/exits/domain/exit-rules.ts` - the registry + `EXIT_PRECEDENCE` + all threshold/hysteresis constants
- `packages/core/src/exits/domain/exit-rules.test.ts` - registry invariants + locked-literal tests
- `packages/core/src/exits/domain/evaluate-exit.ts` - the pure `evaluateExit` evaluator
- `packages/core/src/exits/domain/evaluate-exit.test.ts` - example + fast-check property tests
- `packages/core/src/exits/index.ts` - barrel exports for the new registry constants + `evaluateExit`

## Decisions Made

- **GAMMA/TERM verdict kind = "STOP":** the 26-01-locked `ExitVerdictKind` closed enum has only 5 values; GAMMA and TERM triggers were never meant to be separate verdict kinds — `docs/architecture/exit-rules.md`'s own rule table already lists their Verdict column as "STOP". `ruleId` ("gamma"/"term"/"stop") and `metric.name` ("gammaOffStrike"/"termInversion"/"pnlPct") are what a consumer (26-04's use-case, the Analyzer panel) reads to tell them apart, not `verdict`.
- **Hysteresis is a single-state automaton:** since only one verdict is persisted per calendar per cycle (26-01's `exit_verdicts` append-only table), `wasArmed` compares the CANDIDATE rung against the ENTIRE previous verdict's `ruleId`+`rung` — correct because a calendar can only be armed on one rung/rule at a time by construction (the evaluator itself only ever returns one winner).
- **ROLL replacement selection (Claude's discretion, no locked rule):** nearest to the `[14,21]`-DTE window midpoint (17.5), tie-broken by earliest expiration. Documented in code comments and covered by a dedicated "nearest candidate" test — a future plan can revisit if a different tie-break is desired, it is a one-function change.
- **ROLL pricing side = "sell":** `haircutFill(candidate, "sell")` mirrors the entry formula's front-leg-sell convention (the front leg is always sold). The currently-open front's OWN closing quote is not part of `MarketContext`/`HeldPosition` by design (26-01), so `estDebit` prices only the NEW front's establishment credit, not a full roll-cost netting — documented in the function's doc comment.
- **Staleness constant re-declared, not imported:** `STALENESS_TOLERANCE_MS = 45 * 60 * 1000` is a local exits-owned constant matching journal's `SNAPSHOT_LEG_STALENESS_TOLERANCE_MS` value by number, not by import — consistent with the architecture-boundaries convention that domain code only imports `@morai/shared` (the one sanctioned cross-context import, `haircutFill`, was explicitly extracted and exported in 26-01 for exactly this reuse).

## Deviations from Plan

None — plan executed exactly as written. `MarketContext`'s NaN-sentinel gate is scoped to `frontIv`/`backIv`/`netMark` (the BSM-derived fields) since the 26-01-locked `MarketContext` type carries no separate net-greeks fields; this is a direct, documented reading of the type surface handed off by 26-01, not a plan deviation.

## Issues Encountered

None. Both tasks passed on the first green run after RED was confirmed (module-not-found failures for the right reason), full suite (2431 tests), typecheck, and lint all clean on the first attempt after implementation.

## Verification

- `bun run vitest run packages/core/src/exits/domain/exit-rules.test.ts` — 10/10 passed
- `bun run vitest run packages/core/src/exits` — 37/37 passed (both files)
- `bun run test` (full suite) — 238 files / 2431 tests passed
- `bun run typecheck` — clean
- `bun run lint` — clean (only pre-existing, unrelated boundaries-plugin legacy-selector warning)

## Next Steps

- 26-03: `exit_verdicts` migration + Postgres repo + memory twin + the `ForReadingLatestSnapshotPerOpenCalendar` journal port (must NOT reuse `readJournal`/`mapSnapshotRow` — Pitfall 1, drops `schwab_chain` rows).
- 26-04: `computeExitAdvice` use-case wiring `evaluateExit` to the real ports (reads open calendars, latest snapshots, latest verdicts for hysteresis, tier-1 events; persists) + the `compute-exit-advice` terminal job chained after `compute-picker`.

## Self-Check: PASSED

All 5 created/modified files and both task commit hashes (`7c361f2`, `db2f428`) verified present on disk / in git log.
