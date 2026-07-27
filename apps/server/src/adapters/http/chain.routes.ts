import { Hono } from "hono";
import { chainResponse } from "@morai/contracts";
import type { ChainResponse } from "@morai/contracts";
import type { ForRunningGetChain } from "@morai/core";

/**
 * chainRoutes — factory returning a Hono router for GET /chain.
 *
 * Architecture law (architecture-boundaries.md §3): zero business logic here.
 * Pattern: call use-case → map Result → parse through the contract schema → respond.
 *
 * Feeds the Analyzer tab's chain DATA TABLE (skew/EDGE/IV/greeks per strike). No scoring,
 * no ranking, no derivation — the use-case hands over rows that are already wire-shaped
 * (ISO observedAt, ×1000 int strikes, numeric bsmIv), so this adapter only validates+sends.
 *
 * ARRAY READ — an empty cohort is 200 + [], NEVER 404. The 404-on-null rule in gex.routes.ts
 * exists because that endpoint returns a single object; this one returns a list, so it follows
 * the /analytics/cot convention instead (analytics.routes.ts:136-145).
 *
 * Threat mitigations:
 *   errors map to a flat {error:"internal"} — the DB message never reaches the wire.
 *   No user-controlled query input; the output is contract-parsed before send, which also
 *   strips any internal repo field the read port happens to carry.
 *
 * MCP-02: chainResponse is the single schema source shared by this route and any chain MCP
 *   tool. A one-sided field change fails `bun run typecheck` — but ONLY because of the
 *   `body: ChainResponse` annotation below. `chainResponse.parse(result.value)` on its own
 *   type-checks no matter how far the core `ChainEntry` type and this schema have drifted,
 *   because `.parse()` accepts `unknown`; the mismatch would then surface as a 500 on the
 *   first real request instead of at build time. The annotation is the ONLY compile-time link
 *   between the two, which are mirrored by hand in separate packages because `packages/contracts`
 *   may not import `packages/core`. Verified by probe: renaming a field on one side alone fails
 *   typecheck at the annotation. Three sibling seams (picker candidate, picker snapshot, ad-hoc
 *   analyze) still lack this and are knowingly left alone — they belong to the picker context,
 *   which is scheduled for deletion.
 *
 * Mount: in main.ts inside the CHAINED apiRouter builder (`.route("/", chainRoutes(getChain))`),
 *   so the effective path is GET /api/chain. The chained form is required for hc<AppType>() RPC
 *   inference — sequential app.route() statements break it (main.ts:603-606).
 */
export function chainRoutes(getChain: ForRunningGetChain) {
  const router = new Hono();

  router.get("/chain", async (c) => {
    const result = await getChain();

    if (!result.ok) {
      // Flat error — never expose DB internals.
      return c.json({ error: "internal" }, 500);
    }

    // Empty cohort on no data — never an error (array-read convention).
    // The annotation is load-bearing, not decoration: it reconciles the core row type against
    // the contract's inferred type at build time. The spread copies ReadonlyArray → the mutable
    // array the inferred type wants; no field mapping happens, because the use-case already
    // hands over wire-shaped rows.
    const body: ChainResponse = [...result.value];
    return c.json(chainResponse.parse(body));
  });

  return router;
}
