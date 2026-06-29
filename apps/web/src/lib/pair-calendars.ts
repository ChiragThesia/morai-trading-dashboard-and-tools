/**
 * pair-calendars — group raw broker option legs into calendar spreads for the Positions view.
 *
 * The broker returns single legs. A calendar = two legs at the same UNDERLYING + strike + type,
 * different expiries (short front / long back). We key on the position's `underlyingSymbol`, NOT
 * the OCC root: a Nov calendar can pair an SPX-rooted standard-expiry front with an SPXW-rooted
 * weekly back — same underlying, different roots (the same SPX/SPXW split that bit the journal).
 *
 * Unrealized P&L per leg mirrors the Positions list formula:
 *   unreal = marketValue − averagePrice · (longQty − shortQty) · 100
 * The calendar's netUnreal sums both legs.
 */
import { assertDefined, parseOccSymbol } from "@morai/shared";
import type { BrokerPositionResponse } from "@morai/contracts";

export type CalendarGroup = {
  /** Stable key: `${underlying}|${strike}|${type}` */
  readonly key: string;
  readonly underlyingSymbol: string;
  readonly strike: number;
  readonly optionType: "C" | "P";
  /** Nearer-expiry leg (front). */
  readonly front: BrokerPositionResponse;
  /** Farther-expiry leg (back). */
  readonly back: BrokerPositionResponse;
  /** Summed unrealized P&L across both legs (null if either leg lacks marks). */
  readonly netUnreal: number | null;
  readonly dteFront: number;
  readonly dteBack: number;
};

export type PairedPositions = {
  readonly calendars: ReadonlyArray<CalendarGroup>;
  /** Legs that did not pair into a calendar (odd one out) — shown as-is. */
  readonly singles: ReadonlyArray<BrokerPositionResponse>;
};

/** Unrealized P&L for one leg, or null when marks are missing. */
export function legUnreal(p: BrokerPositionResponse): number | null {
  if (p.marketValue === null || p.averagePrice === null) return null;
  return p.marketValue - p.averagePrice * (p.longQty - p.shortQty) * 100;
}

/**
 * Total unrealized P&L across the whole book — Σ legUnreal over every leg with marks.
 * This is the header "Book P&L". NOT `marketValue × netQty` (that flips short signs and
 * sums notional magnitude — the bug this replaces).
 */
export function bookUnrealizedPnl(
  positions: ReadonlyArray<BrokerPositionResponse>,
): number {
  let total = 0;
  for (const p of positions) {
    const u = legUnreal(p);
    if (u !== null) total += u;
  }
  return total;
}

/** Whole calendar days from `now` to the leg's expiry. */
function dte(occSymbol: string, now: Date): number {
  const parsed = parseOccSymbol(occSymbol);
  if (!parsed.ok) return 0;
  const ms = parsed.value.expiry.getTime() - now.getTime();
  return Math.max(0, Math.ceil(ms / 86_400_000));
}

/**
 * Pair broker legs into calendar groups. Legs are grouped by (underlyingSymbol, strike, type),
 * sorted by expiry, and paired sequentially (front = nearer, back = farther). A group with a
 * single leg — or a leftover after pairing — falls through to `singles`.
 */
export function pairPositionsIntoCalendars(
  positions: ReadonlyArray<BrokerPositionResponse>,
  now: Date,
): PairedPositions {
  // Group by underlying + strike + type. Strike/type come from the parsed OCC (root-agnostic).
  const groups = new Map<string, BrokerPositionResponse[]>();
  const unparseable: BrokerPositionResponse[] = [];

  for (const pos of positions) {
    const parsed = parseOccSymbol(pos.occSymbol);
    if (!parsed.ok) {
      unparseable.push(pos);
      continue;
    }
    const key = `${pos.underlyingSymbol}|${parsed.value.strike}|${parsed.value.type}`;
    const bucket = groups.get(key);
    if (bucket === undefined) groups.set(key, [pos]);
    else bucket.push(pos);
  }

  const calendars: CalendarGroup[] = [];
  const singles: BrokerPositionResponse[] = [...unparseable];

  for (const [key, legs] of groups) {
    if (legs.length < 2) {
      singles.push(...legs);
      continue;
    }
    // Sort by expiry ascending so consecutive pairs are (front, back).
    const sorted = [...legs].sort(
      (a, b) => dte(a.occSymbol, now) - dte(b.occSymbol, now),
    );
    let i = 0;
    for (; i + 1 < sorted.length; i += 2) {
      const front = sorted[i];
      const back = sorted[i + 1];
      assertDefined(front, "front leg in bounds");
      assertDefined(back, "back leg in bounds");
      const frontParsed = parseOccSymbol(front.occSymbol);
      if (!frontParsed.ok) continue;
      const fu = legUnreal(front);
      const bu = legUnreal(back);
      calendars.push({
        key,
        underlyingSymbol: front.underlyingSymbol,
        strike: frontParsed.value.strike,
        optionType: frontParsed.value.type,
        front,
        back,
        netUnreal: fu === null || bu === null ? null : fu + bu,
        dteFront: dte(front.occSymbol, now),
        dteBack: dte(back.occSymbol, now),
      });
    }
    // Leftover odd leg (length was odd) → single.
    if (i < sorted.length) {
      const leftover = sorted[i];
      assertDefined(leftover, "leftover leg in bounds");
      singles.push(leftover);
    }
  }

  return { calendars, singles };
}
