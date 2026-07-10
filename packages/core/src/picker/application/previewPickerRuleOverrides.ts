/**
 * makePreviewPickerRuleOverridesUseCase — the picker branch of the staged-change dry-run
 * preview (Phase 32, Plan 02, B1).
 *
 * Re-scores the LATEST stored snapshot's candidates against the staged picker overrides,
 * honestly, per knob group:
 *   - score-only knobs (9 weights + debitIdealMin/Max) re-weight the STORED breakdown
 *     contributions — zero I/O beyond the snapshot read; debitFit alone is recomputed via
 *     `debitFitFraction` (never a re-derived formula copy);
 *   - gate/sizing knobs (vixLadder, maxOpenCalendars, sizingContracts) re-resolve the gate +
 *     sizing tier from the stored gate's own scalars (+ one fresh open-calendars count read
 *     for maxOpen) — reusing `resolveEntryGate`/`resolveSizingTier` verbatim, never a
 *     hand-rolled tier ladder;
 *   - universe-membership knobs (delta band / DTE window) get an honest "affects next compute
 *     cycle" note — NEVER a fabricated candidate in/out diff (Pitfall 1, T-32-07).
 *
 * Mirrors `analyzeAdHocCalendar.ts`'s precedent exactly (D-02/T-19-17): bounded reads, never
 * recompute the chain, never persist. `PickerPreviewDeps` structurally excludes any
 * persist/chain/gex/events port (T-32-01) — a stray import would fail typecheck, not merely a
 * runtime guard.
 *
 * Hexagon law (architecture-boundaries §2): imports only `@morai/shared`, this bounded
 * context's own `application`/`domain` siblings — cross-context reads (journal/settings) are
 * already folded into `PickerPreviewDeps`'s port types (ports.ts), so this file itself needs
 * no cross-context import.
 */

import { ok, err } from "@morai/shared";
import type { Result } from "@morai/shared";
import { debitFitFraction } from "../domain/rules.ts";
import { resolvePickerRuleConfig } from "../domain/rule-config.ts";
import type { PickerRuleOverrides } from "../domain/rule-config.ts";
import type { BreakdownCriterion } from "../domain/types.ts";
import { resolveEntryGate } from "../domain/entry-gate.ts";
import type { MacroSeriesRow } from "../domain/entry-gate.ts";
import { maxOpenTripped } from "../domain/brakes.ts";
import { resolveSizingTier } from "../domain/sizing.ts";
import type { SizingTierOverride } from "../domain/sizing.ts";
import { toEntryGateState, toPickerGate, isPickerRuleOverrides } from "./computePickerSnapshot.ts";
import type {
  ForPreviewingPickerRuleOverrides,
  PickerCandidateDomain,
  PickerGate,
  PickerPreviewDeps,
  PickerPreviewResult,
  PickerSizing,
  StorageError,
} from "./ports.ts";

/** Staged knobs that only affect universe MEMBERSHIP (delta band / DTE window) — never
 *  re-scorable from stored data alone (Pitfall 1, T-32-07). */
const UNIVERSE_KEYS = [
  "deltaBandMin",
  "deltaBandMax",
  "frontDteMin",
  "frontDteMax",
  "backDteMinGap",
  "backDteMaxGap",
] as const;

const UNIVERSE_NOTE =
  "Affects the next compute cycle — no live candidate re-selection without a chain re-read.";

/**
 * Re-weight one stored candidate under the staged/effective config. Reuses the STORED
 * contribution for every criterion except debitFit (recomputed via `debitFitFraction` against
 * the staged debit band) — the same `Σ weight * contribution / 100` reduction scoring.ts's
 * `scoreOne` uses internally (mirrors computePickerSnapshot.ts's `zeroEventAdjustment`
 * post-scoring-override shape), never a second scoring formula.
 */
function rescoreCandidate(
  candidate: PickerCandidateDomain,
  weights: Record<BreakdownCriterion, number>,
  debitBand: { readonly idealMin: number; readonly idealMax: number },
): PickerCandidateDomain & { readonly oldScore: number } {
  const breakdown = candidate.breakdown.map((entry) =>
    entry.criterion === "debitFit"
      ? { ...entry, contribution: debitFitFraction(candidate.debit, debitBand) * 100 }
      : entry,
  );
  const rawScore = breakdown.reduce((sum, entry) => sum + (weights[entry.criterion] * entry.contribution) / 100, 0);
  const score = Math.min(100, Math.max(0, Math.round(rawScore)));
  return { ...candidate, breakdown, score, oldScore: candidate.score };
}

/**
 * Rebuilds `resolveEntryGate`'s raw `MacroSeriesRow` input from the stored gate's ALREADY-
 * resolved scalars — this preview has no `readMacroObservations` dep (T-32-01 structural
 * exclusion), so `resolveEntryGate` is fed the one shape it needs reconstructed, never a
 * second hand-rolled tier/hysteresis implementation. Empty when the stored gate has no
 * reading (GATE BLIND / read-error) — `resolveEntryGate` then reproduces that same blind state.
 */
function reconstructMacroRows(gate: PickerGate): ReadonlyArray<MacroSeriesRow> {
  if (gate.vix === null || gate.vix3m === null || gate.asOf === null) return [];
  return [
    { seriesId: "VIXCLS", date: gate.asOf, value: gate.vix },
    { seriesId: "VXVCLS", date: gate.asOf, value: gate.vix3m },
  ];
}

export function makePreviewPickerRuleOverridesUseCase(
  deps: PickerPreviewDeps,
): ForPreviewingPickerRuleOverrides {
  return async (staged?: PickerRuleOverrides): Promise<Result<PickerPreviewResult, StorageError>> => {
    // ── Step 1: the latest snapshot — cold start is a clean documented degradation, never a
    // throw (mirrors analyzeAdHocCalendar's D-02 no-snapshot binding). ──
    const snapshotResult = await deps.readPickerSnapshot();
    if (!snapshotResult.ok) return err(snapshotResult.error);
    const snapshotRow = snapshotResult.value;
    if (snapshotRow === null) return ok({ available: false });
    const { snapshot } = snapshotRow;

    // ── Step 2: fresh stored overrides (29-10 parity) — a failed/malformed read degrades to
    // defaults, never fails the whole preview (computePickerSnapshot precedent). An ABSENT
    // staged group falls back to the STORED picker overrides (not the code defaults), so an
    // empty staged edit reproduces the stored effective config byte-identically. ──
    const overridesResult = await deps.readRuleOverrides();
    const storedPickerRaw = overridesResult.ok ? overridesResult.value["picker"] : undefined;
    const storedPickerOverrides = isPickerRuleOverrides(storedPickerRaw) ? storedPickerRaw : undefined;
    const effectiveOverrides = staged ?? storedPickerOverrides;
    const config = resolvePickerRuleConfig(effectiveOverrides);

    // ── Score branch: reuse stored breakdown contributions; only debitFit is recomputed. ──
    const candidates = snapshot.candidates.map((candidate) =>
      rescoreCandidate(candidate, config.weights, config.debitBand),
    );

    // ── Gate branch: one fresh open-calendars count read is the ONLY live I/O this branch
    // needs (T-32-01) — everything else re-derives from the stored gate's own scalars. ──
    const openCalendarsResult = await deps.readOpenCalendars();
    if (!openCalendarsResult.ok) return err(openCalendarsResult.error);
    const openCount = openCalendarsResult.value.length;
    const maxOpenBrake = maxOpenTripped(openCount, config.maxOpenCalendars);
    // Cooldown is not an editable knob (28-CONTEXT.md) — reused verbatim from the stored gate.
    const cooldownBrake = snapshot.gate.brakes.cooldown;

    const gateState = resolveEntryGate({
      rows: reconstructMacroRows(snapshot.gate),
      nowIso: snapshot.gate.asOf ?? snapshot.asOf,
      maxOpenBrake,
      cooldownBrake,
      previousState: toEntryGateState(snapshot.gate),
      vixLadder: config.vixLadder,
    });
    const gateAfter = toPickerGate(gateState, maxOpenBrake, cooldownBrake, snapshot.gate.brakes.cooldownUntil);

    // ── Sizing branch: resolveSizingTier from the SAME re-resolved gate vix (28-04 precedent). ──
    const sizingOverride: SizingTierOverride = {
      ...(effectiveOverrides?.vixLadder !== undefined ? { ladder: effectiveOverrides.vixLadder } : {}),
      contracts: config.sizingContracts,
    };
    const resolvedSizing = resolveSizingTier(gateAfter.vix, sizingOverride);
    const sizingAfter: PickerSizing = {
      tier: resolvedSizing?.tier ?? null,
      contracts: resolvedSizing?.contracts ?? null,
      vix: gateAfter.vix,
    };

    // ── Universe branch: an honest note, never a fabricated candidate diff (Pitfall 1). ──
    const universeNote =
      staged !== undefined && UNIVERSE_KEYS.some((key) => staged[key] !== undefined) ? UNIVERSE_NOTE : null;

    return ok({
      available: true,
      asOf: snapshot.asOf,
      candidates,
      gate: { before: snapshot.gate, after: gateAfter },
      sizing: { before: snapshot.sizing, after: sizingAfter },
      universeNote,
    });
  };
}
