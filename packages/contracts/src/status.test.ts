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

  it("rejects wrong tokenFreshness value", () => {
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
