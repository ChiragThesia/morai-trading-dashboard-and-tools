import { z } from "zod";

// GEX contracts (MCP-02: ONE schema source for GET /api/analytics/gex + get_gex MCP tool).
// gexSnapshotResponse = gexSnapshotEntry — a SINGLE object (not an array; D-03).
// A one-sided field rename fails `bun run typecheck`. No second inline GEX schema.

// ─── Per-strike wall entry ────────────────────────────────────────────────────

/** gexWallEntry — one per-strike net-GEX point (open interest, volume, dealer gamma). */
export const gexWallEntry = z.object({
  /** Strike in integer points (e.g. 7600 = 7600). */
  k: z.number().int(),
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
  /** Strike with highest net positive GEX (call-side wall); null when none. */
  callWall: z.number().int().nullable(),
  /** Strike with highest net negative GEX (put-side wall); null when none. */
  putWall: z.number().int().nullable(),
  /** Net aggregate dealer GEX at the current spot level ($Bn/1% units). */
  netGammaAtSpot: z.number(),
  /** Spot-price grid of aggregate net GEX for charting. */
  profile: z.array(z.object({ strike: z.number(), gamma: z.number() })),
  /** Per-strike detail (full chain). */
  strikes: z.array(gexWallEntry),
  /** Aggregate net GEX rolled up per expiration date. */
  byExpiry: z.array(z.object({ date: z.string(), gex: z.number() })),
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
