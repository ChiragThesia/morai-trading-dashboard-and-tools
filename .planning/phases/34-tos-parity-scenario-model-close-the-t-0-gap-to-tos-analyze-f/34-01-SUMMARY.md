---
phase: 34-tos-parity-scenario-model-close-the-t-0-gap-to-tos-analyze-f
plan: 01
subsystem: quant
tags: [settlement, dst, intl, spx, spxw, occ-symbol, tos-parity]

requires: []
provides:
  - "settlementTimestamp(root, expiry): Date exported from @morai/shared"
  - "DST-safe native-Intl instant-construction technique, extending rth-window.ts's read-only precedent"
affects: [34-02, "any fractional-DTE consumer (pair-calendars.ts, scenario-engine.ts)"]

tech-stack:
  added: []
  patterns:
    - "Intl.DateTimeFormat({timeZoneName:'shortOffset'}) offset-read, then Date.UTC(...) construction — the CONSTRUCT half of rth-window.ts's existing READ-only ET technique, zero new dependency"

key-files:
  created:
    - packages/shared/src/settlement-timestamp.ts
    - packages/shared/src/settlement-timestamp.test.ts
  modified:
    - packages/shared/src/index.ts

key-decisions:
  - "A1 anchor (09:30 ET AM-settled T=0, reasoned-not-cited) encoded as two named constants (AM_SETTLEMENT_HOUR, AM_SETTLEMENT_MINUTE) with a comment tying back to Assumptions Log A1 — a future correction is a one-line change, per the plan's must_haves."
  - "isThirdFriday and nyUtcOffsetHours kept module-private (not exported) — the plan's action step specifies settlementTimestamp as the only public API; no caller needs the sub-helpers."

patterns-established:
  - "Pattern 1 from 34-RESEARCH.md (settlement-aware DST-safe timestamp construction) implemented verbatim as researched, with the offset-parse fallback (-5, EST) preserved for the T-34-01 threat mitigation."

requirements-completed: [TOSP-01]

coverage:
  - id: D1
    description: "settlementTimestamp(root, expiry) resolves AM-settled (root SPX, exact 3rd Friday) to 09:30 ET and everything else (SPXW, or any non-3rd-Friday date) to 16:00 ET, correct across both EST and EDT, proven against hardcoded UTC oracle instants"
    requirement: "TOSP-01"
    verification:
      - kind: unit
        ref: "packages/shared/src/settlement-timestamp.test.ts#settlementTimestamp"
        status: pass
    human_judgment: false
  - id: D2
    description: "settlementTimestamp is re-exported from the @morai/shared barrel so apps/web (plan 34-02) can import it alongside parseOccSymbol"
    requirement: "TOSP-01"
    verification:
      - kind: unit
        ref: "bun run typecheck (workspace-wide, confirms the export resolves)"
        status: pass
    human_judgment: false

duration: 25min
completed: 2026-07-11
status: complete
---

# Phase 34 Plan 01: settlementTimestamp DST-safe helper Summary

**New pure `settlementTimestamp(root, expiry)` helper in `@morai/shared` that converts an OCC-parsed SPX/SPXW contract into its exact wall-clock settlement instant (09:30 ET for AM-settled 3rd-Friday standard SPX, 16:00 ET for everything else), DST-safe via native `Intl`, feeding fractional time-to-expiry for plan 34-02's TOS-parity work.**

## Performance

- **Duration:** ~25 min
- **Tasks:** 1 (TDD: RED → GREEN)
- **Files modified:** 3 (2 created, 1 modified)

## Accomplishments

- `settlementTimestamp(root: string, expiry: Date): Date` — classifies AM vs PM settlement from `root` + `expiry` alone (zero new data source; both fields already come from `parseOccSymbol`), reads the America/New_York UTC offset in effect for that specific date via `Intl.DateTimeFormat({ timeZoneName: "shortOffset" })` (extending `rth-window.ts`'s existing read-only ET technique to construct an instant), and returns the composed UTC `Date`.
- The A1 assumption (AM-settled T=0 anchor = Friday 09:30 ET) is two named constants (`AM_SETTLEMENT_HOUR`, `AM_SETTLEMENT_MINUTE`) with a comment flagging it as reasoned-not-cited (Assumptions Log A1, 34-RESEARCH.md) — a future correction is a one-line change.
- 4 example tests assert against hand-derived, hardcoded `Date.UTC(...)` oracle instants — cross-checked independently via `TZ=America/New_York date -j` against the OS's own IANA tz database, not by re-running the implementation's own offset lookup (would have been a vacuous test):
  - AM-settled SPX on the exact 3rd Friday (Sept 2026, EDT) → 09:30 ET
  - PM-settled SPXW on a 3rd-Friday date in winter (Dec 2026, EST) → 16:00 ET (proves root overrides even a matching date)
  - PM-settled SPXW on a 3rd-Friday date in summer (Jul 2026, EDT) → 16:00 ET
  - Third-Friday classification edge: SPX on the 4th Friday (May 22, 2026, day 22 — outside the 15-21 window) → 16:00 ET despite root SPX

## Task Commits

Each task was committed atomically per the plan-level TDD gate:

1. **Task 1 RED** — `cbaa8f7` (test): add failing test for settlementTimestamp AM/PM DST oracle
2. **Task 1 GREEN** — `f6c26dd` (feat): add settlementTimestamp — DST-safe AM/PM SPX settlement instant

_No REFACTOR commit — GREEN implementation matched the researched Pattern 1 example verbatim, nothing to clean up._

## Files Created/Modified

- `packages/shared/src/settlement-timestamp.ts` — the pure helper: `settlementTimestamp`, plus private `isThirdFriday` and `nyUtcOffsetHours`.
- `packages/shared/src/settlement-timestamp.test.ts` — 4 hardcoded-oracle example tests (AM/PM classification, EST oracle, EDT oracle, third-Friday edge).
- `packages/shared/src/index.ts` — barrel re-export of `settlementTimestamp`.

## Decisions Made

- Followed 34-RESEARCH.md's Pattern 1 implementation verbatim (already fully specified, including the offset-fallback-to-EST guard mapped to threat T-34-01) — no material deviation from the researched design.
- Chose oracle dates (2026-09-18 AM/EDT, 2026-12-18 PM/EST, 2026-07-17 PM/EDT, 2026-05-22 PM edge) so the two DST-boundary cases (Dec/Jul) land on genuine 3rd-Friday dates with root SPXW — this doubles as proof that root, not date alone, drives AM/PM classification, without needing extra test cases.

## Deviations from Plan

None — plan executed exactly as written. RED run showed a genuine module-resolution failure (file didn't exist yet), GREEN run passed all 4 tests on the first implementation, `bun run typecheck` and `bun run lint` were clean with no fixes needed.

## Issues Encountered

None.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

- `settlementTimestamp` is importable from `@morai/shared` — plan 34-02 (`pair-calendars.ts` fractional DTE) can import it alongside `parseOccSymbol` with no further wiring needed.
- Full workspace gate green: `bun run typecheck` clean, `bun run lint` clean (0 errors; pre-existing boundary-plugin warnings unrelated to this change), `bun run test` — 291 test files / 3190 tests passed (includes the 4 new tests).
- Downstream note for 34-02: `settlementTimestamp` returns a `Date` (an instant), not a fraction — 34-02 owns subtracting it from "now" and dividing by the day-count convention (RESEARCH Pitfall 1 flags 365.25 as the convention to match `iv-calibration.ts`/`position-greeks.ts`, not the `/365` some other files use).

## Self-Check: PASSED

All created files and commit hashes verified present.

---
*Phase: 34-tos-parity-scenario-model-close-the-t-0-gap-to-tos-analyze-f*
*Completed: 2026-07-11*
