/**
 * Settlement-aware time-to-expiry (DTE) domain helpers.
 *
 * D-04: T = minutesToCutoff / MINUTES_PER_YEAR (365.25×24×60 = 525960)
 *
 * Settlement rules:
 *   - SPX 3rd-Friday expiry → AM-settled, cutoff 09:30 ET
 *   - All others (SPXW, SPX non-3rd-Friday) → PM-settled, cutoff 16:00 ET
 *
 * ET offset (no TZ assumption on host):
 *   - EDT (summer): UTC-4  (2nd Sunday March → 1st Sunday November)
 *   - EST (winter): UTC-5
 *
 * Pure domain: no I/O, no Date.now(), imports nothing outside packages/shared (none needed).
 */

// ─── Constants ────────────────────────────────────────────────
const MINUTES_PER_YEAR = 365.25 * 24 * 60; // 525960

// ─── DST helpers ──────────────────────────────────────────────

/**
 * Return the UTC offset for Eastern Time on a given UTC date (in hours, negative west).
 * EDT = UTC-4 (2nd Sunday March → 1st Sunday November)
 * EST = UTC-5 otherwise.
 *
 * Uses the US DST rules: spring forward 2nd Sunday in March, fall back 1st Sunday in November.
 * Times in ET: transitions happen at 02:00 ET (07:00 UTC for EST, 06:00 UTC for EDT).
 */
function etUtcOffsetHours(utcDate: Date): number {
  const year = utcDate.getUTCFullYear();

  // 2nd Sunday of March (spring forward: at 02:00 ET = 07:00 UTC, clocks go to 03:00 EDT)
  const springForward = nthSundayUtc(year, 2 /* March */, 2);
  springForward.setUTCHours(7, 0, 0, 0); // 02:00 EST = 07:00 UTC

  // 1st Sunday of November (fall back: at 02:00 EDT = 06:00 UTC, clocks go to 01:00 EST)
  const fallBack = nthSundayUtc(year, 10 /* November */, 1);
  fallBack.setUTCHours(6, 0, 0, 0); // 02:00 EDT = 06:00 UTC

  // Between spring forward and fall back → EDT (UTC-4); otherwise EST (UTC-5)
  if (utcDate >= springForward && utcDate < fallBack) {
    return -4;
  }
  return -5;
}

/**
 * Return the Date (midnight UTC) of the Nth Sunday of a given month/year.
 * month: 0 = January, 1 = February, …, 10 = November (JS month convention).
 */
function nthSundayUtc(year: number, month: number, n: number): Date {
  // Find the first Sunday of the month
  const firstOfMonth = new Date(Date.UTC(year, month, 1));
  const dayOfWeek = firstOfMonth.getUTCDay(); // 0=Sun, 6=Sat
  const daysToFirstSunday = dayOfWeek === 0 ? 0 : 7 - dayOfWeek;
  const firstSunday = 1 + daysToFirstSunday;
  // Nth Sunday
  const nthDay = firstSunday + (n - 1) * 7;
  return new Date(Date.UTC(year, month, nthDay));
}

// ─── Public functions ──────────────────────────────────────────

/**
 * calendarDte — integer calendar-day DTE from `now` to `expiry`.
 *
 * Uses UTC-floored calendar days: both dates are snapped to midnight UTC before
 * computing the difference, so the result is stable across timezones and DST
 * transitions (no local-time drift).
 *
 * Clamped at 0 — never returns a negative value for expired dates.
 *
 * This is the integer DTE the snapshot's dteFront/dteBack columns use.
 * For the BSM year-fraction T use computeT instead.
 *
 * @param now    - Current wall-clock time (injected; never call Date.now() here)
 * @param expiry - Option expiry date
 * @returns integer calendar days until expiry, ≥ 0
 */
export function calendarDte(now: Date, expiry: Date): number {
  const nowMs = Date.UTC(
    now.getUTCFullYear(),
    now.getUTCMonth(),
    now.getUTCDate(),
  );
  const expiryMs = Date.UTC(
    expiry.getUTCFullYear(),
    expiry.getUTCMonth(),
    expiry.getUTCDate(),
  );
  return Math.max(0, Math.floor((expiryMs - nowMs) / 86_400_000));
}

/**
 * isThirdFriday — true if `d` is the 3rd Friday of its calendar month.
 *
 * Definition: the first Friday on or after the 15th of the month.
 * Equivalently: a Friday whose day-of-month is in [15, 21].
 *
 * Uses the UTC date components of `d` so the result is consistent across
 * server timezones. Expiry dates are constructed with Date.UTC (WR-05 fix).
 */
export function isThirdFriday(d: Date): boolean {
  // 5 = Friday in JS getUTCDay()
  if (d.getUTCDay() !== 5) return false;
  const dom = d.getUTCDate();
  return dom >= 15 && dom <= 21;
}

/**
 * computeT — settlement-aware time to expiry in years (BSM T).
 *
 * @param now    - Current wall-clock time (injected; never call Date.now() here)
 * @param expiry - Option expiry date (UTC midnight; UTC components equal the calendar date)
 * @param root   - 'SPX' or 'SPXW'
 * @returns T in years = minutesToCutoff / 525960, always ≥ 0
 */
export function computeT(
  now: Date,
  expiry: Date,
  root: "SPX" | "SPXW",
): number {
  // Determine settlement: AM-settled only when root=SPX AND 3rd-Friday expiry
  const isAmSettled = root === "SPX" && isThirdFriday(expiry);

  // Build the ET cutoff UTC instant for the expiry date.
  // Expiry is constructed with Date.UTC (WR-05), so UTC components equal the
  // calendar date. Use UTC accessors for consistency across server timezones.
  const year = expiry.getUTCFullYear();
  const month = expiry.getUTCMonth();
  const day = expiry.getUTCDate();

  // Cutoff time in ET: 09:30 AM or 16:00 PM
  const cutoffHourEt = isAmSettled ? 9 : 16;
  const cutoffMinEt = isAmSettled ? 30 : 0;

  // Build a UTC Date for noon on the expiry day to determine the ET offset.
  // (Noon ET on any trading day is unambiguously in either EDT or EST.)
  const noonUtcOnExpiry = new Date(Date.UTC(year, month, day, 17, 0, 0)); // 17:00 UTC ≈ 12-13 ET
  const etOffset = etUtcOffsetHours(noonUtcOnExpiry);

  // Convert cutoff ET time to UTC hours
  const cutoffUtcHour = cutoffHourEt - etOffset; // e.g. 16 - (-4) = 20 in EDT
  const cutoffUtcMinute = cutoffMinEt;

  // Build the exact UTC instant of the cutoff
  const cutoffUtc = new Date(
    Date.UTC(year, month, day, cutoffUtcHour, cutoffUtcMinute, 0, 0),
  );

  // Minutes remaining until cutoff
  const msRemaining = cutoffUtc.getTime() - now.getTime();
  const minutesRemaining = msRemaining / 60000;

  return Math.max(0, minutesRemaining) / MINUTES_PER_YEAR;
}
