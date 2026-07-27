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
import { useChain } from "./useChain.ts";
import { buildCalendarRow } from "../lib/chain-math.ts";
import type { ChainCalendarRow } from "../lib/chain-math.ts";
import { riskReversalForExpiry } from "../lib/chain-risk-reversal.ts";
import type { ChainRow } from "../lib/chain-contract.ts";

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
  readonly rows: ReadonlyArray<ChainCalendarRow>;
  readonly spot: number | null;
  readonly observedAt: string | null;
  readonly frontRr: number | null;
  readonly backRr: number | null;
}

/**
 * IV of the strike closest to spot.
 *
 * CALLER OBLIGATION: `rows` must already be narrowed to ONE expiry and ONE
 * contractType. Calls and puts trace different skew curves, so an ATM reference
 * taken from the other wing makes every V-Skew in the column quietly wrong —
 * and unlike every other value here it cannot null itself to say so.
 */
function atmIv(rows: ReadonlyArray<ChainRow>, spot: number | null): number | null {
  if (spot === null) return null;
  let best: number | null = null;
  let bestErr = Number.POSITIVE_INFINITY;
  for (const row of rows) {
    if (row.bsmIv === null) continue;
    const err = Math.abs(row.strike / 1000 - spot);
    if (err < bestErr) {
      bestErr = err;
      best = row.bsmIv;
    }
  }
  return best;
}

export function useChainModel(): ChainModel {
  const { data, isPending, isError, refetch } = useChain();
  const rows = useMemo<ReadonlyArray<ChainRow>>(() => data?.rows ?? [], [data]);

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

  const joined = useMemo<ReadonlyArray<ChainCalendarRow>>(() => {
    if (frontExpiry === null || backExpiry === null) return [];
    // JOIN KEY = expiration + contractType + strike. The chain carries BOTH wings, so a
    // strike-only join silently pairs a put front against a call back — and every input is
    // present and finite, so the em-dash discipline never fires. The row just reads wrong.
    // (Same bug shipped once in the exit advisor's toRollCandidates.) Both wings must be
    // filtered BEFORE the strike map is built, never after.
    const frontLegs = frontAll.filter((r) => r.contractType === contractType);
    const backLegs = backAll.filter((r) => r.contractType === contractType);
    // ATM reference for V-Skew: taken from the WING-FILTERED rows, never frontAll/backAll.
    // See atmIv's caller obligation — this is the one value in the table that cannot signal
    // its own wrongness.
    const frontAtm = atmIv(frontLegs, spot);
    const backAtm = atmIv(backLegs, spot);
    const backByStrike = new Map(backLegs.map((r) => [r.strike, r]));
    const out: ChainCalendarRow[] = [];
    for (const front of frontLegs) {
      const back = backByStrike.get(front.strike);
      if (back === undefined) continue;
      out.push(buildCalendarRow(front, back, frontAtm, backAtm));
    }
    return out.sort((a, b) => a.strike - b.strike);
  }, [frontAll, backAll, frontExpiry, backExpiry, contractType, spot]);

  // RR spans BOTH option types of an expiry — it is a property of the expiry, not
  // of whichever side the table is currently showing.
  const frontRr = useMemo(() => riskReversalForExpiry(frontAll), [frontAll]);
  const backRr = useMemo(() => riskReversalForExpiry(backAll), [backAll]);

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
