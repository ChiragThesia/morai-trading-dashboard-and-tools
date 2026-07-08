/**
 * isNyseHoliday — pure NYSE full-closure holiday gate.
 *
 * Returns true when `now` falls on a day the NYSE is fully closed (not merely
 * an early-close / half-day). Weekend handling belongs to isWithinRth, not here.
 *
 * Implementation notes:
 * - Pure data module: NO imports (architecture-boundaries.md §2).
 * - Uses Intl.DateTimeFormat with timeZone:'America/New_York' — same DST-correct
 *   mechanism as isWithinRth() in rth-window.ts.
 * - Holiday list is pre-researched for 2026–2027. Re-research before 2028.
 *   Source: ICE/NYSE official market hours press releases (ir.theice.com).
 *
 * 2026 note: July 4 is a Saturday in 2026. The NYSE observes no substitute holiday.
 * Friday July 3 2026 is an early close (half-day) — v1 treats early closes as normal
 * days per SPEC. Therefore 2026-07-04 and 2026-07-03 are both absent from this set.
 */

/** NYSE full-closure holidays 2026–2027. ISO date strings (YYYY-MM-DD) in ET. */
const NYSE_HOLIDAYS = new Set<string>([
  // 2026 (9 full closures — July 4 is a Saturday, no observance)
  "2026-01-01", // New Year's Day
  "2026-01-19", // Martin Luther King, Jr. Day
  "2026-02-16", // Washington's Birthday
  "2026-04-03", // Good Friday
  "2026-05-25", // Memorial Day
  "2026-06-19", // Juneteenth
  "2026-09-07", // Labor Day
  "2026-11-26", // Thanksgiving Day
  "2026-12-25", // Christmas Day
  // 2027 (9 full closures)
  "2027-01-01", // New Year's Day
  "2027-01-18", // Martin Luther King, Jr. Day
  "2027-02-15", // Washington's Birthday
  "2027-03-26", // Good Friday
  "2027-05-31", // Memorial Day
  "2027-06-18", // Juneteenth (observed)
  "2027-09-06", // Labor Day
  "2027-11-25", // Thanksgiving Day
  "2027-12-24", // Christmas Day (observed)
]);

/**
 * Returns true when the ET date of `now` is a full NYSE-closure holiday.
 *
 * Returns false for weekends (handled by isWithinRth), early-close days, and
 * any date not in the 2026–2027 list.
 * Returns false defensively if Intl parts are missing.
 */
export function isNyseHoliday(now: Date): boolean {
  const fmt = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });

  const parts = fmt.formatToParts(now);

  const year = parts.find((p) => p.type === "year")?.value;
  const month = parts.find((p) => p.type === "month")?.value;
  const day = parts.find((p) => p.type === "day")?.value;

  // Defensive guard — matches rth-window.ts pattern
  if (year === undefined || month === undefined || day === undefined) return false;

  return NYSE_HOLIDAYS.has(`${year}-${month}-${day}`);
}
