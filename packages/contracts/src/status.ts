import { z } from "zod";

// MCP-02: ONE schema source for both the HTTP route and the MCP tool.
// Both adapters import this; a one-sided change fails typecheck.
export const statusResponse = z.object({
  db: z.enum(["ok", "down"]),
  tokenFreshness: z.literal("none yet"),
  lastJobRuns: z.literal("none yet"),
  version: z.string(),
  uptime: z.number(),
});

export type StatusResponse = z.infer<typeof statusResponse>;
