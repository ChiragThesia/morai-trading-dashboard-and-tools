---
phase: 28-playbook-gates-anti-criteria-sizing
reviewed: 2026-07-09T18:11:58Z
depth: deep
files_reviewed: 14
files_reviewed_list:
  - packages/core/src/picker/domain/entry-gate.ts
  - packages/core/src/picker/domain/brakes.ts
  - packages/core/src/picker/domain/sizing.ts
  - packages/core/src/picker/domain/candidate-selection.ts
  - packages/core/src/picker/domain/scoring.ts
  - packages/core/src/picker/domain/rules.ts
  - packages/core/src/picker/application/computePickerSnapshot.ts
  - packages/core/src/picker/application/ports.ts
  - packages/core/src/journal/application/ports.ts
  - packages/adapters/src/postgres/repos/calendar-events.ts
  - packages/adapters/src/memory/calendar-events.ts
  - packages/contracts/src/picker.ts
  - apps/web/src/components/RegimeBoard.tsx
  - apps/web/src/components/picker/EntryExitPlan.tsx
findings:
  blocker: 0
  warning: 2
  info: 3
  total: 5
status: fixed
fixed_at: 2026-07-09T13:24:00-05:00
fixes:
  WR-01: fixed (9770068)
  WR-02: fixed (818227d)
  IN-01: fixed (8ab714a)
  IN-02: fixed (10b79eb)
  IN-03: acknowledged
---

# Phase 28: Code Review Report

**Reviewed:** 2026-07-09T18:11:58Z
**Depth:** deep
**Files Reviewed:** 14
**Status:** fixed (WR-01, WR-02, IN-01, IN-02 fixed; IN-03 acknowledged intentional)

## Summary

Phase 28 wires the market-level entry gate (VIX + VIX/VIX3M hysteresis, fail-closed
GATE BLIND), the two anti-criteria brakes (max-open, loss-cooldown), VIX-tiered sizing,
autoTune band tilt, and the event-calendar bucket into `computePickerSnapshot`. I traced
the gate correctness, fail-closed integrity, brake arithmetic, sizing/autoTune sign, bucket
disjointness, payload defaults, and UI rendering end to end.

**The safety-critical core is sound.** Every read failure (macro / open-calendars /
recent-closed) collapses to `GATE_READ_ERROR` → `blind` → `entriesAllowed:false`; a null/stale
macro pair fails closed to `blind`; the VIX hysteresis arms/disarms correctly across cycles via
the persisted `reasons` self-read (verified the 25.1→24.5→23.9 walk); mixed-age series fail
closed via `olderDate`; the two bucket gap windows ([15,90] vs [3,10]) are provably disjoint so
no candidate double-counts; both weight registries sum to 100; `autoTuneTargetDelta` tilts the
deep band edge toward the further-OTM edge as VIX rises (correct sign for the user's intent);
sizing tier lookup is half-open-consistent with `VIX_LADDER`; divide-by-zero is guarded in
`extractVixPair`, `cooldownActive`, `bandMultiplier`, and `beVsEm`. No `any`/`as`/`!`, hexagon
boundaries respected, in-memory twin shipped. No BLOCKER found.

Two WARNINGs concern the loss-cooldown *display* date (off-by-one vs. the brake it describes)
and the entry-gate tile being suppressed by an unrelated regime-board load/error state — both
degrade honesty of the surfaced state without leaking the gate itself.

## Warnings

### WR-01: `cooldownUntil` display is one business day earlier than the brake it describes

**Status: fixed** — `9770068` (`fix(28): WR-01 cooldownUntil off-by-one vs the read window it describes`). Switched `cooldownUntilFrom`'s threshold from `>=` to `>`; added a boundary-agreement regression test comparing `cooldownUntilFrom` against `cooldownCutoff` across the Monday-loss/Tue-Wed-Thu window.

**File:** `packages/core/src/picker/application/computePickerSnapshot.ts:242-249` (`cooldownUntilFrom`) vs. `packages/core/src/picker/domain/brakes.ts:77-84` (`cooldownCutoff`)

**Issue:** The contract defines `cooldownUntil` as "the date the cooldown lifts"
(`packages/contracts/src/picker.ts:204`, `packages/core/src/picker/application/ports.ts:191`).
Trace a qualifying loss that closed **Monday**, evaluated on **Wednesday**:

- `cooldownActive` read window: `cooldownCutoff(Wed)` walks back to the date `D` with
  `businessDaysSince(D, Wed) === 2` → `D = Monday`. The repo reads
  `eventedAt >= Monday` (`calendar-events.ts:189-193`), so the Monday close **is still in the
  window** and `cooldownActive` returns **true on Wednesday** — entries are gated Wednesday.
- `cooldownUntilFrom(Monday)` returns the first `C` with
  `businessDaysSince(Monday, C) >= COOLDOWN_BIZDAYS(2)` → `C = Wednesday`.

So on Wednesday the brake is active but `cooldownUntil` reads "Wednesday" — i.e. the UI tells the
user the cooldown lifts today while entries are in fact still blocked today. The read window
(inclusive of losses exactly 2 business days old) and the lift-date formula (`>= 2`) use the same
threshold in opposite directions, an off-by-one. The gate itself is fail-closed (stays on longer,
never leaks), so this is display honesty, not a safety leak — but it misleads a user deciding
when to re-enter.

**Fix:** Make the lift date the first business day the loss falls *out* of the read window:
```ts
// cooldownUntilFrom — first day the loss is no longer within the COOLDOWN_BIZDAYS window
if (businessDaysSince(closedAtIso, candidateIso) > COOLDOWN_BIZDAYS) return candidateIso;
```
(For a Monday loss this yields Thursday — the day `cooldownActive` first returns false.) Add a
test asserting `cooldownActive` and `now < cooldownUntil` agree on every business day of the
window.

### WR-02: GATE BLIND / entry-gate tile is suppressed by unrelated regime-board load/error/empty states

**Status: fixed** — `818227d` (`fix(28): WR-02 GATE BLIND tile suppressed by unrelated regime-board state`). `GateChip` now renders in every `RegimeBoard` branch (loading/error/empty/success), independent of the regime board's own load state. Added a regression test: `useRegimeBoard()` `isError` + picker gate `state:"blind"` still shows `data-testid="gate-chip"` with the loud alarm treatment.

**File:** `apps/web/src/components/RegimeBoard.tsx:184-233`

**Issue:** `GateChip` (the only surface that renders the market entry-gate state — Analyzer never
renders `snapshot.gate`, confirmed: it shows only per-candidate `gateDrops`) is emitted **inside
the success branch** (line 229), after the `isPending`/`isError`/empty early returns
(lines 184-221). The component's own doc comment (lines 178-181, 30-36) claims the tile "renders
independently of the regime board's own loading/error/empty states." It does not: whenever
`useRegimeBoard()` is pending, errored, or returns zero indicators, the gate chip — including the
loud fail-closed **GATE BLIND** treatment — is not rendered even if `usePicker()` has a snapshot.

Worst case coincides with the failure: an empty `macro_observations` table makes `resolveEntryGate`
return `blind` (`macroMissing`) *and* makes the regime board render its "Regime data unavailable"
empty state — so the fail-closed signal is hidden exactly when it fires. "Never silent" is
violated by an unrelated data source's state.

**Fix:** Render `GateChip` from `usePicker()` regardless of the regime-board branch — either lift
it above the early returns into its own always-evaluated block, or render a minimal panel wrapping
just the gate chip in the pending/error/empty branches when `gate !== null`. Add a test: regime
board `isError` + picker snapshot `state:"blind"` still shows `data-testid="gate-chip"`.

## Info

### IN-01: `cooldownActive` ratio inverts for a negative (credit) `openNetDebit`

**Status: fixed** — `8ab714a` (`fix(28): IN-01 cooldownActive ratio inverts sign for a credit openNetDebit`). Guarded `openNetDebit <= 0` (was `=== 0`) in both `cooldownActive` and the `computePickerSnapshot.ts` `triggeringLosses` mirror filter; added regression tests for both.

**File:** `packages/core/src/picker/domain/brakes.ts:57-62`

**Issue:** `realizedPnl / openNetDebit <= LOSS_COOLDOWN_PCT` assumes a positive debit. For a
credit-opened calendar (`openNetDebit < 0`) the sign flips, so a real loss produces a positive
ratio and never trips the cooldown. Put calendars in this system are always net debits and the
repo coerces null debits to 0 (skipped), so this is practically unreachable today.

**Fix:** Guard `if (row.openNetDebit <= 0 || row.realizedPnl === null) return false;` (and the
mirror filter at `computePickerSnapshot.ts:447-452`) to make the "debit-relative loss" assumption
explicit rather than latent.

### IN-02: `nowIso` uses the UTC calendar day, not the ET day the FRED EOD date is stamped in

**Status: fixed** — `10b79eb` (`fix(28): IN-02 nowIso uses UTC calendar day instead of the ET day`). Added `etDateIso()` (same `Intl.DateTimeFormat('America/New_York')` mechanism `isNyseHoliday` uses) and swapped it in for `nowIso`; added a late-UTC boundary regression test.

**File:** `packages/core/src/picker/application/computePickerSnapshot.ts:411`

**Issue:** `nowIso = now.toISOString().slice(0,10)` is the UTC date. FRED VIXCLS/VXVCLS dates are
ET EOD dates. For a run executed late-UTC (evening ET), `nowIso` can be one calendar day ahead of
the ET date, adding a spurious stale business day to `businessDaysSince(asOf, nowIso)`. With the
3-bizday tolerance this only matters at the exact boundary. `compute-picker` is chain-triggered
during RTH (UTC afternoon == ET daytime), so `nowIso` == ET date in practice — harmless today, but
a latent edge if the trigger cadence ever changes.

**Fix:** None required now; if the trigger moves off RTH, derive `nowIso` from the same ET-aware
formatter `isNyseHoliday` uses (the probe in `businessDaysSince` already handles this for candidate
days).

### IN-03: `state:"penalty"` with `penaltyMultiplier:1` when a held rung sits below the penalty floor

**File:** `packages/core/src/picker/domain/entry-gate.ts:298-309`

**Issue:** With VIX hysteresis holding "penalty" at e.g. 19.5 (prev penalty, disarm 19),
`vixLabel === "penalty"` so `state:"penalty"`, but `bandMultiplier(19.5, 20, 25)` returns 1
(value ≤ floor), so no score discount is actually applied. The discrete label implies a penalty
the smooth multiplier does not deliver. This is explicitly documented as intentional
(lines 226-232: the multiplier is a pure function of the current value; only the label
flap-proofs). Flagged for awareness, not a defect.

**Fix:** None. If future backtests show the label/score divergence confuses the UI, apply the same
held-rung floor to the multiplier or annotate the state as "penalty (held)".

**Status: acknowledged — intentional (label flap-proofing, smooth multiplier)**

---

_Reviewed: 2026-07-09T18:11:58Z_
_Reviewer: Claude (gsd-code-reviewer)_
_Depth: deep_
