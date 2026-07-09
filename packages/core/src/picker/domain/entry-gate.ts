/**
 * entry-gate.ts — resolveEntryGate, the market-level playbook entry gate (28-01, PLAY-01/02).
 *
 * The pure foundation for the whole playbook-port phase: `resolveEntryGate` runs ONCE per
 * `computePickerSnapshot` cycle over cohort-level scalars (VIX, VIX/VIX3M ratio, and two
 * anti-criteria brake booleans fed by later plans) — never per candidate. This is the fix
 * for the RETIRED per-pair `term-inversion` gate's exact mistake (picker-rules.md): a
 * per-candidate crisis gate deletes the trades with edge. See docs/architecture/
 * playbook-gates.md for the full design (bands, hysteresis, brakes, deferred sustained-trend
 * rationale).
 *
 * This plan ships ZERO wiring — computePickerSnapshot.ts calling this module is Plan 03.
 *
 * Hexagon law (architecture-boundaries §2 + rule 7): imports only @morai/shared. No import
 * of journal's MacroObservationRow (a different bounded context's application port) —
 * `MacroSeriesRow` below is a structural, core-local mirror of that shape (same convention
 * `getRegimeBoard.ts`'s RegimeIndicatorOut uses for contracts' regimeIndicator).
 */

import { assertDefined, isNyseHoliday } from "@morai/shared";

// ─────────────────────────────────────────────────────────────
// The shared VIX ladder — one constant set for the penalty band, the hard block, and
// (Plan 04) the sizing tiers. `[ASSUMED]` edges (15/20/25), confirm at UAT (playbook-gates.md).
// ─────────────────────────────────────────────────────────────

export type VixTier = "low" | "normal" | "elevated" | "crisis";

export type VixLadderRow = {
  readonly tier: VixTier;
  readonly min: number;
  readonly max: number;
};

/** Half-open [min, max) tiers, contiguous — no gap or overlap (entry-gate.test.ts asserts this). */
export const VIX_LADDER: ReadonlyArray<VixLadderRow> = [
  { tier: "low", min: 0, max: 15 },
  { tier: "normal", min: 15, max: 20 },
  { tier: "elevated", min: 20, max: 25 },
  { tier: "crisis", min: 25, max: Number.POSITIVE_INFINITY },
];

// ─────────────────────────────────────────────────────────────
// Hysteresis rungs — mirrors exits/domain/exit-rules.ts's {label, arm, disarm} ExitRung shape,
// oriented higher-is-worse. USER-LOCKED arm/disarm (28-CONTEXT.md); penalty-band values
// `[ASSUMED]` (Claude's discretion), documented in playbook-gates.md.
// ─────────────────────────────────────────────────────────────

export const VIX_BLOCK_ARM = 25;
export const VIX_BLOCK_DISARM = 24;
/** Penalty-band floor — arms the penalty rung. Same value VIX_LADDER's "elevated" tier starts at. */
export const VIX_PENALTY_FLOOR = 20;
export const VIX_PENALTY_DISARM = 19;

export const RATIO_BLOCK_ARM = 0.95;
export const RATIO_BLOCK_DISARM = 0.93;
/**
 * Penalty-band floor — re-declared here BY VALUE (not imported) because architecture rule 7
 * forbids importing another context's domain module. This mirrors analytics/domain/regime.ts's
 * VIX_TERM_STRUCTURE_WARN (0.90) exactly — same eco3min.fr/systemtrader.co VIX/VIX3M warn cut.
 */
export const RATIO_PENALTY_FLOOR = 0.9;
export const RATIO_PENALTY_DISARM = 0.89;

/** Penalty multiplier floor at the edge of the penalty band (never a discontinuous drop to 0). */
const GATE_PENALTY_FLOOR_MULTIPLIER = 0.3;

export type EntryGateRungLabel = "blocked" | "penalty";

export type GateRung = {
  readonly label: EntryGateRungLabel;
  readonly arm: number;
  readonly disarm: number;
};

export const VIX_GATE_RUNGS: ReadonlyArray<GateRung> = [
  { label: "blocked", arm: VIX_BLOCK_ARM, disarm: VIX_BLOCK_DISARM },
  { label: "penalty", arm: VIX_PENALTY_FLOOR, disarm: VIX_PENALTY_DISARM },
];

export const RATIO_GATE_RUNGS: ReadonlyArray<GateRung> = [
  { label: "blocked", arm: RATIO_BLOCK_ARM, disarm: RATIO_BLOCK_DISARM },
  { label: "penalty", arm: RATIO_PENALTY_FLOOR, disarm: RATIO_PENALTY_DISARM },
];

/** GATE BLIND age tolerance (USER DECISION 1, 28-CONTEXT.md): accept up to this many stale bizdays. */
export const GATE_BLIND_MAX_BIZDAYS = 3;

// ─────────────────────────────────────────────────────────────
// Pure calendar-day arithmetic (mirrors candidate-selection.ts's isoDayNumber convention).
// ─────────────────────────────────────────────────────────────

function isoDayNumber(iso: string): number {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  assertDefined(match, `entry-gate: malformed ISO date "${iso}"`);
  const [, y, m, d] = match;
  assertDefined(y, "entry-gate: year component");
  assertDefined(m, "entry-gate: month component");
  assertDefined(d, "entry-gate: day component");
  return Date.UTC(Number(y), Number(m) - 1, Number(d)) / 86_400_000;
}

/**
 * businessDaysSince — count of Mon-Fri, non-NYSE-holiday days strictly after `asOfIso` up to
 * and including `nowIso`. The asOf day itself never counts as stale.
 *
 * ponytail: probes each candidate day at noon UTC, never midnight, before the holiday check.
 * `isNyseHoliday` formats in America/New_York; a UTC-midnight instant is the PREVIOUS ET
 * calendar day for 4-5 hours (DST-dependent) — noon UTC never crosses that boundary, so this
 * stays correct without a timezone-aware date library.
 */
export function businessDaysSince(asOfIso: string, nowIso: string): number {
  const NOON_UTC_MS = 12 * 60 * 60 * 1000;
  let count = 0;
  let cursor = isoDayNumber(asOfIso) + 1;
  const end = isoDayNumber(nowIso);
  while (cursor <= end) {
    const dayStartMs = cursor * 86_400_000;
    const weekday = new Date(dayStartMs).getUTCDay(); // 0=Sun, 6=Sat
    if (weekday !== 0 && weekday !== 6 && !isNyseHoliday(new Date(dayStartMs + NOON_UTC_MS))) {
      count += 1;
    }
    cursor += 1;
  }
  return count;
}

// ─────────────────────────────────────────────────────────────
// extractVixPair — the FRED VIXCLS/VXVCLS pair only, never vix9d-vix (regime-board.md's
// epoch-mismatch warning).
// ─────────────────────────────────────────────────────────────

/** Core-local structural mirror of journal's MacroObservationRow (rule 7 — no cross-context import). */
export type MacroSeriesRow = {
  readonly seriesId: string;
  readonly date: string; // YYYY-MM-DD
  readonly value: number;
};

export type VixPair = {
  readonly vix: number;
  readonly vix3m: number;
  readonly ratio: number;
  readonly asOf: string; // older of the two dates — never overstates freshness (MACRO-03 convention)
};

function olderDate(a: string, b: string): string {
  return a < b ? a : b;
}

function latestBySeriesId(rows: ReadonlyArray<MacroSeriesRow>, seriesId: string): MacroSeriesRow | null {
  let latest: MacroSeriesRow | null = null;
  for (const row of rows) {
    if (row.seriesId !== seriesId) continue;
    if (latest === null || row.date > latest.date) latest = row;
  }
  return latest;
}

/**
 * extractVixPair — latest VIXCLS + VXVCLS row per series. Returns null when either series is
 * absent or the ratio is non-finite (a zero/garbage denominator) — never fabricated (mirrors
 * getRegimeBoard.ts's "one bad input drops one chip, not the whole board" discipline).
 */
export function extractVixPair(rows: ReadonlyArray<MacroSeriesRow>): VixPair | null {
  const vixCls = latestBySeriesId(rows, "VIXCLS");
  const vxvcls = latestBySeriesId(rows, "VXVCLS");
  if (vixCls === null || vxvcls === null) return null;
  const ratio = vixCls.value / vxvcls.value;
  if (!Number.isFinite(ratio)) return null;
  return { vix: vixCls.value, vix3m: vxvcls.value, ratio, asOf: olderDate(vixCls.date, vxvcls.date) };
}

// ─────────────────────────────────────────────────────────────
// resolveEntryGate
// ─────────────────────────────────────────────────────────────

export type EntryGateStateValue = "open" | "penalty" | "blocked" | "blind";

export type EntryGateState = {
  readonly vix: number | null;
  readonly vix3m: number | null;
  readonly ratio: number | null;
  readonly asOf: string | null;
  readonly state: EntryGateStateValue;
  readonly penaltyMultiplier: number;
  readonly entriesAllowed: boolean;
  readonly reasons: ReadonlyArray<string>;
};

export type ResolveEntryGateInput = {
  readonly rows: ReadonlyArray<MacroSeriesRow>;
  readonly nowIso: string;
  readonly maxOpenBrake: boolean;
  readonly cooldownBrake: boolean;
  /** Previous cycle's gate state, self-read from picker_snapshot (Plan 03) — null on first run. */
  readonly previousState: EntryGateState | null;
};

/** A rung is "held armed" from the prior cycle only if that SAME metric+label fired last time. */
function previousLabelFor(
  previousState: EntryGateState | null,
  metric: "vix" | "ratio",
): EntryGateRungLabel | null {
  if (previousState === null) return null;
  if (previousState.reasons.includes(`${metric}Blocked`)) return "blocked";
  if (previousState.reasons.includes(`${metric}Penalty`)) return "penalty";
  return null;
}

/** Walks a metric's rungs worst-first; returns the held/fresh-armed label, or null (open). */
function resolveRung(
  value: number,
  rungs: ReadonlyArray<GateRung>,
  previousLabel: EntryGateRungLabel | null,
): EntryGateRungLabel | null {
  for (const rung of rungs) {
    const freshArm = value >= rung.arm;
    const heldArmed = previousLabel === rung.label && value >= rung.disarm;
    if (freshArm || heldArmed) return rung.label;
  }
  return null;
}

/**
 * Linear penalty multiplier: 1.0 at/below `floor`, GATE_PENALTY_FLOOR_MULTIPLIER at/above
 * `ceiling`, linear between. Never a step at the boundary (the retired term-inversion lesson).
 *
 * ponytail: a pure function of the CURRENT value only — it does not inherit the rung
 * hysteresis above. Only the discrete `state` label flaps-proofs; the score itself is smooth.
 * Add multiplier-level hysteresis if a future backtest shows score flapping matters too.
 */
function bandMultiplier(value: number, floor: number, ceiling: number): number {
  if (value <= floor) return 1;
  if (value >= ceiling) return GATE_PENALTY_FLOOR_MULTIPLIER;
  const fraction = (value - floor) / (ceiling - floor);
  return 1 - fraction * (1 - GATE_PENALTY_FLOOR_MULTIPLIER);
}

/**
 * resolveEntryGate — the single market-level pre-condition call. Bands VIX and VIX/VIX3M into
 * open/penalty/blocked with hysteresis, fails CLOSED to 'blind' on stale/missing macro data
 * (GATE_BLIND_MAX_BIZDAYS), and passes the two anti-criteria brakes through unconditionally.
 */
export function resolveEntryGate(input: ResolveEntryGateInput): EntryGateState {
  const { rows, nowIso, maxOpenBrake, cooldownBrake, previousState } = input;
  const reasons: string[] = [];
  if (maxOpenBrake) reasons.push("maxOpen");
  if (cooldownBrake) reasons.push("cooldown");
  const brakeTripped = maxOpenBrake || cooldownBrake;

  const pair = extractVixPair(rows);
  if (pair === null) {
    return {
      vix: null,
      vix3m: null,
      ratio: null,
      asOf: null,
      state: "blind",
      penaltyMultiplier: 0,
      entriesAllowed: false,
      reasons: [...reasons, "macroMissing"],
    };
  }

  const { vix, vix3m, ratio, asOf } = pair;
  if (businessDaysSince(asOf, nowIso) > GATE_BLIND_MAX_BIZDAYS) {
    return {
      vix,
      vix3m,
      ratio,
      asOf,
      state: "blind",
      penaltyMultiplier: 0,
      entriesAllowed: false,
      reasons: [...reasons, "macroStale"],
    };
  }

  const vixLabel = resolveRung(vix, VIX_GATE_RUNGS, previousLabelFor(previousState, "vix"));
  const ratioLabel = resolveRung(ratio, RATIO_GATE_RUNGS, previousLabelFor(previousState, "ratio"));
  if (vixLabel !== null) reasons.push(`vix${vixLabel === "blocked" ? "Blocked" : "Penalty"}`);
  if (ratioLabel !== null) reasons.push(`ratio${ratioLabel === "blocked" ? "Blocked" : "Penalty"}`);

  if (vixLabel === "blocked" || ratioLabel === "blocked") {
    return {
      vix,
      vix3m,
      ratio,
      asOf,
      state: "blocked",
      penaltyMultiplier: 0,
      entriesAllowed: false,
      reasons,
    };
  }

  const vixMultiplier = bandMultiplier(vix, VIX_PENALTY_FLOOR, VIX_BLOCK_ARM);
  const ratioMultiplier = bandMultiplier(ratio, RATIO_PENALTY_FLOOR, RATIO_BLOCK_ARM);
  const multiplier = Math.min(vixMultiplier, ratioMultiplier);
  const inPenalty = vixLabel === "penalty" || ratioLabel === "penalty";

  return {
    vix,
    vix3m,
    ratio,
    asOf,
    state: inPenalty ? "penalty" : "open",
    penaltyMultiplier: multiplier,
    entriesAllowed: !brakeTripped,
    reasons,
  };
}

/**
 * applyGatePenaltyScore — scales a candidate's score by the gate's combined multiplier,
 * rounded and clamped to [0, 100]. The multiplier is explicitly NOT one of the 9 weighted
 * scoring criteria (picker-rules.md's sum-100 registry stays untouched) — it is a post-scoring
 * override, same pattern as computePickerSnapshot.ts's existing zeroEventAdjustment.
 */
export function applyGatePenaltyScore(score: number, multiplier: number): number {
  return Math.min(100, Math.max(0, Math.round(score * multiplier)));
}
