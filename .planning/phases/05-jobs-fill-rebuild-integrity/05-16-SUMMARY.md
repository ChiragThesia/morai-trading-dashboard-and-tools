---
phase: 05-jobs-fill-rebuild-integrity
plan: 16
subsystem: journal
tags: [fast-check, property-tests, fill-pairing, idempotency, roll, uuid, hexagonal]

# Dependency graph
requires:
  - phase: 05-jobs-fill-rebuild-integrity
    provides: "WR-A1 eventType recompute, WR-A2 processed-tracking, WR-A3 total-nibble hexToUuid (plans 05-14/05-15)"
provides:
  - "fast-check property suite locking the round-2 invariants across randomized fill/roll/partial sequences (P1 no-double-count, P2 idempotent, P2b partial-growth, P3 rebuild reconciliation, P4 no id-collision)"
  - "Root-cause fix: ROLL pairing pre-computed before the emit loop — an OPEN consumed by a later ROLL is no longer also emitted as a standalone OPEN (input-order independence)"
affects: [re-review-3, journal reconciliation, merge 04+05]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Property harness composes the REAL use-case (makeSyncFillsUseCase) over fc arbitraries with capturing/mutating fake ports — no Docker, no cross-boundary import (core test imports only @morai/shared + sibling modules)"
    - "Recompute reconciliation asserted by applying the WR-A1 sum-by-eventType rule to emitted events and tying it back to raw fill economics (twin/Postgres parity already proven by 05-15 contract suite)"
    - "WR-A3 collision probe uses a strong avalanche hex hasher (node:crypto blocked in core) so any prefix collision is attributable to hexToUuid, not the hasher"

key-files:
  created:
    - packages/core/src/journal/application/syncFills.property.test.ts
    - packages/core/src/journal/application/syncTransactions.property.test.ts
  modified:
    - packages/core/src/journal/application/syncFills.ts

key-decisions:
  - "P3 reconciliation reuses the WR-A1 recompute RULE locally rather than importing the in-memory twin: core (incl. tests) imports only @morai/shared (architecture-boundaries §2); @morai/core has no @morai/adapters dependency and importing it would invert the dependency law and create a cycle. The twin/Postgres recompute parity is already proven by 05-15's contract suite, so the property only needs the rule + an independent raw-economics reconstruction."
  - "P4 uses two complementary forms: the end-to-end key→hex→uuid path with a strong avalanche hasher (proves distinct keys reach distinct ids) AND a hexToUuid-totality property over random 32-hex prefixes (isolates the WR-A3 mapping so a hasher collision can never mask a uuid regression)."

patterns-established:
  - "ROLL pairing decided up front (pre-pass) so emit order cannot double-count a consumed OPEN"

requirements-completed: [JRNL-01]

# Metrics
duration: 18min
completed: 2026-06-22
status: complete
---

# Phase 5 Plan 16: Fill-Pairing Property Tests + ROLL Double-Count Fix Summary

**Locked-decision fast-check properties over randomized fill/roll/partial sequences (no double-count, idempotent re-sync, rebuild reconciliation, no UUID collision) — and the no-double-count property exposed a real residual bug: an OPEN folded into a later ROLL was also emitted as a standalone OPEN, double-counting its fills. Fixed at root cause by pre-pairing ROLLs before the emit loop.**

## Performance
- **Duration:** ~18 min
- **Tasks:** 2
- **Files:** 3 (2 created, 1 modified)

## Accomplishments
- **P1 no-double-count** (numRuns 300): over arbitrary fill arrays, the fills summed across emitted events equal the distinct paired (non-orphaned) fills, and no fill id appears in two events.
- **P2 idempotent** (numRuns 300): a second sync over the same mutating store (markFillsProcessed stamps the store) emits no new events or orphans — the WR-A2 processed-tracking invariant.
- **P2b partial-fill growth** (numRuns 300): a fill arriving in a later sync forms exactly ONE new event covering only it; the prior event is untouched.
- **P3 rebuild reconciliation** (numRuns 300): applying the WR-A1 sum-by-eventType recompute rule to the emitted events reproduces the summed raw economics (price×qty) of the paired fills, bucketed open/close by leg — for OPEN/CLOSE and ROLL (split components).
- **P4 no id-collision** (numRuns 1000): distinct (activityId, legIndex) keys → distinct fill UUIDs via the real `hexToUuid(hash([...]))` path; plus a hexToUuid-totality property and a UUID-shape property.
- Full workspace suite green: **84 files / 790 tests** (was 783; +7 property tests), testcontainer Postgres ran (not skipped).

## Task Commits
1. **Task 1: Property tests (P1/P2/P2b/P3) + ROLL double-count fix** — `32215f0` (feat)
2. **Task 2: Property test P4 — distinct keys → distinct fill UUID (WR-A3)** — `1500d73` (test)

_TDD: the properties ARE the tests — written first, run, and required to PASS against the 05-14/05-15 fixes. Task 1's P1 failed (RED) by finding a real bug; the source was fixed (GREEN), never the generator weakened. Task 2's properties passed against the existing WR-A3 hexToUuid with no source change. Committed at green per project convention (test+impl together)._

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] ROLL pairing double-counted an eagerly-emitted OPEN**
- **Found during:** Task 1 (P1 no-double-count counterexample: back-leg OPEN + front-leg CLOSE on the same orderId)
- **Issue:** `pairFills` emitted events by iterating `classified` in bucket-insertion order. ROLL detection was reactive — decided when the CLOSE was reached — but an OPEN appearing BEFORE its consuming CLOSE was emitted eagerly as a standalone OPEN and THEN folded into the ROLL. The OPEN's fills landed in two events (a standalone OPEN `hash(id-back)` AND the ROLL `hash(id-back:id-front)`), double-counting the position. This is exactly the WR-A2 single-count invariant the round broke under input ordering — a genuine residual bug, not a test artifact.
- **Fix:** Pre-pair ROLLs BEFORE the emit loop. A new pre-pass walks `classified`, matches each CLOSE to a not-yet-consumed OPEN in the same `(calendarId, orderId)` via `detectRoll`, and records the pairing (`rollPairing: close→open`) plus `consumedOpens`. The emit loop's existing OPEN-skip guard (`consumedOpens.has(cf)`) now fires regardless of iteration order, and the CLOSE branch reads the pre-computed pairing instead of searching live. Order-independent: every fill lands in exactly one event.
- **Files modified:** `packages/core/src/journal/application/syncFills.ts`
- **Verification:** P1 passes (numRuns 300); all 17 existing syncFills unit tests (incl. all ROLL cases) still green; full suite 790 pass.
- **Committed in:** `32215f0`

**Total deviations:** 1 auto-fixed (1 bug — the precise residual the property suite was written to catch).
**Impact:** Necessary correctness fix; the property's purpose was to surface exactly this class of regression. No scope creep — the fix is confined to ROLL emission ordering.

## Residual Bugs Exposed by the Properties
- **The ROLL double-count above** (P1). This was a real correctness defect in the 05-14/05-15 pairing path that the round-2 example tests did not cover (they used CLOSE-then-OPEN input order, where the eager-emit bug does not trigger). The property's randomized ordering surfaced it. Fixed at root cause.
- P2/P2b/P3/P4 found no counterexamples — the WR-A1/WR-A2/WR-A3 fixes hold across the input space.

## Decisions Made
See key-decisions in frontmatter. Most consequential: P3 reconciles against the WR-A1 recompute *rule* applied locally rather than importing the in-memory twin, because core (including its tests) may import only `@morai/shared` — importing `@morai/adapters` into a core test would invert the dependency law and create a cycle. Twin/Postgres recompute parity is already proven by 05-15's contract suite.

## Architecture / Boundary Notes
- Both property files live in `packages/core` and import only `@morai/shared` + sibling core modules — no adapter/Drizzle/node:crypto imports (the `no-restricted-imports` rule blocks `node:*` in core, so the WR-A3 probe uses a deterministic avalanche hex hasher in place of sha256).
- No `any` / `as` / `!`; OCC symbols built via `formatOccSymbol`.

## Verification
- `cd packages/core && bunx vitest run syncFills.property syncTransactions.property` — all 7 properties pass.
- `bun run typecheck` — exits 0.
- `bun run lint` — clean (only the pre-existing boundaries v6 legacy-selector warning).
- `bun run test` (full workspace) — 84 files / 790 tests pass; testcontainer Postgres ran (not skipped).

## Self-Check: PASSED
- Created files exist: `syncFills.property.test.ts`, `syncTransactions.property.test.ts`, `05-16-SUMMARY.md`
- Modified file committed: `syncFills.ts` (ROLL pre-pairing fix)
- Commits exist: `32215f0`, `1500d73`
- `fc.assert` in syncFills.property.test.ts = 4 (≥ 3); `fc.property`/`fc.assert` in syncTransactions.property.test.ts = 6 (≥ 1)
- typecheck clean · lint clean · full suite 790 pass

---
*Phase: 05-jobs-fill-rebuild-integrity*
*Completed: 2026-06-22*
