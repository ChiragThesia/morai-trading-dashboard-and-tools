---
phase: 29-runtime-rule-settings-curated-20-knob-settings-surface-entry
reviewed: 2026-07-10T00:00:00Z
depth: standard
files_reviewed: 45
files_reviewed_list:
  - apps/server/src/adapters/http/settings.routes.test.ts
  - apps/server/src/adapters/http/settings.routes.ts
  - apps/server/src/adapters/mcp/server.ts
  - apps/server/src/adapters/mcp/tools.test.ts
  - apps/server/src/adapters/mcp/tools.ts
  - apps/server/src/main.ts
  - apps/web/src/components/Shell.tsx
  - apps/web/src/hooks/useRuleSettings.test.ts
  - apps/web/src/hooks/useRuleSettings.ts
  - apps/web/src/screens/RuleSettingsModal.test.tsx
  - apps/web/src/screens/RuleSettingsModal.tsx
  - apps/worker/src/main.ts
  - packages/adapters/src/__contract__/rule-overrides.contract.ts
  - packages/adapters/src/index.ts
  - packages/adapters/src/memory/rule-overrides.contract.test.ts
  - packages/adapters/src/memory/rule-overrides.ts
  - packages/adapters/src/postgres/migrations/0022_rule_overrides.sql
  - packages/adapters/src/postgres/repos/rule-overrides.contract.test.ts
  - packages/adapters/src/postgres/repos/rule-overrides.ts
  - packages/adapters/src/postgres/schema.ts
  - packages/core/src/analytics/application/getRegimeBoard.test.ts
  - packages/core/src/analytics/application/getRegimeBoard.ts
  - packages/core/src/analytics/domain/regime.test.ts
  - packages/core/src/analytics/domain/regime.ts
  - packages/core/src/analytics/domain/rule-config.test.ts
  - packages/core/src/analytics/domain/rule-config.ts
  - packages/core/src/analytics/index.ts
  - packages/core/src/backtest/application/replayPickerCohort.test.ts
  - packages/core/src/exits/application/computeExitAdvice.test.ts
  - packages/core/src/exits/application/computeExitAdvice.ts
  - packages/core/src/exits/domain/evaluate-exit.test.ts
  - packages/core/src/exits/domain/evaluate-exit.ts
  - packages/core/src/exits/domain/rule-config.test.ts
  - packages/core/src/exits/domain/rule-config.ts
  - packages/core/src/exits/index.ts
  - packages/core/src/index.ts
  - packages/core/src/picker/application/computePickerSnapshot.test.ts
  - packages/core/src/picker/application/computePickerSnapshot.ts
  - packages/core/src/picker/domain/brakes.test.ts
  - packages/core/src/picker/domain/brakes.ts
  - packages/core/src/picker/domain/candidate-selection.test.ts
  - packages/core/src/picker/domain/candidate-selection.ts
  - packages/core/src/picker/domain/entry-gate.test.ts
  - packages/core/src/picker/domain/entry-gate.ts
  - packages/core/src/picker/domain/rule-config.test.ts
  - packages/core/src/picker/domain/rule-config.ts
  - packages/core/src/picker/domain/rules.test.ts
  - packages/core/src/picker/domain/rules.ts
  - packages/core/src/picker/domain/scoring.ts
  - packages/core/src/picker/domain/sizing.test.ts
  - packages/core/src/picker/domain/sizing.ts
  - packages/core/src/picker/index.ts
  - packages/core/src/settings/application/getRuleSettings.test.ts
  - packages/core/src/settings/application/getRuleSettings.ts
  - packages/core/src/settings/application/ports.ts
  - packages/core/src/settings/application/setRuleOverrides.test.ts
  - packages/core/src/settings/application/setRuleOverrides.ts
  - packages/core/src/settings/domain/merge.test.ts
  - packages/core/src/settings/domain/merge.ts
  - packages/contracts/src/rule-settings.ts
  - packages/contracts/src/rule-settings.test.ts
findings:
  critical: 2
  warning: 2
  info: 0
  total: 4
status: issues_found
---

# Phase 29: Code Review Report

**Reviewed:** 2026-07-10T00:00:00Z
**Depth:** standard
**Files Reviewed:** 60
**Status:** issues_found

## Summary

The runtime rule-override plumbing itself is careful and well-tested: the Zod contract's
`.strict()` whitelist, weight-sum-100 refine, and TAKE/STOP hysteresis-pair refine all do what
they claim; every consumer (compute-picker, compute-exit-advice, get-regime-board) reads
overrides fresh per invocation with no module-level caching; the `?? CONSTANT` merge idiom in
all three `resolveXRuleConfig` functions correctly reproduces compile-time behavior byte-for-
byte on omission (locked by fast-check idempotency tests); the JSON-round-trip "ponytail"
bridges (`toJsonSafe`/`toOverridesPatch`) are sound — they run only on data that already passed
full Zod validation, and `__proto__` injection is moot because every nesting level of the
contract is `.strict()` and rejects the key before any merge code runs. The HTTP route is
correctly mounted inside the JWT-gated group; the MCP tool is correctly gated by the bearer
`/mcp/*` middleware.

However, two real defects survive: (1) one of the ~20 curated knobs — `picker.deltaBandMin` —
is validated, persisted, and displayed as "effective" but is never actually read by the
candidate-selection code path, so overriding it silently does nothing to live trading behavior;
(2) the contract has no cross-field ordering validation for `picker.vixLadder`
(`normalMin < elevatedMin < crisisMin`) or the four `regime.*Warn`/`*Crisis` pairs
(`warn < crisis`), so a misordered PUT is accepted and silently corrupts VIX-tier resolution or
regime-board banding downstream with no error anywhere in the pipeline. Both are provable by
tracing the actual call graph, not by inspection of tests (which only ever exercise correctly-
ordered fixtures).

## Critical Issues

### CR-01: `picker.deltaBandMin` override is validated, persisted, and displayed, but has zero effect on the actual picker universe

**File:** `packages/core/src/picker/application/computePickerSnapshot.ts:601-610` (and the mirrored `selectEventCandidates` call at :631-638)
**Issue:**
`resolvePickerRuleConfig` (packages/core/src/picker/domain/rule-config.ts:97-100) correctly
resolves `config.deltaBand.min` from the override (falling back to `DELTA_BAND_MIN`), and its
own doc comment states this object is "the ONE object the worker wiring (29-10) destructures to
feed each seam: `weights` -> `scoreCalendarCandidates`; `deltaBand`/`frontDte`/`backDteGap` ->
`selectCandidates`". In practice, `computePickerSnapshot.ts` only ever reads
`config.deltaBand.max` (as `deltaMax`) — `config.deltaBand.min` is never referenced anywhere in
the file (confirmed by `rg -n "config\.deltaBand"` — the only two matches are `.max`, at lines
605 and 635).

Worse, the "effective" deep edge of the band comes from
`autoTuneTargetDelta(gate.vix, config.vixLadder)`
(packages/core/src/picker/domain/candidate-selection.ts:116-126), whose interpolation
endpoints are the **hardcoded module constants** `DELTA_BAND_MIN`/`DELTA_BAND_MAX`
(-0.49/-0.3), not `config.deltaBand.min`/`config.deltaBand.max`. `selectCandidates` itself then
clamps that value with `Math.max(params.effectiveDeltaMin ?? DELTA_BAND_MIN, DELTA_BAND_MIN)`
(candidate-selection.ts:254-257) — again the hardcoded constant, never a caller-supplied
`deltaMin`. There is no `deltaMin` field on `SelectCandidatesParams` at all — only `deltaMax`.

Net effect: an operator who sets `picker.deltaBandMin` via the settings UI/API/MCP tool will
see it accepted (200 OK), stored, and echoed back as `effective.picker.deltaBandMin` in every
subsequent GET — but the actual candidate universe scanned by `compute-picker` never moves off
the compile-time -0.49 floor. This directly contradicts the phase's own byte-identical/effective-
value invariant (phase context item 3: "Effective values (not compile-time constants) must be
stamped into picker snapshot ruleSet" — the ruleSet metadata even reports the (unused) override
back to the UI as if it were live). No test catches this: `computePickerSnapshot.test.ts` has
zero references to `deltaBandMin`/`deltaBand` (confirmed by grep), and `RuleSettingsModal`
tests only cover `maxOpenCalendars`.

**Fix:**
Thread the override through both `selectCandidates`'s clamp and `autoTuneTargetDelta`'s
interpolation range:
```typescript
// candidate-selection.ts
export type SelectCandidatesParams = {
  // ...
  readonly deltaMin?: number; // NEW — defaults to DELTA_BAND_MIN
  readonly deltaMax?: number;
};

export function autoTuneTargetDelta(
  vix: number | null,
  ladder: ReadonlyArray<VixLadderRow> = VIX_LADDER,
  deltaMin: number = DELTA_BAND_MIN,  // NEW
  deltaMax: number = DELTA_BAND_MAX,  // NEW
): number {
  const floor = vixLadderFloor(ladder, "normal");
  const ceiling = vixLadderFloor(ladder, "crisis");
  if (vix === null || !Number.isFinite(vix) || vix <= floor) return deltaMin;
  if (vix >= ceiling) return deltaMax;
  const fraction = (vix - floor) / (ceiling - floor);
  return deltaMin + fraction * (deltaMax - deltaMin);
}

// selectCandidates
const deltaMinFloor = params.deltaMin ?? DELTA_BAND_MIN;
const deltaMin = Math.min(Math.max(params.effectiveDeltaMin ?? deltaMinFloor, deltaMinFloor), deltaMax);
```
Then in `computePickerSnapshot.ts`, pass `deltaMin: config.deltaBand.min` alongside `deltaMax`
in both `selectCandidates` and `selectEventCandidates` calls, and pass
`config.deltaBand.min`/`config.deltaBand.max` into both `autoTuneTargetDelta(...)` call sites.
Add a regression test asserting a `deltaBandMin` override actually changes the emitted
candidate set (mirrors the existing `deltaMax`/`frontDte` coverage pattern).

### CR-02: No cross-field ordering validation on `picker.vixLadder` or `regime.*Warn`/`*Crisis` — a misordered override is silently accepted and corrupts live gate/banding logic

**File:** `packages/contracts/src/rule-settings.ts:53-59` (`vixLadderShape`) and `:154-165` (`regimeOverrides`)
**Issue:**
Every other cross-field invariant in this contract is explicitly enforced: `picker.weights`
must sum to exactly 100 (`.refine`, lines 87-90), and TAKE/STOP rungs must be complete,
correctly-ordered pairs (`.refine` × 5, lines 113-141). But `vixLadderShape` only checks that
`normalMin`/`elevatedMin`/`crisisMin` are numbers — nothing enforces
`normalMin < elevatedMin < crisisMin`. Likewise `regimeOverrides` only checks each of the 8
threshold fields is a number — nothing enforces `warn < crisis` for any of the four pairs.

This is a live-behavior bug, not just a missing guard rail:
- `resolveVixLadder` (packages/core/src/picker/domain/entry-gate.ts:56-66) blindly builds
  `[{tier:"normal", min:normalMin, max:elevatedMin}, ...]` from whatever values it's given. If
  `normalMin > elevatedMin`, the "normal" tier's range is inverted (`min > max`) and
  `resolveVixTier`'s `vix >= row.min && vix < row.max` check can never match it for any VIX —
  that tier silently becomes unreachable, corrupting both the entry gate's tier label
  (`gate.vixTier`) and `resolveSizingTier`'s contract-count lookup (sizing.ts:76-89), with no
  error surfaced anywhere in the pipeline (T-29-15's "degrade to defaults on malformed data"
  posture does not apply here — the stored blob type-checks fine, it's just semantically
  inverted).
- The regime band functions (`bandVixTermStructure`/`bandVvix`/`bandVix9dRatio`/`bandHyOas`,
  packages/core/src/analytics/domain/regime.ts:27-80) all check `value >= crisis` **before**
  `value >= warn`. If an operator sets `crisis < warn` (e.g. `vvixWarn: 100, vvixCrisis: 90`),
  every value in `[90, 100)` is misclassified as `"crisis"` even though it's below the
  operator's own intended warn line — the regime board would falsely show crisis conditions
  that never should have fired below the warn threshold.

Both `resolveVixLadder` and the 4 band functions are pure and unit-tested, but every existing
test fixture (`entry-gate.test.ts`, `rule-config.test.ts`'s fast-check arbitrary, `regime.test.ts`)
only ever constructs strictly-ascending threshold sets — the misordered case is never exercised,
so nothing in the suite would catch a regression here either.

**Fix:** Add `.refine()` ordering checks mirroring the existing weight-sum/hysteresis-pair
pattern:
```typescript
const vixLadderShape = z
  .object({ normalMin: z.number(), elevatedMin: z.number(), crisisMin: z.number() })
  .strict()
  .refine((v) => v.normalMin < v.elevatedMin && v.elevatedMin < v.crisisMin, {
    path: ["crisisMin"],
    message: "vixLadder boundaries must be strictly ascending (normalMin < elevatedMin < crisisMin)",
  });

const regimeOverrides = z
  .object({ /* ... existing fields ... */ })
  .strict()
  .refine((r) => r.vixTermStructureWarn === undefined || r.vixTermStructureCrisis === undefined || r.vixTermStructureWarn < r.vixTermStructureCrisis, { path: ["vixTermStructureCrisis"], message: "warn must be < crisis" })
  // ... repeat for vvix, vix9dRatio, hyOas
```
(A partial-field PUT that only supplies `warn` or only `crisis` can't be ordering-checked in
isolation against the stored/default counterpart at the contract layer — that check belongs in
`resolveRegimeRuleConfig`/`resolveVixLadder` themselves, which should reject or clamp an
inverted resolved config rather than silently returning one.)

## Warnings

### WR-01: `toOverridesPatch`/`isRuleOverridesPatch` JSON-round-trip bridge is duplicated verbatim in two adapters

**File:** `apps/server/src/adapters/http/settings.routes.ts:13-20` and `apps/server/src/adapters/mcp/tools.ts:1055-1062`
**Issue:** The exact same two functions (byte-identical logic, near-identical comments) are
defined independently in both the HTTP route and the MCP tool. Both files even reference each
other in the comment ("same idiom as ... toOverridesPatch") but neither actually shares the
code. Any future fix to this bridging idiom (e.g. hardening it against a JSON-unsafe value like
`Infinity`/`NaN`, which `JSON.stringify` silently turns into `null`) has to be applied twice or
it silently drifts.
**Fix:** Extract `toOverridesPatch`/`isRuleOverridesPatch` into a shared adapter-local helper
(e.g. `apps/server/src/adapters/http/rule-overrides-bridge.ts`) imported by both
`settings.routes.ts` and `tools.ts`.

### WR-02: `RuleSettingsModal`'s Save silently substitutes `0` for a blank/cleared numeric input

**File:** `apps/web/src/screens/RuleSettingsModal.tsx:114-122`
**Issue:**
```typescript
const parsed = raw === undefined ? row.value : Number(raw);
return { path: row.path, value: Number.isFinite(parsed) ? parsed : row.value };
```
`raw` is `undefined` only when the user never touched the input. Once a user clicks into a
field and clears it (e.g. to retype a new value), `draft[key]` becomes the empty string `""`,
not `undefined`. `Number("")` evaluates to `0` (not `NaN`), so `Number.isFinite(parsed)` is
`true` and the cleared field silently saves as `0` instead of falling back to `row.value` or
blocking the save. For a `picker.weights.*` field this produces a patch that no longer sums to
100 (rejected by the API, at least visibly erroring) — but for a threshold like
`regime.hyOasCrisis` or `exits.stop.minus50Arm`, a `0` is a plausible-looking number that will
be silently accepted and can materially change live trading/exit thresholds from a simple
"clear the field to retype" UI slip.
**Fix:** Treat the empty string the same as `undefined` (fall back to `row.value`), and/or
disable the Save button while any draft value is an empty string:
```typescript
const raw = draft[keyFor(row)];
const parsed = raw === undefined || raw === "" ? row.value : Number(raw);
```

---

_Reviewed: 2026-07-10T00:00:00Z_
_Reviewer: Claude (gsd-code-reviewer)_
_Depth: standard_
