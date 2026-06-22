import { z } from "zod";

// MCP-02: ONE schema source for BOTH the HTTP analytics routes and the MCP get_skew /
// get_term_structure tools. Both adapters import from here; a one-sided field rename fails
// `bun run typecheck`. There is no second or inline analytics schema (SPEC R5 prohibition).
//
// Each response is a JSON ARRAY of entries (current + historical). The no-data case returns a
// contract-valid EMPTY array, never an error (SPEC R5 / api-design.md): `.parse([])` succeeds.

// ─── Skew (per-strike smile entry) ─────────────────────────────────────────────

/** skewEntry — one smile point at a snapshot time. */
export const skewEntry = z.object({
  time: z.string().datetime(),
  underlying: z.string(),
  expiration: z.string(),
  // ×1000 strike convention mirrored from the schema (number for transport)
  strike: z.number(),
  iv: z.number(),
  // Nullable — interpolation source may be absent
  delta: z.number().nullable(),
  moneyness: z.number().nullable(),
});

export type SkewEntry = z.infer<typeof skewEntry>;

/** skewResponse — array of smile points (empty array = no data, not an error). */
export const skewResponse = z.array(skewEntry);

export type SkewResponse = z.infer<typeof skewResponse>;

// ─── Risk-reversal (25Δ scalar + trailing rank) ────────────────────────────────

/** riskReversalEntry — the headline 25Δ risk-reversal + rank per (underlying, expiration). */
export const riskReversalEntry = z.object({
  time: z.string().datetime(),
  underlying: z.string(),
  expiration: z.string(),
  // NULL when ±25Δ cannot be bracketed — never fabricated
  riskReversal: z.number().nullable(),
  // NULL when riskReversal is null or no trailing history exists
  rrRank: z.number().nullable(),
});

export type RiskReversalEntry = z.infer<typeof riskReversalEntry>;

/** riskReversalResponse — array of risk-reversal entries (empty array = no data). */
export const riskReversalResponse = z.array(riskReversalEntry);

export type RiskReversalResponse = z.infer<typeof riskReversalResponse>;

// ─── Term structure (forward-vol slope per calendar) ───────────────────────────

/** termStructureEntry — back_iv − front_iv for one calendar at a snapshot time. */
export const termStructureEntry = z.object({
  time: z.string().datetime(),
  calendarId: z.string(),
  // value = back_iv − front_iv; equals calendar_snapshots.term_slope
  value: z.number(),
});

export type TermStructureEntry = z.infer<typeof termStructureEntry>;

/** termStructureResponse — array of term-structure entries (empty array = no data). */
export const termStructureResponse = z.array(termStructureEntry);

export type TermStructureResponse = z.infer<typeof termStructureResponse>;
