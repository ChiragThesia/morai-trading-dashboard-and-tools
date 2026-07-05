---
phase: 20-stream-watchdog-event-snapshot-strategy-rules
plan: 04
subsystem: journal
tags: [core, hexagonal, tdd, fast-check, snapshot, cooldown, move-detection]

# Dependency graph
requires:
  - phase: 20-stream-watchdog-event-snapshot-strategy-rules
    provides: "20-02/20-03 groundwork (WATCH-01 badge derivation, contracts) this plan's SNAP-01 core builds alongside"
provides:
  - "detectLargeMove — pure rolling-window % move detector (packages/core/src/streaming/domain/spot-move-detector.ts)"
  - "isWithinCooldown — pure cross-process cooldown predicate (packages/core/src/journal/domain/snapshot-cooldown.ts)"
  - "ForReadingLatestSnapshotTime driven port (MAX(time) read, null on cold start)"
  - "SnapshotRow.trigger provenance field ('scheduled' | 'event-move', additive/optional)"
  - "ForRunningSnapshotCalendars accepts optional { trigger? }, defaults to 'scheduled'"
affects: ["20-05 (adapters: provenance column + cooldown Postgres repo)", "20-06 (wiring: SPX tick -> snapshot trigger in apps/server)"]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Pure detector returns a plain object (no Result) when the operation cannot fail — matches recompute-live-greek.ts / rth-window.ts precedent"
    - "Cross-process cooldown resolved via a driven port reading Postgres ground truth (MAX(time)), never an in-memory guard — Pitfall 2"
    - "Additive/optional domain-type field (SnapshotRow.trigger) to avoid a monorepo-wide blast radius across every other SnapshotRow object-literal construction site"

key-files:
  created:
    - packages/core/src/streaming/domain/spot-move-detector.ts
    - packages/core/src/streaming/domain/spot-move-detector.test.ts
    - packages/core/src/journal/domain/snapshot-cooldown.ts
    - packages/core/src/journal/domain/snapshot-cooldown.test.ts
  modified:
    - packages/core/src/journal/application/ports.ts
    - packages/core/src/journal/application/snapshotCalendars.ts
    - packages/core/src/journal/application/snapshotCalendars.test.ts

key-decisions:
  - "SnapshotRow.trigger is optional ('scheduled' | 'event-move' | undefined), not required — makes the D-12 addition purely additive so the dozens of other SnapshotRow object-literal construction sites across apps/server, packages/adapters, and other core tests (mapSnapshotRow, memory twin, contract tests, journal.routes.test.ts, mcp.test.ts, getJournal.test.ts, selectChainSource.test.ts) need zero changes and stay outside this plan's declared file scope; the use-case layer (buildSnapshotRow) always resolves and sets a concrete value, so the field is never left as an explicit undefined under exactOptionalPropertyTypes."
  - "ForRunningSnapshotCalendars gained an optional { trigger? } arg rather than a new use-case — existing zero-arg call sites (apps/worker's snapshot-calendars handler, its tests) remain valid with no changes; 20-06 wiring will pass { trigger: 'event-move' } from the server detector."
  - "Threshold-boundary example test (spot-move-detector) uses hand-picked integer-friendly prices (1000/1010) to get bit-exact IEEE-754 equality at the 1% boundary, rather than a generic float property, to avoid floating-point rounding flakiness at an exact `>=` comparison; the fast-check properties (pruning invariant, direction symmetry) use safety margins/pre-filters instead of exact-boundary assertions for the same reason."

requirements-completed: [SNAP-01]

coverage:
  - id: D1
    description: "detectLargeMove prunes samples older than windowMs, appends the new sample, and triggers iff |newPrice-oldestInWindow|/oldestInWindow >= thresholdPct (cold start never triggers)"
    requirement: "SNAP-01"
    verification:
      - kind: unit
        ref: "packages/core/src/streaming/domain/spot-move-detector.test.ts#detectLargeMove — example tests"
        status: pass
      - kind: unit
        ref: "packages/core/src/streaming/domain/spot-move-detector.test.ts#detectLargeMove — fast-check properties (pruning invariant, direction symmetry)"
        status: pass
    human_judgment: false
  - id: D2
    description: "isWithinCooldown(now, null, ms) is false; true iff now-last < cooldownMs (boundary ==cooldownMs is NOT within cooldown); monotonic in now"
    requirement: "SNAP-01"
    verification:
      - kind: unit
        ref: "packages/core/src/journal/domain/snapshot-cooldown.test.ts#isWithinCooldown — example tests"
        status: pass
      - kind: unit
        ref: "packages/core/src/journal/domain/snapshot-cooldown.test.ts#isWithinCooldown — fast-check properties"
        status: pass
    human_judgment: false
  - id: D3
    description: "ForReadingLatestSnapshotTime port type added; SnapshotRow gains an optional trigger field; snapshotCalendars use-case stamps every row with a resolved trigger, defaulting to 'scheduled'"
    requirement: "SNAP-01"
    verification:
      - kind: unit
        ref: "packages/core/src/journal/application/snapshotCalendars.test.ts#trigger provenance (D-12)"
        status: pass
      - kind: unit
        ref: "bun run typecheck (monorepo, tsc --build --force) — clean, no other SnapshotRow construction site required changes"
        status: pass
    human_judgment: false

duration: 15min
completed: 2026-07-05
status: complete
---

# Phase 20 Plan 04: SNAP-01 Core Detectors + Provenance Plumbing Summary

**Two pure, property-tested detectors (rolling-window % move, cross-process cooldown) plus an additive `SnapshotRow.trigger` provenance field and use-case passthrough — all framework-free inside `packages/core`.**

## Performance

- **Duration:** 15 min
- **Started:** 2026-07-05T00:52:00-05:00
- **Completed:** 2026-07-05T00:58:00-05:00
- **Tasks:** 3/3 completed
- **Files modified:** 7 (4 created, 3 modified)

## Accomplishments
- `detectLargeMove` — O(1) rolling-window ring-buffer prune + threshold check for SPX % moves, no I/O, no `Date.now()`, with fast-check coverage for the pruning invariant and directional symmetry.
- `isWithinCooldown` — the pure predicate that will let the SNAP-01 event detector (apps/server, 20-06) and the existing worker cron chain (apps/worker) agree on "has a snapshot fired recently" via a shared Postgres read, closing the two-process cooldown gap called out as Pitfall 2 in RESEARCH.md.
- `ForReadingLatestSnapshotTime` driven port + `SnapshotRow.trigger` provenance field + `snapshotCalendars` use-case passthrough, landed without touching a single file outside `packages/core` (verified via a full monorepo `bun run typecheck` and `bun run test` pass).

## Task Commits

Each task was committed atomically (TDD RED+GREEN combined per commit, per this repo's established pattern):

1. **Task 1: detectLargeMove rolling-window detector (D-05, Pattern 2)** - `121459b` (test)
2. **Task 2: isWithinCooldown pure predicate (D-06, Pitfall 2)** - `c099ea8` (test)
3. **Task 3: ForReadingLatestSnapshotTime port + SnapshotRow.trigger + use-case passthrough (D-12)** - `c91ce60` (feat)

_Note: each commit includes both the RED test file and the GREEN implementation — test run output was captured and confirmed failing (right reason: missing module / undefined field) before implementing, per tdd.md._

## Files Created/Modified
- `packages/core/src/streaming/domain/spot-move-detector.ts` - `detectLargeMove` + `SpotSample` + `MOVE_WINDOW_MS`/`MOVE_THRESHOLD_PCT` tunables
- `packages/core/src/streaming/domain/spot-move-detector.test.ts` - 5 example tests + 2 fast-check properties
- `packages/core/src/journal/domain/snapshot-cooldown.ts` - `isWithinCooldown` + `SNAPSHOT_COOLDOWN_MS`
- `packages/core/src/journal/domain/snapshot-cooldown.test.ts` - 4 example tests + 1 fast-check property
- `packages/core/src/journal/application/ports.ts` - added `ForReadingLatestSnapshotTime`; added optional `trigger` field to `SnapshotRow`
- `packages/core/src/journal/application/snapshotCalendars.ts` - `buildSnapshotRow` and `ForRunningSnapshotCalendars`/`makeSnapshotCalendarsUseCase` now thread an optional `trigger` arg (default `"scheduled"`) onto every row
- `packages/core/src/journal/application/snapshotCalendars.test.ts` - added "trigger provenance (D-12)" describe block (2 new tests); 19/19 tests green

## Decisions Made
- **`SnapshotRow.trigger` is optional, not required.** The plan's `files_modified` list scopes this plan strictly to `packages/core`'s `ports.ts`/`snapshotCalendars.ts`. A required field would have broken TypeScript compilation in every other `SnapshotRow` object-literal construction site across `packages/adapters` (Postgres repo mapper, memory twin), `apps/server` (route/MCP tests), and other core test files — none of which are in this plan's scope and all of which belong to 20-05 (the adapters plan). Making it optional keeps the change purely additive (matches D-12's own "non-destructive" framing) while still letting `snapshotCalendars.ts` set a concrete resolved value on every row it builds. Verified via a full `bun run typecheck` (monorepo `tsc --build --force`) — zero errors.
- **`ForRunningSnapshotCalendars` gains an optional arg, not a new function.** Existing zero-arg callers (`apps/worker/src/handlers/snapshot-calendars.ts`, its test doubles) remain valid without modification; 20-06 will pass `{ trigger: "event-move" }` from the server-side detector once it's wired.
- **Boundary test uses hand-picked integers, not a generic float property.** The plan's acceptance criteria phrase this as "threshold-boundary *example*" (singular) versus "pruning-invariant + direction-symmetry *properties*" (plural fast-check) — read literally, matching the exact-equality risk of asserting a `>=` comparison against an arbitrary-precision float generator at a boundary. Chose `1000 -> 1010` (exact IEEE-754 division `10/1000 === 0.01`) for the example, and safety-margin `fc.pre()` filters for the property tests to avoid flakiness from floating-point rounding landing exactly on the threshold.

## Deviations from Plan

None — plan executed exactly as written. The `SnapshotRow.trigger` optionality choice above is a design decision within the plan's own "additive/nullable-friendly" constraint (D-12 prohibition), not a deviation from the plan's behavior contract — all `must_haves.truths` and `acceptance_criteria` are satisfied verbatim (verified against the full monorepo test + typecheck + lint run, not just the three per-task scoped commands).

## Issues Encountered
None.

## User Setup Required
None - no external service configuration required. No new dependencies, no migrations (schema/DB work is 20-05's scope).

## Next Phase Readiness
- 20-05 (adapters: provenance column + cooldown) can now: (1) add a `trigger` column to `calendar_snapshots` and have the Postgres repo's `mapSnapshotRow`/`persistSnapshot` populate `SnapshotRow.trigger` from/to it; (2) implement `ForReadingLatestSnapshotTime` against `SELECT MAX(time) FROM calendar_snapshots` (index-only scan, `time` is the leading composite-PK column) plus its in-memory twin.
- 20-06 (wiring) can compose `detectLargeMove` + `isWithinCooldown` + `ForReadingLatestSnapshotTime` in `apps/server`'s `sidecar-sse.ts`/`main.ts` exactly per RESEARCH.md Pattern 2, and call `snapshotCalendarsUseCase({ trigger: "event-move" })` when a move triggers.
- No blockers. Full monorepo suite (203 test files, 1907 tests), `bun run typecheck`, and `bun run lint` all green after this plan's changes.

---
*Phase: 20-stream-watchdog-event-snapshot-strategy-rules*
*Completed: 2026-07-05*
