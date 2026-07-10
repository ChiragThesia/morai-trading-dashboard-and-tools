---
phase: 29-runtime-rule-settings-curated-20-knob-settings-surface-entry
fixed_at: 2026-07-10T06:57:23Z
review_path: .planning/phases/29-runtime-rule-settings-curated-20-knob-settings-surface-entry/29-REVIEW.md
iteration: 1
findings_in_scope: 4
fixed: 4
skipped: 0
status: all_fixed
---

# Phase 29: Code Review Fix Report

**Fixed at:** 2026-07-10T06:57:23Z
**Source review:** .planning/phases/29-runtime-rule-settings-curated-20-knob-settings-surface-entry/29-REVIEW.md
**Iteration:** 1

**Summary:**
- Findings in scope: 4 (2 critical, 2 warning)
- Fixed: 4
- Skipped: 0

## Fixed Issues

### CR-01: `picker.deltaBandMin` override is validated, persisted, and displayed, but has zero effect on the actual picker universe

**Files modified:** `packages/core/src/picker/domain/candidate-selection.ts`, `packages/core/src/picker/domain/candidate-selection.test.ts`, `packages/core/src/picker/application/computePickerSnapshot.ts`, `packages/core/src/picker/application/computePickerSnapshot.test.ts`
**Commit:** `203e2e4`
**Applied fix:** TDD red→green. Added a failing regression test first (candidate-selection.test.ts: `autoTuneTargetDelta` deltaMin/deltaMax override tests, `selectCandidates` deltaMin-param tests; computePickerSnapshot.test.ts: an end-to-end test asserting a `deltaBandMin` override narrows the emitted candidate set). Then:
- `autoTuneTargetDelta` gained optional `deltaMin`/`deltaMax` parameters (default `DELTA_BAND_MIN`/`DELTA_BAND_MAX`), so the VIX-tuned interpolation range itself is overridable instead of hardcoded.
- `SelectCandidatesParams` gained a `deltaMin` field (config.deltaBand.min's clamp floor); the clamp in `selectCandidates` now uses `params.deltaMin ?? DELTA_BAND_MIN` as both the floor and the `effectiveDeltaMin` fallback, instead of the hardcoded `DELTA_BAND_MIN`.
- `computePickerSnapshot.ts`'s both call sites (`selectCandidates` and `selectEventCandidates`) now pass `deltaMin: config.deltaBand.min` and thread `config.deltaBand.min`/`config.deltaBand.max` into both `autoTuneTargetDelta(...)` calls.
- Verified: omission byte-identical to the pre-fix behavior (dedicated regression tests); overriding `deltaBandMin` now actually narrows the live picker universe (confirmed via the new computePickerSnapshot integration test).

### CR-02: No cross-field ordering validation on `picker.vixLadder` or `regime.*Warn`/`*Crisis`

**Files modified:** `packages/contracts/src/rule-settings.ts`, `packages/contracts/src/rule-settings.test.ts`
**Commit:** `27c337e`
**Applied fix:** TDD red→green. Added failing contract tests first (ascending/inverted vixLadder cases; each of the 4 regime warn/crisis pairs, plus single-sided-partial acceptance cases), then:
- `vixLadderShape` gained a `.refine()` requiring `normalMin < elevatedMin < crisisMin` (mirrors the existing weight-sum/hysteresis-pair style and error-message convention).
- `regimeOverrides` gained 4 `.refine()`s (one per indicator pair: vixTermStructure, vvix, vix9dRatio, hyOas), each only enforcing `warn < crisis` when BOTH sides of the SAME request supply a value (a single-sided partial PUT can't be ordering-checked against the stored/default counterpart at the contract layer — documented in the review's own fix note as an intentional scope boundary, not addressed here).

### WR-01: `toOverridesPatch`/`isRuleOverridesPatch` JSON-round-trip bridge duplicated in two adapters

**Files modified:** `apps/server/src/adapters/rule-overrides-bridge.ts` (new), `apps/server/src/adapters/http/settings.routes.ts`, `apps/server/src/adapters/mcp/tools.ts`
**Commit:** `3837fe7`
**Applied fix:** Extracted the duplicated `toOverridesPatch`/`isRuleOverridesPatch` pair into a new shared adapter-local module `apps/server/src/adapters/rule-overrides-bridge.ts`, following the exact precedent already established by `status-dto.ts` (a sibling adapter-local helper imported by both `../http/*.ts` and `../mcp/tools.ts` via the same relative-import shape). Both `settings.routes.ts` and `tools.ts` now import `toOverridesPatch` from this single source instead of each defining their own copy; unused `RuleOverridesPatch`/`SetRuleOverridesRequest` type imports were removed from `tools.ts` since they were only referenced by the deleted local functions. This is a pure refactor (no behavior change) — verified by the pre-existing HTTP route and MCP tool test suites staying green unmodified.

### WR-02: `RuleSettingsModal`'s Save silently substitutes `0` for a blank/cleared numeric input

**Files modified:** `apps/web/src/screens/RuleSettingsModal.tsx`, `apps/web/src/screens/RuleSettingsModal.test.tsx`
**Commit:** `323ceaa`
**Applied fix:** TDD red→green. Added a failing test first (clear a field after typing into it, then Save — expect the effective value, not `0`), then changed the parse guard from `raw === undefined ? row.value : Number(raw)` to `raw === undefined || raw === "" ? row.value : Number(raw)`, so a cleared input (draft becomes `""`, not `undefined`) falls back to the row's current effective value instead of `Number("")` silently coercing to `0`.

## Skipped Issues

None — all 4 in-scope findings were fixed.

## Verification

- `bun run typecheck` equivalent (`tsc --build --force` across the whole workspace): clean, 0 errors.
- `bun run lint` equivalent (`eslint .` across the whole workspace): clean, 0 errors (only 2 pre-existing config warnings unrelated to any touched file).
- Full test suite (`vitest run`, whole workspace): 2937/2954 passed. The 17 failures are all in `apps/web/src/hooks/useLiveStream.test.ts`, confirmed pre-existing and unrelated to this phase or any file touched by these fixes (reproduced identically on the pre-fix commit via `git stash`).
- CR-01's no-override byte-identical invariant is locked by dedicated regression tests (`autoTuneTargetDelta` omission test, `selectCandidates` omission test) — every existing test in the picker/settings/contracts packages passed unmodified except the new coverage added for these 4 findings.
- CR-01 and CR-02 are both live-behavior fixes verified with real assertions (not just typecheck) — no "requires human verification" flag needed; the fixes are provably correct against the review's own cited call graph and are covered by new regression tests exercising the exact failure mode described.

---

_Fixed: 2026-07-10T06:57:23Z_
_Fixer: Claude (gsd-code-fixer)_
_Iteration: 1_
