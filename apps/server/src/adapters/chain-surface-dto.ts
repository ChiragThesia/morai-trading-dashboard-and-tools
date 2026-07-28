/**
 * chain-surface-dto.ts — the priced chain's two seam mappings, shared by its HTTP route and its
 * MCP tool so neither adapter carries logic of its own (architecture-boundaries §3).
 *
 * Same job as calendar-rank-dto.ts: core carries a `Date`, the wire contract carries an ISO
 * string, and handing the raw payload to `.parse()` throws (Date != string). Everything else on
 * `ChainSurface` is already JSON-primitive, so this is a one-field conversion plus the array
 * copies core's ReadonlyArrays need to satisfy the inferred contract type.
 *
 * The `body: PricedChainResponse` annotation is deliberate and load-bearing: it is the ONLY
 * compile-time link between the core surface type and the hand-mirrored Zod schema. Parsing an
 * `unknown` would type-check no matter how far the two drifted, and the mismatch would surface as
 * a 500 on the first real request instead of at build time.
 */

import { pricedChainResponse } from "@morai/contracts";
import type { PricedChainQuery, PricedChainResponse } from "@morai/contracts";
import type { ChainSurface, PriceChainRequest } from "@morai/core";

/**
 * Map validated query params to the use-case request.
 *
 * An absent param is OMITTED rather than passed as `undefined` — exactOptionalPropertyTypes
 * forbids the assignment, and `{ contractType: undefined }` would also override the use-case's
 * own default in any callee that tests key presence.
 */
export function toPriceChainRequest(query: PricedChainQuery): PriceChainRequest {
  return {
    ...(query.contractType === undefined ? {} : { contractType: query.contractType }),
  };
}

/** Map the core surface to the validated wire body (asOf Date → ISO string). */
export function toPricedChainBody(surface: ChainSurface): PricedChainResponse {
  const body: PricedChainResponse = {
    ...surface,
    asOf: surface.asOf.toISOString(),
    cohorts: surface.cohorts.map((c) => ({ ...c, strikes: [...c.strikes] })),
  };
  return pricedChainResponse.parse(body);
}
