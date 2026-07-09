/**
 * exit-rules.ts — THE exit rule registry (docs/architecture/exit-rules.md is its prose twin).
 *
 * Mirrors picker/domain/rules.ts's registry style: a typed row per rule (id, label, kind,
 * rationale, source) plus the named threshold/hysteresis constants the pure evaluator
 * (evaluate-exit.ts, this same plan) reads. `EXIT_PRECEDENCE` is the explicit, reviewable
 * evaluation order — never an implicit if/else chain (RESEARCH "Precedence Ladder").
 *
 * All threshold values are USER-LOCKED (26-CONTEXT.md "The playbook ladder") — encoded here
 * EXACTLY, no re-derivation. Hysteresis disarm bands are Claude's-discretion values
 * (26-CONTEXT.md), documented in docs/architecture/exit-rules.md's band table.
 *
 * Hexagon law (architecture-boundaries §2): pure constants, no I/O, no imports needed.
 */

// ─────────────────────────────────────────────────────────────
// Registry row type + EXIT_PRECEDENCE (the reviewable evaluation order)
// ─────────────────────────────────────────────────────────────

/** ExitRuleId — closed set of the seven registry rows. */
export type ExitRuleId = "stop" | "evt" | "gamma" | "term" | "take" | "roll" | "hold";

/** ExitRuleKind — mirrors contracts' exitRuleSetEntry.kind enum exactly (26-01). */
export type ExitRuleKind = "trigger" | "profit-take" | "roll" | "hold";

export type ExitRuleMetadata = {
  readonly id: ExitRuleId;
  readonly label: string;
  readonly kind: ExitRuleKind;
  readonly rationale: string;
  readonly source: string;
};

export const EXIT_RULE_METADATA: ReadonlyArray<ExitRuleMetadata> = [
  {
    id: "stop",
    label: "Stop loss (-25% / -50%)",
    kind: "trigger",
    rationale:
      "Capital preservation is non-negotiable and time-critical. A stop is urgent risk control " +
      "and fires before a patient profit target even when both conditions are live the same cycle.",
    source: "User-locked playbook ladder (26-CONTEXT.md); futures.stonex.com, metrotrade.com",
  },
  {
    id: "evt",
    label: "Pre-event exit (tier-1 event ≤3 days from front expiry)",
    kind: "trigger",
    rationale:
      "A fixed calendar date, not a noise-driven trigger — mirrors the picker's own " +
      "exitPlan.closeByExpiry discipline, so it runs ahead of the noisier continuous triggers below it.",
    source: "candidate-selection.ts EVENT_BLACKOUT_DAYS day-before-stamp math (reused)",
  },
  {
    id: "gamma",
    label: "Gamma/pin risk (spot >2% off strike, front <7 DTE)",
    kind: "trigger",
    rationale:
      "Pin/whipsaw risk in the final DTE window compounds fastest of the remaining triggers — a " +
      "single session's move near expiry can erase weeks of theta gain.",
    source: "menthorq.com, impliedoptions.com, daystoexpiry.com",
  },
  {
    id: "term",
    label: "Term-structure inversion (front IV − back IV ≥ 0.5pp)",
    kind: "trigger",
    rationale:
      "Front-back IV inversion means the calendar's entry edge is gone — a slower-moving " +
      "structural signal than GAMMA's DTE-driven urgency.",
    source: "abovethegreenline.com",
  },
  {
    id: "take",
    label: "Take profit (+5% / +10% / +15%)",
    kind: "profit-take",
    rationale:
      "Profit-taking is patient by nature; evaluated after every risk-driven trigger above it. " +
      "Highest qualifying rung wins (+15% over +10% over +5%).",
    source: "User-locked playbook ladder (26-CONTEXT.md); traderc.com, journalplus.co",
  },
  {
    id: "roll",
    label: "Roll to replacement front (+14-21 DTE)",
    kind: "roll",
    rationale:
      "A constructive continuation, evaluated only once nothing more urgent fired. Replacement " +
      "front is haircutFill-priced with the same ORATS fill model the picker uses on entry.",
    source: "traderc.com 21-DTE rule; project PITFALLS.md Pitfall 9",
  },
  {
    id: "hold",
    label: "Hold (no rule fired)",
    kind: "hold",
    rationale: "Default verdict when no trigger, profit-take, or roll condition is met.",
    source: "N/A — default case",
  },
];

/** EXIT_PRECEDENCE — the ordered evaluation ladder, first match wins (RESEARCH-cited order). */
export const EXIT_PRECEDENCE: ReadonlyArray<ExitRuleId> = [
  "stop",
  "evt",
  "gamma",
  "term",
  "take",
  "roll",
  "hold",
];

// ─────────────────────────────────────────────────────────────
// TAKE / STOP rungs — USER-LOCKED thresholds + hysteresis disarm bands
// ─────────────────────────────────────────────────────────────

/** One P&L rung: arms at `arm`, stays armed (once previously armed) until crossing `disarm`. */
export type ExitRung = {
  readonly label: string;
  readonly arm: number;
  readonly disarm: number;
};

/** TAKE rungs, ordered HIGHEST → LOWEST so "highest qualifying rung wins" is a linear scan. */
export const TAKE_RUNGS: ReadonlyArray<ExitRung> = [
  { label: "+15%", arm: 0.15, disarm: 0.13 },
  { label: "+10%", arm: 0.1, disarm: 0.08 },
  { label: "+5%", arm: 0.05, disarm: 0.03 },
];

/** STOP rungs, ordered DEEPEST → SHALLOWEST so "deepest qualifying rung wins" is a linear scan. */
export const STOP_RUNGS: ReadonlyArray<ExitRung> = [
  { label: "-50%", arm: -0.5, disarm: -0.48 },
  { label: "-25%", arm: -0.25, disarm: -0.23 },
];

// ─────────────────────────────────────────────────────────────
// TERM / GAMMA thresholds + hysteresis disarm bands
// ─────────────────────────────────────────────────────────────

/** TERM arms at front IV − back IV ≥ this (0.5pp, in IV points). */
export const TERM_INVERSION_MIN = 0.005;
/** TERM disarms once inversion drops below this (proportional ~40% buffer). */
export const TERM_INVERSION_DISARM = 0.003;

/** GAMMA arms at |spot − strike| / strike > this (2% off strike). */
export const GAMMA_OFF_STRIKE = 0.02;
/** GAMMA disarms once off-strike fraction drops below this. */
export const GAMMA_OFF_STRIKE_DISARM = 0.015;
/** GAMMA's other half: front DTE must be < this (no hysteresis — DTE only decreases). */
export const GAMMA_FRONT_DTE_MAX = 7;

// ─────────────────────────────────────────────────────────────
// EVT — date-based, no hysteresis (a calendar date does not flap)
// ─────────────────────────────────────────────────────────────

/**
 * Tier-1 event blackout window before front expiry. Matches picker's
 * `EVENT_BLACKOUT_DAYS` value (candidate-selection.ts) — an exits-owned constant, not a
 * cross-context import (domain layer only imports @morai/shared).
 */
export const EVT_BLACKOUT_DAYS = 3;

// ─────────────────────────────────────────────────────────────
// ROLL thresholds
// ─────────────────────────────────────────────────────────────

/** ROLL arms when front DTE is strictly below this. */
export const ROLL_FRONT_DTE_MAX = 14;
/** ROLL requires spot within this fraction of strike (±1%). */
export const ROLL_SPOT_BAND = 0.01;
/** ROLL requires P&L strictly below this (profit < 15%). */
export const ROLL_PROFIT_MAX = 0.15;
/** Replacement front DTE window ROLL selects from (inclusive). */
export const ROLL_REPLACEMENT_DTE_MIN = 14;
export const ROLL_REPLACEMENT_DTE_MAX = 21;
