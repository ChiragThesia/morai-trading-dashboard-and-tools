// Composition root — server.
// Wires config → adapters → use-cases → Hono routes + MCP transport.
// Full wiring lands in plans 03/04.
import { ok, type Result } from "@morai/core";

// Prove cross-package import chain: apps/server → @morai/core → @morai/shared
const _proof: Result<string, never> = ok("scaffold");

console.warn("morai server scaffold loaded");
