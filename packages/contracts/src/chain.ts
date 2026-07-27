import { z } from "zod";

// Chain contracts (MCP-02: ONE schema source for the chain HTTP route + its MCP tool twin).
// chainResponse = z.array(chainRow) — the chain IS an array (unlike gex, D-03): one row per
// strike × expiration × side. `[]` is the valid no-data case.
// A one-sided field rename fails `bun run typecheck`. No second inline chain schema.
//
// This is a pure DATA contract for the Analyzer table — raw chain facts only.
// No scores, no verdicts, no ranking. Derived columns (horizontal/vertical skew, edge)
// are computed by consumers from these fields.

// ─── Per-contract chain row ───────────────────────────────────────────────────

/** chainRow — one option contract's raw chain facts at a single observation time. */
export const chainRow = z.object({
  /**
   * Strike as a ×1000 integer (7400000 = 7400, 7412500 = 7412.5).
   * Integer everywhere on the wire — SPX lists half- and quarter-point strikes, and the
   * ×1000 convention keeps them exact (no float drift, safe as a map key / equality test).
   */
  strike: z.number().int(),
  /** Expiration date, YYYY-MM-DD. */
  expiration: z.string(),
  /** Contract side — "C" call, "P" put. */
  contractType: z.enum(["C", "P"]),
  /** Calendar days to expiration (NOT trading days), computed server-side. 0 = 0DTE. */
  dte: z.number().int(),
  /**
   * BSM implied volatility as a decimal (0.1249 = 12.49%), NOT a percent.
   * Null = never solved (no usable mark, or the inversion failed) — never a zero stand-in.
   */
  bsmIv: z.number().nullable(),
  /** Bid in index points. 0 on an untraded strike (no bid). */
  bid: z.number(),
  /** Ask in index points. 0 on an untraded strike (no ask). */
  ask: z.number(),
  /** Open interest in contracts. */
  openInterest: z.number().int(),
  /** Underlying spot at observation time, index points (unscaled — 7381.12 = 7381.12). */
  underlyingPrice: z.number(),
  /** Which vendor this row came from — the chain is a schwab+cboe union, deduped per contract. */
  source: z.enum(["schwab", "cboe"]),
  /** ISO 8601 datetime the row was observed, Z-suffixed (UTC). */
  observedAt: z.string(),
});

export type ChainRow = z.infer<typeof chainRow>;

/**
 * chainResponse — the chain HTTP route + MCP tool response shape.
 * Array (NOT a single object) — one row per contract; `[]` is the valid no-data case.
 */
export const chainResponse = z.array(chainRow);

export type ChainResponse = z.infer<typeof chainResponse>;
