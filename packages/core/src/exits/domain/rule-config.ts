/**
 * rule-config.ts — pure merge seam for the exits-owned TAKE/STOP rung overrides (Phase 29-05).
 *
 * Mirrors picker/domain/scoring.ts's `weights?` idiom (`ScoringParams.weights`,
 * `params.weights?.slope ?? WEIGHT_SLOPE`): `resolveExitRuleConfig(overrides?)` rebuilds each
 * rung from `TAKE_RUNGS`/`STOP_RUNGS` by label, falling back to the constant field per-value.
 * Omitting `overrides` (every live call site until 29-11 wires the worker) reproduces the
 * constants byte-identically — required for evaluateExit's omission regression (T-29-05).
 *
 * Hysteresis pair VALIDATION (disarm ordered vs arm) is enforced at the contract boundary
 * (29-02) — this is a pure merge over already-validated input, no validation here.
 *
 * Hexagon law (architecture-boundaries §2): imports only this context's own `exit-rules.ts`.
 */

import { TAKE_RUNGS, STOP_RUNGS } from "./exit-rules.ts";
import type { ExitRung } from "./exit-rules.ts";

export type ExitRuleOverrides = {
  readonly take?: {
    readonly plus15Arm?: number;
    readonly plus15Disarm?: number;
    readonly plus10Arm?: number;
    readonly plus10Disarm?: number;
    readonly plus5Arm?: number;
    readonly plus5Disarm?: number;
  };
  readonly stop?: {
    readonly minus50Arm?: number;
    readonly minus50Disarm?: number;
    readonly minus25Arm?: number;
    readonly minus25Disarm?: number;
  };
};

export type ExitRuleConfig = {
  readonly takeRungs: ReadonlyArray<ExitRung>;
  readonly stopRungs: ReadonlyArray<ExitRung>;
};

function resolveTakeRung(rung: ExitRung, take: ExitRuleOverrides["take"]): ExitRung {
  switch (rung.label) {
    case "+15%":
      return { label: rung.label, arm: take?.plus15Arm ?? rung.arm, disarm: take?.plus15Disarm ?? rung.disarm };
    case "+10%":
      return { label: rung.label, arm: take?.plus10Arm ?? rung.arm, disarm: take?.plus10Disarm ?? rung.disarm };
    case "+5%":
      return { label: rung.label, arm: take?.plus5Arm ?? rung.arm, disarm: take?.plus5Disarm ?? rung.disarm };
    default:
      return rung;
  }
}

function resolveStopRung(rung: ExitRung, stop: ExitRuleOverrides["stop"]): ExitRung {
  switch (rung.label) {
    case "-50%":
      return { label: rung.label, arm: stop?.minus50Arm ?? rung.arm, disarm: stop?.minus50Disarm ?? rung.disarm };
    case "-25%":
      return { label: rung.label, arm: stop?.minus25Arm ?? rung.arm, disarm: stop?.minus25Disarm ?? rung.disarm };
    default:
      return rung;
  }
}

/** Rebuilds TAKE/STOP rungs from the registry constants, applying per-field overrides by label. */
export function resolveExitRuleConfig(overrides?: ExitRuleOverrides): ExitRuleConfig {
  return {
    takeRungs: TAKE_RUNGS.map((rung) => resolveTakeRung(rung, overrides?.take)),
    stopRungs: STOP_RUNGS.map((rung) => resolveStopRung(rung, overrides?.stop)),
  };
}
