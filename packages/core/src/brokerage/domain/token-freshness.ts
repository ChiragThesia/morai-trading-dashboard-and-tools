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

// D-14: proactive refresh-token expiry warning constants.
// REFRESH_TTL_MS = 7 days; WARN_THRESHOLD_MS = 1 day.
// Warning fires when age >= REFRESH_TTL_MS - WARN_THRESHOLD_MS (i.e., >= 6 days).
// Pitfall 3: refreshIssuedAt is never reset on access-token rotation — clock anchored to first auth.
const WARN_THRESHOLD_MS = 1 * 24 * 60 * 60 * 1000; // 1 day

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
 * isNearExpiry — returns true when the refresh token is within the proactive warning window.
 *
 * Warning threshold: 1 day before the hard 7-day expiry → true when age >= 6 days.
 * Pure function: no I/O, clock injected as `now` parameter.
 * Pitfall 3: refreshIssuedAt is NEVER reset on access-token rotation — the 7-day window
 * is anchored to the first authorization_code grant, not to subsequent refresh operations.
 */
export function isNearExpiry(refreshIssuedAt: Date, now: Date): boolean {
  const ageMs = now.getTime() - refreshIssuedAt.getTime();
  return ageMs >= SEVEN_DAYS_MS - WARN_THRESHOLD_MS;
}

/**
 * refreshExpiresInSeconds — seconds remaining until the 7-day refresh-token
 * hard cutoff, non-null only inside the proactive warning window (T-24h).
 *
 * Returns null when NOT isNearExpiry (the field IS the alert signal, not a
 * general countdown). Returns a non-negative integer of seconds inside the
 * window; clamps to 0 once the cutoff has already passed.
 * Pure function: no I/O, clock injected as `now` parameter.
 */
export function refreshExpiresInSeconds(refreshIssuedAt: Date, now: Date): number | null {
  if (!isNearExpiry(refreshIssuedAt, now)) return null;
  const ageMs = now.getTime() - refreshIssuedAt.getTime();
  return Math.max(0, Math.round((SEVEN_DAYS_MS - ageMs) / 1000));
}

/**
 * toAppTokenStatus — derive the freshness classification for a single app.
 *
 * Priority:
 * 1. null row → "none_yet"
 * 2. refresh token expired → "AUTH_EXPIRED"
 * 3. access token stale → "stale"
 * 4. otherwise → "fresh"
 *
 * lastRefreshError (D-14): passed through from the row; null when no row exists.
 */
export function toAppTokenStatus(
  row: SchwabTokenRow | null,
  now: Date,
): AppTokenStatus {
  if (row === null) {
    return {
      status: "none_yet",
      expiresAt: null,
      refreshIssuedAt: null,
      lastRefreshError: null,
      refreshExpiresIn: null,
    };
  }

  if (isTokenExpired(row.refreshIssuedAt, now)) {
    return {
      status: "AUTH_EXPIRED",
      expiresAt: row.expiresAt,
      refreshIssuedAt: row.refreshIssuedAt,
      lastRefreshError: row.lastRefreshError,
      refreshExpiresIn: refreshExpiresInSeconds(row.refreshIssuedAt, now),
    };
  }

  if (isTokenStale(row.expiresAt, now)) {
    return {
      status: "stale",
      expiresAt: row.expiresAt,
      refreshIssuedAt: row.refreshIssuedAt,
      lastRefreshError: row.lastRefreshError,
      refreshExpiresIn: refreshExpiresInSeconds(row.refreshIssuedAt, now),
    };
  }

  return {
    status: "fresh",
    expiresAt: row.expiresAt,
    refreshIssuedAt: row.refreshIssuedAt,
    lastRefreshError: row.lastRefreshError,
    refreshExpiresIn: refreshExpiresInSeconds(row.refreshIssuedAt, now),
  };
}
