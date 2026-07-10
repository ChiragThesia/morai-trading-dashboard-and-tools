---
phase: 32-rule-settings-modal-v2-explain-what-you-touch-per-knob-help
fixed_at: 2026-07-10T20:55:28Z
review_path: .planning/phases/32-rule-settings-modal-v2-explain-what-you-touch-per-knob-help/32-REVIEW.md
iteration: 1
findings_in_scope: 4
fixed: 4
skipped: 0
status: all_fixed
---

# Phase 32: Code Review Fix Report

**Fixed at:** 2026-07-10T20:55:28Z
**Source review:** .planning/phases/32-rule-settings-modal-v2-explain-what-you-touch-per-knob-help/32-REVIEW.md
**Iteration:** 1

**Summary:**
- Findings in scope: 4 (2 critical, 2 warning — `critical_and_warning` scope, Info excluded)
- Fixed: 4
- Skipped: 0

## Fixed Issues

### CR-01: Picker-gate preview silently un-blinds a stale-macro-data gate (byte-parity guarantee broken)

**Files modified:** `packages/core/src/picker/application/previewPickerRuleOverrides.ts`, `packages/core/src/picker/application/previewPickerRuleOverrides.test.ts`
**Commit:** `c064009`
**Status:** fixed: requires human verification (bad-state-handling logic bug on a trading go/no-go signal — flagging per the logic-bug verification limitation even though the fix has direct regression coverage)

**Applied fix:** Short-circuited the gate branch — when `snapshot.gate.state === "blind"`, the preview now reproduces the stored gate verbatim (`gateAfter = snapshot.gate`) instead of re-resolving `resolveEntryGate` with the gate's own `asOf` as a fake "now" (which always reads as "0 days old" and silently un-blinded a `macroStale` gate). No staged knob (ladder, maxOpen, sizing) can cure staleness, so this matches the honest semantics the function's own doc comment already claimed. Sizing continues to recompute from `gateAfter.vix` (unchanged for a blind gate) with the staged sizing override, matching production's `toPickerSizing(gate.vix, ...)` behavior which is independent of gate state.

RED test added (`CR-01: a stored blind gate (macroStale) stays blind in preview even with a staged vixLadder override`) reproduced the exact bug described in the review (`state: "blocked"` instead of `"blind"`, `reasons: ["vixBlocked","ratioBlocked"]` instead of `["macroStale"]`) before the fix, and passes after. Also extended the existing byte-parity fast-check property to fuzz between `OPEN_GATE` and a new `STALE_BLIND_GATE` fixture (with a matching `sizingForGate` helper to keep the fixture's stored `sizing.vix` internally consistent with the chosen gate's `vix`) — the `gate.after === gate.before` / `sizing.after === sizing.before` invariant now holds for both fixtures, not just the open one.

### CR-02: `RULE_EXPLAINERS` ships two factually-wrong direction-of-effect claims

**Files modified:** `packages/contracts/src/rule-explainers.ts`, `packages/contracts/src/rule-explainers.test.ts`
**Commit:** `3366fed`
**Status:** fixed

**Applied fix:** Verified the actual engine semantics against `candidate-selection.ts` (`DELTA_BAND_MIN=-0.49` is the near-ATM edge, `DELTA_BAND_MAX=-0.3` is the shallow/far-OTM edge; the filter keeps `deltaMin <= delta <= deltaMax`) and `entry-gate.ts`'s `ResolveEntryGateInput.vixLadder` doc comment (the ladder tiers sizing/display only; `VIX_PENALTY_FLOOR=20`/`VIX_BLOCK_ARM=25` are fixed constants the ladder never moves), then corrected three copy entries:
- `picker.deltaBandMax`: direction corrected from "closer-to-the-money candidates allowed" (backwards) to "further-out-of-the-money candidates allowed."
- `picker.vixLadder.elevatedMin`: removed the false claim that the knob moves "the entry-gate penalty band...start"; summary/direction now scope it to the sizing-tier boundary and explicitly state it does not move the fixed VIX-20 penalty trigger.
- `picker.vixLadder.crisisMin`: removed the false claim that the knob delays "new entries are hard-blocked"; summary/direction now scope it to the zero-contract sizing tier and explicitly state it does not move the fixed VIX-25 hard-block trigger.

RED tests added: a semantic-correctness `describe` block asserting each of the three entries' `direction` text does NOT contain the false claim (substring denylist) and DOES contain the corrected claim; also updated the pre-existing locked-copy-tone assertion for `picker.deltaBandMax` (which was itself asserting the wrong string) to the corrected text.

### WR-01: The JSON-round-trip preview-narrowing bridge is now hand-copied in 3+ places

**Files modified:** `apps/server/src/adapters/rule-overrides-bridge.ts`, `apps/server/src/adapters/http/settings.routes.ts`, `apps/server/src/adapters/mcp/tools.ts`, `packages/core/src/exits/application/previewExitRuleOverrides.ts`
**Commit:** `0ea2d37`
**Status:** fixed

**Applied fix:** Extended `rule-overrides-bridge.ts` (the existing consolidated seam for the PUT-path `toOverridesPatch`) with a new exported `toPreviewInput` function carrying the exact narrowing logic (`isPlainRecord`/`isPickerRuleOverridesShape`/`isExitRuleOverridesShape` + JSON round-trip) that was previously copy-pasted verbatim into `settings.routes.ts` and `mcp/tools.ts`. Both call sites now import `{ toOverridesPatch, toPreviewInput }` from the shared bridge and no longer declare local copies of the narrowing predicates. `packages/core`'s `previewExitRuleOverrides.ts` copy was left as-is per the fix guidance (core cannot import `apps/server` adapter code — hexagonal boundary — and the narrowing there is structurally different, guarding actual field names against an untyped stored blob rather than a plain-record shape-guard on an already-validated request body); added a comment explaining why it is intentionally not consolidated rather than leaving the old "files_modified scope excludes this file" note as the only rationale.

No new tests needed — this is a pure refactor. The 46 existing tests across `settings.routes.test.ts` and `mcp/tools.test.ts` pass unmodified, proving behavior parity.

### WR-02: Preview panel is never cleared on Save or Reset — a stale diff can linger next to newly-applied settings

**Files modified:** `apps/web/src/screens/RuleSettingsModal.tsx`, `apps/web/src/screens/RuleSettingsModal.test.tsx`
**Commit:** `7472584`
**Status:** fixed

**Applied fix:** `handleSave` now calls `previewMutation.reset()` and `setRegimePreview(undefined)` after `onSave` resolves and the draft clears. The Reset-to-defaults button's `onClick` now chains `.then(() => { previewMutation.reset(); setRegimePreview(undefined); })` onto `onReset(group)` so the same two preview states clear once the reset resolves. Both server-backed (picker/exits) and client-side (regime) preview panels are covered.

RED tests added (`WR-02: Save clears the rendered preview panel` and `WR-02: Reset clears a rendered regime preview panel`) reproduced the stale-panel bug (panel still present after Save/Reset) before the fix and pass after. The test file's `makePreviewMutationMock` fake was extended with a `reset()` method mirroring react-query's real `useMutation().reset()` so the fake hook is controllable for this assertion.

## Skipped Issues

None — all 4 in-scope findings were fixed.

## Verification

- `bun run typecheck` (project-wide `tsc --build --force`): clean, exit 0.
- `bun run lint` (project-wide `eslint .`): clean, exit 0 (pre-existing boundaries-plugin warning about legacy selector syntax, unrelated to this change).
- `bun run test` (full workspace vitest run): 285/286 test files pass, 3127/3144 tests pass. The one failing file (`apps/web/src/hooks/useLiveStream.test.ts`, 17 tests) is confirmed pre-existing and unrelated — `git diff` against the pre-fix commit (`f75e811`) shows zero changes to `useLiveStream.ts`/`useLiveStream.test.ts`, and none of the 4 fixes touch that file or its dependency graph.
- Each individual fix was additionally verified via its own scoped test run (RED before, GREEN after) plus a `tsc --noEmit` check on the specific package/app touched, before being committed.

---

_Fixed: 2026-07-10T20:55:28Z_
_Fixer: Claude (gsd-code-fixer)_
_Iteration: 1_
