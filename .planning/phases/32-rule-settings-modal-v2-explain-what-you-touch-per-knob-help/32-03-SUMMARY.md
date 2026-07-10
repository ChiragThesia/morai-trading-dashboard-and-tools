---
phase: 32-rule-settings-modal-v2-explain-what-you-touch-per-knob-help
plan: 03
subsystem: api
tags: [exits, dry-run, preview, fast-check, hexagonal]

requires:
  - phase: 32-01
    provides: "previewRuleOverridesResponse's exits branch contract shape (calendarId/current/staged)"
provides:
  - "packages/core/src/exits/application/previewExitRuleOverrides.ts — makePreviewExitRuleOverridesUseCase (B2)"
  - "ExitPreviewEntry / ExitPreviewResult / ExitPreviewDeps / ForPreviewingExitRuleOverrides port types (exits/application/ports.ts)"
  - "exits/index.ts barrel export of the preview use-case + its types"
affects:
  - "32-04 (server): wires the preview use-case behind POST /api/settings/rules/preview's exits branch"

tech-stack:
  added: []
  patterns:
    - "Live re-evaluation via the same pure evaluateExit called twice with different resolved configs, rather than a static explainer note — RESEARCH Pattern 3 proved this proportionate (2 overridable groups, pure evaluator, single-digit open-calendar count)"
    - "Copy (not import) of a sibling use-case's private narrowing helper when the plan's files_modified list excludes that sibling file — computeExitAdvice.ts's isExitRuleOverrides is duplicated verbatim rather than exported, unlike 32-02's export-and-import of toEntryGateState/toPickerGate"

key-files:
  created:
    - packages/core/src/exits/application/previewExitRuleOverrides.ts
    - packages/core/src/exits/application/previewExitRuleOverrides.test.ts
  modified:
    - packages/core/src/exits/application/ports.ts
    - packages/core/src/exits/index.ts

key-decisions:
  - "isExitRuleOverrides + its field guards are a verbatim COPY into previewExitRuleOverrides.ts, not an import from computeExitAdvice.ts. The plan's files_modified list scopes this task to exactly 3 files (previewExitRuleOverrides.ts/.test.ts, ports.ts) — computeExitAdvice.ts is not in it, so exporting the helper from there was out of scope. The plan's own read_first wording ('copy the CONTEXT construction... REUSE it') supports 'copy' as the literal instruction, distinct from 32-02's picker precedent (which DID export/import because computePickerSnapshot.ts WAS in that plan's files_modified list)."
  - "ExitPreviewDeps.readRuleOverrides imports ForReadingRuleOverrides directly from settings/application/ports.ts into exits/application/ports.ts (cross-context read through an application port, architecture-boundaries rule 7) — same convention picker/application/ports.ts already established for PickerPreviewDeps."
  - "Single commit per task at green (project tdd.md 'commit only at green' rule, 32-02 precedent) — RED run locally and confirmed failing (module-not-found), then implementation, then one feat commit per task; no separate test()/feat() commit pair."

requirements-completed: [B2, B7]

coverage:
  - id: D1
    description: "Every open position gets a current-vs-staged verdict pair by running the pure evaluateExit twice (current effective config, staged config)"
    requirement: B2
    verification:
      - kind: unit
        ref: "packages/core/src/exits/application/previewExitRuleOverrides.test.ts#a staged plus10Arm rung change flips the previewed verdict where the metric crosses the new arm"
        status: pass
    human_judgment: false
  - id: D2
    description: "Empty staged exit overrides reproduce the current verdict for every open position EXACTLY (byte-parity property)"
    requirement: B2
    verification:
      - kind: unit
        ref: "packages/core/src/exits/application/previewExitRuleOverrides.test.ts#byte-parity: an ABSENT staged exits group reproduces the current verdict EXACTLY (fast-check) + the EMPTY ({}) staged group example test"
        status: pass
    human_judgment: false
  - id: D3
    description: "The exit preview use-case deps type structurally excludes persistExitVerdict (read-only, never persists)"
    requirement: B7
    verification:
      - kind: unit
        ref: "packages/core/src/exits/application/previewExitRuleOverrides.test.ts#port hygiene: deps structurally exclude persistExitVerdict and readChainForRoll -- only these 6 fields exist"
        status: pass
    human_judgment: false
  - id: D4
    description: "The live exit re-eval is built (B2 — proportionate per RESEARCH Pattern 3), not the static-note fallback"
    requirement: B2
    verification:
      - kind: unit
        ref: "makePreviewExitRuleOverridesUseCase calls evaluateExit twice per position (currentExitConfig, stagedExitConfig) — no note/string fallback anywhere in the return shape"
        status: pass
    human_judgment: false
  - id: D5
    description: "Preview use-case reachable via the exits context barrel; top-level @morai/core barrel deferred to Plan 04"
    verification:
      - kind: unit
        ref: "bun run typecheck (clean, imports resolve through exits/index.ts); git diff confirms packages/core/src/index.ts untouched"
        status: pass
    human_judgment: false

duration: ~35min
completed: 2026-07-10
status: complete
---

# Phase 32 Plan 03: Exit preview use-case Summary

**Live current-vs-staged re-evaluation of every open calendar's TAKE/STOP verdict — a read-only fork of computeExitAdvice.ts that runs the same pure `evaluateExit` twice per position (once under the current effective config, once under the staged override) and returns the diff, never persisting.**

## Performance

- **Duration:** ~35 min
- **Tasks:** 2
- **Files modified:** 4 (2 created, 2 modified)

## Accomplishments

- `makePreviewExitRuleOverridesUseCase` (B2): the exits branch of the staged-change preview, forking `computeExitAdvice.ts`'s exact read order (`readRuleOverrides` → `readHeldPositions` → `readLatestSnapshotPerOpenCalendar` → `readLatestVerdictsPerCalendar` → `readEconomicEvents`) minus persist and minus chain-for-roll.
- `ExitPreviewEntry`/`ExitPreviewResult`/`ExitPreviewDeps`/`ForPreviewingExitRuleOverrides` added to `exits/application/ports.ts`, re-exported through `exits/index.ts` (top-level `@morai/core` barrel deferred to Plan 04, matching 32-02's own scoping note — Plan 03 leaves the top barrel untouched).
- Byte-parity fast-check property (an absent staged exits group ⇒ `staged.verdict === current.verdict` for every open position across random `netMark` values) plus 11 example tests: an empty `{}` staged group, a staged `plus10Arm` rung flip, an after-hours snapshot's rule-identity stability, safe-skip on a missing snapshot, hysteresis self-read feeding both evaluations, four `StorageError` propagation cases, a `readRuleOverrides` read-error degradation, and port hygiene (exactly 6 deps fields, no persist/chain port).

## Task Commits

Each task was committed atomically:

1. **Task 1: Exit preview use-case — evaluateExit twice per open position, structural no-persist** - `9d7a154` (feat)
2. **Task 2: Barrel-export the exit preview use-case + types through the context barrel** - `0d574bb` (feat)

_Note: followed project `tdd.md`'s "commit only at green" rule — RED was run locally (module-not-found failure, 0 tests collected) and confirmed before implementation; each task lands as one commit at green, not a separate test()/feat() pair (32-02 precedent)._

## Files Created/Modified

- `packages/core/src/exits/application/previewExitRuleOverrides.ts` - the preview use-case: a verbatim copy of `computeExitAdvice.ts`'s `isExitRuleOverrides` narrowing helpers + `makePreviewExitRuleOverridesUseCase`, which evaluates every open position's verdict twice (`currentExitConfig`, `stagedExitConfig`) via the unmodified `evaluateExit`.
- `packages/core/src/exits/application/previewExitRuleOverrides.test.ts` - byte-parity fast-check property + 11 example tests.
- `packages/core/src/exits/application/ports.ts` - `ExitPreviewEntry`/`ExitPreviewResult`/`ExitPreviewDeps`/`ForPreviewingExitRuleOverrides` types, plus a cross-context import of `ForReadingRuleOverrides` from `settings/application/ports.ts` (architecture-boundaries rule 7) and a same-context import of `ExitRuleOverrides` from `../domain/rule-config.ts`.
- `packages/core/src/exits/index.ts` - barrel re-export of the new use-case + its four types.

## Decisions Made

- **`isExitRuleOverrides` is a verbatim copy, not an import.** The plan's `files_modified` frontmatter scopes this task to exactly 3 files (`previewExitRuleOverrides.ts`/`.test.ts`, `ports.ts`) — `computeExitAdvice.ts` is not in that list. Exporting `isExitRuleOverrides` from `computeExitAdvice.ts` (the 32-02 picker precedent's approach for `toEntryGateState`/`toPickerGate`) would have required modifying a file outside this plan's declared scope. The plan's own read_first instruction ("copy the CONTEXT construction... REUSE it") supports literal duplication as the intended approach here — the copied code is byte-identical to the source, so there is no re-authored logic, only a structural duplication forced by the plan's scoping.
- **`ExitPreviewDeps` reads `ForReadingRuleOverrides` cross-context** exactly like `PickerPreviewDeps` does — one settings-context application-port import, no domain import.
- **`ExitPreviewEntry.current` carries no `metric` field** — matches `previewExitEntry` in `contracts/src/rule-preview.ts` (32-01) exactly: only the staged side surfaces the raw metric, since that's the value a UI diffing current vs. staged actually needs.
- **`rollChain.candidates = []` unconditionally** — a TAKE/STOP rung change never drives a ROLL suggestion (ROLL has its own independent DTE/spot-band/profit gates unrelated to the staged rungs), so omitting the chain read keeps the preview bounded and structurally read-only (T-32-02).

## Deviations from Plan

None — plan executed exactly as written, including the critical constraint (deps type structurally excludes persist ports AND chain reads; byte-parity fast-check on empty staged overrides; only TAKE/STOP rungs overridable; Phase 27 replay suites untouched).

## Issues Encountered

None.

## User Setup Required

None - no external service configuration required.

## Known Stubs

None. `previewExitRuleOverrides.ts` is fully wired against the real `evaluateExit`/`resolveExitRuleConfig` domain functions — no placeholder branch, no mock verdict path. It has no caller yet (that's 32-04's HTTP-route wiring), same "shipped but unwired" status 32-01's contracts and 32-02's picker preview had before this plan.

## Next Phase Readiness

- The use-case is ready for 32-04 to wire behind `POST /api/settings/rules/preview`'s exits branch: its `ExitPreviewResult` shape (`{calendarId, current:{verdict,rung,ruleId}, staged:{verdict,rung,ruleId,metric}}[]`) maps directly onto `previewRuleOverridesResponse`'s `exits` field from 32-01's contract.
- No blockers. Plan 04 (server wiring) can now wire BOTH the picker (32-02) and exits (32-03) preview use-cases through the top-level `@morai/core` barrel it owns — neither Plan 02 nor Plan 03 touched `packages/core/src/index.ts`.

---
*Phase: 32-rule-settings-modal-v2-explain-what-you-touch-per-knob-help*
*Completed: 2026-07-10*

## Self-Check: PASSED

- FOUND: packages/core/src/exits/application/previewExitRuleOverrides.ts
- FOUND: packages/core/src/exits/application/previewExitRuleOverrides.test.ts
- FOUND: .planning/phases/32-rule-settings-modal-v2-explain-what-you-touch-per-knob-help/32-03-SUMMARY.md
- FOUND commit 9d7a154 (feat: exit preview use-case)
- FOUND commit 0d574bb (feat: barrel-export exit preview use-case)
