/**
 * resolveRootCandidates — HIST-01 root-candidate resolution.
 *
 * `calendars.underlying` stores ONE OCC root for both legs of a calendar, but a real
 * calendar spread's front and back legs can be listed under different roots (e.g. a
 * standard-monthly SPX front + an End-of-Month SPXW back — Cboe: "SPXW is the ticker
 * symbol for SPX Weeklys and SPX End-of-Month options"). This pure, total function
 * returns the ordered root candidates to try for a leg, so every downstream resolution
 * path (contract lookup, mustInclude allowlist) can find the leg under its real root
 * even when it differs from the calendar's stored one.
 *
 * No date-of-week classification here — the calendar's stored root is tried first, then
 * its one sibling; costless over-inclusion at the consuming sites (Set-dedup or
 * try-both query) beats a fragile 3rd-Friday/EOM date heuristic.
 *
 * Pure domain: no I/O, never throws (total function, no Result needed).
 */
export function resolveRootCandidates(underlying: string): ReadonlyArray<"SPX" | "SPXW"> {
  if (underlying === "SPXW") return ["SPXW"]; // unambiguous — no split possible
  return ["SPX", "SPXW"]; // try the calendar's stored root first, then the sibling
}
