/**
 * Regime domain — pure calm/warning/crisis banding (Phase 24, BOARD-01/02).
 *
 * Hexagon law (architecture-boundaries §2): imports nothing — plain functions over
 * primitive numbers, same idiom as gex.ts's pickWalls/findFlip.
 *
 * Four indicators, four named-constant thresholds — no rules-engine/DSL, no composite
 * fragility score (24-RESEARCH.md Anti-Patterns). Each function is total over the reals
 * and monotonic non-decreasing in its input (proven by regime.test.ts fast-check).
 */

export type RegimeBand = "calm" | "warning" | "crisis";

// ─── VIX/VIX3M term-structure ratio ─────────────────────────────────────────────
// Confirmed by independent sources against the user's own tos-studies-learnings.md prior
// (24-RESEARCH.md Indicator 1 — no refinement needed).

const VIX_TERM_STRUCTURE_WARN = 0.9;
const VIX_TERM_STRUCTURE_CRISIS = 0.95;

export function bandVixTermStructure(ratio: number): RegimeBand {
  if (ratio >= VIX_TERM_STRUCTURE_CRISIS) return "crisis";
  if (ratio >= VIX_TERM_STRUCTURE_WARN) return "warning";
  return "calm";
}

// ─── VVIX absolute level ────────────────────────────────────────────────────────
// 100 warn confirmed directly by multiple sources; 115 crisis is the user's own TOS-tested
// interpolation of the cited 110-120 elevated→extreme-fear zone (24-RESEARCH.md Indicator 2).

const VVIX_WARN = 100;
const VVIX_CRISIS = 115;

export function bandVvix(level: number): RegimeBand {
  if (level >= VVIX_CRISIS) return "crisis";
  if (level >= VVIX_WARN) return "warning";
  return "calm";
}

// ─── VIX9D/VIX short-term stress ratio ──────────────────────────────────────────
// [ASSUMED] — no backtested numeric cut exists online; structural analogy to the VIX/VIX3M
// ratio logic (24-RESEARCH.md Indicator 3, Assumption A1). Display-only this phase, no hard
// gate — flag for a dedicated backtest before any future Phase-28 gate-wiring.

const VIX9D_RATIO_WARN = 1.0;
const VIX9D_RATIO_CRISIS = 1.1;

export function bandVix9dRatio(ratio: number): RegimeBand {
  if (ratio >= VIX9D_RATIO_CRISIS) return "crisis";
  if (ratio >= VIX9D_RATIO_WARN) return "warning";
  return "calm";
}

// ─── HY OAS credit spread (FRED BAMLH0A0HYM2, percent units) ───────────────────
// [ASSUMED/newly-calibrated] — synthesized from 3 practitioner sources, not the user's own
// TOS study (24-RESEARCH.md Indicator 5, Assumption A2). Absolute-level band (not a moving
// average) so it needs zero warm-up history on ship day.

const HY_OAS_WARN = 3.0;
const HY_OAS_CRISIS = 5.0;

export function bandHyOas(percent: number): RegimeBand {
  if (percent >= HY_OAS_CRISIS) return "crisis";
  if (percent >= HY_OAS_WARN) return "warning";
  return "calm";
}
