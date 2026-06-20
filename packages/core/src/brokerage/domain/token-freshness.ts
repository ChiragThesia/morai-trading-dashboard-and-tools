/**
 * token-freshness.ts — pure brokerage token freshness domain logic.
 *
 * All functions are pure (no I/O, no Date.now(), no side effects).
 * Imports: @morai/shared port types only (architecture-boundaries.md §2).
 *
 * TTLs per RESEARCH.md:
 *  - Access token:  30 minutes (cached in expires_at)
 *  - Refresh token: 7 days hard cutoff from refresh_issued_at (no sliding window)
 *  - Clock-skew buffer: 60 seconds on access token expiry check
 */
import type { SchwabTokenRow, AppTokenStatus } from "../application/ports.ts";

// 7 days in milliseconds
const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000;

// 60-second clock-skew buffer for access token staleness check
const CLOCK_SKEW_BUFFER_MS = 60 * 1000;

/**
 * isTokenExpired — returns true when the refresh token has exceeded the 7-day hard cutoff.
 * A refresh token this old will return invalid_grant on any refresh attempt.
 */
export function isTokenExpired(refreshIssuedAt: Date, now: Date): boolean {
  return now.getTime() - refreshIssuedAt.getTime() > SEVEN_DAYS_MS;
}

/**
 * isTokenStale — returns true when the access token is within or past its expiry
 * window, accounting for a 60-second clock-skew buffer (conservative refresh).
 *
 * expiresAt exactly 30s in the future → true (within 60s buffer → stale)
 * expiresAt exactly 90s in the future → false (beyond 60s buffer → fresh)
 */
export function isTokenStale(expiresAt: Date, now: Date): boolean {
  return now.getTime() > expiresAt.getTime() - CLOCK_SKEW_BUFFER_MS;
}

/**
 * toAppTokenStatus — derive the freshness classification for a single app.
 *
 * Priority:
 * 1. null row → "none_yet"
 * 2. refresh token expired → "AUTH_EXPIRED"
 * 3. access token stale → "stale"
 * 4. otherwise → "fresh"
 */
export function toAppTokenStatus(
  row: SchwabTokenRow | null,
  now: Date,
): AppTokenStatus {
  if (row === null) {
    return { status: "none_yet", expiresAt: null, refreshIssuedAt: null };
  }

  if (isTokenExpired(row.refreshIssuedAt, now)) {
    return {
      status: "AUTH_EXPIRED",
      expiresAt: row.expiresAt,
      refreshIssuedAt: row.refreshIssuedAt,
    };
  }

  if (isTokenStale(row.expiresAt, now)) {
    return {
      status: "stale",
      expiresAt: row.expiresAt,
      refreshIssuedAt: row.refreshIssuedAt,
    };
  }

  return {
    status: "fresh",
    expiresAt: row.expiresAt,
    refreshIssuedAt: row.refreshIssuedAt,
  };
}
