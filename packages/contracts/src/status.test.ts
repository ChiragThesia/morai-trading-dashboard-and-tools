import { describe, it, expect } from "vitest";
import { statusResponse } from "./status.ts";

describe("statusResponse schema", () => {
  it("accepts a valid status payload", () => {
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

  it("rejects wrong lastJobRuns value", () => {
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
});
