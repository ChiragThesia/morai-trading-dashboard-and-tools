/**
 * sizing.ts — VIX-tiered discrete contract-count registry (28-04, PLAY-03).
 *
 * `SIZING_TIERS` maps the SAME `VIX_LADDER` the entry gate (entry-gate.ts) uses to a
 * user-set contract count per tier — never a derived optimum (a backtest-fit "optimal size"
 * formula would re-introduce the exact over-fit-to-13-trades risk the milestone's research
 * flagged). `resolveSizingTier` is the pure lookup the use-case (Plan 04 Task 2) calls once
 * per cohort with the same VIX the gate already resolved.
 *
 * [ASSUMED] The default contract counts (2/2/1/0) and the VIX_LADDER edges (15/20/25,
 * entry-gate.ts) are UAT-pending per 28-CONTEXT.md ("user sets the CONTRACT COUNTS per
 * tier ... user confirms at UAT"). This file is the visible, user-editable source of
 * truth — never a hidden default or a UI config screen (T-28-11).
 *
 * Hexagon law (architecture-boundaries §2): imports only this bounded context's own
 * `./entry-gate.ts` sibling (intra-context domain import, no cross-context/framework deps).
 */

import { VIX_LADDER } from "./entry-gate.ts";
import type { VixTier } from "./entry-gate.ts";

export type SizingTierRow = {
  readonly tier: VixTier;
  /** Inclusive lower VIX bound — half-open [min, max), mirrors VIX_LADDER's own convention. */
  readonly vixMin: number;
  readonly vixMax: number;
  readonly contracts: number;
  readonly rationale: string;
};

/**
 * [ASSUMED] Proposed default contract counts — 28-RESEARCH.md's "Sizing tiers" section
 * (volatilitybox.com-cited tier shape). UAT-pending; edit this table directly to change
 * live sizing — never derive it from a formula.
 */
const DEFAULT_TIER_CONTRACTS: Readonly<Record<VixTier, number>> = {
  low: 2,
  normal: 2,
  elevated: 1,
  crisis: 0,
};

const TIER_RATIONALE: Readonly<Record<VixTier, string>> = {
  low: "Calm VIX (<15) — full size.",
  normal: "Normal VIX (15-20) — full size.",
  elevated: "Elevated VIX (20-25) — half size; the gate's own penalty band already discounts score here.",
  crisis: "Crisis VIX (>=25) — zero size; coincides with the gate's hard block (no live entries here anyway).",
};

/** The registry — one row per VIX_LADDER tier, ships verbatim to the Analyzer (Plan 06). */
export const SIZING_TIERS: ReadonlyArray<SizingTierRow> = VIX_LADDER.map((row) => ({
  tier: row.tier,
  vixMin: row.min,
  vixMax: row.max,
  contracts: DEFAULT_TIER_CONTRACTS[row.tier],
  rationale: TIER_RATIONALE[row.tier],
}));

/**
 * resolveSizingTier — the row whose half-open [vixMin, vixMax) contains `vix`. A null/NaN
 * vix (GATE BLIND / gate-read-error / cold-start) resolves no recommendation (null), never
 * a guessed tier (T-28-11). VIX_LADDER's four tiers are contiguous and non-overlapping
 * (entry-gate.test.ts asserts this), so every finite, non-negative `vix` resolves exactly
 * one row.
 */
export function resolveSizingTier(vix: number | null): SizingTierRow | null {
  if (vix === null || !Number.isFinite(vix)) return null;
  return SIZING_TIERS.find((row) => vix >= row.vixMin && vix < row.vixMax) ?? null;
}
