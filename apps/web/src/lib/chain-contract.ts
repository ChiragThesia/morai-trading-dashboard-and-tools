/**
 * Chain row contract — the shape `GET /api/chain` returns.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * INTEGRATION STUB (Unit 11 ← Unit 01). The canonical home for this schema is
 * `packages/contracts/src/chain.ts`. That file does not exist in this worktree,
 * so the FROZEN row contract is transcribed here verbatim to keep the Analyzer
 * rework buildable and green.
 *
 * To reconcile: replace the two declarations below with
 *
 *     export { chainResponse } from "@morai/contracts";
 *     export type { ChainRow } from "@morai/contracts";
 *
 * and delete nothing else — every consumer imports from this module, so the
 * swap is a one-file change.
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * Units: `strike` is ×1000 (divide to display), `bsmIv` is a decimal (0.1249 =
 * 12.49%), `observedAt` is ISO-Z. `bsmIv` is nullable — a missing IV renders as
 * an em dash, never as 0 (project law: never fabricate a number).
 *
 * No any/as/!.
 */
import { z } from "zod";

export const chainRow = z.object({
  /** Strike ×1000 (integer cents-of-a-point) — divide by 1000 to display. */
  strike: z.number().int(),
  /** YYYY-MM-DD. */
  expiration: z.string(),
  contractType: z.enum(["C", "P"]),
  dte: z.number().int(),
  /** Decimal, not percent. Null when the BSM job has not priced this contract. */
  bsmIv: z.number().nullable(),
  bid: z.number(),
  ask: z.number(),
  openInterest: z.number().int(),
  underlyingPrice: z.number(),
  source: z.enum(["schwab", "cboe"]),
  /** ISO instant, Z-suffixed. */
  observedAt: z.string(),
});

/**
 * ASSUMPTION (Unit 01 seam): the endpoint wraps its rows in `{ rows: [...] }`,
 * matching the house shape of `/api/trade-history` and `/api/analytics/gex`.
 * If Unit 01 froze a bare array instead, this object is the only thing that
 * changes.
 */
export const chainResponse = z.object({
  rows: z.array(chainRow),
});

export type ChainRow = z.infer<typeof chainRow>;
export type ChainResponse = z.infer<typeof chainResponse>;
