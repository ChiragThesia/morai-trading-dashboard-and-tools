/**
 * date-projection.ts — timezone-safe date-projection helpers for the Overview date-picker.
 *
 * Zero-dependency, pure functions, no DOM, no I/O. Turns an `<input type="date">` value into
 * a clamped whole-day `daysForward` integer for the scenario engine (OVW-05, D-01/D-01a).
 *
 * RESEARCH Pitfall 1 (the CBOE-UTC bug class this project has hit twice, inverted direction):
 * `new Date(string)` parses a bare YYYY-MM-DD string as UTC midnight, which drifts a day in
 * negative-UTC-offset timezones. Every date here is constructed via the LOCAL-timezone
 * `new Date(y, m - 1, d)` constructor instead.
 */

/** Local YYYY-MM-DD string for a Date (input value / min / max attr). */
export function toDateInputValue(d: Date): string {
  const year = String(d.getFullYear()).padStart(4, "0");
  const month = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

/**
 * Parse a `YYYY-MM-DD` string as a LOCAL midnight Date via the local-timezone
 * `new Date(y, m - 1, d)` constructor — never `new Date(string)`, which parses as UTC
 * midnight and is the documented drift source (RESEARCH Pitfall 1).
 * Returns `null` for empty/malformed input (never `Invalid Date`, never a thrown error).
 */
export function parseLocalDateInput(value: string): Date | null {
  const parts = value.split("-");
  if (parts.length !== 3) return null;

  const [yearStr, monthStr, dayStr] = parts;
  const year = Number(yearStr);
  const month = Number(monthStr);
  const day = Number(dayStr);

  if (!Number.isFinite(year) || !Number.isFinite(month) || !Number.isFinite(day)) return null;

  return new Date(year, month - 1, day);
}

/** Whole calendar days between two dates, computed at local midnight. */
export function daysBetween(from: Date, to: Date): number {
  const fromMidnight = new Date(from.getFullYear(), from.getMonth(), from.getDate()).getTime();
  const toMidnight = new Date(to.getFullYear(), to.getMonth(), to.getDate()).getTime();
  return Math.round((toMidnight - fromMidnight) / 86_400_000);
}
