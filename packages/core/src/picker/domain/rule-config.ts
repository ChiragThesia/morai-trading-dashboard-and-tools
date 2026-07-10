/**
 * rule-config.ts — the picker engine's single pure merge function (29-07-PLAN.md, RUNTIME-*).
 *
 * `resolvePickerRuleConfig(overrides?)` takes the partial picker overrides and returns a
 * fully-resolved `PickerRuleConfig` whose every field defaults to the corresponding
 * picker-domain constant. This is the ONE object the worker wiring (29-10) destructures to
 * feed each seam: `weights` -> `scoreCalendarCandidates`; `deltaBand`/`frontDte`/`backDteGap`
 * -> `selectCandidates`; `debitBand` -> `debitFitFraction`; `vixLadder` -> `resolveEntryGate` +
 * `autoTuneTargetDelta`'s floor; `sizingContracts`+`vixLadder` -> `resolveSizingTier`;
 * `maxOpenCalendars` -> `maxOpenTripped`.
 *
 * `PickerRuleOverrides` is a core-local structural mirror of `packages/contracts/src/
 * rule-settings.ts`'s `picker` override group (flat field names) — this module never imports
 * that contract (hexagon law).
 *
 * Hexagon law (architecture-boundaries §2): imports only sibling `./` domain modules. No I/O,
 * no clock, no cross-context/contracts/adapters import.
 */

import {
  WEIGHT_SLOPE,
  WEIGHT_FWD_EDGE,
  WEIGHT_GEX_FIT,
  WEIGHT_EVENT,
  WEIGHT_BE_VS_EM,
  WEIGHT_DELTA_NEUTRAL,
  WEIGHT_THETA_VEGA,
  WEIGHT_VRP,
  WEIGHT_DEBIT_FIT,
  DEBIT_IDEAL_MIN,
  DEBIT_IDEAL_MAX,
} from "./rules.ts";
import {
  DELTA_BAND_MIN,
  DELTA_BAND_MAX,
  FRONT_DTE_MIN,
  FRONT_DTE_MAX,
  BACK_DTE_MIN_GAP,
  BACK_DTE_MAX_GAP,
} from "./candidate-selection.ts";
import { resolveVixLadder } from "./entry-gate.ts";
import { DEFAULT_TIER_CONTRACTS } from "./sizing.ts";
import { MAX_OPEN_CALENDARS } from "./brakes.ts";
import type { VixLadderOverride, VixLadderRow, VixTier } from "./entry-gate.ts";
import type { BreakdownCriterion } from "./types.ts";

/** Core-local structural mirror of `packages/contracts/src/rule-settings.ts`'s `picker` override group. */
export type PickerRuleOverrides = {
  readonly deltaBandMin?: number;
  readonly deltaBandMax?: number;
  readonly frontDteMin?: number;
  readonly frontDteMax?: number;
  readonly backDteMinGap?: number;
  readonly backDteMaxGap?: number;
  readonly weights?: Partial<Record<BreakdownCriterion, number>>;
  readonly debitIdealMin?: number;
  readonly debitIdealMax?: number;
  readonly vixLadder?: VixLadderOverride;
  readonly maxOpenCalendars?: number;
  readonly sizingContracts?: Partial<Record<VixTier, number>>;
};

/** The fully-resolved picker knob set — pinned shape (29-07-PLAN.md Artifacts). */
export type PickerRuleConfig = {
  readonly weights: Record<BreakdownCriterion, number>;
  readonly deltaBand: { readonly min: number; readonly max: number };
  readonly frontDte: { readonly min: number; readonly max: number };
  readonly backDteGap: { readonly min: number; readonly max: number };
  readonly debitBand: { readonly idealMin: number; readonly idealMax: number };
  readonly vixLadder: ReadonlyArray<VixLadderRow>;
  readonly sizingContracts: Record<VixTier, number>;
  readonly maxOpenCalendars: number;
};

/**
 * resolvePickerRuleConfig — each scalar defaults `overrides?.field ?? CONSTANT`; `weights`
 * merges per-criterion `?? WEIGHT_*`; `vixLadder` rebuilds via `resolveVixLadder` (the ONE
 * ladder-rebuild source, 29-04); `sizingContracts` merges over `DEFAULT_TIER_CONTRACTS`.
 * Omitting `overrides` (or passing `{}`) reproduces every field byte-identically to its named
 * constant (BT-02 leakage-oracle correctness).
 */
export function resolvePickerRuleConfig(overrides?: PickerRuleOverrides): PickerRuleConfig {
  const weights: Record<BreakdownCriterion, number> = {
    slope: overrides?.weights?.slope ?? WEIGHT_SLOPE,
    fwdEdge: overrides?.weights?.fwdEdge ?? WEIGHT_FWD_EDGE,
    gexFit: overrides?.weights?.gexFit ?? WEIGHT_GEX_FIT,
    eventAdjustment: overrides?.weights?.eventAdjustment ?? WEIGHT_EVENT,
    beVsEm: overrides?.weights?.beVsEm ?? WEIGHT_BE_VS_EM,
    deltaNeutral: overrides?.weights?.deltaNeutral ?? WEIGHT_DELTA_NEUTRAL,
    thetaVega: overrides?.weights?.thetaVega ?? WEIGHT_THETA_VEGA,
    vrp: overrides?.weights?.vrp ?? WEIGHT_VRP,
    debitFit: overrides?.weights?.debitFit ?? WEIGHT_DEBIT_FIT,
  };

  return {
    weights,
    deltaBand: {
      min: overrides?.deltaBandMin ?? DELTA_BAND_MIN,
      max: overrides?.deltaBandMax ?? DELTA_BAND_MAX,
    },
    frontDte: {
      min: overrides?.frontDteMin ?? FRONT_DTE_MIN,
      max: overrides?.frontDteMax ?? FRONT_DTE_MAX,
    },
    backDteGap: {
      min: overrides?.backDteMinGap ?? BACK_DTE_MIN_GAP,
      max: overrides?.backDteMaxGap ?? BACK_DTE_MAX_GAP,
    },
    debitBand: {
      idealMin: overrides?.debitIdealMin ?? DEBIT_IDEAL_MIN,
      idealMax: overrides?.debitIdealMax ?? DEBIT_IDEAL_MAX,
    },
    vixLadder: resolveVixLadder(overrides?.vixLadder),
    sizingContracts: { ...DEFAULT_TIER_CONTRACTS, ...overrides?.sizingContracts },
    maxOpenCalendars: overrides?.maxOpenCalendars ?? MAX_OPEN_CALENDARS,
  };
}
