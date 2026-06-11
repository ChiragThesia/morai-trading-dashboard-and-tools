import { z } from "zod";

// MCP-02: ONE schema source for both the HTTP route and the MCP tool.
// Both adapters import this; a one-sided change fails typecheck.

// Per-job last-run record (D-10): success timestamp, error timestamp, error message.
// All fields nullable — a job may have succeeded but never failed, or vice versa.
export const jobRunRecord = z.object({
  lastSuccessAt: z.string().datetime().nullable(),
  lastErrorAt: z.string().datetime().nullable(),
  lastError: z.string().nullable(),
});

export type JobRunRecord = z.infer<typeof jobRunRecord>;

export const statusResponse = z.object({
  db: z.enum(["ok", "down"]),
  tokenFreshness: z.literal("none yet"),
  // lastJobRuns: "none yet" on first deploy (Pitfall 6), or a map of job-name → run record
  lastJobRuns: z.union([
    z.literal("none yet"),
    z.record(z.string(), jobRunRecord),
  ]),
  version: z.string(),
  uptime: z.number(),
});

export type StatusResponse = z.infer<typeof statusResponse>;
