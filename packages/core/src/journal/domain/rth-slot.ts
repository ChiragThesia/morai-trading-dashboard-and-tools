/**
 * roundDownToRthSlot — HIST-05 slot-boundary rounding.
 *
 * Floors a `scheduled`-trigger snapshot instant down to its nominal 30-min RTH slot
 * boundary (09:47 ET -> 09:30 ET slot; 10:14 ET -> 10:00 ET slot), so two near-simultaneous
 * writes for the same nominal slot collapse onto the SAME `calendar_snapshots` composite-PK
 * key (calendar_id, time) and the EXISTING onConflictDoNothing absorbs the duplicate — no new
 * dedup mechanism needed (docs/architecture/jobs.md, HIST-05). Journal-specific 30-min-slot
 * semantics, so this lives in core/journal/domain rather than @morai/shared alongside the
 * generic RTH-membership check (isWithinRth).
 *
 * DST-safe via the SAME "read the Intl-reported UTC offset in effect at this exact instant,
 * then construct the floored instant with it" technique as @morai/shared's
 * settlement-timestamp.ts (its offset-reading helper is private to that module, not part of
 * shared's public surface, so the small helper is copied here rather than reached into).
 * Reading the offset from the instant being floored — instead of guessing — keeps this
 * correct even inside DST fall-back's doubled hour, since every real Date ms value is
 * unambiguous regardless of local wall-clock repetition.
 *
 * Never reads Date.now() — the instant is passed in explicitly (caller-supplies-now idiom,
 * matches @morai/shared's isWithinRth). Pure domain: no I/O.
 */

import { assertDefined } from "@morai/shared";

const SLOT_MINUTES = 30;

// Sane fallback if the Intl offset parse doesn't match (locale/runtime quirk) — degrade to
// EST rather than produce NaN (mirrors @morai/shared's settlement-timestamp.ts).
const FALLBACK_NY_OFFSET_HOURS = -5;

function nyUtcOffsetHours(instant: Date): number {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    timeZoneName: "shortOffset",
  }).formatToParts(instant);
  const tzPart = parts.find((p) => p.type === "timeZoneName")?.value;
  const match = tzPart !== undefined ? /GMT([+-]\d+)/.exec(tzPart) : null;
  return match?.[1] !== undefined ? Number(match[1]) : FALLBACK_NY_OFFSET_HOURS;
}

function wallClockPart(parts: readonly Intl.DateTimeFormatPart[], type: string): number {
  const found = parts.find((p) => p.type === type)?.value;
  assertDefined(found, `roundDownToRthSlot: Intl part "${type}" missing for America/New_York`);
  return Number(found);
}

export function roundDownToRthSlot(instant: Date): Date {
  const fmt = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    year: "numeric",
    month: "numeric",
    day: "numeric",
    hour: "numeric",
    minute: "numeric",
    hour12: false,
  });
  const parts = fmt.formatToParts(instant);

  const year = wallClockPart(parts, "year");
  const month0 = wallClockPart(parts, "month") - 1;
  const day = wallClockPart(parts, "day");
  const rawHour = wallClockPart(parts, "hour");
  const hour = rawHour === 24 ? 0 : rawHour; // hour12:false can report "24" at midnight
  const minute = wallClockPart(parts, "minute");

  const flooredMinute = minute - (minute % SLOT_MINUTES);
  const offset = nyUtcOffsetHours(instant);

  return new Date(Date.UTC(year, month0, day, hour - offset, flooredMinute));
}
