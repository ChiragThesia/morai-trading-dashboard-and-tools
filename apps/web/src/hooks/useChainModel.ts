/**
 * useChainModel — state + derivation for the Analyzer's chain data table.
 *
 * Plays the role `useAnalyzerModel` plays for the payoff panel: the screen holds
 * no derivation of its own. Four jobs, no fifth:
 *
 *   1. Own the front/back expiry pair and the put/call switch.
 *   2. Group the flat chain by strike and join each strike's two legs.
 *   3. Hand each pair to chain-math (which does the arithmetic).
 *   4. Report the 25Δ risk reversal for each of the two expiries.
 *
 * It does NOT rank, score, filter-for-quality, or recommend. The table is data.
 *
 * No any/as/!.
 */
import { useMemo, useState } from "react";
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
import type { ChainTableLeg, ChainTableRow } from "../components/chain/ChainTable.tsx";
import type { ChainRow } from "../lib/chain-contract.ts";

/**
 * The forward vol implied between the two legs — the rate the market prices for the window
 * the calendar actually owns. Null on an inverted term structure: `computeFwdIv` guards a
 * negative radicand rather than returning NaN, and an inverted structure has no forward vol
 * to quote. (`edge` applies the same guard independently; this column is the raw reading
 * the edge is measured against.)
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

/**
 * One chain row → one table leg. Greeks are all-or-nothing: `legGreeks` returns null when
 * the leg cannot be priced (no solved IV, at/past expiry, non-positive spot or strike), and
 * a half-priced leg would be worse than a blank one.
 */
function toLeg(row: ChainRow, carry: Carry): ChainTableLeg {
  const greeks = legGreeks(row, carry);
  return {
    expiry: row.expiration,
    dte: row.dte,
    iv: row.bsmIv,
    bid: row.bid,
    ask: row.ask,
    openInterest: row.openInterest,
    delta: greeks?.delta ?? null,
    gamma: greeks?.gamma ?? null,
    theta: greeks?.theta ?? null,
    vega: greeks?.vega ?? null,
  };
}

/**
 * Compose one strike's two legs into a table row.
 *
 * Both legs are already known to share a strike, an expiry pair, AND a wing — the caller
 * filters by `contractType` before building the strike map, so a put front against a call
 * back is not reachable from here. `frontAtm` comes from `atmIv`, which takes the expiry and
 * the wing as arguments, so the V-Skew reference cannot be crossed either.
 */
function buildRow(
  front: ChainRow,
  back: ChainRow,
  frontAtm: number | null,
  frontCarry: Carry,
  backCarry: Carry,
): ChainTableRow {
  const frontGreeks = legGreeks(front, frontCarry);
  const backGreeks = legGreeks(back, backCarry);
  const net = netCalendarGreeks(frontGreeks, backGreeks);
  return {
    strike: front.strike,
    contractType: front.contractType,
    root: front.root,
    deltaFront: frontGreeks?.delta ?? null,
    ivFront: front.bsmIv,
    ivBack: back.bsmIv,
    hSkew: hSkew(front.bsmIv, back.bsmIv),
    fwdIv: forwardIv(front, back),
    edge: edge(front.dte, front.bsmIv, back.dte, back.bsmIv),
    vSkew: vSkewVsAtm(front.bsmIv, frontAtm),
    theta: net?.theta ?? null,
    vega: net?.vega ?? null,
    netDelta: net?.delta ?? null,
    netGamma: net?.gamma ?? null,
    debit: calendarDebit(front, back),
    front: toLeg(front, frontCarry),
    back: toLeg(back, backCarry),
  };
}

export interface ChainExpiry {
  readonly expiration: string;
  readonly dte: number;
}

export interface ChainModel {
  readonly isLoading: boolean;
  readonly isError: boolean;
  readonly refetch: () => void;
  /** Every expiry in the chain, nearest first. */
  readonly expirations: ReadonlyArray<ChainExpiry>;
  /** Null until the first response lands, or when the user's pick left the chain. */
  readonly frontExpiry: string | null;
  readonly backExpiry: string | null;
  readonly setFrontExpiry: (expiration: string) => void;
  readonly setBackExpiry: (expiration: string) => void;
  readonly contractType: "C" | "P";
  readonly setContractType: (contractType: "C" | "P") => void;
  /** One joined row per strike quoted in BOTH selected expiries, ascending. */
  readonly rows: ReadonlyArray<ChainTableRow>;
  readonly spot: number | null;
  readonly observedAt: string | null;
  readonly frontRr: number | null;
  readonly backRr: number | null;
}

export function useChainModel(): ChainModel {
  const { data, isPending, isError, refetch } = useChain();
  const { data: gex } = useGex();
  // The response is a bare array (200 [] when the chain is empty), not an envelope.
  const rows = useMemo<ReadonlyArray<ChainRow>>(() => data ?? [], [data]);

  const expirations = useMemo<ReadonlyArray<ChainExpiry>>(() => {
    const byExpiration = new Map<string, number>();
    for (const row of rows) {
      if (!byExpiration.has(row.expiration)) byExpiration.set(row.expiration, row.dte);
    }
    return [...byExpiration.entries()]
      .map(([expiration, dte]) => ({ expiration, dte }))
      .sort((a, b) => a.dte - b.dte);
  }, [rows]);

  // Null means "no pick yet" — the defaults below fill in from the chain itself,
  // so the selects are usable the moment the first response lands.
  const [frontPick, setFrontPick] = useState<string | null>(null);
  const [backPick, setBackPick] = useState<string | null>(null);
  const [contractType, setContractType] = useState<"C" | "P">("P");

  const known = useMemo(() => new Set(expirations.map((e) => e.expiration)), [expirations]);
  const frontExpiry =
    frontPick !== null && known.has(frontPick) ? frontPick : (expirations[0]?.expiration ?? null);
  const backExpiry =
    backPick !== null && known.has(backPick) ? backPick : (expirations[1]?.expiration ?? null);

  const spot = rows[0]?.underlyingPrice ?? null;
  const observedAt = rows[0]?.observedAt ?? null;

  const frontAll = useMemo(
    () => rows.filter((r) => r.expiration === frontExpiry),
    [rows, frontExpiry],
  );
  const backAll = useMemo(() => rows.filter((r) => r.expiration === backExpiry), [rows, backExpiry]);

  const joined = useMemo<ReadonlyArray<ChainTableRow>>(() => {
    if (frontExpiry === null || backExpiry === null) return [];
    // JOIN KEY = expiration + contractType + strike. The chain carries BOTH wings, so a
    // strike-only join silently pairs a put front against a call back — and every input is
    // present and finite, so the em-dash discipline never fires. The row just reads wrong.
    // (Same bug shipped once in the exit advisor's toRollCandidates.) Both wings must be
    // filtered BEFORE the strike map is built, never after.
    const frontLegs = frontAll.filter((r) => r.contractType === contractType);
    const backLegs = backAll.filter((r) => r.contractType === contractType);
    // ROOT IS PART OF THE JOIN KEY, not just the wing. SPX (AM-settled monthlies) and SPXW
    // (PM-settled weeklies) quote the SAME strike on the SAME date with different books. A
    // strike-only map keeps whichever root it saw last — in production that was often the
    // twin whose IV had never solved, which is why most columns rendered em dashes, and it
    // once paired an SPXW back leg against an SPX front (back IV 68.89% vs front 24.69%,
    // H-Skew −44.21). Like the wing, every input is present and finite, so nothing dashes:
    // the row just reads wrong.
    const keyOf = (r: ChainRow): string => `${r.root}-${r.strike}`;
    // V-Skew reference: chain-math's atmIv takes the expiry and wing as arguments, so the
    // skew curve cannot be crossed here. Never resolve the ATM strike by hand.
    // A null spot means the cohort carried no usable underlying price — there is no honest
    // "nearest strike" to measure against, so the whole V-Skew column dashes rather than
    // measuring against an invented reference.
    // Front leg only: the table carries ONE V-Skew column, measured on the leg you sell.
    // The back leg's own vertical skew is computable the same way (atmIv on backExpiry) but
    // has no column to land in yet — adding it means a column on ChainTable, not a change here.
    const frontAtm = spot === null ? null : atmIv(rows, spot, frontExpiry, contractType);
    // Carry is per-expiry (FRED-interpolated r + parity-implied q, resolved server-side),
    // so each leg prices against its own expiry's rate. Degrades to the flat defaults when
    // the GEX snapshot is absent or carries no entry — never throws, never blocks the table.
    const frontCarry = resolveCarry(gex, frontExpiry);
    const backCarry = resolveCarry(gex, backExpiry);
    const backByKey = new Map(backLegs.map((r) => [keyOf(r), r]));
    const out: ChainTableRow[] = [];
    for (const front of frontLegs) {
      const back = backByKey.get(keyOf(front));
      if (back === undefined) continue;
      out.push(buildRow(front, back, frontAtm, frontCarry, backCarry));
    }
    return out.sort((a, b) => a.strike - b.strike);
  }, [rows, frontAll, backAll, frontExpiry, backExpiry, contractType, spot, gex]);

  // RR spans BOTH option types of an expiry — it is a property of the expiry, not of
  // whichever side the table is currently showing, so it reads the unfiltered rows.
  // Carry comes from that expiry's own entry, matching how the legs above are priced.
  const frontRr = useMemo(
    () =>
      frontExpiry === null
        ? null
        : riskReversalForExpiry(
            rows,
            frontExpiry,
            resolveCarry(gex, frontExpiry).rate,
            resolveCarry(gex, frontExpiry).divYield,
          ),
    [rows, frontExpiry, gex],
  );
  const backRr = useMemo(
    () =>
      backExpiry === null
        ? null
        : riskReversalForExpiry(
            rows,
            backExpiry,
            resolveCarry(gex, backExpiry).rate,
            resolveCarry(gex, backExpiry).divYield,
          ),
    [rows, backExpiry, gex],
  );

  return {
    isLoading: isPending && data === undefined,
    isError,
    refetch,
    expirations,
    frontExpiry,
    backExpiry,
    setFrontExpiry: setFrontPick,
    setBackExpiry: setBackPick,
    contractType,
    setContractType,
    rows: joined,
    spot,
    observedAt,
    frontRr,
    backRr,
  };
}
