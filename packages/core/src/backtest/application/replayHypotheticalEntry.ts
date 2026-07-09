/**
 * replayHypotheticalEntry — BT-04 full-universe entry+exit simulation (Phase 27, Plan 05,
 * Task 3).
 *
 * At an in-range cohort (the SAME 03's readPickerSnapshotsInRange ledger BT-02 iterates),
 * scores the FULL (uncapped -- not rankAndCapCandidates's top-8) candidate universe through
 * the untouched selectCandidates -> scoreCalendarCandidates, accepting an optional per-rule
 * weights override (the ablation seam, 27-02). Each scored candidate is then forward-walked
 * through evaluateExit on a synthetic MarketContext assembled from the as-of-T chain slice
 * via computeLegPairMetrics (Pattern 5, 27-RESEARCH.md), with the entry priced at the
 * candidate's own haircut-priced debit (selectCandidates already haircut-prices it) and the
 * exit priced via the SAME haircutFill on the as-of-T quotes.
 *
 * GEX is reused from the cohort's frozen snapshot fields (Pattern 1 -- this replay iterates
 * the SAME stored-snapshot ledger BT-02 does, so the frozen gex is exactly as authoritative
 * here as it is for the oracle check). Economic events use the CURRENT readEconomicEvents
 * (documented leakage caveat, 27-RESEARCH.md "Pitfall: events-leakage gap is structurally
 * unfixable" -- economic_events has no discoveredAt column). Late-solved-BSM optimism is a
 * standing caveat too (no bsm_solved_at column exists). Both caveats are attached to every
 * outcome, not silently absorbed.
 *
 * ponytail: `selectCandidates`'s liquidity/netTheta/termInverted/eventBlackout gates are
 * hard-coded internal filters with no bypass export, and picker_snapshot only ever persists
 * gate-drop COUNTS, never identities -- genuinely gate-dropped strikes are structurally
 * irrecoverable without reimplementing candidate-selection (forbidden by BT-01's
 * zero-reimplementation lock). "Full universe" here means every strike selectCandidates
 * itself returns, uncapped by the top-8 display cap -- the maximal survivorship-bias
 * reduction achievable through the untouched engine. Upgrade path: a future plan could add
 * an additive `includeGateDropped` diagnostic export to candidate-selection.ts if the
 * survivorship gap proves material.
 *
 * A candidate whose front/back leg is missing (or NaN-stamped) from the as-of-T chain slice
 * degrades to `indicative: true` via computeLegPairMetrics' own NaN propagation ->
 * evaluateExit's hasNaN gate -- skipped, never simulated at a fabricated price (T-27-12).
 *
 * Hexagon law (architecture-boundaries §2/§7): imports only @morai/shared + the reused
 * picker/exits/journal pure functions threaded to @morai/core (self-import, mirrors
 * replayPickerCohort.ts's precedent) + this context's own ports/types.
 */

import { z } from "zod";
import { ok, err, parseOccSymbol, formatOccSymbol } from "@morai/shared";
import type { Result } from "@morai/shared";
import {
  selectCandidates,
  scoreCalendarCandidates,
  evaluateExit,
  haircutFill,
  computeLegPairMetrics,
  isWithinRth,
  isNyseHoliday,
  realizedVol,
} from "@morai/core";
import type {
  BreakdownCriterion,
  BreakdownEntry,
  ChainQuoteForPicker,
  EconomicEvent,
  ForReadingEconomicEvents,
  GexContextForPicker,
  HeldPosition,
  LegSnapshot,
  MarketContext,
  ScoredCandidate,
} from "@morai/core";
import type {
  ChainLegQuoteAsOf,
  ForReadingChainAsOf,
  ForReadingDailySpotClosesAsOf,
  StorageError,
  StoredPickerSnapshotRow,
} from "../application/ports.ts";

// ─── Local schema — only the frozen GEX fields this replay needs (parse, don't cast) ──────

const gexSchema = z.object({
  flip: z.number().nullable(),
  callWall: z.number().nullable(),
  putWall: z.number().nullable(),
  netGammaAtSpot: z.number(),
  absGammaStrike: z.number().nullable(),
  nearTerm: z
    .object({
      callWall: z.number().nullable(),
      putWall: z.number().nullable(),
      flip: z.number().nullable(),
    })
    .nullable(),
});

const frozenGexSchema = z.object({
  gexContextStatus: z.enum(["ok", "stale", "missing"]),
  gex: gexSchema,
});

// ─── Outcome shape (application-local -- Task 3's file scope excludes domain/types.ts) ────

export type HypotheticalOutcomeCaveat = "events-leakage" | "late-bsm-optimism";

export type HypotheticalCandidateOutcome = {
  readonly cohortObservedAt: string; // ISO instant
  readonly candidateId: string;
  readonly score: number;
  readonly simulatedPnl: number;
  readonly caveats: ReadonlyArray<HypotheticalOutcomeCaveat>;
  /** The candidate's per-criterion score breakdown (Plan 06 addition) — runBacktest's
   * per-rule directional attribution needs each rule's own raw contribution alongside the
   * outcome (median-split "high-scoring beat low-scoring" sign test, 27-CONTEXT.md); the
   * aggregate `score` alone can't be attributed back to one rule. Purely additive — no
   * existing field changed. */
  readonly breakdown: ReadonlyArray<BreakdownEntry>;
};

const OUTCOME_CAVEATS: ReadonlyArray<HypotheticalOutcomeCaveat> = ["events-leakage", "late-bsm-optimism"];

// ─── Adapters (mirrors replayPickerCohort.ts's toChainQuoteForPicker/toGexContextForPicker) ─

function toChainQuoteForPicker(leg: ChainLegQuoteAsOf): ChainQuoteForPicker {
  return {
    time: leg.time,
    strike: leg.strike,
    expiration: leg.expiration,
    contractType: leg.contractType,
    underlyingPrice: leg.underlyingPrice,
    bsmIv: leg.bsmIv === null ? null : String(leg.bsmIv),
    bid: leg.bid,
    ask: leg.ask,
    openInterest: leg.openInterest,
    source: leg.source === "schwab_chain" ? "schwab" : "cboe",
  };
}

function toGexContextForPicker(gex: z.infer<typeof gexSchema>, observedAt: Date): GexContextForPicker {
  return {
    flip: gex.flip,
    callWall: gex.callWall,
    putWall: gex.putWall,
    netGammaAtSpot: gex.netGammaAtSpot,
    absGammaStrike: gex.absGammaStrike,
    nearTermFlip: gex.nearTerm?.flip ?? null,
    nearTermCallWall: gex.nearTerm?.callWall ?? null,
    nearTermPutWall: gex.nearTerm?.putWall ?? null,
    computedAt: observedAt,
  };
}

function findLeg(
  chain: ReadonlyArray<ChainLegQuoteAsOf>,
  strike: number,
  expiration: string,
): ChainLegQuoteAsOf | undefined {
  return chain.find((q) => q.strike === strike && q.expiration === expiration && q.contractType === "P");
}

/** Mirrors journal/application/snapshotCalendars.ts's SNAPSHOT_LEG_STALENESS_TOLERANCE_MS
 * (not exported -- this task's file scope doesn't touch journal/ files). Structurally almost
 * never trips given readChainAsOf's 10-min lookback window (RESEARCH Pattern 5: "the
 * staleness gate degrades gracefully to 'never fires on backtest replay' except via the
 * explicit leg-freshness check") -- kept as defense-in-depth against a future window widen. */
const LEG_FRESHNESS_TOLERANCE_MS = 45 * 60 * 1000;

function isLegFresh(leg: ChainLegQuoteAsOf | undefined, cohortObservedAt: Date): leg is ChainLegQuoteAsOf {
  if (leg === undefined) return false;
  return Math.abs(cohortObservedAt.getTime() - leg.time.getTime()) <= LEG_FRESHNESS_TOLERANCE_MS;
}

function toLegSource(source: string): "cboe" | "schwab_chain" | "computed_only" {
  if (source === "schwab_chain") return "schwab_chain";
  if (source === "computed_only") return "computed_only";
  return "cboe";
}

/** Re-brands the raw chain leg's occSymbol string as OccSymbol (parse, don't cast --
 * typescript.md; mirrors calendar-snapshots.ts's established parseOccSymbol/formatOccSymbol
 * round-trip). Null when the stored string isn't valid OCC format -- treated the same as a
 * missing leg by the caller, never a cast-through fabrication. occSymbol itself is otherwise
 * inert here: computeLegPairMetrics never reads it. */
function toLegSnapshot(leg: ChainLegQuoteAsOf): LegSnapshot | null {
  const parsedOcc = parseOccSymbol(leg.occSymbol);
  if (!parsedOcc.ok) return null;
  return {
    occSymbol: formatOccSymbol(parsedOcc.value),
    time: leg.time,
    mark: leg.mark,
    underlyingPrice: leg.underlyingPrice,
    ivRaw: null,
    bsmIv: leg.bsmIv === null ? null : String(leg.bsmIv),
    bsmDelta: leg.bsmDelta === null ? null : String(leg.bsmDelta),
    bsmGamma: leg.bsmGamma === null ? null : String(leg.bsmGamma),
    bsmTheta: leg.bsmTheta === null ? null : String(leg.bsmTheta),
    bsmVega: leg.bsmVega === null ? null : String(leg.bsmVega),
    source: toLegSource(leg.source),
  };
}

/** Forward-walks one scored candidate to a simulated P&L, or null when the candidate is
 * skipped (leg missing/stale/NaN -- never simulated at a fabricated price). */
function simulateCandidateExit(
  candidate: ScoredCandidate,
  chain: ReadonlyArray<ChainLegQuoteAsOf>,
  cohortObservedAt: Date,
): number | null {
  // candidate.frontLeg/backLeg.strike are already converted to POINTS (RawCandidateLeg's own
  // convention); ChainLegQuoteAsOf.strike is still the raw ×1000 int convention — convert
  // back before matching (Pitfall 1, mirrors candidate-selection.ts's own conversion boundary).
  const frontLegRaw = findLeg(chain, candidate.frontLeg.strike * 1000, candidate.frontLeg.expiration);
  const backLegRaw = findLeg(chain, candidate.backLeg.strike * 1000, candidate.backLeg.expiration);
  const frontFresh = isLegFresh(frontLegRaw, cohortObservedAt) ? frontLegRaw : undefined;
  const backFresh = isLegFresh(backLegRaw, cohortObservedAt) ? backLegRaw : undefined;

  const metrics = computeLegPairMetrics(
    cohortObservedAt,
    frontFresh !== undefined ? toLegSnapshot(frontFresh) : null,
    backFresh !== undefined ? toLegSnapshot(backFresh) : null,
    1, // HYPOTHETICAL_QTY: position sizing is out of scope this phase; direction/sign is qty-invariant.
    candidate.frontLeg.expiration,
    candidate.backLeg.expiration,
  );

  const netMark = Number(metrics.netMark);
  const frontIv = Number(metrics.frontIv);
  const backIv = Number(metrics.backIv);
  const spot = Number(metrics.spot);

  const marketSession: "rth" | "after-hours" =
    isWithinRth(cohortObservedAt) && !isNyseHoliday(cohortObservedAt) ? "rth" : "after-hours";

  const position: HeldPosition = {
    calendarId: "hypothetical",
    name: candidate.name,
    strike: candidate.frontLeg.strike,
    qty: 1,
    openNetDebit: candidate.debit / 100,
    frontExpiry: candidate.frontLeg.expiration,
    backExpiry: candidate.backLeg.expiration,
  };
  const context: MarketContext = {
    netMark,
    pnlOpen: (netMark - position.openNetDebit) * 100,
    spot,
    frontIv,
    backIv,
    dteFront: metrics.dteFront,
    dteBack: metrics.dteBack,
    snapshotTime: cohortObservedAt,
    cohortNow: cohortObservedAt,
    marketSession,
    tier1Events: [],
    rollChain: { candidates: [] },
  };

  const verdict = evaluateExit(position, context, null);
  if (verdict.indicative) return null; // gap/missing-leg/NaN — skip, never fill on garbage

  // Both legs are guaranteed non-null here (indicative would be true otherwise via the
  // NaN-propagation chain), so the haircut close price is always computable.
  if (frontFresh === undefined || backFresh === undefined) return null;
  const exitValue = haircutFill(backFresh, "sell") - haircutFill(frontFresh, "buy");
  const entryValue = candidate.debit / 100;
  return (exitValue - entryValue) * 100;
}

// ─── replayHypotheticalEntry ────────────────────────────────────────────────────

export type ReplayHypotheticalEntryDeps = {
  readonly readChainAsOf: ForReadingChainAsOf;
  readonly readEconomicEvents: ForReadingEconomicEvents;
  readonly readDailySpotClosesAsOf: ForReadingDailySpotClosesAsOf;
  readonly rate: number;
  readonly dividendYield: number;
};

const RV_CLOSES_DAYS = 21;

export async function replayHypotheticalEntry(
  cohort: StoredPickerSnapshotRow,
  deps: ReplayHypotheticalEntryDeps,
  weights?: Partial<Record<BreakdownCriterion, number>>,
): Promise<Result<ReadonlyArray<HypotheticalCandidateOutcome>, StorageError>> {
  const parsed = frozenGexSchema.safeParse(cohort.snapshot);
  if (!parsed.success) {
    return err({
      kind: "storage-error",
      message: `replayHypotheticalEntry: malformed stored snapshot at ${cohort.observedAt.toISOString()} — ${parsed.error.message}`,
    });
  }

  const chainResult = await deps.readChainAsOf(cohort.observedAt);
  if (!chainResult.ok) return chainResult;
  const chain = chainResult.value;

  // Gap cohort guard (T-27-12): no chain data at/before observedAt -- skip, never simulate
  // at spot=0.
  if (chain.length === 0) return ok([]);

  const eventsResult = await deps.readEconomicEvents();
  if (!eventsResult.ok) return eventsResult;
  const events: ReadonlyArray<EconomicEvent> = eventsResult.value;

  const closesResult = await deps.readDailySpotClosesAsOf(RV_CLOSES_DAYS, cohort.observedAt);
  const realizedVol20 = closesResult.ok && closesResult.value.length > 0 ? realizedVol(closesResult.value) : null;

  const pickerChain = chain.map(toChainQuoteForPicker);
  const { candidates: raw } = selectCandidates(pickerChain, events, { r: deps.rate, q: deps.dividendYield });

  const frozenGexContext = parsed.data.gexContextStatus === "ok" ? toGexContextForPicker(parsed.data.gex, cohort.observedAt) : null;
  // exactOptionalPropertyTypes forbids an explicit `weights: undefined` — omit the key
  // entirely when the caller didn't pass an ablation override (27-02 precedent).
  const scored = scoreCalendarCandidates(raw, frozenGexContext, {
    r: deps.rate,
    q: deps.dividendYield,
    realizedVol20,
    ...(weights !== undefined ? { weights } : {}),
  });

  const outcomes: HypotheticalCandidateOutcome[] = [];
  for (const candidate of scored) {
    const simulatedPnl = simulateCandidateExit(candidate, chain, cohort.observedAt);
    if (simulatedPnl === null) continue;
    outcomes.push({
      cohortObservedAt: cohort.observedAt.toISOString(),
      candidateId: candidate.id,
      score: candidate.score,
      simulatedPnl,
      caveats: OUTCOME_CAVEATS,
      breakdown: candidate.breakdown,
    });
  }
  return ok(outcomes);
}
