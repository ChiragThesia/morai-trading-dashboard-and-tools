---
phase: 28-playbook-gates-anti-criteria-sizing
plan: 02
subsystem: picker
tags: [journal, postgres-join, in-memory-twin, testcontainers, fast-check, tdd, anti-criteria]

requires:
  - phase: 28-playbook-gates-anti-criteria-sizing
    provides: "Plan 01's resolveEntryGate (maxOpenBrake/cooldownBrake inputs), businessDaysSince, entry-gate.ts's core-local structural-mirror-type convention"
provides:
  - "ForReadingRecentClosedCalendars — bulk journal port: calendars ⋈ calendar_events(CLOSE) since a cutoff date, one row per calendar"
  - "Postgres single-JOIN implementation + in-memory twin, contract-tested for row parity"
  - "brakes.ts — maxOpenTripped(6), cooldownActive(-25%), cooldownCutoff(2 bizdays) pure evaluators"
affects: [28-03-gate-wiring]

tech-stack:
  added: []
  patterns:
    - "SUM(realizedPnl)/MAX(eventedAt) GROUP BY calendars.id — a calendar's per-leg CLOSE events (D-04) collapse to one row per calendar via Postgres's PK functional-dependency rule, not a second query"
    - "cooldownCutoff walks backward one calendar day at a time using businessDaysSince as the oracle, instead of reimplementing weekday/holiday detection"

key-files:
  created:
    - packages/core/src/picker/domain/brakes.ts
    - packages/core/src/picker/domain/brakes.test.ts
  modified:
    - packages/core/src/journal/application/ports.ts
    - packages/core/src/journal/index.ts
    - packages/core/src/index.ts
    - packages/adapters/src/postgres/repos/calendar-events.ts
    - packages/adapters/src/postgres/repos/calendar-events.contract.test.ts
    - packages/adapters/src/memory/calendar-events.ts

key-decisions:
  - "readRecentClosedCalendars returns ONE row per calendar via GROUP BY calendars.id + SUM(realizedPnl)/MAX(eventedAt), not one row per CLOSE event — a calendar's two legs close via separate CLOSE events (D-04/D-09), and the cooldown brake needs the calendar's total realized loss, not a single leg's"
  - "The memory twin's seedCalendar signature grew an optional second param (openNetDebit) instead of adding a parallel method — mirrors memory/fills.ts's MemorySeedCalendar precedent for a port needing calendar-level data the calendar-events store didn't previously carry"
  - "brakes.ts defines RecentClosedCalendarRow as a core-local structural mirror of journal's RecentClosedCalendar port type (architecture rule 7 — no cross-context domain import), same convention entry-gate.ts's MacroSeriesRow already established for MacroObservationRow"
  - "cooldownCutoff reuses businessDaysSince as an oracle in a bounded backward walk (max ~4 iterations at COOLDOWN_BIZDAYS=2) rather than reimplementing the weekday+NYSE-holiday logic a second time"

patterns-established:
  - "A driven port needing an aggregate across a joined table's rows groups by the OTHER table's primary key so Postgres's functional-dependency rule allows selecting its un-aggregated columns without a second query"

requirements-completed: [PLAY-02]

coverage:
  - id: D1
    description: "ForReadingRecentClosedCalendars(sinceDate) returns every calendar CLOSE since the cutoff with its openNetDebit and realizedPnl in ONE query (no N+1 per-calendar reads)"
    requirement: "PLAY-02"
    verification:
      - kind: integration
        ref: "packages/adapters/src/postgres/repos/calendar-events.contract.test.ts#readRecentClosedCalendars (28-02, PLAY-02)"
        status: pass
    human_judgment: false
  - id: D2
    description: "A calendar closed before sinceDate is excluded; one closed exactly on sinceDate is included"
    requirement: "PLAY-02"
    verification:
      - kind: integration
        ref: "packages/adapters/src/postgres/repos/calendar-events.contract.test.ts#excludes a calendar whose only CLOSE event is before sinceDate / includes a calendar closed exactly on sinceDate"
        status: pass
    human_judgment: false
  - id: D3
    description: "The Postgres repo and its in-memory twin return identical rows for the same fixture (contract parity)"
    requirement: "PLAY-02"
    verification:
      - kind: integration
        ref: "packages/adapters/src/postgres/repos/calendar-events.contract.test.ts#Postgres repo and the in-memory twin return identical rows for the same fixture"
        status: pass
    human_judgment: false
  - id: D4
    description: "maxOpenTripped fires at an open count of exactly 6 (USER DECISION 2), false at 5"
    requirement: "PLAY-02"
    verification:
      - kind: unit
        ref: "packages/core/src/picker/domain/brakes.test.ts#maxOpenTripped"
        status: pass
    human_judgment: false
  - id: D5
    description: "cooldownActive fires when any recently-closed calendar has realizedPnl/openNetDebit at or beyond -25% (USER DECISION 2), never NaN/divide-by-zero on a 0 debit or null realizedPnl"
    requirement: "PLAY-02"
    verification:
      - kind: unit
        ref: "packages/core/src/picker/domain/brakes.test.ts#cooldownActive"
        status: pass
      - kind: unit
        ref: "packages/core/src/picker/domain/brakes.test.ts#cooldownActive fast-check invariant"
        status: pass
    human_judgment: false

duration: 45min
completed: 2026-07-09
status: complete
---

# Phase 28 Plan 02: Anti-Criteria Brakes — Recent-Closed Read Port + brakes.ts Summary

**ForReadingRecentClosedCalendars (single Postgres JOIN + in-memory twin) plus brakes.ts's maxOpenTripped(6)/cooldownActive(-25%)/cooldownCutoff(2 bizdays) pure evaluators, ready for Plan 03's resolveEntryGate wiring.**

## Performance

- **Duration:** 45 min
- **Started:** 2026-07-09T16:00:00Z
- **Completed:** 2026-07-09T16:44:36Z
- **Tasks:** 2
- **Files modified:** 8 (2 created, 6 modified)

## Accomplishments
- New journal port `ForReadingRecentClosedCalendars(sinceDate)` — one Postgres JOIN (`calendars ⋈ calendar_events WHERE event_type = 'CLOSE'`, `GROUP BY calendars.id`) returning one row per calendar with its aggregated realized P&L and openNetDebit, never an N+1 loop
- In-memory twin shipped in the same PR, contract-tested for byte-identical rows against the Postgres adapter (testcontainers)
- `brakes.ts`: `maxOpenTripped` (trips at exactly 6 open calendars), `cooldownActive` (trips at exactly -25% realized loss, guarded against 0 debit / null P&L), `cooldownCutoff` (2 NYSE business days back, reusing Plan 01's `businessDaysSince`)
- 31 new tests (14 Postgres contract + 17 brakes unit/fast-check), full 2682-test suite green, typecheck + lint clean

## Task Commits

Each task was committed atomically:

1. **Task 1: New journal port ForReadingRecentClosedCalendars — Postgres JOIN + in-memory twin + contract test** - `2f7705f` (feat, TDD RED confirmed via `repo.readRecentClosedCalendars is not a function` before implementation)
2. **Task 2: brakes.ts — maxOpenTripped + cooldownActive pure evaluators** - `b90b77f` (feat, TDD RED confirmed via `Cannot find module './brakes.ts'` before implementation)

**Plan metadata:** (this commit, docs: complete plan)

_Note: both tasks are `type="tdd"` — RED was confirmed by running the test suite against the pre-implementation state before writing brakes.ts/the repo methods, then GREEN after; no separate refactor commit was needed (implementations landed clean on first pass)._

## Files Created/Modified
- `packages/core/src/picker/domain/brakes.ts` - MAX_OPEN_CALENDARS/LOSS_COOLDOWN_PCT/COOLDOWN_BIZDAYS constants + maxOpenTripped/cooldownActive/cooldownCutoff
- `packages/core/src/picker/domain/brakes.test.ts` - boundary tests (6/5, -25%/-24.9%, 0-debit/null-pnl guards) + one fast-check invariant + cooldownCutoff weekend-crossing tests
- `packages/core/src/journal/application/ports.ts` - `RecentClosedCalendar` domain type + `ForReadingRecentClosedCalendars` port
- `packages/core/src/journal/index.ts`, `packages/core/src/index.ts` - barrel exports for the new port
- `packages/adapters/src/postgres/repos/calendar-events.ts` - `readRecentClosedCalendars`: one JOIN, `GROUP BY calendars.id`, `SUM(realizedPnl)`/`MAX(eventedAt)`
- `packages/adapters/src/postgres/repos/calendar-events.contract.test.ts` - new `describe` block: exclude-before-cutoff, include-on-cutoff, sum-across-leg-CLOSEs, Postgres/twin parity
- `packages/adapters/src/memory/calendar-events.ts` - `readRecentClosedCalendars` twin (Map grouping, NULL-ignoring SUM semantics) + `seedCalendar(id, openNetDebit?)`

## Decisions Made
- **One row per calendar via GROUP BY + SUM/MAX, not one row per CLOSE event.** A calendar's front and back legs close through separate `CLOSE` events (D-04/D-09); the cooldown brake needs each calendar's TOTAL realized loss against its openNetDebit, not one leg in isolation. `GROUP BY calendars.id` lets Postgres's primary-key functional-dependency rule select `calendars.open_net_debit` un-aggregated, so this stays exactly the "one JOIN" the plan scoped (no second query, no N+1).
- **Memory twin's `seedCalendar` grew an optional second param** (`openNetDebit?: number`) rather than a parallel method — mirrors the `memory/fills.ts` `MemorySeedCalendar` precedent for a port that needs calendar-level data the calendar-events store didn't previously carry. Existing callers (the generic `runCalendarEventsContractTests` suite, `id`-only) are unaffected.
- **`RecentClosedCalendarRow` is a core-local structural mirror**, not an import of journal's `RecentClosedCalendar` port type — architecture rule 7 forbids a picker/domain module importing another bounded context's application port. Same convention `entry-gate.ts`'s `MacroSeriesRow` already established for `MacroObservationRow`.
- **`cooldownCutoff` reuses `businessDaysSince` as an oracle** in a bounded backward walk (at most ~4 iterations for `COOLDOWN_BIZDAYS = 2`) instead of reimplementing weekday/NYSE-holiday detection a second time — per the plan's explicit instruction not to re-derive a calendar-day proxy.

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered

None.

## User Setup Required

None - no external service configuration required.

## Known Stubs

None. Both the port and brakes.ts are fully implemented and tested; wiring them into `resolveEntryGate`/`computePickerSnapshot` is explicitly Plan 03's scope (this plan's `<objective>` states brakes.ts's outputs are "ready for the use-case to feed into resolveEntryGate").

## Threat Flags

None beyond what the plan's own threat_model already covers (T-28-04/05/06 — all mitigated in this plan's implementation: `readRecentClosedCalendars` propagates a read failure as `err(StorageError)` rather than a silent empty array; `cooldownActive` guards a 0 debit / null realizedPnl row before dividing; the Postgres query is a single JOIN with no per-calendar loop).

## Next Phase Readiness
- `ForReadingRecentClosedCalendars`, `brakes.ts`'s three exports, and Plan 01's `resolveEntryGate` are all ready for Plan 03 to wire together at the `computePickerSnapshot` use-case level (read open count + recent-closed rows, compute both brakes, call `resolveEntryGate` once per cohort).
- No blockers.

---
*Phase: 28-playbook-gates-anti-criteria-sizing*
*Completed: 2026-07-09*

## Self-Check: PASSED

All 8 created/modified source files confirmed on disk; both task commit hashes (2f7705f,
b90b77f) confirmed in git log.
