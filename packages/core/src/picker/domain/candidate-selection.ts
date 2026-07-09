/**
 * candidate-selection — the band-scan put-calendar universe (Phase 19 Plan 03, redesigned
 * 2026-07-08 after deep research: scanner-methodology brief + the user's trading-knowledge
 * repo playbook).
 *
 * Universe = MEMBERSHIP band, not delta rungs: every liquid 25-point strike whose front-leg
 * put delta lies in [DELTA_BAND_MIN, DELTA_BAND_MAX] is emitted, for every front expiry in
 * the DTE window, paired with EVERY back expiry in the gap window at the same strike. The
 * previous nearest-delta rung design provably missed strikes whose delta fell between rung
 * targets (the user's real 7450 fill at Δ−0.43 sat between the −0.45 and −0.40 rungs) —
 * commercial screeners use band membership for exactly this reason.
 *
 * Debit realism: candidates are priced from the actual bid/ask with the ORATS 2-leg fill
 * haircut — cross FILL_WIDTH_FRACTION (66%) of each leg's bid-ask width off the natural
 * side — never a BSM-theoretical mid. Ranking on mid overstates edge on wide SPX markets.
 *
 * Hard gates (each counted in gateDrops, never silent):
 *   - liquidity (rules.ts isLiquidQuote): spread ≤10% of mid + OI ≥100 per leg;
 *   - net-theta-positive (criterion 6);
 *   (event handling: a tier-1 event within EVENT_BLACKOUT_DAYS before the front expiry no
 *   longer blocks entry — it stamps exitBeforeIso, the day before the event, which scoring
 *   turns into the hard-close date. gateDrops.eventBlackout stays 0 for contract compat.)
 *
 * Strike-unit conversion boundary (Pitfall 1): `ChainQuoteForPicker.strike` is the ×1000 int
 * convention. This module converts to points ONCE, at the top of `selectCandidates` — no
 * function below this boundary ever sees the ×1000 form.
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

/**
 * Front-leg put-delta membership band (user-locked 2026-07-08 after the 7450 rung-gap miss):
 * every liquid 25-multiple with delta in [min, max] enters the universe. Put deltas are
 * negative, so min = deepest (−0.55, just past ATM) and max = furthest OTM edge (−0.25).
 */
export const DELTA_BAND_MIN = -0.49;
export const DELTA_BAND_MAX = -0.3;

// 25-multiple filter RETIRED 2026-07-09 (user: "25s is where I see OI — if you see OI and
// volume elsewhere consider that too"): the liquidity gate (OI + spread) is the real
// criterion; any strike passing it enters the universe.

/** Front-leg DTE window (mockup default grid, D-02). */
export const FRONT_DTE_MIN = 21;
export const FRONT_DTE_MAX = 36;

/**
 * Back-leg gap window relative to the front leg (user-locked 2026-07-08): every back expiry
 * with gap ∈ [21, 35] days is emitted (fwd-edge scoring ranks them).
 */
export const BACK_DTE_MIN_GAP = 15;
export const BACK_DTE_MAX_GAP = 90;

/**
 * ORATS 2-leg fill haircut: cross this fraction of each leg's bid-ask width off the natural
 * side (buy at bid + f·width, sell at ask − f·width). ORATS backtester methodology (66% for
 * 2-leg complex orders) — ranking on mid overstates edge on wide markets.
 */
export const FILL_WIDTH_FRACTION = 0.66;

/**
 * Tier-1 event blackout (playbook hard gate): no FOMC/CPI/NFP within this many days BEFORE
 * the front expiry — event vol + gamma cliff stack in the short leg's final days.
 */
export const EVENT_BLACKOUT_DAYS = 3;

/**
 * Peak-theta window: the final N days before the front expiry, where calendar decay is
 * richest. A tier-1 event inside it collides with the harvest — scoring doubles the event
 * penalty (2026-07-09 user lock: weigh the forced pre-event exit against max theta decay).
 */
export const PEAK_THETA_DAYS = 5;

// ─────────────────────────────────────────────────────────────
// Pure helpers
// ─────────────────────────────────────────────────────────────

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

/**
 * ORATS 2-leg fill haircut (Phase 26, extracted from selectCandidates' private buyFill/sellFill
 * closures — Pitfall 2): a buyer pays UP toward the ask, a seller receives DOWN toward the bid,
 * each crossing FILL_WIDTH_FRACTION of the bid-ask width off the natural side. Exported so ROLL
 * pricing (exits context) imports this formula instead of re-deriving it — one source of truth
 * for the fill model on both the entry and exit side.
 */
export function haircutFill(quote: { readonly bid: number; readonly ask: number }, side: "buy" | "sell"): number {
  const width = quote.ask - quote.bid;
  return side === "buy" ? quote.bid + width * FILL_WIDTH_FRACTION : quote.ask - width * FILL_WIDTH_FRACTION;
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
  /** Pairs dropped because front IV > back IV (playbook term-inversion hard gate). */
  readonly termInverted: number;
  /** Pairs dropped by the tier-1 event blackout (≤EVENT_BLACKOUT_DAYS before front expiry). */
  readonly eventBlackout: number;
};

export type SelectCandidatesResult = {
  readonly candidates: ReadonlyArray<RawCandidate>;
  readonly gateDrops: GateDrops;
};

/**
 * Build the band-scan put-calendar universe over a chain cohort.
 *
 * Steps: convert strikes ×1000→points once; resolve cohort spot (average underlyingPrice)
 * and asOf (latest quote time, UTC calendar day); for each front expiry in the DTE window,
 * emit EVERY liquid 25-multiple strike whose front put delta is inside the band, paired with
 * EVERY back expiry in the gap window quoting the same strike; price both legs from bid/ask
 * with the 2-leg fill haircut; apply the term-inversion, event-blackout, and net-theta gates
 * (all counted). Returns [] for an empty or all-unusable chain — never throws.
 */
export function selectCandidates(
  chain: ReadonlyArray<ChainQuoteForPicker>,
  events: ReadonlyArray<EconomicEvent>,
  params: SelectCandidatesParams,
): SelectCandidatesResult {
  const drops = { liquidity: 0, netTheta: 0, termInverted: 0, eventBlackout: 0 };
  if (chain.length === 0) {
    return { candidates: [], gateDrops: drops };
  }

  const { r, q } = params;

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

  // Convert ×1000 → points ONCE (Pitfall 1); puts only (D-01); 25-multiples only (user
  // lock); skip null/non-finite iv; liquidity gate (rules.ts) — drops counted.
  type PointsQuote = {
    readonly strike: number;
    readonly expiration: string;
    readonly iv: number;
    readonly bid: number;
    readonly ask: number;
  };
  const putQuotes: PointsQuote[] = [];
  for (const quote of chain) {
    if (quote.contractType !== "P") continue;
    if (quote.bsmIv === null) continue;
    const iv = Number(quote.bsmIv);
    if (!Number.isFinite(iv)) continue;
    const strike = quote.strike / 1000;
    if (!isLiquidQuote(quote)) {
      drops.liquidity += 1;
      continue;
    }
    putQuotes.push({ strike, expiration: quote.expiration, iv, bid: quote.bid, ask: quote.ask });
  }
  if (putQuotes.length === 0) {
    return { candidates: [], gateDrops: drops };
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
  const seenPairs = new Set<string>();

  for (const fe of expiries) {
    const tf = daysBetween(asOfIso, fe);
    if (tf < FRONT_DTE_MIN || tf > FRONT_DTE_MAX) continue;

    const frontQuotesRaw = byExpiry.get(fe);
    assertDefined(frontQuotesRaw, "selectCandidates: frontQuotesRaw (fe came from byExpiry.keys())");

    // Playbook EVT discipline (2026-07-09 — was an entry BLOCK, now an exit rule): a tier-1
    // event within EVENT_BLACKOUT_DAYS before this front expiry stamps a hard exit on the day
    // BEFORE the earliest such event; eventAdjustment (w10) still penalizes the score.
    const feDay = isoDayNumber(fe);
    let exitBeforeIso: string | null = null;
    let eventInPeakTheta = false;
    for (const ev of events) {
      const evDay = isoDayNumber(ev.date);
      if (evDay <= feDay && feDay - evDay <= EVENT_BLACKOUT_DAYS) {
        const dayBefore = new Date((evDay - 1) * 86_400_000).toISOString().slice(0, 10);
        if (exitBeforeIso === null || dayBefore < exitBeforeIso) exitBeforeIso = dayBefore;
      }
      if (evDay <= feDay && feDay - evDay <= PEAK_THETA_DAYS) eventInPeakTheta = true;
    }

    // Band membership (NOT nearest-target): every strike whose front delta is in the band.
    for (const frontQuote of frontQuotesRaw) {
      const delta = bsmGreeks(spot, frontQuote.strike, tf / 365, frontQuote.iv, r, q, "P").delta;
      if (delta < DELTA_BAND_MIN || delta > DELTA_BAND_MAX) continue;
      const K = frontQuote.strike;
      const ivF = frontQuote.iv;

      for (const be of expiries) {
        const tb = daysBetween(asOfIso, be);
        const gap = tb - tf;
        if (gap < BACK_DTE_MIN_GAP || gap > BACK_DTE_MAX_GAP) continue;
        const backQuotes = byExpiry.get(be);
        assertDefined(backQuotes, "selectCandidates: backQuotes (be came from byExpiry.keys())");
        const backAtK = backQuotes.find((quote) => quote.strike === K);
        if (backAtK === undefined) continue;
        const ivB = backAtK.iv;

        const pairKey = `${K}-${fe}-${be}`;
        if (seenPairs.has(pairKey)) continue;

        // Term-inversion gate RETIRED 2026-07-09: mild front-richness IS the entry edge
        // (ORATS/SteadyOptions) — slopeEntryFraction ranks it; its crisis floor (slope
        // < −1.5) zeroes true stress inversions. gateDrops.termInverted stays at 0 for
        // contract compat until the next schema pass.

        const gF = bsmGreeks(spot, K, tf / 365, ivF, r, q, "P");
        const gB = bsmGreeks(spot, K, tb / 365, ivB, r, q, "P");
        const theta = (gB.theta - gF.theta) * 100;
        if (theta <= 0) {
          drops.netTheta += 1;
          continue;
        }

        seenPairs.add(pairKey);

        const vega = (gB.vega - gF.vega) * 100;
        const netDelta = (gB.delta - gF.delta) * 100;

        // Debit from the actual market with the fill haircut — buy the back, sell the front.
        const debit = (haircutFill(backAtK, "buy") - haircutFill(frontQuote, "sell")) * 100;

        const slope = ((ivB - ivF) / (tb - tf)) * 365;

        const frontEvents = legSpansEvents(fe, asOfIso, events);
        const backEventsAll = legSpansEvents(be, asOfIso, events);
        const backEvents = backEventsAll.filter((name) => !frontEvents.includes(name));

        // Label = the actual front |Δ| in whole delta points (band-scan has no rungs).
        const deltaLabel = `${Math.round(Math.abs(delta) * 100)}D`;

        candidates.push({
          id: `${deltaLabel}-${K}-${fe}-${be}`,
          name: `${K}P ${fe} / ${be}`,
          frontLeg: { strike: K, putCall: "P", expiration: fe, dte: tf, iv: ivF },
          backLeg: { strike: K, putCall: "P", expiration: be, dte: tb, iv: ivB },
          deltaRung: deltaLabel,
          spot,
          theta,
          vega,
          delta: netDelta,
          debit,
          slope,
          frontEvents,
          backEvents,
          exitBeforeIso,
          eventInPeakTheta,
        });
      }
    }
  }

  return { candidates, gateDrops: drops };
}
