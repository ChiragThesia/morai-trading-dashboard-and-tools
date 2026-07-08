/**
 * candidate-selection — the delta-targeted OTM-put calendar universe (Phase 19, Plan 03).
 *
 * Port + generalize (D-07) of the mockup's front/back-expiry strike loop into a
 * delta-targeted selection (D-01) over a live chain: for each front expiry in the DTE window,
 * for each delta rung (ATM/-0.30/-0.20/-0.10), find the strike whose put delta is nearest that
 * rung (`nearestStrikeByDelta`), pair it with the nearest qualifying back expiry at the SAME
 * strike (a calendar spread), price both legs via `@morai/quant`, drop non-positive-theta
 * pairs (criterion 6), and flag the economic events each leg spans (D-10).
 *
 * Strike-unit conversion boundary (Pitfall 1): `ChainQuoteForPicker.strike` is the ×1000 int
 * convention. This module converts to points ONCE, at the top of `selectCandidates` — no
 * function below this boundary ever sees the ×1000 form.
 *
 * Dedupe (Pitfall 5): a resolved strike is a pure function of (deltaRung, frontExpiry) via
 * `nearestStrikeByDelta` -- it does not vary by which back expiry is chosen. This module keeps
 * dedupe-by-construction: for a given (deltaRung, frontExpiry) it selects exactly the NEAREST
 * qualifying back expiry (smallest back DTE satisfying the window), rather than emitting one
 * candidate per valid back expiry and deduping after the fact by score (which would require
 * scoring info this module does not have -- scoring is scoring.ts's job).
 *
 * Hexagon law (architecture-boundaries §2): imports only `@morai/quant`, `@morai/shared`, and
 * this bounded context's own `application/ports.ts` (intra-context read, gex.ts precedent) +
 * `./types.ts`. No I/O, no Date-instant construction (Pitfall 3) -- calendar-day arithmetic uses
 * `Date.UTC` (a pure static function, not an instant-construction call) on parsed ISO
 * components, and event-span membership is a plain ISO string-interval compare.
 */

import { assertDefined } from "@morai/shared";
import { bsmGreeks, bsmPrice } from "@morai/quant";
import { isLiquidQuote } from "./rules.ts";
import type { ChainQuoteForPicker, EconomicEvent } from "../application/ports.ts";
import type { DeltaRung, RawCandidate } from "./types.ts";

// ─────────────────────────────────────────────────────────────
// Named constants (D-01/D-02 defaults, Claude's-discretion per 19-CONTEXT.md)
// ─────────────────────────────────────────────────────────────

/** Delta-rung targets (put delta, i.e. negative) -- ATM plus the ~30/20/10-delta OTM rungs. */
export const DELTA_RUNGS: ReadonlyArray<{ readonly label: DeltaRung; readonly targetDelta: number }> = [
  { label: "ATM", targetDelta: -0.5 },
  { label: "30D", targetDelta: -0.3 },
  { label: "20D", targetDelta: -0.2 },
  { label: "10D", targetDelta: -0.1 },
];

/** Front-leg DTE window (mockup default grid, D-02). */
export const FRONT_DTE_MIN = 21;
export const FRONT_DTE_MAX = 36;

/** Back-leg DTE constraints relative to the front leg (mockup default grid, D-02). */
export const BACK_DTE_MIN_GAP = 21;
export const BACK_DTE_MAX = 80;

// ─────────────────────────────────────────────────────────────
// Pure helpers
// ─────────────────────────────────────────────────────────────

/** A chain quote reduced to what delta-targeting/pricing needs, strike already in points. */
export type StrikeIvQuote = {
  readonly strike: number;
  readonly iv: number;
};

/**
 * Find the strike (from a single expiry's put quotes, already in points) whose bsmGreeks put
 * delta is nearest `targetDelta`. Returns null when `quotes` is empty.
 */
export function nearestStrikeByDelta(
  quotes: ReadonlyArray<StrikeIvQuote>,
  spot: number,
  dte: number,
  targetDelta: number,
  r: number,
  q: number,
): StrikeIvQuote | null {
  const t = dte / 365;
  let best: StrikeIvQuote | null = null;
  let bestDiff = Number.POSITIVE_INFINITY;
  for (const quote of quotes) {
    const delta = bsmGreeks(spot, quote.strike, t, quote.iv, r, q, "P").delta;
    const diff = Math.abs(delta - targetDelta);
    if (diff < bestDiff) {
      bestDiff = diff;
      best = quote;
    }
  }
  return best;
}

/**
 * Convert a YYYY-MM-DD ISO calendar date into a day-number (days since the Unix epoch), via
 * `Date.UTC` on the parsed components -- never a Date-instant constructor call
 * (Pitfall 3: no timezone-crossing Date-object arithmetic).
 */
function isoDayNumber(iso: string): number {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  assertDefined(match, `isoDayNumber: malformed ISO date "${iso}"`);
  const [, y, m, d] = match;
  assertDefined(y, "isoDayNumber: year component");
  assertDefined(m, "isoDayNumber: month component");
  assertDefined(d, "isoDayNumber: day component");
  return Date.UTC(Number(y), Number(m) - 1, Number(d)) / 86_400_000;
}

/** Days between two ISO calendar dates (`to` minus `from`), via calendar-day arithmetic. */
function daysBetween(fromIso: string, toIso: string): number {
  return isoDayNumber(toIso) - isoDayNumber(fromIso);
}

/**
 * A leg "spans" an event iff the event's ISO date falls in `(todayIso, legExpiryIso]` (D-10).
 * Pure ISO YYYY-MM-DD string-interval membership -- no Date-object arithmetic (Pitfall 3).
 */
export function legSpansEvents(
  legExpiryIso: string,
  todayIso: string,
  events: ReadonlyArray<EconomicEvent>,
): ReadonlyArray<string> {
  return events.filter((ev) => todayIso < ev.date && ev.date <= legExpiryIso).map((ev) => ev.name);
}

// ─────────────────────────────────────────────────────────────
// selectCandidates
// ─────────────────────────────────────────────────────────────

export type SelectCandidatesParams = {
  /** Risk-free rate (decimal), supplied by the use-case from config. */
  readonly r: number;
  /** Continuous dividend yield (decimal), supplied by the use-case from config. */
  readonly q: number;
};

/** Per-gate drop counts — logged by the use-case so gating is never a silent cap. */
export type GateDrops = {
  /** Quotes excluded by the `liquidity` gate (spread/OI — rules.ts). */
  readonly liquidity: number;
  /** Candidate pairs dropped by the `net-theta-positive` gate (criterion 6). */
  readonly netTheta: number;
};

export type SelectCandidatesResult = {
  readonly candidates: ReadonlyArray<RawCandidate>;
  readonly gateDrops: GateDrops;
};

/**
 * Build the delta-targeted OTM-put calendar universe over a chain cohort.
 *
 * Steps (per the module doc comment): convert strikes ×1000->points once; resolve cohort
 * spot (average underlyingPrice) and asOf (latest quote time, snapped to its UTC calendar
 * day) from the cohort; for each front expiry in [FRONT_DTE_MIN,FRONT_DTE_MAX] and each delta
 * rung, resolve the nearest-delta strike; pair with the NEAREST qualifying back expiry at the
 * same strike; price both legs via @morai/quant; drop net-theta<=0 pairs (criterion 6); flag
 * event spans (D-10). Returns [] for an empty or all-unusable chain -- never throws.
 */
export function selectCandidates(
  chain: ReadonlyArray<ChainQuoteForPicker>,
  events: ReadonlyArray<EconomicEvent>,
  params: SelectCandidatesParams,
): SelectCandidatesResult {
  if (chain.length === 0) {
    return { candidates: [], gateDrops: { liquidity: 0, netTheta: 0 } };
  }

  const { r, q } = params;
  let liquidityDrops = 0;
  let netThetaDrops = 0;

  // Cohort spot: average underlyingPrice across the whole cohort (GEX precedent).
  const spot = chain.reduce((sum, quote) => sum + quote.underlyingPrice, 0) / chain.length;

  // Cohort asOf: the latest quote time, taken as its UTC calendar day. `.time` is already a
  // real Date instance from the port -- calling a method on it is not a Date construction.
  const latestTime = chain.reduce<Date | undefined>((max, quote) => {
    if (max === undefined) return quote.time;
    return quote.time.getTime() > max.getTime() ? quote.time : max;
  }, undefined);
  assertDefined(latestTime, "selectCandidates: latestTime (chain is non-empty)");
  const asOfIso = latestTime.toISOString().slice(0, 10);

  // Convert ×1000 -> points ONCE (Pitfall 1); puts only (D-01); skip null/non-finite iv;
  // liquidity gate (rules.ts): a leg quote with a wide market or thin OI never enters the
  // universe — an untradeable leg produces fictional debits/breakevens. Drops are counted.
  type PointsQuote = { readonly strike: number; readonly expiration: string; readonly iv: number };
  const putQuotes: PointsQuote[] = [];
  for (const quote of chain) {
    if (quote.contractType !== "P") continue;
    if (quote.bsmIv === null) continue;
    const iv = Number(quote.bsmIv);
    if (!Number.isFinite(iv)) continue;
    if (!isLiquidQuote(quote)) {
      liquidityDrops += 1;
      continue;
    }
    putQuotes.push({ strike: quote.strike / 1000, expiration: quote.expiration, iv });
  }
  if (putQuotes.length === 0) {
    return { candidates: [], gateDrops: { liquidity: liquidityDrops, netTheta: 0 } };
  }

  const byExpiry = new Map<string, PointsQuote[]>();
  for (const quote of putQuotes) {
    const bucket = byExpiry.get(quote.expiration);
    if (bucket === undefined) {
      byExpiry.set(quote.expiration, [quote]);
    } else {
      bucket.push(quote);
    }
  }
  const expiries = [...byExpiry.keys()];

  const candidates: RawCandidate[] = [];

  for (const fe of expiries) {
    const tf = daysBetween(asOfIso, fe);
    if (tf < FRONT_DTE_MIN || tf > FRONT_DTE_MAX) continue;

    const frontQuotesRaw = byExpiry.get(fe);
    assertDefined(frontQuotesRaw, "selectCandidates: frontQuotesRaw (fe came from byExpiry.keys())");
    const frontQuotes = frontQuotesRaw;

    for (const rung of DELTA_RUNGS) {
      const frontPick = nearestStrikeByDelta(frontQuotes, spot, tf, rung.targetDelta, r, q);
      if (frontPick === null) continue;
      const K = frontPick.strike;
      const ivF = frontPick.iv;

      // Find every qualifying back expiry at the SAME strike K, then keep the nearest one
      // (dedupe-by-construction, Pitfall 5 -- see module doc comment).
      let chosen: { readonly be: string; readonly tb: number; readonly ivB: number } | null = null;
      for (const be of expiries) {
        const tb = daysBetween(asOfIso, be);
        if (tb - tf < BACK_DTE_MIN_GAP) continue;
        if (tb > BACK_DTE_MAX) continue;
        const backQuotes = byExpiry.get(be);
        assertDefined(backQuotes, "selectCandidates: backQuotes (be came from byExpiry.keys())");
        const backAtK = backQuotes.find((quote) => quote.strike === K);
        if (backAtK === undefined) continue;
        if (chosen === null || tb < chosen.tb) {
          chosen = { be, tb, ivB: backAtK.iv };
        }
      }
      if (chosen === null) continue;
      const { be, tb, ivB } = chosen;

      const gF = bsmGreeks(spot, K, tf / 365, ivF, r, q, "P");
      const gB = bsmGreeks(spot, K, tb / 365, ivB, r, q, "P");
      const theta = (gB.theta - gF.theta) * 100;
      if (theta <= 0) {
        // Gate `net-theta-positive` (criterion 6) — counted, never silent.
        netThetaDrops += 1;
        continue;
      }

      const vega = (gB.vega - gF.vega) * 100;
      const delta = (gB.delta - gF.delta) * 100;

      const priceF = bsmPrice(spot, K, tf / 365, ivF, r, q, "P");
      const priceB = bsmPrice(spot, K, tb / 365, ivB, r, q, "P");
      const debit = (priceB - priceF) * 100;

      const slope = ((ivB - ivF) / (tb - tf)) * 365;

      const frontEvents = legSpansEvents(fe, asOfIso, events);
      const backEventsAll = legSpansEvents(be, asOfIso, events);
      const backEvents = backEventsAll.filter((name) => !frontEvents.includes(name));

      candidates.push({
        // WR-04: include the delta rung -- a resolved strike is a pure function of (rung,
        // frontExpiry), but a sparse chain can make TWO DIFFERENT rungs resolve to the SAME
        // strike for the same front expiry, which would otherwise collide on `${K}-${fe}-${be}`
        // (React key collision + combined-book double-toggle downstream).
        id: `${rung.label}-${K}-${fe}-${be}`,
        name: `${K}P ${fe} / ${be}`,
        frontLeg: { strike: K, putCall: "P", expiration: fe, dte: tf, iv: ivF },
        backLeg: { strike: K, putCall: "P", expiration: be, dte: tb, iv: ivB },
        deltaRung: rung.label,
        spot,
        theta,
        vega,
        delta,
        debit,
        slope,
        frontEvents,
        backEvents,
      });
    }
  }

  return { candidates, gateDrops: { liquidity: liquidityDrops, netTheta: netThetaDrops } };
}
