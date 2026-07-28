import { Hono } from "hono";
import { pricedChainQuery } from "@morai/contracts";
import type { ForPricingChain } from "@morai/core";
import { toPriceChainRequest, toPricedChainBody } from "../chain-surface-dto.ts";

/**
 * chainSurfaceRoutes — factory returning a Hono router for GET /chain/priced.
 *
 * Architecture law (architecture-boundaries.md §3): zero business logic here.
 * Pattern: Zod-parse query → call use-case → map Result → parse through the contract → respond.
 * Every number on the wire was computed in `packages/core/src/calendar`; nothing is derived,
 * defaulted or re-grouped at this layer.
 *
 * SIBLING OF /chain, NOT A REPLACEMENT. GET /chain returns the raw two-vendor union — one flat
 * row per contract with `bsmIv` and nothing else derived. This route returns that same read
 * grouped into (root, expiration) cohorts with greeks, the ATM reference and vertical skew
 * already solved, because those eight formulas currently run in the BROWSER
 * (apps/web/src/lib/chain-math.ts) and a second implementation of a formula is a second thing to
 * be wrong. The web app is NOT repointed by this change; that is a separate, reviewable step, and
 * `apps/server/src/adapters/chain-surface-differential.test.ts` is the evidence it is safe.
 *
 * Computed ON READ from the latest chain cohort, like /calendars/ranked and unlike
 * /picker/candidates: the mapping is deterministic over one chain read, so a stored snapshot
 * would add a staleness mode without adding an answer.
 *
 * ?contractType is user-controlled input, so it is validated BEFORE the use-case runs — an
 * invalid value is a 400 and the engine is never called. An absent param is omitted rather than
 * defaulted here, so the use-case stays the one source of the default wing.
 *
 * OBJECT READ — an empty chain is 200 with `cohorts: []`, never a 404. The 404-on-null rule in
 * gex.routes.ts is for a missing stored snapshot row; nothing is stored here. Unlike GET /chain
 * this response is an object rather than an array, because the cohorts are unreadable without the
 * snapshot's spot, instant and wing.
 *
 * Threat mitigations:
 *   Errors map to a flat {error:"internal"} — the DB message never reaches the wire.
 *   The response is contract-parsed on the way out, which also strips any internal field the core
 *   type happens to carry.
 *   No limit param, and none is needed: the response is bounded by the chain read itself (one
 *   wing, ~5,800 rows), which is the same bound GET /chain already ships.
 *
 * MCP-02: pricedChainResponse / pricedChainQuery are the single schema sources shared with the
 *   get_priced_chain MCP tool, and both adapters go through the same chain-surface-dto mappers.
 *   A one-sided field change fails `bun run typecheck`.
 *
 * Mount: in main.ts inside the CHAINED apiRouter builder, so the effective path is
 *   GET /api/chain/priced. Hono matches exact paths and chainRoutes registers only the exact
 *   path /chain, so there is no shadowing in either direction.
 */
export function chainSurfaceRoutes(priceChain: ForPricingChain) {
  const router = new Hono();

  router.get("/chain/priced", async (c) => {
    const parsed = pricedChainQuery.safeParse(c.req.query());
    if (!parsed.success) {
      // Reject before the engine is ever called.
      return c.json({ error: "invalid query" }, 400);
    }

    const result = await priceChain(toPriceChainRequest(parsed.data));
    if (!result.ok) {
      // Flat error — never expose DB internals.
      return c.json({ error: "internal" }, 500);
    }

    return c.json(toPricedChainBody(result.value));
  });

  return router;
}
