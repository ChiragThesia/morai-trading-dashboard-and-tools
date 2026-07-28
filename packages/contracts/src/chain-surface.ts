import { z } from "zod";

// Priced-chain contracts — ONE schema source for GET /api/chain/priced + the get_priced_chain
// MCP tool. A one-sided field change fails `bun run typecheck` at
// apps/server/src/adapters/chain-surface-dto.ts, which types the mapped body as
// PricedChainResponse before parsing it.
//
// A NEW schema next to `chain.ts`, not a widened one. `chainResponse` is the RAW chain — a flat
// array of vendor facts with `bsmIv` and nothing derived, and the Analyzer's browser code turns it
// into priced rows itself. This schema is that derivation done server-side: grouped into
// (root, expiration) cohorts, greeks solved, the ATM reference named, vertical skew measured.
// Both will coexist until the chain table is repointed, and the raw one has other readers.
//
// STRIKE CONVENTION: points, e.g. 7400 — NOT the ×1000 integer `chainResponse` carries. The
// engine converts once, in domain/cohort.ts, and nothing downstream of it sees ×1000. A consumer
// joining these rows against a raw chain row must scale one side.
//
// NULL-HONESTY: every field the engine can fail to measure is `.nullable()`. That is not
// defensive padding. A strike whose IV never solved has no greeks and no skew, and it does NOT
// have zero ones — 24.4% of the live put wing was in that state on 2026-07-28. A required field
// here would force the engine to fabricate.
//
// NOTHING IS RANKED, SCORED OR GATED. This surface answers "show me the chain", not "what should
// I trade" — that is `rankedCalendarResponse`. There is deliberately no score, no verdict and no
// tradeability filter: the only rows missing from a ladder are the ones the chain never quoted.

// ─── Per-strike row ────────────────────────────────────────────────────────────

/**
 * pricedChainStrike — one strike of one cohort, priced as a single LEG.
 *
 * Greeks are ALL-OR-NOTHING. A row with a delta but no vega would be a half-priced leg, which is
 * worse than a blank one; `bid`, `ask` and `openInterest` are always present, because a strike the
 * chain quoted but could not price is still a strike the chain quoted. A gap is not a deletion.
 */
export const pricedChainStrike = z.object({
  /** Index points (7400 = 7400), NOT the ×1000 integer. */
  strike: z.number(),
  /** BSM implied vol as a decimal (0.1620 = 16.20%). Null = never solved. Never a zero stand-in. */
  iv: z.number().nullable(),
  bid: z.number(),
  ask: z.number(),
  openInterest: z.number().int(),
  delta: z.number().nullable(),
  gamma: z.number().nullable(),
  theta: z.number().nullable(),
  vega: z.number().nullable(),
  /**
   * `iv − atmIv`, same expiration AND same wing AND same root. Null when either IV is missing,
   * including when the cohort's own ATM strike never solved — a neighbour's IV is NOT a
   * substitute reference, because this renders as a sortable column and a silently re-based row
   * corrupts its neighbours' order while still looking fine.
   */
  vSkew: z.number().nullable(),
});

export type PricedChainStrike = z.infer<typeof pricedChainStrike>;

// ─── Per-cohort ladder ─────────────────────────────────────────────────────────

/**
 * pricedChainCohort — one `(root, expiration)` book and every strike it quotes on one wing.
 *
 * ROOT IS PART OF THE IDENTITY, never a display field. SPX (AM-settled third-Friday monthlies)
 * and SPXW (PM-settled weeklies) quote the SAME strikes on the SAME dates out of different books,
 * so a consumer keying a row or joining legs by (expiration, strike) alone collides two contracts
 * into one. In production that put an SPXW back leg against an SPX front — back IV 68.89% against
 * a front of 24.69%.
 */
export const pricedChainCohort = z.object({
  root: z.enum(["SPX", "SPXW"]),
  expiration: z.string(),
  /** Whole calendar days to expiry. Display and gating only — never the pricing clock. */
  dte: z.number().int(),
  /**
   * Years to the SETTLEMENT instant — the clock every greek below was priced at.
   *
   * On the wire because a consumer computing two-leg calendar math must feed THIS number to
   * `pairMetrics`, not re-derive `dte / 365.25`. The two are not interchangeable: AM settlement
   * (09:30 ET) lands before the expiry day's UTC midnight and PM (16:00 ET) after it, so the
   * whole-day convention moves the forward vol by a root-dependent amount.
   */
  t: z.number(),
  /** Strike nearest spot across every strike quoted, priced or not. Ties to the lower. */
  atmStrike: z.number().nullable(),
  /** That strike's OWN IV. Null when it never solved — never a neighbour's. */
  atmIv: z.number().nullable(),
  /** Ascending by strike, gaps included. */
  strikes: z.array(pricedChainStrike),
});

export type PricedChainCohort = z.infer<typeof pricedChainCohort>;

// ─── Response envelope ─────────────────────────────────────────────────────────

/**
 * pricedChainResponse — the GET /api/chain/priced + get_priced_chain response.
 *
 * OBJECT, not an array (unlike `chainResponse`): the cohorts need a spot, an observation instant
 * and the wing that was priced to be readable at all, and those are properties of the snapshot
 * rather than of any row. An empty `cohorts` is the valid no-data case.
 */
export const pricedChainResponse = z.object({
  /** Newest observation instant the priced cohort carries, ISO 8601 — not the server clock. */
  asOf: z.string().datetime(),
  /**
   * ONE spot for the whole snapshot, index points. Null when no quote carried a usable underlying
   * price. Nullable rather than defaulted: a fabricated 0 renders as a real quote and a reader
   * acts on it.
   */
  spot: z.number().nullable(),
  /** The wing actually priced — echoed because the default lives in the use-case, not here. */
  contractType: z.enum(["C", "P"]),
  /** Nearest expiry first, root breaking the tie so the order is stable across polls. */
  cohorts: z.array(pricedChainCohort),
});

export type PricedChainResponse = z.infer<typeof pricedChainResponse>;

// ─── Request ───────────────────────────────────────────────────────────────────

/**
 * pricedChainQuery — the optional GET /api/chain/priced query params, shared by the
 * get_priced_chain MCP tool's inputSchema.
 *
 * One field, and it is optional so the use-case's own default (puts) stays the single source of
 * that choice. There is deliberately nothing here that filters, limits or ranks: this surface
 * exists to hide nothing, and a paging knob on a screen whose contract is "show me everything"
 * would be the first hidden filter.
 */
export const pricedChainQuery = z.object({
  contractType: z.enum(["C", "P"]).optional(),
});

export type PricedChainQuery = z.infer<typeof pricedChainQuery>;
