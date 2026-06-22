import { describe, it, expect } from "vitest";
import { statusResponse } from "./status.ts";

describe("statusResponse schema", () => {
  it("accepts a valid status payload with lastJobRuns:'none yet'", () => {
    const valid = {
      db: "ok",
      tokenFreshness: "none yet",
      lastJobRuns: "none yet",
      version: "1.0.0",
      uptime: 42.5,
    };
    const result = statusResponse.safeParse(valid);
    expect(result.success).toBe(true);
  });

  it("accepts db:'down'", () => {
    const valid = {
      db: "down",
      tokenFreshness: "none yet",
      lastJobRuns: "none yet",
      version: "1.0.0",
      uptime: 0,
    };
    const result = statusResponse.safeParse(valid);
    expect(result.success).toBe(true);
  });

  it("rejects invalid db value", () => {
    const invalid = {
      db: "maybe",
      tokenFreshness: "none yet",
      lastJobRuns: "none yet",
      version: "1.0.0",
      uptime: 0,
    };
    const result = statusResponse.safeParse(invalid);
    expect(result.success).toBe(false);
  });

  it("rejects missing db field", () => {
    const invalid = {
      tokenFreshness: "none yet",
      lastJobRuns: "none yet",
      version: "1.0.0",
      uptime: 0,
    };
    const result = statusResponse.safeParse(invalid);
    expect(result.success).toBe(false);
  });

  it("rejects wrong tokenFreshness value (neither 'none yet' nor a valid map)", () => {
    const invalid = {
      db: "ok",
      tokenFreshness: "fresh",
      lastJobRuns: "none yet",
      version: "1.0.0",
      uptime: 0,
    };
    const result = statusResponse.safeParse(invalid);
    expect(result.success).toBe(false);
  });

  // AUTH-04: per-app tokenFreshness map
  it("accepts tokenFreshness as a per-app freshness map (AUTH-04)", () => {
    const valid = {
      db: "ok",
      tokenFreshness: {
        trader: {
          status: "fresh",
          expiresAt: "2026-06-20T12:30:00.000Z",
          refreshIssuedAt: "2026-06-20T12:00:00.000Z",
          lastRefreshError: null,
        },
        market: {
          status: "AUTH_EXPIRED",
          expiresAt: "2026-06-13T12:30:00.000Z",
          refreshIssuedAt: "2026-06-13T12:00:00.000Z",
          lastRefreshError: null,
        },
      },
      lastJobRuns: "none yet",
      version: "1.0.0",
      uptime: 42.5,
    };
    const result = statusResponse.safeParse(valid);
    expect(result.success).toBe(true);
  });

  it("accepts tokenFreshness with status:'stale'", () => {
    const valid = {
      db: "ok",
      tokenFreshness: {
        trader: {
          status: "stale",
          expiresAt: "2026-06-20T12:00:00.000Z",
          refreshIssuedAt: "2026-06-20T11:00:00.000Z",
          lastRefreshError: null,
        },
        market: {
          status: "none_yet",
          expiresAt: null,
          refreshIssuedAt: null,
          lastRefreshError: null,
        },
      },
      lastJobRuns: "none yet",
      version: "1.0.0",
      uptime: 10,
    };
    const result = statusResponse.safeParse(valid);
    expect(result.success).toBe(true);
  });

  it("rejects tokenFreshness map with invalid status value", () => {
    const invalid = {
      db: "ok",
      tokenFreshness: {
        trader: { status: "expired", expiresAt: null, refreshIssuedAt: null },
        market: { status: "none_yet", expiresAt: null, refreshIssuedAt: null },
      },
      lastJobRuns: "none yet",
      version: "1.0.0",
      uptime: 0,
    };
    const result = statusResponse.safeParse(invalid);
    expect(result.success).toBe(false);
  });

  it("rejects arbitrary string for lastJobRuns", () => {
    const invalid = {
      db: "ok",
      tokenFreshness: "none yet",
      lastJobRuns: "ran at 10:00",
      version: "1.0.0",
      uptime: 0,
    };
    const result = statusResponse.safeParse(invalid);
    expect(result.success).toBe(false);
  });

  // NEW: lastJobRuns as a populated record (D-10)
  it("accepts lastJobRuns as a populated job run record map", () => {
    const valid = {
      db: "ok",
      tokenFreshness: "none yet",
      lastJobRuns: {
        "fetch-cboe-chain": {
          lastSuccessAt: "2026-06-15T14:00:00.000Z",
          lastErrorAt: null,
          lastError: null,
        },
      },
      version: "1.0.0",
      uptime: 42.5,
    };
    const result = statusResponse.safeParse(valid);
    expect(result.success).toBe(true);
  });

  // NEW: partial job run record (some jobs never run)
  it("accepts partial job run record with nulls", () => {
    const valid = {
      db: "ok",
      tokenFreshness: "none yet",
      lastJobRuns: {
        "fetch-cboe-chain": {
          lastSuccessAt: null,
          lastErrorAt: "2026-06-15T14:05:00.000Z",
          lastError: "CBOE returned 503",
        },
        "compute-bsm-greeks": {
          lastSuccessAt: "2026-06-15T14:31:00.000Z",
          lastErrorAt: null,
          lastError: null,
        },
      },
      version: "1.0.0",
      uptime: 100,
    };
    const result = statusResponse.safeParse(valid);
    expect(result.success).toBe(true);
  });

  // NEW: rejects lastJobRuns record with invalid lastSuccessAt (not datetime format)
  it("rejects lastJobRuns record with invalid datetime format", () => {
    const invalid = {
      db: "ok",
      tokenFreshness: "none yet",
      lastJobRuns: {
        "fetch-cboe-chain": {
          lastSuccessAt: "not-a-date",
          lastErrorAt: null,
          lastError: null,
        },
      },
      version: "1.0.0",
      uptime: 0,
    };
    const result = statusResponse.safeParse(invalid);
    expect(result.success).toBe(false);
  });
});
