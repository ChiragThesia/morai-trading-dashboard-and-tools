---
phase: 28-playbook-gates-anti-criteria-sizing
plan: 03
subsystem: picker
tags: [entry-gate, hysteresis, anti-criteria, use-case-wiring, snapshot-payload, composition-root, tdd]

requires:
  - phase: 28-playbook-gates-anti-criteria-sizing
    provides: "Plan 01's resolveEntryGate/VIX_LADDER/businessDaysSince/applyGatePenaltyScore + Plan 02's brakes.ts (maxOpenTripped/cooldownActive/cooldownCutoff) + ForReadingRecentClosedCalendars port"
provides:
  - "PickerSnapshot.gate — the additive, once-per-cohort market gate + anti-criteria brakes surfaced on every snapshot (contract + core domain)"
  - "computePickerSnapshot.ts Steps 3c/3d/4b/6 — the live gate wiring: read macro/open-count/recent-closed, self-read hysteresis, penalty-scale scores, zero candidates on block/blind/brake"
  - "apps/worker/src/main.ts composition-root wiring for the four new deps (zero new adapters)"
affects: [28-04-sizing-tiers, 28-05, 28-06]

tech-stack:
  added: []
  patterns:
    - "Gate computed exactly once per computePickerSnapshot cycle (Step 3d), never inside selectCandidates' per-strike loop — the fix for the retired term-inversion gate's placement mistake (T-28-10)"
    - "Fail-closed on ANY of the three new reads (macro/open-calendars/recent-closed) erroring — synthesizes a 'blind' PickerGate rather than propagating err() and losing the whole snapshot (T-28-07)"
    - "Self-read hysteresis via the existing ForReadingPickerSnapshot precedent — the persisted gate carries an additive `reasons` tag array so arm/disarm state survives a Postgres round-trip, not just an in-process one"

key-files:
  created: []
  modified:
    - packages/contracts/src/picker.ts
    - packages/contracts/src/picker.test.ts
    - packages/contracts/src/__fixtures__/picker-candidates.fixture.ts
    - packages/core/src/picker/application/ports.ts
    - packages/core/src/picker/application/computePickerSnapshot.ts
    - packages/core/src/picker/application/computePickerSnapshot.test.ts
    - packages/core/src/picker/application/getPicker.test.ts
    - packages/core/src/picker/index.ts
    - packages/core/src/index.ts
    - packages/core/src/backtest/application/replayPickerCohort.test.ts
    - packages/adapters/src/memory/picker-snapshot.contract.test.ts
    - apps/worker/src/main.ts
    - apps/web/src/hooks/usePicker.test.ts

key-decisions:
  - "Added an additive `reasons: string[]` field to pickerGate/PickerGate beyond the plan's literal schema text — the Postgres picker-snapshot repo validates `row.snapshot` through pickerSnapshotResponse.parse on BOTH write and read (parse-don't-cast at the storage seam), so anything not in the Zod schema is silently stripped. Without persisting the per-metric hysteresis tags (vixBlocked/ratioPenalty/etc.), resolveEntryGate's self-read arm/disarm state would reset every cycle instead of surviving a restart — a real correctness gap, not a nice-to-have (Rule 2)."
  - "cooldownUntil is computed via a small LOCAL helper (cooldownUntilFrom) in computePickerSnapshot.ts, not a new brakes.ts export — it walks FORWARD from a trigger's closedAt using businessDaysSince as the oracle, the symmetric partner to brakes.ts's cooldownCutoff (which walks BACKWARD from now). Kept local rather than adding a second brakes.ts export for one caller, and kept brakes.ts (already shipped/tested in Plan 02) untouched per this plan's file scope."
  - "PickerGate (persisted/wire shape) does NOT carry `entriesAllowed` — it's fully derivable at both write time (from EntryGateState, still in scope before projection) and read time (state==='open'||'penalty' && !brakes.maxOpen && !brakes.cooldown), so storing it would be redundant state that could drift from the fields it's derived from."
  - "On a macro/open-calendars/recent-closed read error, the use-case does NOT propagate err() from the whole invocation — that would abort persistence entirely and violate the truth that termStructure/gex/events stay populated even when the gate is closed. Instead a synthetic GATE_READ_ERROR (state: 'blind', reasons: ['gateReadError']) is substituted, so a transient read failure looks identical on the wire to 'the market data is missing' (T-28-07) — one fail-closed code path, not two."
  - "The gate penalty (Step 4b) is applied UNCONDITIONALLY to every candidate's score (not gated on state==='penalty') — the multiplier is mathematically 1.0 in the open state, so applying it universally is a documented no-op there and avoids a branch that could silently diverge from the true source of truth (gate.penaltyMultiplier)."

patterns-established:
  - "Cross-bounded-context reads at the APPLICATION layer (not domain) import the other context's application-port types directly (ForReadingMacroObservations/ForGettingOpenCalendars/ForReadingRecentClosedCalendars from journal/index.ts into computePickerSnapshot.ts) — the same precedent analytics/application/getRegimeBoard.ts already established, distinct from Plans 01/02's domain-layer choice to re-declare structural mirror types (rule 7 forbids domain-to-domain imports, but application-to-application application-port imports are explicitly sanctioned)."

requirements-completed: [PLAY-01, PLAY-02]

coverage:
  - id: D1
    description: "pickerSnapshotResponse gains a .default()'d gate object (vix/vix3m/ratio/asOf/state/penaltyMultiplier/brakes/reasons); a stored snapshot missing gate parses to the default, a full gate object round-trips"
    requirement: "PLAY-01"
    verification:
      - kind: unit
        ref: "packages/contracts/src/picker.test.ts#pickerSnapshotResponse.gate (28-03, PLAY-01/PLAY-02 — additive)"
        status: pass
    human_judgment: false
  - id: D2
    description: "The gate is computed exactly once per computePickerSnapshot invocation (never per candidate) — regression-tested via a read-call counter"
    requirement: "PLAY-01"
    verification:
      - kind: unit
        ref: "packages/core/src/picker/application/computePickerSnapshot.test.ts#calm macro pair -> gate open... gate evaluated ONCE"
        status: pass
    human_judgment: false
  - id: D3
    description: "Blocked/blind/braked cohort ships candidates: [] while termStructure/gex/events stay populated"
    requirement: "PLAY-01, PLAY-02"
    verification:
      - kind: unit
        ref: "packages/core/src/picker/application/computePickerSnapshot.test.ts#crisis VIX/ratio -> gate blocked, candidates: [] while termStructure/gex/events stay populated"
        status: pass
      - kind: unit
        ref: "packages/core/src/picker/application/computePickerSnapshot.test.ts#missing macro data -> gate blind"
        status: pass
      - kind: unit
        ref: "packages/core/src/picker/application/computePickerSnapshot.test.ts#max-open brake tripped"
        status: pass
      - kind: unit
        ref: "packages/core/src/picker/application/computePickerSnapshot.test.ts#loss-cooldown brake tripped"
        status: pass
    human_judgment: false
  - id: D4
    description: "Penalty band scales every candidate's score by the gate multiplier without touching its breakdown; re-ranking stays consistent"
    requirement: "PLAY-01"
    verification:
      - kind: unit
        ref: "packages/core/src/picker/application/computePickerSnapshot.test.ts#penalty band -> every candidate's score is scaled down, breakdown untouched, re-ranked"
        status: pass
    human_judgment: false
  - id: D5
    description: "A macro/open-calendars/recent-closed read error fails the gate CLOSED (blind), never a default-open"
    requirement: "PLAY-01, PLAY-02"
    verification:
      - kind: unit
        ref: "packages/core/src/picker/application/computePickerSnapshot.test.ts#a macro read error fails the gate CLOSED"
        status: pass
      - kind: unit
        ref: "packages/core/src/picker/application/computePickerSnapshot.test.ts#a recent-closed read error fails the gate CLOSED"
        status: pass
      - kind: unit
        ref: "packages/core/src/picker/application/computePickerSnapshot.test.ts#an open-calendars read error fails the gate CLOSED"
        status: pass
    human_judgment: false
  - id: D6
    description: "Hysteresis reads the previous cycle's gate from the ForReadingPickerSnapshot self-read: a held-armed value between disarm and arm stays blocked; cold start (no previous snapshot) uses fresh-arm rules only"
    requirement: "PLAY-01"
    verification:
      - kind: unit
        ref: "packages/core/src/picker/application/computePickerSnapshot.test.ts#hysteresis: a held-blocked previous state stays blocked"
        status: pass
      - kind: unit
        ref: "packages/core/src/picker/application/computePickerSnapshot.test.ts#no previous snapshot (cold start)"
        status: pass
    human_judgment: false
  - id: D7
    description: "The composition root threads the four new deps from already-present repo instances (macroObsRepo, calendarsRepo, calendarEventsRepo, pickerSnapshotRepo) — zero new adapter wiring"
    requirement: "PLAY-01, PLAY-02"
    verification:
      - kind: other
        ref: "apps/worker/src/main.ts — readMacroObservations/readOpenCalendars/readRecentClosedCalendars/readPickerSnapshot wired; bun run typecheck clean"
        status: pass
    human_judgment: false
  - id: D8
    description: "The memory picker-snapshot twin round-trips the additive gate field byte-for-byte with zero twin code change"
    requirement: "PLAY-01"
    verification:
      - kind: unit
        ref: "packages/adapters/src/memory/picker-snapshot.contract.test.ts#in-memory picker-snapshot twin — gate field (28-03) — round-trips a full gate object"
        status: pass
    human_judgment: false

duration: 55min
completed: 2026-07-09
status: complete
---

# Phase 28 Plan 03: Use-Case Gate/Brake Wiring + Snapshot Gate Payload + Composition Root Summary

**Wired Plan 01's resolveEntryGate and Plan 02's brakes into computePickerSnapshot.ts (Steps 3c/3d/4b/6), added an additive PickerSnapshot.gate contract field, and threaded the composition root — PLAY-01/PLAY-02 now live, observable, once-per-cohort, and fail-closed.**

## Performance

- **Duration:** ~55 min
- **Tasks:** 2 (both TDD)
- **Files modified:** 13 (0 created)

## Accomplishments

- `pickerSnapshotResponse` gains a `.default()`'d `gate` object (vix/vix3m/ratio/asOf/state/
  penaltyMultiplier/brakes/reasons) so pre-Phase-28 stored snapshots still parse — a stored row
  missing `gate` reads as an open gate with no brakes tripped (harmless for a historical row).
- `PickerSnapshot` (core domain) gains the matching readonly `gate` field; `ComputePickerSnapshotDeps`
  gains `readMacroObservations`, `readOpenCalendars`, `readRecentClosedCalendars`, and
  `readPickerSnapshot` (the previous-cycle self-read for hysteresis).
- `computePickerSnapshot.ts` Step 3c reads the macro pair + open-calendar count + recent-closed
  rows since the cooldown cutoff, and self-reads the previous snapshot's gate. Step 3d calls
  `resolveEntryGate` exactly ONCE per invocation (regression-tested via a call-counter, plus an
  assertion that no `RULE_SET_METADATA` row represents the market gate — the retired-gate scar,
  T-28-10). Step 4b scales every candidate's score by the gate's penalty multiplier, breakdown
  untouched. Step 6 ships `candidates: []` whenever the gate is blocked/blind or a brake trips,
  while `termStructure`/`gex`/`events` stay populated so the board and Analyzer keep their context.
- Any of the three new reads (macro/open-calendars/recent-closed) erroring fails the gate CLOSED
  (`state: "blind"`) — never a silent default-open (T-28-07's highest-consequence error path).
- `apps/worker/src/main.ts` threads the four new deps from the already-present `macroObsRepo`,
  `calendarsRepo`, `calendarEventsRepo`, and `pickerSnapshotRepo` instances — zero new adapters.
- The in-memory picker-snapshot twin round-trips the additive `gate` field with zero twin code
  change (it stores/returns `PickerSnapshotRow` generically) — proven with a dedicated test.
- 25 new/extended use-case tests + 3 new contract round-trip tests + 1 memory-twin test, all
  green; full suite (2700 tests), typecheck, and lint all clean.

## Task Commits

1. **Task 1: Additive gate field — pickerSnapshotResponse Zod + PickerSnapshot type + deps
   extension (TDD)** - `73ceafb` (feat) — RED confirmed inline (3 failing assertions against
   the not-yet-defined `gate` field/schema branch) before implementation, then GREEN; combined
   into one commit per Plan 02's own precedent in this phase (see TDD Gate Compliance below).
2. **Task 2: Wire resolveEntryGate into computePickerSnapshot (Steps 3c/3d/4b/6) + composition
   root + twin (TDD)** - `0b0b2a2` (feat) — RED confirmed via 12 failing assertions reading
   `snapshot.gate` as `undefined` before implementation, then GREEN; includes the four
   downstream file fixes the schema change required (getPicker.test.ts, the backtest harness's
   replayPickerCohort.test.ts, and apps/web's usePicker.test.ts — all needed a `gate` value to
   stay compiling/green, Rule 3).

## Files Created/Modified

- `packages/contracts/src/picker.ts` - `pickerGate`/`pickerGateBrakes` schemas, additive `gate` field on `pickerSnapshotResponse`
- `packages/contracts/src/picker.test.ts` - gate schema round-trip tests (defaulted-old-row, full round-trip, out-of-enum rejection)
- `packages/contracts/src/__fixtures__/picker-candidates.fixture.ts` - frozen fixture gains a default-shaped `gate`
- `packages/core/src/picker/application/ports.ts` - `PickerGate`/`PickerGateBrakes` domain types, `PickerSnapshot.gate` field
- `packages/core/src/picker/application/computePickerSnapshot.ts` - Steps 3c/3d/4b/6 gate wiring, `toEntryGateState`/`toPickerGate`/`cooldownUntilFrom`/`applyGatePenalty` helpers
- `packages/core/src/picker/application/computePickerSnapshot.test.ts` - 13 new entry-gate wiring tests (open/blocked/blind/brakes/penalty/read-errors/hysteresis/cold-start)
- `packages/core/src/picker/application/getPicker.test.ts` - fixture gains `gate` (Rule 3)
- `packages/core/src/picker/index.ts`, `packages/core/src/index.ts` - barrel exports for `PickerGate`/`PickerGateBrakes`
- `packages/core/src/backtest/application/replayPickerCohort.test.ts` - calm gate-inputs fakes added to the oracle-builder call (Rule 3)
- `packages/adapters/src/memory/picker-snapshot.contract.test.ts` - dedicated gate round-trip test
- `apps/worker/src/main.ts` - composition-root wiring for the four new deps
- `apps/web/src/hooks/usePicker.test.ts` - fixture gains `gate` (Rule 3)

## Decisions Made

- **Added an additive `reasons: string[]` field to `pickerGate`/`PickerGate`, beyond the plan's
  literal shape.** The Postgres picker-snapshot repo validates `row.snapshot` through
  `pickerSnapshotResponse.parse` on BOTH write and read (parse-don't-cast at the storage seam,
  T-19-10) — any field not in the Zod schema is silently stripped before it ever reaches
  Postgres. Without persisting the per-metric hysteresis tags (`vixBlocked`/`ratioPenalty`/etc.)
  `resolveEntryGate`'s `previousLabelFor` self-read would have nothing to read after a worker
  restart, resetting arm/disarm state every cycle instead of holding it across the disarm band
  — silently breaking the exact behavior USER DECISION 1/2's hysteresis exists to provide. This
  is Rule 2 (auto-add missing critical functionality): the must-have truth "hysteresis reads the
  previous cycle's gate state from the self-read" is only actually true with this field present.
- **`cooldownUntil` is computed by a small local helper (`cooldownUntilFrom`) in
  `computePickerSnapshot.ts`, not a new `brakes.ts` export.** It walks FORWARD from a triggering
  loss's `closedAt` using `businessDaysSince` as the oracle — the symmetric partner to
  `brakes.ts`'s `cooldownCutoff` (which walks BACKWARD from "now" to find the read window's
  start). Kept local and out of `brakes.ts` (already shipped/tested in Plan 02, not in this
  plan's file scope) rather than adding a second export there for one caller.
- **`PickerGate` does not persist `entriesAllowed`.** It is fully derivable at read time
  (`state ∈ {open, penalty} && !brakes.maxOpen && !brakes.cooldown`), so storing it would be
  redundant state that could drift from the fields it's computed from.
- **A macro/open-calendars/recent-closed read error does NOT propagate `err()` from the whole
  use-case invocation.** That would abort persistence entirely, contradicting the truth that
  `termStructure`/`gex`/`events` stay populated even when the gate is closed. Instead a
  synthetic `GATE_READ_ERROR` constant (`state: "blind"`, `reasons: ["gateReadError"]`) is
  substituted — one fail-closed code path, and a read failure reads identically on the wire to
  "the market data is missing."
- **The gate penalty (Step 4b) applies unconditionally to every candidate's score**, not gated
  on `state === "penalty"`. The multiplier is mathematically `1.0` in the open state (verified
  by `bandMultiplier`'s own floor behavior), so applying it universally is a documented no-op
  there and avoids a branch that could silently diverge from `gate.penaltyMultiplier` as the
  single source of truth.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 2 - Missing critical functionality] Added `reasons` to the gate contract for working cross-cycle hysteresis**
- **Found during:** Task 1, while designing Task 2's self-read wiring
- **Issue:** The plan's literal gate schema (vix/vix3m/ratio/asOf/state/penaltyMultiplier/brakes)
  has no field carrying resolveEntryGate's per-metric hysteresis tags. Since the Postgres repo
  round-trips every snapshot through `pickerSnapshotResponse.parse` on both write and read, a
  field not in the schema never survives to the next cycle's self-read — hysteresis would work
  in-process (same JS object) but silently reset on every worker restart or cross-cycle self-read.
- **Fix:** Added `reasons: z.array(z.string()).default([])` to `pickerGate` (contracts) and the
  matching `reasons: ReadonlyArray<string>` to `PickerGate` (core). `toEntryGateState` reconstructs
  enough of `EntryGateState` from the persisted `PickerGate` for `resolveEntryGate`'s
  `previousState` param.
- **Files modified:** packages/contracts/src/picker.ts, packages/core/src/picker/application/ports.ts
- **Verification:** `computePickerSnapshot.test.ts`'s hysteresis tests (held-blocked between
  disarm/arm, cold-start) pass; contract round-trip tests confirm `reasons` survives Zod parse.
- **Committed in:** `73ceafb` (Task 1)

**2. [Rule 3 - Blocking issue] Fixed 4 downstream files broken by the additive PickerSnapshot.gate field**
- **Found during:** Task 2's full-suite/typecheck verification pass
- **Issue:** `getPicker.test.ts`, `replayPickerCohort.test.ts` (backtest harness), and `apps/web`'s
  `usePicker.test.ts` all constructed `PickerSnapshot`/`PickerSnapshotResponse` object literals
  or called `makeComputePickerSnapshotUseCase` without the new required `gate`-related fields/deps
  — a mechanical consequence of Task 1's contract change, not a design gap in those files.
- **Fix:** Added a default-shaped `gate` object to the two snapshot fixtures, and calm gate-input
  fakes (`readMacroObservations`/`readOpenCalendars`/`readRecentClosedCalendars`/`readPickerSnapshot`)
  to the backtest oracle-builder's use-case call.
- **Files modified:** packages/core/src/picker/application/getPicker.test.ts,
  packages/core/src/backtest/application/replayPickerCohort.test.ts, apps/web/src/hooks/usePicker.test.ts
- **Verification:** `bun run test` (full 2700-test suite), `bun run typecheck`, `bun run lint` all clean.
- **Committed in:** `0b0b2a2` (Task 2)

---

**Total deviations:** 2 (1 Rule 2 missing-functionality addition, 1 Rule 3 blocking-issue fix)
**Impact on plan:** Both necessary for the gate to actually function correctly across a
Postgres round-trip and for the additive contract change to not silently break sibling
consumers. No scope creep — `brakes.ts` and `entry-gate.ts` (Plans 01/02) were left untouched.

## TDD Gate Compliance

Both tasks are `type="tdd"`. RED was confirmed by running the test suite against the
pre-implementation state (Task 1: 3 failing schema assertions; Task 2: 12 failing
`snapshot.gate` reads, both failing for the right reason — missing field/undefined, not an
import or syntax error) before writing any implementation, then GREEN after. Per Plan 02's own
precedent in this phase (its SUMMARY: "no separate refactor commit was needed... RED was
confirmed via [error] before implementation, then GREEN after"), each task landed as ONE `feat`
commit rather than a separate `test`-then-`feat` pair — the RED confirmation is a verification
step, not a persisted commit, consistent with how this phase's Plan 02 executed. No production
code was written before its test existed and failed for the right reason; the suite was never
committed red.

## Issues Encountered

None beyond the two auto-fixed deviations above.

## User Setup Required

None — no external service configuration required.

## Known Stubs

None. Both tasks are fully wired and tested; PLAY-01 and PLAY-02 are live, observable behavior
on every computed snapshot, not a pending wiring step.

## Threat Flags

None beyond what the plan's own threat_model already covers (T-28-07/08/09/10 — all mitigated:
fail-closed on any of the three new reads erroring, gate is 100% server-computed with no client
input path, append-only picker_snapshot history remains the audit trail, and the regression test
proves the gate is evaluated once and is not a `RULE_SET_METADATA` row).

## Next Phase Readiness

- PLAY-01 (crisis gate) and PLAY-02 (anti-criteria brakes) are both live, snapshot-visible
  behavior — the picker computes nothing new to enter when VIX ≥ 25 or ratio ≥ 0.95 (banded with
  hysteresis), and pauses on max-open (6) or the loss cooldown (-25%, 2 business days), each
  pause naming its reason on `PickerSnapshot.gate`.
- Plan 04 (VIX-tiered discrete sizing) can read `PickerSnapshot.gate.vix`/`VIX_LADDER` directly —
  no new gate infrastructure needed.
- The board/Analyzer UI wiring to RENDER `gate` (vix/vix3m/ratio/state/brakes/cooldownUntil) is
  not part of this plan's scope — it's additive contract surface ready for a future UI plan.
- No blockers.

---
*Phase: 28-playbook-gates-anti-criteria-sizing*
*Completed: 2026-07-09*

## Self-Check: PASSED

All 13 created/modified source files confirmed on disk; both task commit hashes (73ceafb,
0b0b2a2) confirmed in git log.
