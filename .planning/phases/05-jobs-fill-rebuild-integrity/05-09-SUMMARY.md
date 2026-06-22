---
phase: 05-jobs-fill-rebuild-integrity
plan: 09
subsystem: api
tags: [fill-pairing, realized-pnl, hexagonal-boundary, occ-symbol, tdd, fast-check]

# Dependency graph
requires:
  - phase: 05-jobs-fill-rebuild-integrity
    provides: "fill-pairing domain + syncFills use-case + calendar_events ports (plans 05-03/05-07)"
provides:
  - "Corrected realized-P&L domain formula computeRealizedPnl(closeCredit, originalOpenDebit, feesOnClose)"
  - "detectRoll requires same root+strike+type and DIFFERENT expiry (OSI-symbol parsed)"
  - "aggregatePartialFills returns Result, errors on empty/non-positive sumQty, takes caller calendarId/positionEffect"
  - "classifyFill drops the dead side param (positionEffect authoritative)"
  - "Pure hexagon: fill-pairing.ts imports no node crypto; hashFillIds delegates to an injected hasher"
  - "Data-path port contracts: ForWritingFills (A4), ForRecomputingCalendarAmounts (A3), ForReadingUnprocessedFillsForCalendar (A2), NewId + HashFillIds (C1)"
  - "D-08/D-09 realized-P&L definition corrected in docs/architecture (data-model.md, jobs.md)"
affects: [05-11, 05-12, 05-13]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Injected hasher port (HashFillIds) keeps core pure while preserving the sha256 reference algorithm"
    - "Pure domain aggregation returns Result<T,E> on malformed input instead of emitting a zero-priced event"
    - "ROLL detection delegates symbol parsing to shared parseOccSymbol (OSI canonical form)"

key-files:
  created:
    - .planning/phases/05-jobs-fill-rebuild-integrity/05-09-SUMMARY.md
  modified:
    - docs/architecture/data-model.md
    - docs/architecture/jobs.md
    - packages/core/src/journal/application/ports.ts
    - packages/core/src/journal/domain/fill-pairing.ts
    - packages/core/src/journal/domain/fill-pairing.test.ts
    - packages/core/src/journal/application/syncFills.ts
    - packages/core/src/journal/application/syncFills.test.ts

key-decisions:
  - "realizedPnl is null on CLOSE/ROLL when no prior OPEN debit is known — never a wrong number (locked decision 2 / WR-01)"
  - "On a ROLL the new leg's premium is cost basis (netAmount), never realized P&L"
  - "legOccSymbol canonical form is the OSI 21-char padded string (parseOccSymbol), not the O:-prefixed form"
  - "hashFillIds stays in the pure domain as the reference algorithm (sort + ':'-join) with the sha256 hex injected by the adapter (05-13)"
  - "classifyFill drops the dead side param rather than implementing an unused side+positionEffect matrix (CLAUDE.md: no unrequested flexibility)"
  - "05-09 owns ALL ports.ts changes for the fills data path so Waves 2-3 build against a stable contract"

patterns-established:
  - "Interface-anchor plan: port surface declared once, consumed by downstream plans with no further ports.ts churn"
  - "Docs-before-code: D-08/D-09 redefined in architecture docs before the domain implementation"

requirements-completed: [JRNL-01]

# Metrics
duration: ~20min
completed: 2026-06-21
status: complete
---

# Phase 5 Plan 09: Fill-pairing economics + hexagon purity Summary

**Corrected SC4's realized-P&L math (close credit minus the original open debit, not the new leg's cost basis), parsed real OCC structure into ROLL detection, removed the node:crypto import from the pure hexagon via an injected hasher, and declared the full fills data-path port surface for the rest of the gap round.**

## Performance

- **Duration:** ~20 min
- **Started:** 2026-06-21T22:15:00Z (approx)
- **Completed:** 2026-06-21T22:25:00Z (approx)
- **Tasks:** 2 completed
- **Files modified:** 7

## What Was Built

### Task 1 — Docs-first D-08/D-09 + data-path port contracts (commit 42903ec)

- `docs/architecture/data-model.md`: rewrote the `calendar_events.realized_pnl` definition to
  `realizedPnl = closeCredit − originalOpenDebit − feesOnClose`, defined `originalOpenDebit` as
  the prior OPEN event's debit, stated null-when-no-prior-OPEN, and clarified that a ROLL's new-leg
  premium is cost basis (`net_amount`), not realized P&L.
- `docs/architecture/jobs.md`: replaced sync-fills step 6's `closeCredit − openDebit − totalFees`
  with the corrected prior-OPEN-lookup definition; added a `sync-transactions` subsection noting the
  `fills` table is populated from Schwab transactions (A4 source, plan 05-12).
- `packages/core/src/journal/application/ports.ts`: declared `ForWritingFills` (A4),
  `ForRecomputingCalendarAmounts` (A3), `ForReadingUnprocessedFillsForCalendar` (A2), `NewId` and
  `HashFillIds` (C1) — types only, no implementations (consumed by 05-11/05-12/05-13).

### Task 2 — Fill-pairing domain fixes + hexagon purity, TDD red→green (commit b1a1e1f)

- **B1:** `computePnl(openDebit, closeCredit, totalFees)` → `computeRealizedPnl(closeCredit, originalOpenDebit, feesOnClose)`.
- **B2:** `detectRoll` parses both legs via shared `parseOccSymbol` (OSI form); requires equal
  root + strike + option type and DIFFERENT expiry. Same-expiry / different-strike / different-type /
  different-root / unparseable → false.
- **B3:** `aggregatePartialFills` now aggregates ONE pre-bucketed group, takes caller-supplied
  `calendarId` and `positionEffect`, returns `Result<AggregatedFill, FillAggregationError>`, and
  errors on empty input or `sumQty <= 0` (never `avgPrice = 0`). The internal re-grouping and the
  `calendarId: ""` / hardcoded `positionEffect: "UNKNOWN"` placeholders are gone.
- **B4:** `classifyFill` drops the dead `side` param; branches on `positionEffect` only.
- **C1:** `fill-pairing.ts` no longer imports `crypto`. `hashFillIds(ids, hasher)` keeps the pure
  reference algorithm (sort, `':'`-join) and delegates the sha256 to an injected hasher matching the
  `HashFillIds` port. The adapter supplies the sha256 hex in 05-13.

TDD: rewrote `fill-pairing.test.ts` (example + fast-check property tests: monotonicity of
`computeRealizedPnl` in all three args; aggregation qty round-trip; detectRoll matrix; injected-hasher
delegation). Confirmed RED (19 failures against the new contract), implemented GREEN (30/30).

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Adapted syncFills.ts to the new domain signatures**
- **Found during:** Task 2 (GREEN step)
- **Issue:** `syncFills.ts` (NOT in this plan's `files_modified`; its full rewiring is owned by
  05-11) calls `computePnl`, `aggregatePartialFills` (old array signature), `classifyFill(side, …)`,
  and `hashFillIds(ids)`. Renaming/retyping the domain functions broke its compile, which would fail
  the plan's `typecheck`/`lint` acceptance criteria.
- **Fix:** Minimal interim adaptation that keeps the build green without doing 05-11's work:
  - `aggregatePartialFills` err → park the bucket's fills as orphans (D-05, never drop).
  - `classifyFill(positionEffect)` call updated; removed the now-dead `classifiedSide` helper.
  - `realizedPnl` set to `null` on CLOSE and ROLL (locked decision 2: no prior-OPEN lookup yet → no
    wrong number). The prior-OPEN lookup + `computeRealizedPnl` call is wired in 05-11.
  - `hashFillIds(ids, sha256Hex)` with a local crypto hasher (syncFills keeps its existing `crypto`
    import; its removal is explicitly 05-11's scope).
- **Files modified:** packages/core/src/journal/application/syncFills.ts
- **Commit:** b1a1e1f

**2. [Rule 1 - Bug] Corrected a stale test asserting the buggy CLOSE realized-P&L**
- **Found during:** Task 2 (GREEN step)
- **Issue:** `syncFills.test.ts` asserted a CLOSE with no prior OPEN yields a numeric `realizedPnl`
  — exactly the WR-01 bug (it computed `closeCredit − 0 − fees`, a wrong number). The plan's Task 2
  action authorizes correcting stale tests that codify the old formula.
- **Fix:** Updated the assertion to expect `realizedPnl === null` (locked decision 2), keeping the
  legBreakdown-populated assertion. `syncFills.test.ts`'s deeper coverage is rebuilt in 05-11.
- **Files modified:** packages/core/src/journal/application/syncFills.test.ts
- **Commit:** b1a1e1f

**3. [Rule 1 - Bug] Test fixtures used a non-canonical OCC form**
- **Found during:** Task 2 (the syncFills ROLL test failed first)
- **Issue:** My initial `fill-pairing.test.ts` fixtures used the `O:SPX260620P07100000` form, but the
  real canonical `legOccSymbol` across the codebase (and in `syncFills.test.ts`) is the OSI 21-char
  space-padded form `SPX   260620P07100000` that shared `parseOccSymbol` consumes. `detectRoll` must
  match the real format.
- **Fix:** `detectRoll` delegates to shared `parseOccSymbol`; converted the fill-pairing test fixtures
  to the OSI form. The ROLL test in `syncFills.test.ts` now passes unchanged.
- **Files modified:** packages/core/src/journal/domain/fill-pairing.ts, fill-pairing.test.ts
- **Commit:** b1a1e1f

## Known Stubs

`syncFills.ts` sets `realizedPnl = null` on CLOSE/ROLL as a deliberate, documented interim — the
prior-OPEN-event lookup that supplies `originalOpenDebit` is wired in plan 05-11. This is the locked
"null over wrong number" behavior, not an accidental stub; the inline comments and the corrected
`syncFills.test.ts` assertion both record it. `syncFills.ts` still imports `crypto` (randomUUID +
local sha256 hasher) — its removal is explicitly scoped to 05-11 (CR-01 use-case half).

## Verification

- `bunx vitest run fill-pairing` — 30/30 pass (RED 19 failures → GREEN).
- `bunx vitest run syncFills fill-pairing` — 37/37 pass.
- `bun run test` (full workspace) — 76 files, 699 tests pass.
- `bun run typecheck` — exits 0.
- `bun run lint` — exits 0 (pre-existing boundaries v6 migration warnings only).
- `grep -v '^ *\*' packages/core/src/journal/domain/fill-pairing.ts | rg -c "from \"crypto\"|node:crypto"` → 0.
- `rg "originalOpenDebit" docs/architecture/data-model.md` → matches.
- `rg "closeCredit − openDebit − totalFees" docs/architecture/jobs.md` → no match (old formula gone).

## Self-Check: PASSED
