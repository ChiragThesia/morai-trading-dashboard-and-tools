/**
 * useChainModel — state + wiring for the Analyzer's TWO chain surfaces.
 *
 * The screen used to show ONE table: row = a strike, pre-paired across two chosen expiries. That
 * shape had a defect no dash could report — it was an INNER JOIN. Only strikes quoted in BOTH
 * expiries got a row, so a strike listed in August but not September simply was not there. On a
 * screen whose whole point is "give me the data, do not decide for me", a hidden filter is the
 * worst possible default. So the join is gone, replaced by two surfaces (user, 2026-07-26):
 *
 *   BROWSE — row = one (root, expiration) cohort, ALL of them. Expand it and you get every strike
 *            that cohort lists, each priced as a single LEG. TOS Trade tab, nothing hidden.
 *   PAIR   — the user picks a front leg and a back leg. Only then does calendar math happen:
 *            H-Skew, forward IV, edge, net greeks, the haircut debit, and a TOS order line.
 *
 * THIS HOOK NO LONGER DOES ARITHMETIC. Grouping, per-leg greeks, the ATM reference and vertical
 * skew were computed here, in the browser, off the raw chain — a second implementation of eight
 * formulas the calendar engine already owned, and a second thing to be wrong. They now arrive
 * solved from GET /api/chain/priced, and the two-leg math is `pairMetrics` from the same engine.
 * What is left is state and mapping:
 *
 *   1. Own the put/call switch and the two leg picks.
 *   2. Map the wire's cohorts onto the row shape the two components render.
 *   3. Hand the picked pair to `pairMetrics`, and flag the three ways a hand-built pair is odd.
 *   4. Add the 25Δ risk reversal, which has no server twin (see below).
 *
 * TWO READS, DELIBERATELY. The priced surface serves ONE wing, because that is the wing the
 * screen shows. The 25Δ risk reversal is `IV(25Δ put) − IV(25Δ call)`: it spans BOTH wings, so it
 * is a property of the expiry rather than of the side on screen, and it still reads the raw
 * `/api/chain`. Its carry comes off the GEX snapshot per expiry, which is NOT the one carry the
 * server priced the greeks on — the two conventions sit on one table and the RR column is the
 * only thing on the second one. Building the server twin would mean `calendar/domain` importing
 * `analytics/domain`, which architecture-boundaries §7 forbids. The raw read only ever nulls this
 * one column; it never gates the table.
 *
 * It does NOT rank, score, filter-for-quality, or recommend. The chain is data.
 *
 * No any/as/!.
 */
import { useCallback, useMemo, useState } from "react";
import { pairMetrics } from "@morai/core";
import type { PairLeg } from "@morai/core";
import { usePricedChain } from "./usePricedChain.ts";
import { useChain } from "./useChain.ts";
import { useGex } from "./useGex.ts";
import { resolveCarry } from "../lib/resolve-carry.ts";
import { riskReversalForExpiry } from "../lib/chain-risk-reversal.ts";
import { buildTosPairOrder } from "../lib/tos-order.ts";

/**
 * The wire serves strikes in INDEX POINTS (7400); every other browser module — `legKey`,
 * `strikeLabel`, `buildTosPairOrder`, `riskReversalForExpiry` — is on the ×1000 integer the raw
 * chain uses. Converting once, here, is what keeps the two conventions from meeting anywhere
 * else. `Math.round` because the wire's number is a float and a half-point strike must land on
 * an exact integer key.
 */
const STRIKE_SCALE = 1000;

// ─── Shapes ───────────────────────────────────────────────────────────────────

/** The four fields that identify one option contract on the wire. */
export interface ChainLegId {
  readonly root: "SPX" | "SPXW";
  readonly expiration: string;
  readonly contractType: "C" | "P";
  /** Strike ×1000, the integer the rest of the system stores. */
  readonly strike: number;
}

/**
 * One row of a cohort's strike ladder — a single LEG, not a calendar.
 *
 * Greeks are all-or-nothing: the engine emits them together or not at all, because a half-priced
 * leg would be worse than a blank one. The row itself still appears with its bid/ask/OI — a gap
 * is not a deletion, and 24.4% of the live put wing was in that state on 2026-07-28.
 */
export interface ChainLegRow extends ChainLegId {
  readonly dte: number;
  readonly iv: number | null;
  readonly bid: number;
  readonly ask: number;
  readonly openInterest: number;
  readonly delta: number | null;
  readonly gamma: number | null;
  readonly theta: number | null;
  readonly vega: number | null;
  /**
   * Vertical skew — this strike's IV minus the ATM strike's IV, same expiry, same wing, same
   * root. Measured server-side; the reference is the ATM strike's OWN IV, never a neighbour's.
   */
  readonly vSkew: number | null;
}

/** One Browse row: everything one (root, expiration) quotes on the shown wing. */
export interface ChainCohort {
  readonly root: "SPX" | "SPXW";
  readonly expiration: string;
  readonly dte: number;
  /** This cohort's ATM reference IV on the shown wing, or null if that strike never solved. */
  readonly atmIv: number | null;
  /** 25Δ risk reversal, `IV(25Δ put) − IV(25Δ call)`. Spans BOTH wings — a property of the
   *  expiry, not of the side currently on screen. Null when the ladder cannot bracket ±25Δ, and
   *  null while the raw chain read has not landed. */
  readonly riskReversal: number | null;
  readonly strikes: ReadonlyArray<ChainLegRow>;
}

/** The calendar math for the two legs the user picked, and the three ways a pair can be odd. */
export interface ChainPair {
  readonly front: ChainLegRow;
  readonly back: ChainLegRow;
  /** Front IV − back IV. POSITIVE = the front is the rich one, the calendar seller's setup. */
  readonly hSkew: number | null;
  readonly fwdIv: number | null;
  /** Front IV − forward IV. Same direction as hSkew; when they disagree, trust this one. */
  readonly edge: number | null;
  readonly debit: number | null;
  readonly netDelta: number | null;
  readonly netGamma: number | null;
  readonly netTheta: number | null;
  readonly netVega: number | null;
  /** The two legs are different OCC roots — one AM-settled book against one PM-settled book. */
  readonly rootMismatch: boolean;
  /**
   * The back leg does not settle after the front, so there is no window between them and forward
   * vol has no solution. Measured on the SETTLEMENT clock, not on whole DTE days: SPX and SPXW
   * quote the same date with a 6.5-hour gap between their settlements, so a same-dated AM/PM pair
   * has a real window. Flagging that off `dte` would contradict the forward vol printed beside it.
   */
  readonly backNotLater: boolean;
  /** Different strikes — a diagonal, not a calendar. */
  readonly diagonal: boolean;
  /**
   * A paste-ready TOS order line, or null when the pair cannot be expressed as one calendar
   * order: an inverted pair (parseTosOrder SORTS the dates and would silently re-label it), a
   * diagonal (two strikes, one strike field), or a cross-root pair (two separate books).
   */
  readonly tosOrder: string | null;
}

export interface ChainModel {
  readonly isLoading: boolean;
  readonly isError: boolean;
  readonly refetch: () => void;
  /** Every tradeable (root, expiration) cohort, in the order the engine ranked them: nearest
   *  expiry first, root breaking the tie. Nothing else filtered, nothing re-sorted here. */
  readonly cohorts: ReadonlyArray<ChainCohort>;
  readonly contractType: "C" | "P";
  readonly setContractType: (contractType: "C" | "P") => void;
  readonly frontLeg: ChainLegRow | null;
  readonly backLeg: ChainLegRow | null;
  readonly pickFront: (leg: ChainLegId) => void;
  readonly pickBack: (leg: ChainLegId) => void;
  readonly clearPair: () => void;
  readonly pair: ChainPair | null;
  readonly spot: number | null;
  readonly observedAt: string | null;
}

/**
 * Full row identity. All four fields bind: the chain carries both wings AND both OCC roots, and
 * dropping any one of them collides two contracts onto one key. Dropping `root` alone did exactly
 * that in production — 242 rows sharing a React key and an expansion slot, so opening one opened
 * the other and sorting froze the duplicates in place.
 */
export function legKey(id: ChainLegId): string {
  return `${id.root}|${id.expiration}|${id.contractType}|${id.strike}`;
}

// ─── Derivation ───────────────────────────────────────────────────────────────

/** What the pair surface needs: the display row plus the cohort clock it was priced on. */
interface LegEntry {
  readonly leg: ChainLegRow;
  /** Years to the SETTLEMENT instant, off the cohort. Never `dte / 365.25`. */
  readonly t: number;
}

/**
 * One picked leg as `pairMetrics` wants it: the cohort's `t` plus the fields the arithmetic
 * reads. Nulls travel through — an unpriced leg nulls the metrics that need an IV and leaves the
 * debit, which only ever needed a two-sided market.
 */
function toPairLeg(entry: LegEntry): PairLeg {
  const { leg } = entry;
  return {
    t: entry.t,
    leg: {
      iv: leg.iv,
      bid: leg.bid,
      ask: leg.ask,
      delta: leg.delta,
      gamma: leg.gamma,
      theta: leg.theta,
      vega: leg.vega,
    },
  };
}

export function useChainModel(): ChainModel {
  const [contractType, setContractTypeState] = useState<"C" | "P">("P");
  const { data, isPending, isError, refetch } = usePricedChain(contractType);
  // Raw chain + GEX feed the risk-reversal column and nothing else. Neither gates the table.
  const { data: rawChain } = useChain();
  const { data: gex } = useGex();

  // The picks are IDENTITIES, never leg objects. The chain polls every 30s; holding the object
  // would freeze the pair's numbers at whatever the first response said while the rest of the
  // screen refreshed — a stale panel that looks live.
  const [frontKey, setFrontKey] = useState<string | null>(null);
  const [backKey, setBackKey] = useState<string | null>(null);

  const spot = data?.spot ?? null;
  // A surface with no cohorts observed nothing, so it has no instant to stamp. The engine seeds
  // its `asOf` reduce with `new Date(0)`, so an empty chain — a cold start, or a snapshot whose
  // spot was unusable (priceChain.ts returns `cohorts: []` rather than pricing against a level the
  // index never traded at) — arrives stamped 1970-01-01. It is a valid `z.string().datetime()`, so
  // nothing upstream rejects it, and `Analyzer.tsx` keys the header's dash off this being null.
  const observedAt = data === undefined || data.cohorts.length === 0 ? null : data.asOf;

  const { cohorts, byKey } = useMemo<{
    cohorts: ReadonlyArray<ChainCohort>;
    byKey: ReadonlyMap<string, LegEntry>;
  }>(() => {
    const rawRows = rawChain ?? [];
    const out: ChainCohort[] = [];
    const index = new Map<string, LegEntry>();

    for (const cohort of data?.cohorts ?? []) {
      const legs = cohort.strikes.map((row) => {
        const leg: ChainLegRow = {
          root: cohort.root,
          expiration: cohort.expiration,
          // The wing is on the ENVELOPE, not the row — this endpoint prices one wing per call.
          // Taking it from the toggle's state would mislabel every row for the round trip a wing
          // switch is in flight, and key them wrong with it.
          contractType: data?.contractType ?? contractType,
          strike: Math.round(row.strike * STRIKE_SCALE),
          dte: cohort.dte,
          iv: row.iv,
          bid: row.bid,
          ask: row.ask,
          openInterest: row.openInterest,
          delta: row.delta,
          gamma: row.gamma,
          theta: row.theta,
          vega: row.vega,
          vSkew: row.vSkew,
        };
        index.set(legKey(leg), { leg, t: cohort.t });
        return leg;
      });

      const carry = resolveCarry(gex, cohort.expiration);
      out.push({
        root: cohort.root,
        expiration: cohort.expiration,
        dte: cohort.dte,
        atmIv: cohort.atmIv,
        // RR spans BOTH wings, so it reads the raw chain — it is a property of the expiry, not of
        // whichever side the surface is showing. Root-scoped by signature: one smile per book,
        // never a mixture of two.
        riskReversal: riskReversalForExpiry(
          rawRows,
          cohort.expiration,
          carry.rate,
          carry.divYield,
          cohort.root,
        ),
        strikes: legs,
      });
    }
    // No sort. The engine already emits nearest expiry first with root breaking the tie, and
    // re-sorting here would be a second ordering rule to keep in step with it.
    return { cohorts: out, byKey: index };
  }, [data, contractType, rawChain, gex]);

  const frontEntry = frontKey === null ? undefined : byKey.get(frontKey);
  const backEntry = backKey === null ? undefined : byKey.get(backKey);
  const frontLeg = frontEntry?.leg ?? null;
  const backLeg = backEntry?.leg ?? null;

  const pair = useMemo<ChainPair | null>(() => {
    if (frontEntry === undefined || backEntry === undefined) return null;
    const front = frontEntry.leg;
    const back = backEntry.leg;
    const metrics = pairMetrics(toPairLeg(frontEntry), toPairLeg(backEntry));
    const rootMismatch = front.root !== back.root;
    // On the settlement clock, not on dte — see ChainPair.backNotLater.
    const backNotLater = !(backEntry.t > frontEntry.t);
    const diagonal = front.strike !== back.strike;
    return {
      front,
      back,
      hSkew: metrics.hSkew,
      fwdIv: metrics.fwdIv,
      edge: metrics.edge,
      debit: metrics.debit,
      // The net is all-or-nothing in the engine too, so this spreads one null across four cells
      // rather than inventing four.
      netDelta: metrics.net?.delta ?? null,
      netGamma: metrics.net?.gamma ?? null,
      netTheta: metrics.net?.theta ?? null,
      netVega: metrics.net?.vega ?? null,
      rootMismatch,
      backNotLater,
      diagonal,
      tosOrder:
        backNotLater || diagonal || rootMismatch
          ? null
          : buildTosPairOrder({
              strike: front.strike,
              contractType: front.contractType,
              // Safe to take one leg's root: this branch is unreachable when rootMismatch.
              root: front.root,
              frontExpiry: front.expiration,
              backExpiry: back.expiration,
              debit: metrics.debit,
            }),
    };
  }, [frontEntry, backEntry]);

  const clearPair = useCallback((): void => {
    setFrontKey(null);
    setBackKey(null);
  }, []);

  // Switching the wing CLEARS the picks. The old model made a mixed-wing pair unrepresentable by
  // filtering the wing before the join; here the picks are per-leg, so without this you could
  // pick a put, toggle, pick a call, and get exactly the put-front/call-back pair the exit
  // advisor shipped once — every input present and finite, so nothing dashes.
  const setContractType = useCallback((next: "C" | "P"): void => {
    setContractTypeState((cur) => {
      if (cur !== next) {
        setFrontKey(null);
        setBackKey(null);
      }
      return next;
    });
  }, []);

  const pickFront = useCallback((leg: ChainLegId): void => {
    setFrontKey(legKey(leg));
  }, []);
  const pickBack = useCallback((leg: ChainLegId): void => {
    setBackKey(legKey(leg));
  }, []);

  return {
    isLoading: isPending && data === undefined,
    isError,
    refetch,
    cohorts,
    contractType,
    setContractType,
    frontLeg,
    backLeg,
    pickFront,
    pickBack,
    clearPair,
    pair,
    spot,
    observedAt,
  };
}
