import { z } from "zod";

// Picker contracts (Phase 18, D-01; MCP-02: ONE schema source for the Phase-19
// GET /api/picker/candidates response + get_picker_candidates MCP tool).
// pickerCandidate is rich/display-complete: the engine (Phase 19) is the sole scoring
// authority, the UI is pure-render and never recomputes scores. A one-sided field
// rename fails `bun run typecheck`. No second inline picker schema.

// ─── Per-candidate leg ─────────────────────────────────────────────────────────

/** pickerCandidateLeg — one leg (front or back) of a candidate calendar. */
export const pickerCandidateLeg = z.object({
  /** Strike in points (e.g. 7500.0). */
  strike: z.number(),
  /** Option right — puts only in scope this milestone, kept as an enum for forward-compat. */
  putCall: z.enum(["C", "P"]),
  /** Days to expiration at the fixture/snapshot's reference date. */
  dte: z.number().int(),
  /** Per-strike implied volatility for this leg (skew-adjusted, not raw ATM term IV). */
  iv: z.number(),
});

export type PickerCandidateLeg = z.infer<typeof pickerCandidateLeg>;

// ─── Score breakdown ────────────────────────────────────────────────────────────

/**
 * breakdownEntry — one scored criterion contributing to `pickerCandidate.score`.
 * `criterion` is a CLOSED enum — structurally excludes every REFUTED criterion from
 * calendar-selection-criteria.md (no IV-rank gate, no -1..-3% IV-diff band, no
 * debit-%-of-back band). Adding a criterion requires an explicit schema change.
 */
export const breakdownEntry = z.object({
  criterion: z.enum(["slope", "fwdEdge", "gexFit", "eventAdjustment", "beVsEm"]),
  /** Points this criterion contributes at 100% (e.g. 40 for slope, 10 for eventAdjustment). */
  weight: z.number(),
  /** The criterion's raw computed metric (e.g. slope in vol-pts/yr, gexFit as a 0-1 fraction). */
  rawValue: z.number(),
  /** Normalized 0-100 share of this criterion's weight the candidate achieved. */
  contribution: z.number(),
});

export type BreakdownEntry = z.infer<typeof breakdownEntry>;

// ─── Exit plan ──────────────────────────────────────────────────────────────────

/** exitPlan — entry/exit defaults for a candidate (D-01b; fixed defaults this phase). */
export const exitPlan = z.object({
  /** Profit target as a fraction of debit (e.g. 0.25 = +25%). */
  profitTargetPct: z.number(),
  /** Stop-loss as a fraction of debit (e.g. 0.175 = -17.5%). */
  stopPct: z.number(),
  /** Manage the short (front) leg at this many DTE remaining. */
  manageShortDte: z.number().int(),
  /** Hard close-by date (ISO 8601 date) — the front leg's expiration. */
  closeByExpiry: z.string(),
});

export type ExitPlan = z.infer<typeof exitPlan>;

// ─── Candidate ──────────────────────────────────────────────────────────────────

/**
 * pickerCandidate — one scored calendar candidate. Rich/display-complete (D-01): carries
 * every value the picker UI renders, so the UI is pure-render against fixture or live data.
 */
export const pickerCandidate = z.object({
  id: z.string(),
  name: z.string(),
  /** 0-100 engine-computed score; always present and finite, even in the fwdIv-guard case. */
  score: z.number().min(0).max(100),
  breakdown: z.array(breakdownEntry),
  /** Debit paid to enter (= max loss, per D-01/D-01b, when closed by front expiry). */
  debit: z.number(),
  /** Net position theta ($/day). */
  theta: z.number(),
  /** Net position vega ($/vol-pt). */
  vega: z.number(),
  /** Net position delta ($/pt). */
  delta: z.number(),
  /**
   * Forward IV between the two legs (criterion 1). Null when the term structure is
   * inverted (radicand < 0) — never NaN. `fwdIvGuard === "inverted"` implies `fwdIv === null`.
   */
  fwdIv: z.number().nullable(),
  /** Guard tag for `fwdIv`: "ok" = computed normally, "inverted" = radicand < 0 (fwdIv null). */
  fwdIvGuard: z.enum(["ok", "inverted"]),
  /** Term-structure slope between legs, annualized vol-pts/yr (criterion 2). */
  slope: z.number(),
  /** Front-IV-rich-vs-forward-path edge (criterion 1); 0 in the fwdIv-guard case. */
  fwdEdge: z.number(),
  /** +/-1 sigma expected move by front expiry. */
  expectedMove: z.number(),
  /** Scheduled economic events the front leg spans (e.g. ["NFP", "CPI"]). */
  frontEvents: z.array(z.string()),
  /** Scheduled economic events the back leg spans, excluding any already in frontEvents. */
  backEvents: z.array(z.string()),
  frontLeg: pickerCandidateLeg,
  backLeg: pickerCandidateLeg,
  exitPlan,
});

export type PickerCandidate = z.infer<typeof pickerCandidate>;

// ─── Term structure ─────────────────────────────────────────────────────────────

/** termStructurePoint — one point on the ATM-IV term-structure curve. */
export const termStructurePoint = z.object({
  dte: z.number().int(),
  iv: z.number(),
});

export type TermStructurePoint = z.infer<typeof termStructurePoint>;

// ─── GEX context ────────────────────────────────────────────────────────────────

/**
 * pickerGexContext — the GEX snapshot the picker scores against (criterion 7).
 * flip/callWall/putWall/absGammaStrike are nullable, mirroring gex.ts's nullable-field
 * convention (null when the profile never crosses zero / no dominant wall exists).
 */
export const pickerGexContext = z.object({
  flip: z.number().nullable(),
  callWall: z.number().nullable(),
  putWall: z.number().nullable(),
  netGammaAtSpot: z.number(),
  absGammaStrike: z.number().nullable(),
});

export type PickerGexContext = z.infer<typeof pickerGexContext>;

// ─── Economic events ────────────────────────────────────────────────────────────

/** pickerEvent — one scheduled economic-calendar event (FOMC/CPI/NFP). */
export const pickerEvent = z.object({
  /** ISO 8601 date. */
  date: z.string(),
  name: z.string(),
});

export type PickerEvent = z.infer<typeof pickerEvent>;

// ─── Snapshot response ──────────────────────────────────────────────────────────

/**
 * pickerSnapshotResponse — the HTTP GET /api/picker/candidates + get_picker_candidates
 * MCP tool response shape (MCP-02). Both the Phase-18 frozen fixture and the Phase-19 live
 * response must satisfy this schema with zero shape change.
 */
export const pickerSnapshotResponse = z.object({
  spot: z.number(),
  termStructure: z.array(termStructurePoint),
  gex: pickerGexContext,
  events: z.array(pickerEvent),
  candidates: z.array(pickerCandidate),
});

export type PickerSnapshotResponse = z.infer<typeof pickerSnapshotResponse>;
