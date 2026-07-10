---
phase: 32-rule-settings-modal-v2-explain-what-you-touch-per-knob-help
reviewed: 2026-07-10T00:00:00Z
depth: standard
files_reviewed: 26
files_reviewed_list:
  - apps/server/src/adapters/http/settings.routes.test.ts
  - apps/server/src/adapters/http/settings.routes.ts
  - apps/server/src/adapters/mcp/server.ts
  - apps/server/src/adapters/mcp/tools.test.ts
  - apps/server/src/adapters/mcp/tools.ts
  - apps/server/src/main.ts
  - apps/web/src/hooks/useRuleSettingsPreview.test.ts
  - apps/web/src/hooks/useRuleSettingsPreview.ts
  - apps/web/src/screens/RuleSettingsModal.test.tsx
  - apps/web/src/screens/RuleSettingsModal.tsx
  - packages/contracts/src/index.ts
  - packages/contracts/src/rule-explainers.test.ts
  - packages/contracts/src/rule-explainers.ts
  - packages/contracts/src/rule-preview.test.ts
  - packages/contracts/src/rule-preview.ts
  - packages/contracts/src/rule-settings.ts
  - packages/core/src/analytics/index.ts
  - packages/core/src/exits/application/ports.ts
  - packages/core/src/exits/application/previewExitRuleOverrides.test.ts
  - packages/core/src/exits/application/previewExitRuleOverrides.ts
  - packages/core/src/exits/index.ts
  - packages/core/src/index.ts
  - packages/core/src/picker/application/computePickerSnapshot.ts
  - packages/core/src/picker/application/ports.ts
  - packages/core/src/picker/application/previewPickerRuleOverrides.test.ts
  - packages/core/src/picker/application/previewPickerRuleOverrides.ts
  - packages/core/src/picker/index.ts
  - packages/core/src/settings/application/previewRuleOverrides.test.ts
  - packages/core/src/settings/application/previewRuleOverrides.ts
findings:
  critical: 2
  warning: 2
  info: 0
  total: 4
status: issues_found
---

# Phase 32: Code Review Report

**Reviewed:** 2026-07-10T00:00:00Z
**Depth:** standard
**Files Reviewed:** 26 (files_modified list, per config)
**Status:** issues_found

## Summary

Reviewed the Phase 32 preview stack (picker/exits/combined preview use-cases + their HTTP
route + MCP tool twins), the `RULE_EXPLAINERS` registry + its schema-derived completeness
test, and the client (`useRuleSettingsPreview` + `RuleSettingsModal`). The engineering is
disciplined overall: port hygiene tests genuinely prove no persist port exists on any preview
deps type, the byte-parity fast-check properties are real (not vacuous), auth boundary
(JWT-gated HTTP route, bearer-gated MCP mount) is unchanged from the existing pattern, and
`Number("")` coercion (a named repo pitfall) is correctly guarded in the modal.

Two BLOCKER-class problems survived that discipline:

1. The picker-gate preview's "absent staged group reproduces the stored gate byte-identically"
   guarantee is provably false for a stored gate that was `blind` due to **stale** macro data
   (as opposed to `blind` due to missing macro data) — the preview's `nowIso` surrogate always
   reads as "0 business days old," so a genuinely-blind gate resolves as `open`/`penalty`/
   `blocked` in preview. This directly contradicts the code's own claim that the reconstruction
   "reproduces that same blind state," and it is a trading go/no-go signal.
2. Two `RULE_EXPLAINERS` entries assert a causal relationship the code explicitly documents as
   false (`entry-gate.ts`'s own comment: VIX ladder overrides do NOT move the penalty/block
   hysteresis rungs), and one entry has the delta-band direction-of-effect backwards. Per this
   phase's own stated bar ("a wrong explainer is worse than none"), these ship misleading
   guidance on a live trading-rules editor.

Two WARNING-class findings round this out: the JSON-round-trip preview-narrowing bridge is now
copy-pasted in 3 places (a 4th related copy already exists for the PUT path), and the modal
never clears a rendered Preview panel after Save/Reset, so a stale diff can linger next to
newly-applied settings.

## Critical Issues

### CR-01: Picker-gate preview silently un-blinds a stale-macro-data gate (byte-parity guarantee broken)

**File:** `packages/core/src/picker/application/previewPickerRuleOverrides.ts:93-99, 137-144`

**Issue:** `reconstructMacroRows` rebuilds `resolveEntryGate`'s `MacroSeriesRow[]` input from the
*stored* `PickerGate`'s own `vix`/`vix3m`/`asOf` scalars, and the call site feeds
`nowIso: snapshot.gate.asOf ?? snapshot.asOf` — i.e. it uses the gate's own reference date as
its surrogate "now."

`resolveEntryGate` (`entry-gate.ts:311-323`) has **two** distinct ways to reach `state: "blind"`:
- `macroMissing` — `pair === null` (either series absent). Here `vix`/`vix3m`/`asOf` are all
  `null` in the persisted `PickerGate`, so `reconstructMacroRows` correctly returns `[]`,
  `extractVixPair([])` is `null`, and the blind state IS reproduced. This path is fine.
- `macroStale` — `businessDaysSince(pair.asOf, nowIso) > GATE_BLIND_MAX_BIZDAYS`. Here the
  returned state **still carries the real `vix`/`vix3m`/`asOf`** (only `reasons` gets
  `"macroStale"` appended) — `entry-gate.ts:310-323`.

For a stored gate that is blind via the `macroStale` path, `reconstructMacroRows` sees non-null
`vix`/`vix3m`/`asOf` and returns the 2-row reconstruction (not `[]`). The preview then calls
`resolveEntryGate` with `nowIso = snapshot.gate.asOf` — i.e. `nowIso` set to the *same date* the
macro row is stamped with. `businessDaysSince(asOf, asOf)` is always `0`, which is never `>
GATE_BLIND_MAX_BIZDAYS (3)`. So the preview **always** recomputes a non-blind state (`open`,
`penalty`, or `blocked`, per the vix/ratio hysteresis) for a gate that was actually persisted as
`blind` due to staleness.

Compare to the real compute path, `computePickerSnapshot.ts:540` — `nowIso = etDateIso(now())`,
the **actual wall-clock ET day**, which is what makes `macroStale` reachable in production (e.g.
the macro-fetch cron stalls while chain-fetch keeps running — a scenario this repo has hit
before per MEMORY.md's chain-source-cutover-outage history).

This breaks two things at once:
1. The stated invariant in this very function's own comment (`previewPickerRuleOverrides.ts:90-92`:
   "Empty when the stored gate has no reading (GATE BLIND / read-error) — `resolveEntryGate`
   then reproduces that same blind state") is false for the `macroStale` variant of blind.
2. The `previewPickerRuleOverrides.test.ts` byte-parity fast-check (lines 143-197) only exercises
   `OPEN_GATE` (never blind), so this gap has no regression coverage.

Operationally: if the live entry gate is `blind` (stale macro feed — a real go/no-go-relevant
degraded state), the Rule Settings modal's Preview button can show the gate as `open` with a
live sizing tier, when the actual system is refusing all new entries. That is a materially
misleading signal on a trading dashboard whose entire purpose is entry/no-entry decisions.

**Fix:** Detect the `macroStale` case explicitly rather than inferring "blind" purely from
null-ness of the stored scalars — e.g. check `snapshot.gate.reasons.includes("macroStale")` (or
`snapshot.gate.state === "blind"`) up front and short-circuit to reproducing the stored gate
verbatim (`gateAfter = snapshot.gate` when no vix-ladder/maxOpen-affecting knob is staged), or
thread a real `nowIso` (the preview already has no `now()` port — add one, mirroring
`ExitPreviewDeps.now`, since `ComputePickerSnapshotDeps.now` already exists for this exact
purpose) instead of reusing `asOf` as a fake "now":

```ts
// previewPickerRuleOverrides.ts
export type PickerPreviewDeps = {
  readonly readPickerSnapshot: ForReadingPickerSnapshot;
  readonly readRuleOverrides: ForReadingRuleOverrides;
  readonly readOpenCalendars: ForGettingOpenCalendars;
  readonly now: () => Date; // NEW — mirrors ExitPreviewDeps's clock injection
};
// ...
const gateState = resolveEntryGate({
  rows: reconstructMacroRows(snapshot.gate),
  nowIso: etDateIso(deps.now()), // real now, not the stored asOf
  maxOpenBrake,
  cooldownBrake,
  previousState: toEntryGateState(snapshot.gate),
  vixLadder: config.vixLadder,
});
```

Add a fast-check/example case with a stored `blind`/`macroStale` gate to
`previewPickerRuleOverrides.test.ts` proving the preview reproduces `state: "blind"` when no
staged knob is present.

### CR-02: `RULE_EXPLAINERS` ships two factually-wrong direction-of-effect claims

**File:** `packages/contracts/src/rule-explainers.ts:44-49, 153-164`

**Issue:** This phase's own review bar (32-CONTEXT.md, restated in this review's brief) is "a
WRONG explainer is worse than none" — the completeness test only proves every knob HAS copy, it
proves nothing about whether that copy is TRUE. Two entries are provably false against the
engine code they describe:

**(a) `picker.deltaBandMax` (lines 44-49) has the direction backwards.**
```
direction: "Higher (toward −0.30) = closer-to-the-money candidates allowed."
```
`DELTA_BAND_MIN = -0.49`, `DELTA_BAND_MAX = -0.3` (`candidate-selection.ts:52-53`); the filter
keeps `deltaMin <= delta <= deltaMax` (`candidate-selection.ts:366`). For a short put, delta
magnitude shrinks toward 0 as the strike moves further OUT of the money — `-0.49` is near-ATM,
`-0.30` is already the *shallow* (further-OTM) edge of the default band. Raising `deltaBandMax`
past its default (e.g. to `-0.20`) widens the admitted range to include deltas between `-0.30`
and `-0.20`, which are **further from the money**, not closer. The correct direction is the
mirror of `deltaBandMin`'s own (correct) entry two lines above it: higher `deltaBandMax` (less
negative) admits further-OTM candidates, not closer-to-the-money ones.

**(b) `picker.vixLadder.elevatedMin` / `picker.vixLadder.crisisMin` (lines 153-164) claim the VIX
ladder override moves the entry-gate's penalty/block trigger — it does not.**
```
"picker.vixLadder.elevatedMin": direction: "... before the entry-gate penalty band and sizing haircut start."
"picker.vixLadder.crisisMin":   direction: "... before new entries are hard-blocked."
```
`entry-gate.ts:236-240` (`ResolveEntryGateInput.vixLadder` doc comment) is explicit: *"Does NOT
affect the block/penalty hysteresis rungs below (`VIX_BLOCK_ARM`, `VIX_PENALTY_FLOOR` stay
code-only per the resolved research open question); ladder tiers move independently."*
`VIX_PENALTY_FLOOR = 20` and `VIX_BLOCK_ARM = 25` (`entry-gate.ts:83, 80`) are fixed constants —
editing `elevatedMin`/`crisisMin` only moves the *display tier* (`vixTier`, used for sizing
lookup and `autoTuneTargetDelta`'s band-widening), never when the penalty band starts or the
hard block trips. A trader raising `crisisMin` believing it delays the hard entry block (per the
explainer's own words) will not observe the effect the copy promises — the block still fires at
VIX 25 regardless of the knob.

Both are directly reachable from the modal's info-icon tooltip (`RuleSettingsModal.tsx:301-303`)
— this is user-facing, decision-relevant copy for a trading system, not incidental prose.

**Fix:**
```ts
"picker.deltaBandMax": {
  summary: "Upper edge of the short-put delta band.",
  unit: "delta (Δ)",
  direction: "Higher (less negative, away from −0.49) = further-out-of-the-money candidates allowed.",
  affects: "Picker candidates",
},
"picker.vixLadder.elevatedMin": {
  summary: "VIX level where the ladder leaves \"normal\" and enters \"elevated\" (sizing tier boundary).",
  unit: "VIX",
  direction: "Higher = VIX must climb further before sizing drops to the elevated-tier contract count. Does NOT move the entry gate's own penalty-band trigger (fixed at VIX 20).",
  affects: "Picker candidates",
},
"picker.vixLadder.crisisMin": {
  summary: "VIX level where the ladder enters \"crisis\" (sizing drops to zero contracts).",
  unit: "VIX",
  direction: "Higher = VIX must climb further before sizing drops to zero. Does NOT move the entry gate's own hard-block trigger (fixed at VIX 25).",
  affects: "Picker candidates",
},
```
Since `rule-explainers.test.ts`'s locked-copy-tone assertions (`toBe(...)` on the exact string)
will need updating alongside this fix, and the completeness test only checks presence/shape —
consider adding a lightweight "no contradicts-the-domain-comment" spot-check is out of scope for
an automated test, but this pair is worth a one-line code comment cross-reference back to
`entry-gate.ts:236-240` so the next editor doesn't reintroduce the same conflation.

## Warnings

### WR-01: The JSON-round-trip preview-narrowing bridge is now hand-copied in 3+ places

**File:** `apps/server/src/adapters/http/settings.routes.ts:21-61`,
`apps/server/src/adapters/mcp/tools.ts:64-94`,
`packages/core/src/exits/application/previewExitRuleOverrides.ts:38-62`

**Issue:** Per this phase's explicit review brief: the JSON round-trip + shape-guard bridge
pattern already has one consolidated source (`apps/server/src/adapters/rule-overrides-bridge.ts`
— `toOverridesPatch`/`isRuleOverridesPatch`, built specifically to be the single seam per its own
header comment: *"a duplicated copy silently drifts when this idiom is hardened later"*). Phase
32 added a second, near-identical idiom (`toPreviewInput` + `isPickerRuleOverridesShape` +
`isExitRuleOverridesShape`) and copy-pasted it verbatim into both `settings.routes.ts` and
`mcp/tools.ts` — both files' own comments admit this ("duplicated verbatim... this task's
files_modified scope excludes the shared rule-overrides-bridge.ts"). A third, structurally
distinct but conceptually identical narrowing (`isExitRuleOverrides` + its field-guard helpers)
lives in `previewExitRuleOverrides.ts`, also explicitly commented as "a verbatim COPY... not an
import."

That is now 4 independent copies of "narrow an untyped JSON blob into a rule-overrides shape"
across the codebase (1 for PUT, 2 for preview HTTP/MCP, 1 for the exits engine's own stored-read
narrowing). The `rule-overrides-bridge.ts` header's own warning has already materialized: the
PUT-path bridge and the preview-path bridge are subtly different (`isRuleOverridesPatch` accepts
any plain record; `isPickerRuleOverridesShape`/`isExitRuleOverridesShape` are today literally the
same one-line check, `isPlainRecord`) — nothing enforces they stay that way. The scope-exclusion
comments ("this task's files_modified list excludes X") were true at plan-time but are no longer
a good reason now that the pattern has proven itself needed by 3 call sites plus 1 sibling.

**Fix:** Promote the shared bridge. `rule-overrides-bridge.ts` already owns this exact idiom for
the PUT path — extend it with a preview-shaped sibling (or generalize `toOverridesPatch` to take
the target shape) and import it from both `settings.routes.ts` and `mcp/tools.ts`:

```ts
// apps/server/src/adapters/rule-overrides-bridge.ts
export function toPreviewInput(body: PreviewRuleOverridesRequest): RulePreviewInput {
  const cloned: unknown = JSON.parse(JSON.stringify(body));
  if (typeof cloned !== "object" || cloned === null || Array.isArray(cloned)) return {};
  const { picker, exits } = cloned as Record<string, unknown>;
  return {
    ...(isPlainRecord(picker) ? { picker } : {}),
    ...(isPlainRecord(exits) ? { exits } : {}),
  };
}
```
Then delete the duplicate from `settings.routes.ts` and `mcp/tools.ts`. The `previewExitRuleOverrides.ts`
copy is narrower (it type-guards actual field names, not just plain-record shape) and serves a
different purpose (narrowing an untyped *stored* blob, not a Zod-already-validated request body)
— it's a weaker candidate for consolidation, but worth a comment noting why it's intentionally
separate rather than leaving the "verbatim copy, not an import" note as the only explanation.

### WR-02: Preview panel is never cleared on Save or Reset — a stale diff can linger next to newly-applied settings

**File:** `apps/web/src/screens/RuleSettingsModal.tsx:213-215, 238-241, 270-280`

**Issue:** `GroupPanel` holds its own `previewMutation` (server-backed picker/exits preview) and
`regimePreview` (client-side regime preview) state, populated only by the explicit Preview
button (correctly implementing T-32-13's explicit-click-only requirement). Neither `handleSave`
(lines 238-241, calls `onSave` then `setDraft({})`) nor the Reset button's `onClick` (lines
270-280, calls `onReset(group)`) resets `previewMutation` or `regimePreview`.

Sequence that reproduces stale UI: user edits a knob → clicks Preview (sees a real diff, e.g.
"cand-1: 62 → 72") → clicks Save (draft clears, the input reverts to the new effective value) →
the Preview panel below still renders "cand-1: 62 → 72" from before the save, now describing a
transition that already happened and no longer represents "staged vs. current." The same applies
to Reset: click Reset to defaults, the stale Preview panel from before the reset keeps showing a
diff computed against the pre-reset baseline. Since `useRuleSettingsPreview()` is a fresh
`useMutation()` per `GroupPanel` render (not global state), there is no `reset()` call wired to
either action.

This is not a data-integrity bug (nothing is submitted incorrectly), but it is a real UX
correctness issue on a modal whose entire purpose is "show the operator what a change does before
they commit to it" — a stale preview after the underlying state changed defeats that purpose and
could cause a user to misjudge what their most recent Save actually changed.

**Fix:** Clear both preview states when Save or Reset resolves:
```ts
async function handleSave(): Promise<void> {
  await onSave(group, buildStagedGroup());
  setDraft({});
  previewMutation.reset();
  setRegimePreview(undefined);
}
```
and in the Reset button's handler:
```ts
onClick={() => {
  void onReset(group).then(() => {
    previewMutation.reset();
    setRegimePreview(undefined);
  });
}}
```

---

_Reviewed: 2026-07-10T00:00:00Z_
_Reviewer: Claude (gsd-code-reviewer)_
_Depth: standard_
