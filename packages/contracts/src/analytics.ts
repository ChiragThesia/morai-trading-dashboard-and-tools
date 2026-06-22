import { z } from "zod";

// MCP-02: ONE schema source for BOTH the HTTP analytics routes and the MCP get_skew /
// get_term_structure tools. Both adapters import from here; a one-sided field rename fails
// `bun run typecheck`. There is no second or inline analytics schema (SPEC R5 prohibition).
//
// Each response is a JSON ARRAY of entries (current + historical). The no-data case returns a
// contract-valid EMPTY array, never an error (SPEC R5 / api-design.md): `.parse([])` succeeds.

// ─── Skew smile detail (per-strike) ────────────────────────────────────────────

/** skewSmileEntry — one per-strike smile point at a snapshot time (optional detail surface). */
export const skewSmileEntry = z.object({
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

export type SkewSmileEntry = z.infer<typeof skewSmileEntry>;

/** skewSmileResponse — array of per-strike smile points (empty array = no data, not an error). */
export const skewSmileResponse = z.array(skewSmileEntry);

export type SkewSmileResponse = z.infer<typeof skewSmileResponse>;

// ─── Skew headline = 25Δ risk-reversal scalar + trailing rank ──────────────────
// SPEC R5: GET /api/analytics/skew returns {time, value=risk_reversal, …} — the derived headline,
// NOT the smile detail. The skew read surface and MCP get_skew share this ONE skewResponse schema
// (MCP-02). A one-sided field rename fails `bun run typecheck`.

/** skewEntry — the headline 25Δ risk-reversal + rank per (underlying, expiration). */
export const skewEntry = z.object({
  time: z.string().datetime(),
  underlying: z.string(),
  expiration: z.string(),
  // value = risk_reversal = IV(25Δ put) − IV(25Δ call); NULL when ±25Δ cannot be bracketed
  // (never fabricated). `value` is the SPEC R5 generic field name shared with term-structure.
  value: z.number().nullable(),
  // NULL when value is null or no trailing history exists
  rrRank: z.number().nullable(),
});

export type SkewEntry = z.infer<typeof skewEntry>;

/** skewResponse — array of headline risk-reversal entries (empty array = no data). */
export const skewResponse = z.array(skewEntry);

export type SkewResponse = z.infer<typeof skewResponse>;

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
