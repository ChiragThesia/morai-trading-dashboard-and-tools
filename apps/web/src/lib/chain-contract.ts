/**
 * Chain row contract — the shape `GET /api/chain` returns.
 *
 * A re-export of the canonical schema in `packages/contracts/src/chain.ts`. This module
 * exists only so every Analyzer consumer has one import path; the schema itself is shared
 * with the HTTP route and the `get_chain` MCP tool, so a one-sided field rename fails
 * `bun run typecheck` rather than drifting.
 *
 * Units: `strike` is ×1000 (divide to display), `bsmIv` is a decimal (0.1249 = 12.49%),
 * `observedAt` is ISO-Z. `bsmIv` is nullable — a missing IV renders as an em dash, never
 * as 0 (project law: never fabricate a number).
 *
 * The response is a BARE ARRAY, not an envelope: an array read has no "missing resource"
 * state, so the endpoint returns `200 []` on an empty chain rather than a 404.
 */
export { chainRow, chainResponse } from "@morai/contracts";
export type { ChainRow, ChainResponse } from "@morai/contracts";
