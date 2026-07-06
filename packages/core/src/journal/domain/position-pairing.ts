/**
 * position-pairing.ts — group raw open positions into calendar spread candidates
 * (register-open-calendars, JRNL auto-registration).
 *
 * Ported from apps/web/src/lib/pair-calendars.ts's `pairPositionsIntoCalendars`: same
 * grouping key (underlyingSymbol + parsed strike + type — root-agnostic) and the same
 * front(near)/back(far) split by expiry. This copy operates on the minimal PositionLeg
 * shape (not @morai/contracts' BrokerPositionResponse) so packages/core stays free of the
 * contracts dependency (architecture-boundaries §2: core imports only @morai/shared); the
 * web copy keeps its own P&L-oriented fields for the Positions UI and is not touched here.
 *
 * Keying on underlyingSymbol (not OCC root) is required for a real calendar spread whose
 * front leg is SPX-rooted (standard monthly expiry) and back leg is SPXW-rooted (weekly) —
 * both share the same underlyingSymbol ("$SPX") even though their OCC roots differ.
 */
import { assertDefined, parseOccSymbol } from "@morai/shared";

export type PositionLeg = {
  readonly occSymbol: string;
  readonly underlyingSymbol: string;
  readonly longQty: number;
  readonly shortQty: number;
  readonly averagePrice: number | null;
};

export type CalendarCandidate = {
  readonly underlyingSymbol: string;
  readonly strike: number; // points (not ×1000)
  readonly optionType: "C" | "P";
  readonly frontRoot: string; // front leg's OCC root ("SPX" | "SPXW")
  readonly front: PositionLeg;
  readonly back: PositionLeg;
  readonly frontExpiry: string; // YYYY-MM-DD
  readonly backExpiry: string; // YYYY-MM-DD
};

/** Format a parsed OCC expiry (local-midnight Date, see shared/occ-symbol.ts) as YYYY-MM-DD. */
function toYmd(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

/**
 * pairPositionsIntoCalendarCandidates — group legs by (underlyingSymbol, strike, type),
 * sort by expiry, pair sequentially (front = nearer, back = farther). A group with fewer
 * than 2 legs, or a leftover single leg after pairing, is not a calendar and is dropped —
 * registerOpenCalendars only registers real two-leg spreads.
 */
export function pairPositionsIntoCalendarCandidates(
  positions: ReadonlyArray<PositionLeg>,
): ReadonlyArray<CalendarCandidate> {
  type Entry = { readonly leg: PositionLeg; readonly strike: number; readonly type: "C" | "P"; readonly root: string; readonly expiry: Date };

  const groups = new Map<string, Entry[]>();

  for (const pos of positions) {
    const parsed = parseOccSymbol(pos.occSymbol);
    if (!parsed.ok) continue; // unparseable → cannot pair
    const entry: Entry = {
      leg: pos,
      strike: parsed.value.strike,
      type: parsed.value.type,
      root: parsed.value.root,
      expiry: parsed.value.expiry,
    };
    const key = `${pos.underlyingSymbol}|${entry.strike}|${entry.type}`;
    const bucket = groups.get(key);
    if (bucket === undefined) groups.set(key, [entry]);
    else bucket.push(entry);
  }

  const candidates: CalendarCandidate[] = [];

  for (const entries of groups.values()) {
    if (entries.length < 2) continue; // odd leg out — not a calendar

    const sorted = [...entries].sort((a, b) => a.expiry.getTime() - b.expiry.getTime());

    let i = 0;
    for (; i + 1 < sorted.length; i += 2) {
      const frontEntry = sorted[i];
      const backEntry = sorted[i + 1];
      assertDefined(frontEntry, "front entry in bounds");
      assertDefined(backEntry, "back entry in bounds");

      candidates.push({
        underlyingSymbol: frontEntry.leg.underlyingSymbol,
        strike: frontEntry.strike,
        optionType: frontEntry.type,
        frontRoot: frontEntry.root,
        front: frontEntry.leg,
        back: backEntry.leg,
        frontExpiry: toYmd(frontEntry.expiry),
        backExpiry: toYmd(backEntry.expiry),
      });
    }
    // Leftover odd leg (entries.length was odd) — not a calendar, dropped.
  }

  return candidates;
}
