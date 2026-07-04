---
phase: 19-picker-engine-economic-events
plan: 06
subsystem: api
tags: [hexagonal, use-case, picker, gex, economic-events, tdd, honesty-tagging]

# Dependency graph
requires:
  - phase: 19-01
    provides: "picker application/ports.ts (ChainQuoteForPicker, GexContextForPicker, EconomicEvent, PickerSnapshot/Row, all driven ports)"
  - phase: 19-03
    provides: "selectCandidates (candidate-selection.ts) + scoreCalendarCandidates (scoring.ts) domain functions"
  - phase: 19-04
    provides: "economic_events adapter trio + picker/index.ts barrel"
  - phase: 19-05
    provides: "picker_snapshot persistence (Postgres repo + memory twin), picker-chain read repo"
provides:
  - "makeComputePickerSnapshotUseCase — read chain+GEX+events, select+score, tag gexContextStatus/eventsContextStatus honestly (D-17), rank+cap top-8 (D-03), persist one PickerSnapshotRow stamped with the cohort's own data instant"
  - "makeGetPickerUseCase — thin ForReadingPickerSnapshot forwarder, zero recompute"
  - "rankAndCapCandidates — exported, independently-testable stable id tie-break + cap helper"
  - "Exported freshness-window tunables: PICKER_TOP_N=8, GEX_FRESHNESS_WINDOW_MS=2h, EVENTS_FRESHNESS_WINDOW_MS=14d"
affects: [19-07, 19-08, 19-09, compute-picker job, picker.routes, get_picker_candidates MCP tool]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Never-silent degraded-context tagging (D-17): pass null into a domain scorer to zero a term when there IS a null-passthrough (GEX); post-process-zero the breakdown entry and recompute score from sum(weight*contribution/100) when there is NOT (events) -- same guarantee, two mechanisms, chosen by what the domain function already supports"
    - "Freshness-window staleness classification via injected now() -- now() bounds resolution only, observedAt always derives from the data cohort's own instant (mirrors computeGexSnapshot's cycleTime discipline)"
    - "Exported pure ranking helper (rankAndCapCandidates) for white-box tie-break unit coverage, separate from the full read-select-score-persist integration tests"

key-files:
  created:
    - packages/core/src/picker/application/computePickerSnapshot.ts
    - packages/core/src/picker/application/computePickerSnapshot.test.ts
    - packages/core/src/picker/application/getPicker.ts
    - packages/core/src/picker/application/getPicker.test.ts
  modified: []

key-decisions:
  - "PICKER_TOP_N = 8, matching the approved mockup's `top.slice(0,8)` cap verbatim (playground-v4.html) -- D-03's '6-8' range resolved to the mockup's own precedent"
  - "GEX_FRESHNESS_WINDOW_MS = 2 hours -- compute-picker runs chain-triggered immediately after compute-gex-snapshot (D-04), so anything older signals a stalled pipeline"
  - "EVENTS_FRESHNESS_WINDOW_MS = 14 days -- economic_events refreshes on a weekly cron (D-14); 14 days tolerates one missed run before tagging stale"
  - "Events staleness has no fetchedAt field to key off (EconomicEvent carries only date/name/source) -- resolved by comparing now() against the furthest-known event date: if the calendar's horizon has receded more than the freshness window into the past, the feed needs refreshing"
  - "GEX degraded-context zeroing reuses scoring.ts's existing null-context branch (pass null when status != ok) rather than a second scoring path; events degraded-context zeroing is a post-scoring breakdown override (zero the eventAdjustment entry, recompute score) since scoring.ts derives its event penalty from RawCandidate.frontEvents with no context-level null hook -- documented in the file's own doc comment so the asymmetry is intentional, not accidental"
  - "termStructure (display-only ATM-IV curve) is derived locally in computePickerSnapshot.ts from the chain's nearest-to-spot put quote per expiry -- no picker port reads it, and no existing analytics term-structure use-case fits (that one is calendarId-keyed from a different table)"

requirements-completed: [PICK-01, PICK-02]

coverage:
  - id: D1
    description: "computePickerSnapshot reads chain+GEX+events, selects+scores, ranks with stable id tie-break, caps at top-8, and persists one honestly-tagged PickerSnapshotRow stamped with the cohort's own data instant"
    requirement: "PICK-01"
    verification:
      - kind: unit
        ref: "packages/core/src/picker/application/computePickerSnapshot.test.ts#persists exactly one row: observedAt = cohort time, source from cohort, candidates ranked and capped, both statuses ok"
        status: pass
      - kind: unit
        ref: "packages/core/src/picker/application/computePickerSnapshot.test.ts#rankAndCapCandidates > sorts score-desc and breaks ties deterministically by ascending id"
        status: pass
    human_judgment: false
  - id: D2
    description: "gexContextStatus/eventsContextStatus tag missing/stale honestly and the corresponding scoring term (gexFit/eventAdjustment) contributes exactly 0 in each degraded case -- never a falsely-clean score"
    requirement: "PICK-01"
    verification:
      - kind: unit
        ref: "packages/core/src/picker/application/computePickerSnapshot.test.ts#GEX context null -> gexContextStatus missing AND every candidate's gexFit contributes 0"
        status: pass
      - kind: unit
        ref: "packages/core/src/picker/application/computePickerSnapshot.test.ts#economic_events empty -> eventsContextStatus missing AND eventAdjustment contributes 0"
        status: pass
      - kind: unit
        ref: "packages/core/src/picker/application/computePickerSnapshot.test.ts#GEX computedAt older than the freshness window -> gexContextStatus stale, term still zeroed"
        status: pass
      - kind: unit
        ref: "packages/core/src/picker/application/computePickerSnapshot.test.ts#economic_events all older than the freshness window -> eventsContextStatus stale, term still zeroed"
        status: pass
    human_judgment: false
  - id: D3
    description: "Empty chain cohort writes no row (ok(undefined)); a chain present but zero candidates surviving net-theta>0 still persists a row with candidates: [] (D-18 zero-candidate case, distinct from cold-start)"
    requirement: "PICK-02"
    verification:
      - kind: unit
        ref: "packages/core/src/picker/application/computePickerSnapshot.test.ts#empty chain cohort -> no row persisted, ok(undefined)"
        status: pass
      - kind: unit
        ref: "packages/core/src/picker/application/computePickerSnapshot.test.ts#chain present but zero candidates survive net-theta>0 -> a row IS persisted with candidates: []"
        status: pass
    human_judgment: false
  - id: D4
    description: "getPicker is a thin forwarder returning the latest row (or null) with zero recompute logic"
    requirement: "PICK-02"
    verification:
      - kind: unit
        ref: "packages/core/src/picker/application/getPicker.test.ts#returns ok(row) when a snapshot exists"
        status: pass
      - kind: unit
        ref: "packages/core/src/picker/application/getPicker.test.ts#returns ok(null) when no snapshot exists yet"
        status: pass
      - kind: unit
        ref: "packages/core/src/picker/application/getPicker.test.ts#propagates a StorageError unchanged"
        status: pass
    human_judgment: false

# Metrics
duration: ~15min
completed: 2026-07-04
status: complete
---

# Phase 19 Plan 06: Picker Compute + Read Use-Cases Summary

**computePickerSnapshot orchestrates chain+GEX+events into one honestly-tagged, top-8-ranked PickerSnapshotRow; getPicker forwards the latest row with zero recompute**

## Performance

- **Duration:** ~15 min
- **Tasks:** 2 completed
- **Files modified:** 4 (all new)

## Accomplishments
- `makeComputePickerSnapshotUseCase`: reads the latest chain cohort + GEX context + economic events, composes 19-03's `selectCandidates`/`scoreCalendarCandidates`, tags `gexContextStatus`/`eventsContextStatus` as `ok`/`stale`/`missing` (D-17), ranks with a stable ascending-id tie-break and caps at the top 8 (D-03), and persists exactly one `PickerSnapshotRow` stamped with the chain cohort's own data instant (never `now()`)
- Degraded-context honesty verified both ways: GEX missing/stale zeroes `gexFit` via scoring's existing null-context branch; events missing/stale zeroes `eventAdjustment` via a post-scoring breakdown override that recomputes the total score — both proven by tests asserting the breakdown `contribution` is exactly `0`, never a fabricated full-credit fraction
- D-18 zero-candidate case: a chain present but with no theta-positive candidates still persists a row with `candidates: []` and a real `asOf`/`source`, distinct from the empty-cohort `ok(undefined)` no-row case
- `makeGetPickerUseCase`: verbatim `getGex.ts`-shaped thin forwarder over `ForReadingPickerSnapshot` — no `select`/`compute`/`score` substring anywhere in the file (verified via `rg`)

## Task Commits

Each task was committed atomically (TDD RED -> GREEN):

1. **Task 1: computePickerSnapshot use-case** - `a15da39` (test, RED) → `6f2a060` (feat, GREEN)
2. **Task 2: getPicker use-case** - `bc929ff` (test, RED) → `619892e` (feat, GREEN)

**Plan metadata:** (this commit)

## Files Created/Modified
- `packages/core/src/picker/application/computePickerSnapshot.ts` - Compute-picker use-case: read→resolve cohort spot/asOf/source→read GEX+events→tag statuses→select+score→rank+cap→assemble→persist
- `packages/core/src/picker/application/computePickerSnapshot.test.ts` - 11 tests: ok/missing/stale status tagging (both contexts), empty-cohort no-row, zero-candidate persisted-empty-array, tie-break + cap on the exported `rankAndCapCandidates`, error propagation
- `packages/core/src/picker/application/getPicker.ts` - Thin `ForReadingPickerSnapshot` forwarder
- `packages/core/src/picker/application/getPicker.test.ts` - 3 tests: ok(row) / ok(null) / err passthrough

## Decisions Made
- **PICKER_TOP_N = 8** — matches the approved mockup's own `top.slice(0,8)` cap (D-03's "6-8" range resolved to the mockup's precedent value)
- **GEX_FRESHNESS_WINDOW_MS = 2h** — compute-picker is chain-triggered right after compute-gex-snapshot (D-04), so a 2-hour gap signals a stalled pipeline, not normal cadence
- **EVENTS_FRESHNESS_WINDOW_MS = 14d** — one missed weekly cron (D-14) tolerance before tagging stale
- **Events staleness heuristic**: `EconomicEvent` has no `fetchedAt` field, so staleness is derived from `now() - (furthest known event date)` exceeding the window — a calendar whose horizon has receded into the past needs refreshing. Documented in the code comment as the reasoned interpretation of D-17 for a port shape that doesn't carry an ingestion timestamp
- **Asymmetric degraded-context zeroing mechanism** (documented in the file's header comment): GEX passes `null` into `scoreCalendarCandidates` (reusing 19-03's existing null-context branch, zero new domain code); events has no such hook (the domain function derives its penalty from `RawCandidate.frontEvents`, already resolved before scoring runs), so `computePickerSnapshot.ts` zeroes the `eventAdjustment` breakdown entry and recomputes the score from `sum(weight*contribution/100)` post-scoring — same guarantee (term contributes exactly 0), two mechanisms, chosen by what 19-03's frozen domain code already supports without modifying it
- **termStructure derivation**: no picker port reads a term-structure series (the existing analytics `getTermStructure` use-case is calendarId-keyed from a different table and out of scope), so `computePickerSnapshot.ts` derives a display-only ATM-IV curve locally from the chain's nearest-to-spot put quote per expiry

## Deviations from Plan

None — plan executed exactly as written. One implementation-detail note: the plan's acceptance criterion `rg -n 'select|compute|score' packages/core/src/picker/application/getPicker.ts` returns no match required wording in the doc comment to avoid the substrings "compute" (inside "recomputed"/"precompute") and was written cleanly from the start using "re-derived"/"write-once-then-read" instead — not a deviation, just a wording choice made during initial drafting to satisfy the plan's own literal grep check.

## Issues Encountered
- Initial test-fixture bug (not implementation): `baseDeps({ gexContext: null })` used `overrides.gexContext ?? GEX_CONTEXT_FRESH`, and `??` coalesces an explicit `null` back to the default, silently defeating the "GEX missing" test case. Fixed by checking `"gexContext" in overrides` instead of nullish-coalescing. Caught immediately by the first GREEN run (test failed with `expected 'ok' to be 'missing'`), fixed, re-ran green. No production code was affected.

## Next Phase Readiness
- `makeComputePickerSnapshotUseCase` and `makeGetPickerUseCase` are ready for wiring: `compute-picker` pg-boss job handler (Plan 07/08), `GET /api/picker/candidates` HTTP route, and `get_picker_candidates` MCP tool can now inject the Postgres/memory repos + `readGexContext` (composed from the existing GEX snapshot repo) + `readEconomicEvents` and call these use-cases directly
- No new adapter for `ForReadingGexContext` exists yet — a composition-root adapter mapping `GexSnapshotRow` → `GexContextForPicker` will be needed when wiring the job in a later plan (not this plan's scope; ports.ts already defines the target shape)
- Full test suite (1784 tests across 195 files, including testcontainers) and `bun run typecheck`/`bun run lint` all green after this plan

---
*Phase: 19-picker-engine-economic-events*
*Completed: 2026-07-04*

## Self-Check: PASSED

All 4 created files verified present on disk; all 4 task commit hashes (a15da39, 6f2a060, bc929ff, 619892e) verified present in git log.
