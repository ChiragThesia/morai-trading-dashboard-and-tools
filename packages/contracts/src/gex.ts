import { z } from "zod";

// GEX contracts (MCP-02: ONE schema source for GET /api/analytics/gex + get_gex MCP tool).
// gexSnapshotResponse = gexSnapshotEntry — a SINGLE object (not an array; D-03).
// A one-sided field rename fails `bun run typecheck`. No second inline GEX schema.

// ─── Per-strike wall entry ────────────────────────────────────────────────────

/** gexWallEntry — one per-strike net-GEX point (open interest, volume, dealer gamma). */
export const gexWallEntry = z.object({
  /**
   * Strike in points (e.g. 7600.0 = 7600, 7412.5 = half-point SPX strike).
   * Not necessarily an integer — SPX lists half- and quarter-point strikes
   * (stored ×1000, divided back to points: 7412500 → 7412.5).
   */
  k: z.number(),
  /** Net dealer GEX in $-notional for this strike (positive = calls dominate). */
  gex: z.number(),
  /** Call open interest (contracts). */
  coi: z.number().int(),
  /** Put open interest (contracts). */
  poi: z.number().int(),
  /** Volume (contracts). */
  vol: z.number().int(),
});

export type GexWallEntry = z.infer<typeof gexWallEntry>;

// ─── GEX snapshot ─────────────────────────────────────────────────────────────

/**
 * gexSnapshotEntry — the full GEX snapshot for a computation cycle.
 * Includes flip level, call/put walls, profile grid, per-strike detail, and per-expiry rollup.
 * flip / callWall / putWall are nullable (null when the profile never crosses zero / no dominant wall).
 */
export const gexSnapshotEntry = z.object({
  /** Underlying spot price at computation time. */
  spot: z.number(),
  /** Gamma flip level (zero-crossing of the GEX profile); null when no crossing exists. */
  flip: z.number().nullable(),
  /**
   * Spot level with highest net positive GEX (call-side wall); null when none.
   * May be fractional for half-point SPX strikes (e.g. 7412.5).
   */
  callWall: z.number().nullable(),
  /**
   * Spot level with highest net negative GEX (put-side wall); null when none exists
   * (i.e. null when all strikes have non-negative GEX — fully long-gamma chain).
   * May be fractional for half-point SPX strikes.
   */
  putWall: z.number().nullable(),
  /** Net aggregate dealer GEX at the current spot level ($Bn/1% units). */
  netGammaAtSpot: z.number(),
  /**
   * Spot-price grid of aggregate net GEX for charting.
   * Each entry: { spot: gridSpotLevel, gamma: netDollarGamma }.
   * Field is named `spot` (not `strike`) because the axis is a simulated spot-price
   * grid, not an option strike — renaming prevents future misinterpretation (WR-01).
   */
  profile: z.array(z.object({ spot: z.number(), gamma: z.number() })),
  /** Per-strike detail (full chain). */
  strikes: z.array(gexWallEntry),
  /** Aggregate net GEX rolled up per expiration date. */
  byExpiry: z.array(z.object({ date: z.string(), gex: z.number() })),
  /**
   * Near-term (≤45d DTE) level set — walls/flip recomputed from only near-dated legs
   * (far-dated OI can dominate the all-expiry walls with an intraday-irrelevant level).
   * Null when no near-term legs solve, and on snapshots computed before this field shipped.
   */
  nearTerm: z
    .object({
      callWall: z.number().nullable(),
      putWall: z.number().nullable(),
      flip: z.number().nullable(),
    })
    .nullable(),
  /**
   * Per-expiry resolved carry — FRED-interpolated risk-free rate AND the put-call-parity
   * implied dividend yield solved against it, over the ATM-bracket call/put marks GEX
   * already reads. Null when the macro read fails or no expiry has a usable ATM pair, and
   * on snapshots computed before this field shipped (34-04, TOSP-02). Both r AND q are
   * emitted together so a downstream consumer can re-price with the EXACT r the q was
   * solved against — no client/server rate drift.
   */
  impliedCarry: z
    .array(
      z.object({
        expiration: z.string(),
        rate: z.number(),
        divYield: z.number(),
      }),
    )
    .nullable(),
  /** ISO 8601 datetime when this snapshot was computed. */
  computedAt: z.string().datetime(),
});

export type GexSnapshotEntry = z.infer<typeof gexSnapshotEntry>;

/**
 * gexSnapshotResponse — the HTTP GET /api/analytics/gex + get_gex MCP tool response shape.
 * Single object (NOT an array) — D-03: both read surfaces return the latest snapshot as one entry.
 */
export const gexSnapshotResponse = gexSnapshotEntry;

export type GexSnapshotResponse = GexSnapshotEntry;
