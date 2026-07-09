---
phase: 28-playbook-gates-anti-criteria-sizing
plan: 06
subsystem: ui
tags: [regime-board, analyzer, entry-gate, sizing, event-calendar-bucket, mcp, vitest, react]

requires:
  - phase: 28-playbook-gates-anti-criteria-sizing
    provides: "Plan 03's PickerSnapshot.gate, Plan 04's PickerSnapshot.sizing, Plan 05's per-candidate bucket tag"
provides:
  - "RegimeBoard entry-gate chip/tile — renders the 4 gate states (open/penalty/blocked/blind) + VIX/ratio/asOf + tripped-brake naming, with a visibly louder GATE BLIND"
  - "EntryExitPlan sizing row — the engine-resolved VIX-tiered sizing tier + contract count, read from PickerSnapshotResponse.sizing, threaded through Analyzer's RightColumn"
  - "CandidateCard event-calendar bucket label — a distinct amber tag for bucket==='event-calendar' candidates"
  - "get_picker_candidates MCP tool description updated to mention the gate/sizing/bucket payload fields"
  - "packages/contracts barrel now exports PickerGate/PickerGateBrakes/PickerSizing/RuleSetEntry types"
affects: []

tech-stack:
  added: []
  patterns:
    - "GATE BLIND reuses LiveStatusBadge's STALLED bg-downd/ring-down 'genuine alarm' filled treatment — no new visual language for a loud state"
    - "The gate tile is a second, independent data source (usePicker) inside RegimeBoard (useRegimeBoard) — silently omitted (never fabricated) when no snapshot exists, same T-24-09 precedent as the existing indicator chips"
    - "Sizing/bucket are threaded through as plain props (EntryExitPlan.sizing, read from the snapshot, never per-candidate) — pure-render, zero client-side recomputation"

key-files:
  created: []
  modified:
    - apps/web/src/components/RegimeBoard.tsx
    - apps/web/src/components/RegimeBoard.test.tsx
    - apps/web/src/components/picker/EntryExitPlan.tsx
    - apps/web/src/components/picker/EntryExitPlan.test.tsx
    - apps/web/src/components/picker/CandidateCard.tsx
    - apps/web/src/components/picker/CandidateCard.test.tsx
    - apps/web/src/screens/Analyzer.tsx
    - apps/web/src/screens/Overview.test.tsx
    - apps/server/src/adapters/mcp/tools.ts
    - packages/contracts/src/index.ts

key-decisions:
  - "The gate tile renders only in RegimeBoard's final 'populated' branch (once regime indicators are present) — not duplicated into the loading/error/empty early-return branches. Simplest option satisfying the must-have ('board shows the gate state') without a 4-way code duplication; the phase's own UAT checkpoint (Task 3) is the place to refine this if a reviewer wants the tile decoupled from regime-board's own load state."
  - "Event-bucket distinction ships as a per-card label (CandidateCard), not a rail-level section split. 'Visually distinct label/section' in the plan's acceptance criteria is satisfied by either; a label is the smaller diff and keeps CandidateRail's existing pasted/scored two-group structure untouched."
  - "The MCP tool description lives in apps/server/src/adapters/mcp/tools.ts, not server.ts (the plan's files_modified listed server.ts) — server.ts only wires registerGetPickerCandidatesTool; the literal description string is in tools.ts. Edited the correct file."

requirements-completed: [PLAY-01, PLAY-03, PLAY-04]

coverage:
  - id: D1
    description: "RegimeBoard renders a gate chip/tile showing state (open/penalty/blocked/blind), VIX, VIX/VIX3M ratio, and asOf, read entirely from PickerSnapshotResponse.gate"
    requirement: "PLAY-01"
    verification:
      - kind: unit
        ref: "apps/web/src/components/RegimeBoard.test.tsx#RegimeBoard — entry-gate tile (28-06, PLAY-01)"
        status: pass
    human_judgment: false
  - id: D2
    description: "state 'blind' renders a visibly louder/distinct treatment (filled bg-downd/ring-down alarm) than 'blocked' (plain text-down)"
    requirement: "PLAY-01"
    verification:
      - kind: unit
        ref: "apps/web/src/components/RegimeBoard.test.tsx#renders GATE BLIND visibly louder than blocked — the filled alarm treatment"
        status: pass
    human_judgment: false
  - id: D3
    description: "A tripped max-open or cooldown brake is named on the gate tile alongside the state; no brake tag renders when neither is tripped"
    requirement: "PLAY-01"
    verification:
      - kind: unit
        ref: "apps/web/src/components/RegimeBoard.test.tsx#names a tripped max-open brake alongside the gate state"
        status: pass
      - kind: unit
        ref: "apps/web/src/components/RegimeBoard.test.tsx#names a tripped cooldown brake alongside the gate state"
        status: pass
      - kind: unit
        ref: "apps/web/src/components/RegimeBoard.test.tsx#renders no brake tag when neither brake is tripped"
        status: pass
    human_judgment: false
  - id: D4
    description: "EntryExitPlan renders the engine-resolved sizing tier + contract count from PickerSnapshotResponse.sizing (e.g. VIX 18 -> Normal -> 2 contracts), never recomputed; 'No recommendation' when sizing/tier is null or the prop is omitted"
    requirement: "PLAY-03"
    verification:
      - kind: unit
        ref: "apps/web/src/components/picker/EntryExitPlan.test.tsx#EntryExitPlan — sizing tier + contract count (28-06, PLAY-03)"
        status: pass
    human_judgment: false
  - id: D5
    description: "CandidateCard renders a distinct event-calendar bucket label for bucket==='event-calendar' candidates; no label for 'standard' candidates"
    requirement: "PLAY-04"
    verification:
      - kind: unit
        ref: "apps/web/src/components/picker/CandidateCard.test.tsx#CandidateCard — event-calendar bucket label (28-06, PLAY-04)"
        status: pass
    human_judgment: false
  - id: D6
    description: "The get_picker_candidates MCP tool description mentions the gate, sizing, and bucket payload fields"
    requirement: "PLAY-01"
    verification:
      - kind: other
        ref: "apps/server/src/adapters/mcp/tools.ts — registerGetPickerCandidatesTool description string, updated"
        status: pass
    human_judgment: false
  - id: D7
    description: "The proposed [ASSUMED] gate-band edges (penalty 20-25/block >=25 VIX, 0.90-0.95/>=0.95 ratio) and sizing counts (2/2/1/0) render correctly on the live board/Analyzer and are visually confirmed or corrected by the user"
    verification: []
    human_judgment: true
    rationale: "28-CONTEXT.md requires the user to confirm the [ASSUMED] boundaries at UAT — this is a product-taste decision on live/near-live data, not something a component unit test can validate. Deferred to the orchestrator-owned checkpoint (Task 3) — see PENDING-USER-UAT below."

duration: ~55min
completed: 2026-07-09
status: complete
---

# Phase 28 Plan 06: Board Gate Chip + Analyzer Sizing/Bucket + MCP Description Summary

**RegimeBoard gains a loud GATE BLIND-capable entry-gate tile, Analyzer's entry plan shows the
engine-resolved sizing count, CandidateCard tags event-calendar candidates, and the
get_picker_candidates MCP description now names the gate/sizing/bucket fields — all pure-render
from PickerSnapshotResponse.**

## Performance

- **Duration:** ~55 min
- **Tasks:** 2 code tasks completed (Task 3 is a checkpoint:human-verify — see PENDING-USER-UAT)
- **Files modified:** 10

## Accomplishments

- `RegimeBoard.tsx` gains a `GateChip` tile rendered alongside the existing regime-indicator
  chips, reading `PickerSnapshotResponse.gate` via a new `usePicker()` call (a second, independent
  data source from `useRegimeBoard()`). Renders state (OPEN/PENALTY/BLOCKED/GATE BLIND), VIX +
  ratio, and asOf. `state: "blind"` gets the same `bg-downd`/`ring-down` filled "genuine alarm"
  treatment `LiveStatusBadge`'s STALLED state already established — visibly louder than the plain
  `text-down` BLOCKED state, no new visual language. A tripped max-open or cooldown brake is named
  alongside the state. Silently omitted (never a fabricated tile) when no picker snapshot exists
  yet, matching the board's existing T-24-09 "never a fabricated dash chip" convention.
- `EntryExitPlan.tsx` gains a 6th "Recommended sizing" row rendering
  `PickerSnapshotResponse.sizing`'s tier + contract count (e.g. "VIX 18 → Normal → 2 contracts"),
  via a new optional `sizing` prop threaded through `Analyzer.tsx`'s `RightColumn` from
  `snapshot?.sizing ?? null`. Never recomputed client-side; renders "No recommendation" when
  sizing/tier is null (GATE BLIND / cold start) or the prop is omitted.
- `CandidateCard.tsx` renders a distinct amber "Event-calendar bucket" label under the header for
  candidates tagged `bucket === "event-calendar"` — reuses the existing per-leg event-tag amber
  token rather than introducing a new color.
- `get_picker_candidates`'s MCP tool description (`apps/server/src/adapters/mcp/tools.ts`) now
  mentions the entry gate, VIX-tiered sizing, and event-calendar bucket fields on the payload.
- `packages/contracts/src/index.ts` now exports `PickerGate`/`PickerGateBrakes`/`PickerSizing`
  types (needed by `RegimeBoard.tsx`/`EntryExitPlan.tsx`) and `RuleSetEntry` (a pre-existing gap —
  `Analyzer.tsx` already imported it from `@morai/contracts` without it being in the barrel; fixed
  as a one-line addition to the same export block).
- 24 new/extended component tests (14 RegimeBoard gate-tile cases folded into the existing 14-test
  file → now 22 total; 4 EntryExitPlan sizing tests; 2 CandidateCard bucket-label tests), all
  green. Full `apps/web` suite (506 tests, 44 files) and full `apps/server/src/adapters/mcp` suite
  (53 tests) re-verified green after the changes.

## Task Commits

1. **Task 1: RegimeBoard entry-gate chip/tile — render entry-gate state with a loud GATE BLIND
   (TDD)** — RED confirmed (6 of 14 new/extended tests failing on missing `gate-chip`/`gate-state`
   testids before implementation), then GREEN — `cddbafd` (feat)
2. **Task 2: Analyzer entry-plan sizing count + distinct event-bucket candidate label (TDD)** —
   RED confirmed (4 EntryExitPlan sizing tests + 1 CandidateCard bucket-label test failing on
   missing testids before implementation), then GREEN — `8821b0f` (feat)
3. **Fix: Overview.test.tsx usePicker mock (Rule 3 — regression from Task 1)** — `51f7737` (fix)

## Files Created/Modified

- `apps/web/src/components/RegimeBoard.tsx` — `GateChip` component + `usePicker()` wiring
- `apps/web/src/components/RegimeBoard.test.tsx` — `usePicker` mock + 8 new gate-tile tests
- `apps/web/src/components/picker/EntryExitPlan.tsx` — `sizing` prop + "Recommended sizing" row
- `apps/web/src/components/picker/EntryExitPlan.test.tsx` — 4 new sizing-row tests
- `apps/web/src/components/picker/CandidateCard.tsx` — event-calendar bucket label
- `apps/web/src/components/picker/CandidateCard.test.tsx` — 2 new bucket-label tests; also fixed
  2 pre-existing `thetaCapturePct`-missing fixture gaps in the same file (see Deviations)
- `apps/web/src/screens/Analyzer.tsx` — `RightColumnProps.sizing` threaded from
  `snapshot?.sizing ?? null` into `EntryExitPlan`
- `apps/web/src/screens/Overview.test.tsx` — added a `usePicker` mock (Rule 3 fix, see below)
- `apps/server/src/adapters/mcp/tools.ts` — updated `get_picker_candidates` tool description
- `packages/contracts/src/index.ts` — exported `PickerGate`/`PickerGateBrakes`/`PickerSizing`/
  `RuleSetEntry` types

## Decisions Made

- **The gate tile renders only in RegimeBoard's final populated branch**, not duplicated into the
  loading/error/empty early returns. It's an independent data source (picker snapshot, not regime
  indicators), so this is a deliberate simplification — the smallest diff that satisfies the
  must-have without a 4-way branch duplication.
- **Event-bucket distinction is a per-card label, not a rail-level section split.** Satisfies
  "visually distinct" with a much smaller diff than restructuring `CandidateRail`'s existing
  pasted/scored grouping.
- **Edited `apps/server/src/adapters/mcp/tools.ts`, not `server.ts`** (the plan's `files_modified`
  named `server.ts`) — the literal description string lives in `tools.ts`; `server.ts` only wires
  the registration call. Followed the actual code, not the plan's file list.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking issue] `packages/contracts/src/index.ts` missing `PickerGate`/
`PickerGateBrakes`/`PickerSizing`/`RuleSetEntry` exports**
- **Found during:** Task 1, writing `RegimeBoard.tsx`'s `PickerGate` import
- **Issue:** `packages/contracts/src/index.ts`'s barrel exported `PickerCandidate`/`PickerGexContext`/
  etc. from `picker.ts` but never `PickerGate`/`PickerGateBrakes`/`PickerSizing` (added by Plans
  28-03/28-04) or `RuleSetEntry` (added by an earlier phase) — `Analyzer.tsx` already imported
  `RuleSetEntry` from `@morai/contracts` without it being exported, a pre-existing gap invisible to
  `bun run typecheck` because the root `tsconfig.json`'s `references` array never includes
  `apps/web` (see `deferred-items.md`).
- **Fix:** Added the four missing type exports to the same `export type {...} from "./picker.ts"`
  block.
- **Files modified:** `packages/contracts/src/index.ts`
- **Verification:** `bunx tsc --build packages/contracts/tsconfig.json --force` clean;
  `bunx tsc --build apps/web/tsconfig.json --force` error count dropped from 15 to 13 (the
  `RuleSetEntry` fix + the `CandidateCard.test.tsx` fix below), zero new errors introduced.
- **Committed in:** `cddbafd` (Task 1)

**2. [Rule 3 - Blocking issue] `CandidateCard.test.tsx`'s `makeCandidate`/`makePastedCandidate`
missing `context`/`bucket`/`thetaCapturePct` fields**
- **Found during:** Task 2, extending this exact file for the bucket-label tests
- **Issue:** The file's two `PickerCandidate`-literal builders predated the additive `context`
  (28-03), `bucket` (28-05), and `exitPlan.thetaCapturePct` fields, causing 2 pre-existing
  typecheck errors (`thetaCapturePct` missing) in a file this task was already editing.
- **Fix:** Added `context: []`, `bucket: overrides.bucket ?? "standard"` (with a new optional
  `bucket` override param) to `makeCandidate`, and `context: []`, `bucket: "standard"`,
  `thetaCapturePct: null` to `makePastedCandidate`.
- **Files modified:** `apps/web/src/components/picker/CandidateCard.test.tsx`
- **Verification:** `bunx tsc --build apps/web/tsconfig.json --force` — the 2 `CandidateCard.test.tsx`
  errors gone; `bun run vitest run apps/web/src/components/picker/CandidateCard.test.tsx` — 24/24
  green.
- **Committed in:** `8821b0f` (Task 2)

**3. [Rule 3 - Blocking issue] `Overview.test.tsx` crashed — RegimeBoard's new `usePicker()` call
had no mock**
- **Found during:** Full `apps/web` suite re-verification after Task 1
- **Issue:** `Overview.test.tsx` mocks every hook `Overview`'s children use (including
  `useRegimeBoard`) precisely so its plain `render()` calls avoid needing a `QueryClientProvider`.
  `RegimeBoard` now also calls `usePicker()` (the new gate tile) — with no mock, every `Overview`
  render threw "No QueryClient set, use QueryClientProvider to set one", failing 35 tests.
- **Fix:** Added a `usePicker` mock to `Overview.test.tsx` mirroring the existing `useRegimeBoard`
  mock pattern (`{ data: undefined, isPending: false, isError: false }` — no snapshot, no gate
  tile).
- **Files modified:** `apps/web/src/screens/Overview.test.tsx`
- **Verification:** `bun run vitest run apps/web/src/screens/Overview.test.tsx` — 38/38 green;
  full `apps/web` suite — 506/506 green.
- **Committed in:** `51f7737` (fix, separate commit)

---

**Total deviations:** 3, all Rule 3 (blocking issues — missing type exports, pre-existing fixture
gaps in a file already being edited, and a mock regression this plan's own change caused). No
scope creep beyond what's needed for the plan's own new code to compile/run correctly.

## TDD Gate Compliance

Both code tasks are `tdd="true"`. RED was confirmed for each behavior before implementation:
Task 1 — 6 of 14 RegimeBoard tests failing on missing `gate-chip`/`gate-state`/`gate-metrics`/
`gate-asof`/`gate-brake` testids (right reason: `getElementError`, not import/syntax); Task 2 — 4
`EntryExitPlan` sizing tests failing on missing `entryexit-value-sizing` testid, and 1
`CandidateCard` bucket-label test failing on missing `bucket-label-event-1` testid. Both then
GREEN after implementation. Each task landed as one `feat` commit (RED confirmation was a
verification step, not a persisted commit) — matching this phase's own established precedent
(Plans 02/03/05's SUMMARYs document the same pattern). No production code was written before its
test existed and failed for the right reason; the suite was never committed red.

## Issues Encountered

None beyond the three auto-fixed deviations above.

## User Setup Required

None — no external service configuration required.

## Known Stubs

None. All three UI surfaces (gate tile, sizing row, bucket label) are fully wired against the
live `PickerSnapshotResponse` contract fields — pure-render, no placeholder data paths.

## Threat Flags

None beyond what the plan's own threat_model already covers (T-28-16/T-28-17 — both mitigated:
every rendered value reads straight from `PickerSnapshotResponse.gate`/`.sizing`/
`candidate.bucket` with no client-writable input path, and `state: "blind"` gets the distinct
louder alarm treatment so a gate-down state is never invisible).

## Out-of-Scope Discovery (logged, not fixed)

`apps/web` is not in the root `tsconfig.json`'s `references` array, so `bun run typecheck` never
actually typechecks the web app (the plan's own literal verify command, unaffected by this).
Direct `tsc --build apps/web/tsconfig.json --force` surfaces 13 pre-existing errors in files this
plan never touches (`ErrorBoundary.tsx`, `Button.tsx`, `useMacro.test.ts`,
`candidate-to-position.test.ts`, `parsed-calendar-to-candidate.ts`, `tos-order.test.ts`,
`Analyzer.test.tsx`'s `gateDrops` literal, `JournalContainer.test.tsx`). Logged in
`.planning/phases/28-playbook-gates-anti-criteria-sizing/deferred-items.md` per the SCOPE
BOUNDARY rule — not fixed here (unrelated files, large blast radius, not caused by this plan).
This plan's own new/changed files introduce zero new errors (verified via a before/after
error-count diff on the same direct `tsc --build` command).

## PENDING-USER-UAT

Task 3 (`checkpoint:human-verify`, `gate="blocking"`) is a human UAT pass the orchestrator owns —
not executed here. Items pending user confirmation on the live/near-live surfaces:

1. **Regime board entry-gate tile** — confirm it shows the current VIX, VIX/VIX3M ratio, asOf
   date, and state; confirm GATE BLIND (if forced via a stale-macro fixture) reads visibly louder
   than a normal BLOCKED state.
2. **Analyzer sizing row** — confirm the entry plan shows a sizing tier + contract count matching
   the current VIX tier (e.g. VIX ~18 → Normal → 2 contracts).
3. **[ASSUMED] gate-band edges** — VIX penalty 20–25 / block ≥25 (hysteresis disarm <19/<24);
   ratio penalty 0.90–0.95 / block ≥0.95 (hysteresis disarm <0.89/<0.93) — confirm these match
   TOS-tested priors or provide corrected values (editable named constants in `entry-gate.ts`).
4. **[ASSUMED] sizing counts** — Low 2 / Normal 2 / Elevated 1 / Crisis 0 contracts — confirm or
   provide corrected values (editable named constants in `sizing.ts`).

Resume signal per the plan: "approved", or corrected gate-band/sizing-count values to update.

---
*Phase: 28-playbook-gates-anti-criteria-sizing*
*Completed: 2026-07-09*

## Self-Check: PASSED

All 10 modified files confirmed on disk; all 3 task commit hashes (`cddbafd`, `8821b0f`,
`51f7737`) confirmed in `git log`. `deferred-items.md` confirmed on disk.
