import { z } from "zod";

// COT contracts (MCP-02: ONE schema source for GET /api/analytics/cot + get_cot MCP tool).
//
// TFF (Traders in Financial Futures) class names are used here — not the legacy
// net_noncommercial/net_commercial terms from the COT-02 acceptance criteria illustration
// (D-05 reconciliation). The TFF classes for E-mini S&P 500 are:
//   Dealer/Intermediary, Asset Manager/Institutional, Leveraged Funds,
//   Other Reportable, Non-Reportable.
//
// NET values are DERIVED here (included in the contract) but NOT STORED in cot_observations.
// Storage holds only the raw long/short legs; derivation happens at the API/use-case layer
// (D-04). Including net fields in the contract gives the Overview chart and net invariants
// what they need without requiring re-derivation on the client side.
//
// `netLeveraged` is the headline "big guys" signal (hedge funds / CTAs, D-05).

// ─── Per-week TFF series entry ────────────────────────────────────────────────

/**
 * cotSeriesEntry — one week of CFTC TFF positioning for E-mini S&P 500.
 *
 * Field naming follows TFF class labels (D-05); supersedes legacy net_noncommercial /
 * net_commercial from COT-02's illustrative example.
 *
 * All long/short/net values are position counts (integer contracts).
 */
export const cotSeriesEntry = z.object({
  /** Report date (the Tuesday) — YYYY-MM-DD from report_date_as_yyyy_mm_dd (D-08). */
  asOf: z.string().date(),
  /** Fetch timestamp (Friday) — ISO 8601 datetime; equals published_at in cot_observations (D-07). */
  publishedAt: z.string().datetime(),
  /** CFTC contract market code — e.g. '13874A' for E-mini S&P 500 TFF futures-only. */
  contractCode: z.string(),
  /** Total open interest across all trader classes. */
  openInterest: z.number().int(),

  // ─── Dealer / Intermediary ──────────────────────────────────────────────────
  dealerLong: z.number().int(),
  dealerShort: z.number().int(),
  /** Net = dealerLong − dealerShort. Derived at use-case layer; not stored in DB (D-04). */
  netDealer: z.number().int(),

  // ─── Asset Manager / Institutional ──────────────────────────────────────────
  assetMgrLong: z.number().int(),
  assetMgrShort: z.number().int(),
  /** Net = assetMgrLong − assetMgrShort. */
  netAssetManager: z.number().int(),

  // ─── Leveraged Funds (hedge funds / CTAs) — headline D-05 signal ────────────
  levMoneyLong: z.number().int(),
  levMoneyShort: z.number().int(),
  /** Net = levMoneyLong − levMoneyShort. Primary "big guys" positioning signal (D-05). */
  netLeveraged: z.number().int(),

  // ─── Other Reportable ───────────────────────────────────────────────────────
  otherReptLong: z.number().int(),
  otherReptShort: z.number().int(),
  /** Net = otherReptLong − otherReptShort. */
  netOther: z.number().int(),

  // ─── Non-Reportable (small speculators) ─────────────────────────────────────
  nonreptLong: z.number().int(),
  nonreptShort: z.number().int(),
  /** Net = nonreptLong − nonreptShort. */
  netNonreportable: z.number().int(),
});

export type CotSeriesEntry = z.infer<typeof cotSeriesEntry>;

/**
 * cotResponse — the HTTP GET /api/analytics/cot + get_cot MCP tool response shape.
 * Array (NOT a single object) — COT is a time series; `[]` is the valid no-data case.
 */
export const cotResponse = z.array(cotSeriesEntry);

export type CotResponse = z.infer<typeof cotResponse>;
