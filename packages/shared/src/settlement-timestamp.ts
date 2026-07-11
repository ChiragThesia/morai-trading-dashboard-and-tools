/**
 * settlementTimestamp — the exact wall-clock instant an OCC-parsed SPX/SPXW contract's
 * payoff is determined, DST-safe via native Intl. Extends rth-window.ts's ET-reading
 * technique to CONSTRUCT an instant (read the offset in effect, then build the UTC ms)
 * instead of only reading local wall-clock time.
 *
 * Classification reads only root + expiry-date — both already returned by
 * parseOccSymbol — so this introduces zero new data source:
 *   - AM-settled: root "SPX" AND expiry is the exact 3rd Friday of its month →
 *     settlement at 09:30 America/New_York (the SPX Special Opening Quotation window).
 *   - PM-settled (everything else — root "SPXW", or any non-3rd-Friday date) →
 *     settlement at 16:00 America/New_York (market close).
 *
 * [ASSUMED — 34-RESEARCH.md Assumptions Log A1]: the AM anchor (09:30 ET, market open)
 * is this research's best-reasoned inference from settlement mechanics — no cited
 * source pins down the exact BSM T=0 instant for AM-settled options. Flagged below as a
 * single named constant so a future correction is a one-line change.
 */

// A1 [ASSUMED, not cited]: reasoned anchor for AM-settled T=0 — Friday market open,
// the payoff-determining instant, not the Thursday-5pm last-tradeable instant.
const AM_SETTLEMENT_HOUR = 9;
const AM_SETTLEMENT_MINUTE = 30;

const PM_SETTLEMENT_HOUR = 16;
const PM_SETTLEMENT_MINUTE = 0;

// Sane fallback if the Intl offset parse below doesn't match (locale/runtime quirk) —
// degrade to EST rather than throw or produce NaN.
const FALLBACK_NY_OFFSET_HOURS = -5;

function isThirdFriday(year: number, month0: number, day: number): boolean {
  const dow = new Date(Date.UTC(year, month0, day)).getUTCDay(); // date-only, tz-agnostic
  return dow === 5 && day >= 15 && day <= 21;
}

/** UTC offset (hours, negative) actually in effect for America/New_York at this local wall-clock. */
function nyUtcOffsetHours(
  year: number,
  month0: number,
  day: number,
  hour: number,
  minute: number,
): number {
  const guess = new Date(Date.UTC(year, month0, day, hour, minute));
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    timeZoneName: "shortOffset",
  }).formatToParts(guess);
  const tzPart = parts.find((p) => p.type === "timeZoneName")?.value;
  const match = tzPart !== undefined ? /GMT([+-]\d+)/.exec(tzPart) : null;
  return match?.[1] !== undefined ? Number(match[1]) : FALLBACK_NY_OFFSET_HOURS;
}

export function settlementTimestamp(root: string, expiry: Date): Date {
  const year = expiry.getFullYear();
  const month0 = expiry.getMonth();
  const day = expiry.getDate();

  const isAmSettled = root === "SPX" && isThirdFriday(year, month0, day);
  const hour = isAmSettled ? AM_SETTLEMENT_HOUR : PM_SETTLEMENT_HOUR;
  const minute = isAmSettled ? AM_SETTLEMENT_MINUTE : PM_SETTLEMENT_MINUTE;

  const offset = nyUtcOffsetHours(year, month0, day, hour, minute);
  return new Date(Date.UTC(year, month0, day, hour - offset, minute));
}
