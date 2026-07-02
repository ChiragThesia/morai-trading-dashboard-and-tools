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

// AUTH-04: per-app token freshness (Phase 4).
// status values match domain AppTokenStatus (core/brokerage/application/ports.ts).
export const appTokenStatus = z.object({
  status: z.enum(["fresh", "stale", "AUTH_EXPIRED", "none_yet"]),
  // ISO datetime strings (Date serialized from core domain type)
  expiresAt: z.string().datetime().nullable(),
  refreshIssuedAt: z.string().datetime().nullable(),
  // D-14 (05-05): per-app refresh failure flag; non-null when last refresh failed
  lastRefreshError: z.string().nullable(),
  // AUTH-05: seconds until the 7-day refresh-token cutoff; non-null only inside
  // the T-24h proactive warning window (a required key — null when far from expiry,
  // never omitted, so the wire shape stays stable).
  refreshExpiresIn: z.number().int().nonnegative().nullable(),
});

export type AppTokenStatus = z.infer<typeof appTokenStatus>;

// TokenFreshnessMap — per-app freshness map for both Schwab apps (D-09)
export const tokenFreshnessMap = z.object({
  trader: appTokenStatus,
  market: appTokenStatus,
});

export type TokenFreshnessMap = z.infer<typeof tokenFreshnessMap>;

export const statusResponse = z.object({
  db: z.enum(["ok", "down"]),
  // AUTH-04: "none yet" before any tokens stored; per-app map once at least one app is set up
  tokenFreshness: z.union([z.literal("none yet"), tokenFreshnessMap]),
  // lastJobRuns: "none yet" on first deploy (Pitfall 6), or a map of job-name → run record
  lastJobRuns: z.union([
    z.literal("none yet"),
    z.record(z.string(), jobRunRecord),
  ]),
  version: z.string(),
  uptime: z.number(),
});

export type StatusResponse = z.infer<typeof statusResponse>;
