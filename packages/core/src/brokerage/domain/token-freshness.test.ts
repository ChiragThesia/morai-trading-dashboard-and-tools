import { describe, it, expect } from "vitest";
import { toAppTokenStatus, isTokenExpired, isTokenStale } from "./token-freshness.ts";
import type { SchwabTokenRow } from "../application/ports.ts";

// Helper to build a SchwabTokenRow for a given appId with specified times
function makeRow(
  refreshIssuedAt: Date,
  expiresAt: Date,
): SchwabTokenRow {
  return {
    appId: "trader",
    accessToken: "access-token",
    refreshToken: "refresh-token",
    issuedAt: new Date(expiresAt.getTime() - 30 * 60 * 1000), // 30 min before expiry
    refreshIssuedAt,
    expiresAt,
  };
}

describe("toAppTokenStatus", () => {
  it("returns none_yet when row is null", () => {
    const now = new Date("2026-06-19T12:00:00Z");
    const status = toAppTokenStatus(null, now);
    expect(status.status).toBe("none_yet");
    expect(status.expiresAt).toBeNull();
    expect(status.refreshIssuedAt).toBeNull();
  });

  it("returns AUTH_EXPIRED when refresh token is 8 days old", () => {
    const now = new Date("2026-06-19T12:00:00Z");
    // 8 days ago
    const eightDaysAgo = new Date(now.getTime() - 8 * 24 * 60 * 60 * 1000);
    const expiresAt = new Date(now.getTime() + 60 * 60 * 1000); // 1 hour from now (fresh)
    const row = makeRow(eightDaysAgo, expiresAt);
    const status = toAppTokenStatus(row, now);
    expect(status.status).toBe("AUTH_EXPIRED");
    expect(status.refreshIssuedAt).toEqual(eightDaysAgo);
  });

  it("returns stale when refresh is 1 day old but access token expired 5 min ago", () => {
    const now = new Date("2026-06-19T12:00:00Z");
    const oneDayAgo = new Date(now.getTime() - 1 * 24 * 60 * 60 * 1000);
    // 5 min in the past → stale
    const expiresAt = new Date(now.getTime() - 5 * 60 * 1000);
    const row = makeRow(oneDayAgo, expiresAt);
    const status = toAppTokenStatus(row, now);
    expect(status.status).toBe("stale");
    expect(status.expiresAt).toEqual(expiresAt);
  });

  it("returns fresh when refresh is 1 day old and access token expires 20 min in the future", () => {
    const now = new Date("2026-06-19T12:00:00Z");
    const oneDayAgo = new Date(now.getTime() - 1 * 24 * 60 * 60 * 1000);
    // 20 min in the future → fresh (beyond 60s buffer)
    const expiresAt = new Date(now.getTime() + 20 * 60 * 1000);
    const row = makeRow(oneDayAgo, expiresAt);
    const status = toAppTokenStatus(row, now);
    expect(status.status).toBe("fresh");
    expect(status.expiresAt).toEqual(expiresAt);
  });
});

describe("isTokenStale", () => {
  it("returns true when expiresAt is 30s in the future (within 60s buffer)", () => {
    const now = new Date("2026-06-19T12:00:00Z");
    const expiresAt = new Date(now.getTime() + 30 * 1000); // 30s from now
    expect(isTokenStale(expiresAt, now)).toBe(true);
  });

  it("returns false when expiresAt is 90s in the future (beyond 60s buffer)", () => {
    const now = new Date("2026-06-19T12:00:00Z");
    const expiresAt = new Date(now.getTime() + 90 * 1000); // 90s from now
    expect(isTokenStale(expiresAt, now)).toBe(false);
  });
});

describe("isTokenExpired", () => {
  it("returns false when refresh token is exactly 7 days minus 1 minute old", () => {
    const now = new Date("2026-06-19T12:00:00Z");
    const sevenDaysMinusOneMin = new Date(
      now.getTime() - (7 * 24 * 60 * 60 * 1000 - 60 * 1000),
    );
    expect(isTokenExpired(sevenDaysMinusOneMin, now)).toBe(false);
  });

  it("returns true when refresh token is exactly 7 days plus 1 minute old", () => {
    const now = new Date("2026-06-19T12:00:00Z");
    const sevenDaysPlusOneMin = new Date(
      now.getTime() - (7 * 24 * 60 * 60 * 1000 + 60 * 1000),
    );
    expect(isTokenExpired(sevenDaysPlusOneMin, now)).toBe(true);
  });
});
