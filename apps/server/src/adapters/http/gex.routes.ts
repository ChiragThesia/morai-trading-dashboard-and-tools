import { Hono } from "hono";
import { gexSnapshotResponse } from "@morai/contracts";
import type { ForRunningGetGex } from "@morai/core";

/**
 * gexRoutes — factory returning a Hono router for GET /analytics/gex.
 *
 * Architecture law (architecture-boundaries.md §3): zero business logic here.
 * Pattern: call use-case → map Result → parse through contract schema → respond.
 *
 * GEX-01 / SC-1: Returns the latest stored GEX snapshot (never recomputed per-request — D-01).
 *
 * Threat mitigations:
 *   T-08-AUTH5: errors mapped to flat {error:"internal"} or {error:"no-snapshot"} — no DB internals.
 *   D-01 prohibition: no buildProfile/strikeGex/bsmGreeks/recompute call here.
 *
 * MCP-02: gexSnapshotResponse is the single schema source shared by this route and the
 *   get_gex MCP tool. A one-sided field change fails `bun run typecheck`.
 *
 * Mount: in main.ts under /analytics (authReadGroup.route("/api", authReadGroup) →
 *   apiRouter.route("/analytics", gexRoutes(getGex))), so the effective path is
 *   GET /api/analytics/gex.
 */
export function gexRoutes(getGex: ForRunningGetGex) {
  const router = new Hono();

  router.get("/gex", async (c) => {
    const result = await getGex();

    if (!result.ok) {
      // T-08-AUTH5: flat error — never expose DB internals (storage-error message hidden).
      return c.json({ error: "internal" }, 500);
    }

    if (result.value === null) {
      // No snapshot computed yet — clean no-data response (GEX-01 / D-01).
      return c.json({ error: "no-snapshot" }, 404);
    }

    // Parse through the contract before responding (MCP-02 schema parity enforced at type level).
    // GexSnapshotRow has Date computedAt; gexSnapshotResponse expects z.string().datetime().
    const row = result.value;
    return c.json(
      gexSnapshotResponse.parse({
        spot: row.spot,
        flip: row.flip,
        callWall: row.callWall,
        putWall: row.putWall,
        netGammaAtSpot: row.netGammaAtSpot,
        profile: row.profile,
        strikes: row.strikes,
        byExpiry: row.byExpiry,
        nearTerm: row.nearTerm,
        impliedCarry: row.impliedCarry,
        computedAt:
          row.computedAt instanceof Date
            ? row.computedAt.toISOString()
            : row.computedAt,
      }),
    );
  });

  return router;
}
