/**
 * app-type.assert.ts — typecheck-only assertion that hc<AppType>() compiles (RPC-01 / SC-3).
 *
 * This file is not imported at runtime. It exists solely so `bun run typecheck`
 * verifies that hono/client's typed RPC inference resolves against AppType.
 *
 * If AppType is missing or the routes are not chained (statement-style app.route()
 * calls are not chainable), hc<AppType>() will fail to infer route types and
 * typecheck will report an error here.
 *
 * RESEARCH A5 / Pattern 6: the chained apiRouter in main.ts is what enables this.
 */

import { hc } from "hono/client";
import type { AppType } from "./main.ts";

// Typecheck-only: confirm hc<AppType>() compiles and the result is typed.
// The base URL is a placeholder — this is never called at runtime.
const _client = hc<AppType>("http://localhost:3000");

// Suppress "unused variable" lint error: _ prefix marks it as intentionally unused.
void _client;
