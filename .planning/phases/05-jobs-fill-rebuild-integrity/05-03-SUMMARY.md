---
phase: 05-jobs-fill-rebuild-integrity
plan: 03
subsystem: fill-pairing-domain
tags: [tdd, pure-domain, fill-pairing, journal, fast-check]
dependency_graph:
  requires:
    - 05-01 (CalendarEvent/RawFill/AggregatedFill types, throwing stubs, Wave-0 RED baseline)
  provides:
    - classifyFill implementation (D-02)
    - aggregatePartialFills implementation (D-04)
    - computePnl implementation (D-08/D-09)
    - detectRoll implementation (D-03)
    - hashFillIds implementation (SHA-256, T-05-06)
  affects:
    - 05-07 (syncFills use-case consumes all five functions)
    - 05-08 (rebuildJournal use-case consumes computePnl and hashFillIds)
tech_stack:
  added: []
  patterns:
    - TDD RED→GREEN (Wave-0 stubs from 05-01 provided the baseline; 05-03 extended + implemented)
    - fast-check property tests with Math.fround() for fc.float v4 compatibility
    - node:crypto createHash("sha256") for sync deterministic hashing
    - Map-keyed aggregation with null-safe accumulation
key_files:
  created: []
  modified:
    - packages/core/src/journal/domain/fill-pairing.ts
    - packages/core/src/journal/domain/fill-pairing.test.ts
decisions:
  - detectRoll uses orderId-only matching per RESEARCH Open Question 3 (ROLL_WINDOW_MS time-window reserved as comment, no test demands it)
  - aggregatePartialFills sets calendarId to "" (empty string) as it is populated by syncFills use-case which knows the calendarId context
  - fc.float bounds wrapped in Math.fround() per fast-check v4 requirement (same decision as Phase 1 P02 fc.date filter)
metrics:
  duration: 12 min
  completed: "2026-06-21T22:00:00Z"
  tasks: 1
  files: 2
---

# Phase 05 Plan 03: Fill-Pairing Pure Domain Functions Summary

Five pure fill-pairing functions implemented via TDD: classifyFill (D-02), aggregatePartialFills (D-04), computePnl (D-08/D-09), detectRoll (D-03), and hashFillIds (SHA-256 idempotency key). 26 tests GREEN including fast-check property tests for computePnl monotonicity and aggregatePartialFills qty round-trip.

## Tasks Completed

| Task | Name | Commit | Status |
|------|------|--------|--------|
| RED | Extend fill-pairing tests with avgPrice, fees, empty-input assertions | 34385a9 | DONE |
| GREEN | Implement all 5 fill-pairing domain functions | 2fde3d5 | DONE |

## What Was Built

### RED Phase (34385a9)

Extended `fill-pairing.test.ts` with 5 additional example tests that were missing from the Wave-0 baseline:
- `qty-weighted avgPrice`: verifies (2*10 + 3*20) / 5 = 16 (D-04 exactness)
- `totalCommission + totalFees summed`: verifies accumulation from partial fills
- `null commission/fees treated as 0`: verifies null-safe arithmetic
- `empty input → empty output`: verifies degenerate case
- All 26 tests confirmed RED on "not implemented" (not import errors)

### GREEN Phase (2fde3d5)

**`classifyFill`** (D-02):
- Switch on `positionEffect` (not side) — OPENING→OPEN, CLOSING→CLOSE, UNKNOWN→UNKNOWN
- Side is irrelevant to the classification: both buy-to-open and sell-to-open → OPEN

**`aggregatePartialFills`** (D-04):
- Map keyed on `${occSymbol}|${orderId}` — groups partial fills
- `avgPrice = weightedPriceSum / sumQty` (qty-weighted)
- `totalCommission` and `totalFees` null-safe (`?? 0`)
- `calendarId` set to `""` — syncFills use-case (05-07) populates it during per-calendar partitioning
- `positionEffect` defaults to `"UNKNOWN"` — enriched by syncFills before aggregation

**`computePnl`** (D-08/D-09):
- `Math.abs(closeCredit) - openDebit - totalFees` — single line, no branching

**`detectRoll`** (D-03):
- Same calendarId + same orderId + different legOccSymbol → true
- Different calendarId → false; different orderId → false; same symbol → false
- ROLL_WINDOW_MS time-based fallback documented as comment only (no test demands it)

**`hashFillIds`** (T-05-06):
- Sort ids → join with `:` → `createHash("sha256").update(joined).digest("hex")`
- Order-independent, deterministic, exactly 64 hex characters

**Test fix (Rule 1 auto-fix):** `fc.float` bounds wrapped in `Math.fround()` — fast-check v4 requires 32-bit float bounds.

## Verification Evidence

```
bun test src/journal/domain/fill-pairing.test.ts
 26 pass
 0 fail
 30 expect() calls
Ran 26 tests across 1 file. [38.00ms]

rg -c "createHash" packages/core/src/journal/domain/fill-pairing.ts → 5

rg -nE "\bas\b|: any|!\." packages/core/src/journal/domain/fill-pairing.ts
  → lines 83 and 140 are JSDoc comment text only (not type assertions)
  → zero production-code violations

bunx tsc --noEmit (packages/core) → 0 errors

git log --oneline:
  2fde3d5 feat(05-03): implement fill-pairing domain functions
  34385a9 test(05-03): extend fill-pairing RED tests
  → test(05-03) precedes feat(05-03) ✓
```

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] fc.float constraints require Math.fround() in fast-check v4**
- **Found during:** GREEN phase — 2 property tests failed with "fc.float constraints.min must be a 32-bit float"
- **Issue:** fast-check v4 requires float bounds to be exact 32-bit floats (Math.fround). Non-fround values throw at test runtime.
- **Fix:** Wrapped all `min`/`max` in `fc.float({...})` calls with `Math.fround()` — 4 call sites in 2 property tests.
- **Files modified:** `packages/core/src/journal/domain/fill-pairing.test.ts`
- **Commit:** 2fde3d5 (bundled into GREEN commit per minimal-commit hygiene)
- **Precedent:** Same pattern documented in STATE.md decisions: "fc.date().filter(!isNaN) required in fast-check v4" (Phase 1 P02).

## Known Stubs

None — all five functions are implemented. The `calendarId: ""` in `aggregatePartialFills` output is intentional: it is populated by the `syncFills` use-case (05-07) which performs per-calendar partitioning before calling this function. It is not a stub — it is an intentional design boundary.

## Threat Flags

None — pure domain functions, no I/O, no external input.

T-05-06 (Tampering — hashFillIds idempotency key): mitigated. `hashFillIds` is deterministic and order-independent: same fill set → same SHA-256 hex → UNIQUE constraint on `calendar_events.fill_ids_hash` blocks duplicate event injection. Verified by the `order-independence` and `determinism` tests.

T-05-07 (Repudiation — classifyFill UNKNOWN path): mitigated. `classifyFill` explicitly returns `"UNKNOWN"` for any `positionEffect === "UNKNOWN"` input — never silently misclassifies. The `syncFills` use-case (05-07) routes UNKNOWN to orphan parking (D-05).

## TDD Gate Compliance

- RED commit: `34385a9` (test(05-03): extend fill-pairing RED tests — avgPrice, fees, empty input)
- GREEN commit: `2fde3d5` (feat(05-03): implement fill-pairing domain functions)

RED gate: 26 tests failed on "not implemented" (assertion errors, not import errors). Confirmed via `bun test` output.
GREEN gate: 26/26 tests pass.

## Self-Check: PASSED

Files verified present:
- packages/core/src/journal/domain/fill-pairing.ts ✓ (min_lines: 40, actual: ~160)
- packages/core/src/journal/domain/fill-pairing.test.ts ✓ (min_lines: 60, actual: ~300)

Commits verified:
- 34385a9 (RED) ✓
- 2fde3d5 (GREEN) ✓

Exports verified: classifyFill, aggregatePartialFills, computePnl, detectRoll, hashFillIds — all exported.
createHash usage: 5 occurrences (import + 1 production use + void suppression removed, hash call = 1).
Zero typecheck errors (bunx tsc --noEmit in packages/core).
