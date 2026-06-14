import { z } from "zod";

// Typed-empty schemas for analytics MCP tools (plan 07 Phase 6 tools).
// These always return { observations: [] } — never an error (SPEC §7).
// Shape is deliberately minimal; actual analytics live in a future phase.

export const termStructureResponse = z.object({
  observations: z.array(z.unknown()),
});

export type TermStructureResponse = z.infer<typeof termStructureResponse>;

export const skewResponse = z.object({
  observations: z.array(z.unknown()),
});

export type SkewResponse = z.infer<typeof skewResponse>;
