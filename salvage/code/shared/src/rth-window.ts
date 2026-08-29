/**
 * isWithinRth — pure RTH gate for the US equity market.
 *
 * Returns true when `now` falls within Regular Trading Hours:
 *   - Monday–Friday only (weekdays 1–5 in Intl weekday 1=Mon…7=Sun)
 *   - 09:30–16:00 ET inclusive (Eastern Time; IANA zone America/New_York)
 *
 * Implementation notes:
 * - Uses Intl.DateTimeFormat with timeZone:'America/New_York' to extract local
 *   weekday/hour/minute — the IANA zone handles EST↔EDT transitions correctly.
 * - Never reads Date.now() — accepts `now` explicitly for testability/purity.
 * - No imports from outside @morai/shared (architecture-boundaries.md §2).
 */
export function isWithinRth(now: Date): boolean {
  const fmt = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    hour: "numeric",
    minute: "numeric",
    weekday: "short",
    hour12: false,
  });

  const parts = fmt.formatToParts(now);

  const weekdayPart = parts.find((p) => p.type === "weekday");
  const hourPart = parts.find((p) => p.type === "hour");
  const minutePart = parts.find((p) => p.type === "minute");

  if (
    weekdayPart === undefined ||
    hourPart === undefined ||
    minutePart === undefined
  ) {
    return false;
  }

  // Intl "short" weekday in en-US: "Sun","Mon","Tue","Wed","Thu","Fri","Sat"
  const weekday = weekdayPart.value;
  if (
    weekday === "Sat" ||
    weekday === "Sun"
  ) {
    return false;
  }

  // Intl hour12:false produces "00"–"23"; "24" possible at midnight in some locales
  const hour = parseInt(hourPart.value, 10);
  const minute = parseInt(minutePart.value, 10);

  // Total minutes since midnight ET
  const totalMinutes = hour * 60 + minute;

  // RTH: 09:30 (570 min) to 16:00 (960 min) inclusive
  const openMinutes = 9 * 60 + 30; // 570
  const closeMinutes = 16 * 60; // 960

  return totalMinutes >= openMinutes && totalMinutes <= closeMinutes;
}
