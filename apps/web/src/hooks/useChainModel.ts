/**
 * useChainModel — state + derivation for the Analyzer's TWO chain surfaces.
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
 * Four jobs, no fifth:
 *   1. Own the put/call switch and the two leg picks.
 *   2. Group the flat chain into (root, expiration) cohorts and price each leg.
 *   3. Hand the picked pair to chain-math (which does the arithmetic).
 *   4. Report each cohort's ATM IV and 25Δ risk reversal.
 *
 * It does NOT rank, score, filter-for-quality, or recommend. The chain is data.
 *
 * No any/as/!.
 */
import { useCallback, useMemo, useState } from "react";
import { computeFwdIv } from "@morai/core";
import { useChain } from "./useChain.ts";
import { useGex } from "./useGex.ts";
import {
  atmIv,
  calendarDebit,
  edge,
  hSkew,
  legGreeks,
  netCalendarGreeks,
  vSkewVsAtm,
} from "../lib/chain-math.ts";
import type { Carry } from "../lib/chain-math.ts";
import { resolveCarry } from "../lib/resolve-carry.ts";
import { riskReversalForExpiry } from "../lib/chain-risk-reversal.ts";
import { buildTosPairOrder } from "../lib/tos-order.ts";
import type { ChainRow } from "../lib/chain-contract.ts";

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
 * Greeks are all-or-nothing: `legGreeks` returns null when the leg cannot be priced (no solved
 * IV, at/past expiry, non-positive spot or strike), and a half-priced leg would be worse than a
 * blank one. The row itself still appears with its bid/ask/OI — a gap is not a deletion.
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
   * root. Sourced from `chain-math.atmIv`, which takes all three as arguments so the reference
   * cannot come off the wrong curve or the wrong book.
   */
  readonly vSkew: number | null;
}

/** One Browse row: everything one (root, expiration) quotes on the shown wing. */
export interface ChainCohort {
  readonly root: "SPX" | "SPXW";
  readonly expiration: string;
  readonly dte: number;
  /** This cohort's ATM reference IV on the shown wing, or null if it never solved. */
  readonly atmIv: number | null;
  /** 25Δ risk reversal, `IV(25Δ put) − IV(25Δ call)`. Spans BOTH wings — a property of the
   *  expiry, not of the side currently on screen. Null when the ladder cannot bracket ±25Δ. */
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
  /** The back leg is not strictly later than the front. Forward vol has no solution. */
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
  /** Every tradeable (root, expiration) cohort, nearest expiry first. Nothing else filtered. */
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

/**
 * The forward vol implied between two legs — the rate the market prices for the window the
 * calendar actually owns. Null on an inverted term structure: `computeFwdIv` guards a negative
 * radicand rather than returning NaN, and an inverted structure has no forward vol to quote.
 * (`edge` applies the same guard independently; this is the raw reading edge is measured against.)
 */
function forwardIv(front: ChainRow, back: ChainRow): number | null {
  const ivF = front.bsmIv;
  const ivB = back.bsmIv;
  if (ivF === null || ivB === null) return null;
  if (!Number.isFinite(front.dte) || !Number.isFinite(back.dte) || back.dte <= front.dte) {
    return null;
  }
  const fwd = computeFwdIv(front.dte, ivF, back.dte, ivB);
  return fwd.guard === "inverted" ? null : fwd.fwdIv;
}

function toLeg(row: ChainRow, carry: Carry, cohortAtmIv: number | null): ChainLegRow {
  const greeks = legGreeks(row, carry);
  return {
    root: row.root,
    expiration: row.expiration,
    contractType: row.contractType,
    strike: row.strike,
    dte: row.dte,
    iv: row.bsmIv,
    bid: row.bid,
    ask: row.ask,
    openInterest: row.openInterest,
    delta: greeks?.delta ?? null,
    gamma: greeks?.gamma ?? null,
    theta: greeks?.theta ?? null,
    vega: greeks?.vega ?? null,
    vSkew: vSkewVsAtm(row.bsmIv, cohortAtmIv),
  };
}

/** What the pair surface needs to re-price a picked leg: the display row plus its raw source. */
interface LegEntry {
  readonly leg: ChainLegRow;
  readonly row: ChainRow;
  readonly carry: Carry;
}

export function useChainModel(): ChainModel {
  const { data, isPending, isError, refetch } = useChain();
  const { data: gex } = useGex();
  // The response is a bare array (200 [] when the chain is empty), not an envelope.
  const rows = useMemo<ReadonlyArray<ChainRow>>(() => data ?? [], [data]);

  const [contractType, setContractTypeState] = useState<"C" | "P">("P");
  // The picks are IDENTITIES, never leg objects. The chain polls every 30s; holding the object
  // would freeze the pair's numbers at whatever the first response said while the rest of the
  // screen refreshed — a stale panel that looks live.
  const [frontKey, setFrontKey] = useState<string | null>(null);
  const [backKey, setBackKey] = useState<string | null>(null);

  const spot = rows[0]?.underlyingPrice ?? null;
  const observedAt = rows[0]?.observedAt ?? null;

  const { cohorts, byKey } = useMemo<{
    cohorts: ReadonlyArray<ChainCohort>;
    byKey: ReadonlyMap<string, LegEntry>;
  }>(() => {
    // Group by (root, expiration) — the pair that identifies one book on one date. Expiration
    // alone is not a cohort: SPX (AM-settled monthlies) and SPXW (PM-settled weeklies) quote the
    // same strikes on the same dates out of different books, and merging them is what put an
    // SPXW back leg against an SPX front in production (back IV 68.89% vs front 24.69%).
    const groups = new Map<string, { root: "SPX" | "SPXW"; expiration: string; dte: number }>();
    for (const row of rows) {
      // P1 (UAT): the cohort still carries yesterday's expiry, and an expired contract cannot be
      // traded — it is stale junk, not data. 0DTE stays: it trades until the close.
      if (!Number.isFinite(row.dte) || row.dte < 0) continue;
      const key = `${row.root}|${row.expiration}`;
      if (!groups.has(key)) {
        groups.set(key, { root: row.root, expiration: row.expiration, dte: row.dte });
      }
    }

    // Carry is per-expiry (FRED-interpolated r + parity-implied q, resolved server-side), so each
    // leg prices against its own expiry's rate. Degrades to the flat defaults when the GEX
    // snapshot is absent or carries no entry — never throws, never blocks the surface.
    const carryFor = new Map<string, Carry>();
    const carry = (expiration: string): Carry => {
      const hit = carryFor.get(expiration);
      if (hit !== undefined) return hit;
      const resolved = resolveCarry(gex, expiration);
      carryFor.set(expiration, resolved);
      return resolved;
    };

    const out: ChainCohort[] = [];
    const index = new Map<string, LegEntry>();
    for (const group of groups.values()) {
      const { root, expiration, dte } = group;
      // ATM reference for THIS cohort. atmIv takes the expiry, the wing and the root, so the
      // reference cannot come off another curve or another book — the one bad input in
      // chain-math that cannot null itself, so it is enforced by signature.
      const cohortAtmIv = spot === null ? null : atmIv(rows, spot, expiration, contractType, root);
      const legs = rows
        .filter(
          (r) => r.root === root && r.expiration === expiration && r.contractType === contractType,
        )
        .sort((a, b) => a.strike - b.strike)
        .map((row) => {
          const entry: LegEntry = { leg: toLeg(row, carry(expiration), cohortAtmIv), row, carry: carry(expiration) };
          index.set(legKey(entry.leg), entry);
          return entry.leg;
        });
      out.push({
        root,
        expiration,
        dte,
        atmIv: cohortAtmIv,
        // RR spans BOTH wings of the cohort, so it reads the unfiltered rows — it is a property
        // of the expiry, not of whichever side the surface is showing. Root-scoped for the same
        // reason atmIv is: one smile per book, never a mixture of two.
        riskReversal: riskReversalForExpiry(rows, expiration, carry(expiration).rate, carry(expiration).divYield, root),
        strikes: legs,
      });
    }
    // Nearest expiry first; root breaks the tie so the order is stable across polls.
    out.sort((a, b) => a.dte - b.dte || a.root.localeCompare(b.root));
    return { cohorts: out, byKey: index };
    // ponytail: prices EVERY leg of EVERY cohort up front, not just the expanded one — one wing
    // of a full SPX chain is a few thousand bsmGreeks calls, well under a frame. If the chain
    // grows enough to show, make `strikes` a getter memoised per cohort.
  }, [rows, contractType, spot, gex]);

  const frontEntry = frontKey === null ? undefined : byKey.get(frontKey);
  const backEntry = backKey === null ? undefined : byKey.get(backKey);
  const frontLeg = frontEntry?.leg ?? null;
  const backLeg = backEntry?.leg ?? null;

  const pair = useMemo<ChainPair | null>(() => {
    if (frontEntry === undefined || backEntry === undefined) return null;
    const front = frontEntry.row;
    const back = backEntry.row;
    const netGreeks = netCalendarGreeks(
      legGreeks(front, frontEntry.carry),
      legGreeks(back, backEntry.carry),
    );
    const rootMismatch = front.root !== back.root;
    const backNotLater = !(back.dte > front.dte);
    const diagonal = front.strike !== back.strike;
    const debit = calendarDebit(front, back);
    return {
      front: frontEntry.leg,
      back: backEntry.leg,
      hSkew: hSkew(front.bsmIv, back.bsmIv),
      fwdIv: forwardIv(front, back),
      edge: edge(front.dte, front.bsmIv, back.dte, back.bsmIv),
      debit,
      netDelta: netGreeks?.delta ?? null,
      netGamma: netGreeks?.gamma ?? null,
      netTheta: netGreeks?.theta ?? null,
      netVega: netGreeks?.vega ?? null,
      rootMismatch,
      backNotLater,
      diagonal,
      tosOrder:
        backNotLater || diagonal || rootMismatch
          ? null
          : buildTosPairOrder({
              strike: front.strike,
              contractType: front.contractType,
              frontExpiry: front.expiration,
              backExpiry: back.expiration,
              debit,
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
