/**
 * replayPickerCohort — BT-02 leakage oracle (Phase 27, Plan 05, Task 1).
 *
 * For a stored `picker_snapshot` cohort, replays chain-as-of-observedAt through the SAME
 * untouched picker pure functions (selectCandidates -> scoreCalendarCandidates -> the
 * eventsContextStatus post-step -> rankAndCapCandidates, mirroring
 * computePickerSnapshot.ts's own read->select->score->rank sequence exactly) and asserts the
 * replayed score reproduces the stored score EXACTLY for every matched candidate id.
 *
 * Pattern 1 (27-RESEARCH.md): the oracle reuses the stored snapshot's FROZEN gex/events/
 * gexContextStatus/eventsContextStatus fields verbatim -- it never re-derives GEX or
 * economic-events state from raw tables. The registry-drift guard runs FIRST: a cohort whose
 * stored ruleSet differs from the current RULE_SET_METADATA is flagged as drift, not
 * compared for score equality (rules.ts changing later is expected, not a leakage bug).
 *
 * `stored.snapshot` arrives as an untyped Record<string, unknown> (ports.ts's hexagon-pure
 * declaration -- core cannot import @morai/contracts). It is re-validated here through a
 * backtest-owned local Zod schema (parse, don't cast -- typescript.md) covering only the
 * fields this replay needs, mirroring ports.ts's own "backtest-owned re-declaration, never a
 * foreign context's domain/ import" convention.
 *
 * Hexagon law (architecture-boundaries §2/§7): imports only @morai/shared + the reused picker
 * pure functions/types threaded to @morai/core (27-02) + this context's own ports/types. The
 * self-import of "@morai/core" mirrors reuse-exports.test.ts's proven precedent (27-02) --
 * backtest is itself a bounded context living inside packages/core, and the picker/exit reuse
 * seam was built specifically so sibling contexts inside core pull from the top-level barrel.
 */

import { z } from "zod";
import { ok, err } from "@morai/shared";
import type { Result } from "@morai/shared";
import {
  selectCandidates,
  scoreCalendarCandidates,
  rankAndCapCandidates,
  PICKER_TOP_N,
  RULE_SET_METADATA,
  realizedVol,
} from "@morai/core";
import type {
  ChainQuoteForPicker,
  EconomicEvent,
  GateDrops,
  GexContextForPicker,
  RuleMetadata,
  ScoredCandidate,
} from "@morai/core";
import type {
  ChainLegQuoteAsOf,
  ForReadingChainAsOf,
  ForReadingDailySpotClosesAsOf,
  StorageError,
  StoredPickerSnapshotRow,
} from "../application/ports.ts";
import type { CohortMismatch } from "../domain/types.ts";

// ─── Local schema — the subset of PickerSnapshot this replay needs (parse, don't cast) ────

const breakdownEntrySchema = z.object({
  criterion: z.enum([
    "slope",
    "fwdEdge",
    "gexFit",
    "eventAdjustment",
    "beVsEm",
    "deltaNeutral",
    "thetaVega",
    "vrp",
    "debitFit",
  ]),
  weight: z.number(),
  rawValue: z.number(),
  contribution: z.number(),
});

const storedCandidateSchema = z.object({
  id: z.string(),
  score: z.number(),
  breakdown: z.array(breakdownEntrySchema),
});

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

const ruleSetEntrySchema = z.object({
  id: z.string(),
  label: z.string(),
  kind: z.enum(["gate", "score", "experimental"]),
  weight: z.number(),
  status: z.enum(["active", "experimental"]),
  rationale: z.string(),
});

const gateDropsSchema = z.object({
  liquidity: z.number(),
  netTheta: z.number(),
  termInverted: z.number(),
  eventBlackout: z.number(),
});

const storedSnapshotSchema = z.object({
  gexContextStatus: z.enum(["ok", "stale", "missing"]),
  eventsContextStatus: z.enum(["ok", "stale", "missing"]),
  events: z.array(z.object({ date: z.string(), name: z.enum(["FOMC", "CPI", "NFP"]) })),
  gex: gexSchema,
  ruleSet: z.array(ruleSetEntrySchema),
  candidates: z.array(storedCandidateSchema),
  gateDrops: gateDropsSchema,
});

type StoredSnapshot = z.infer<typeof storedSnapshotSchema>;

// ─── Adapters from the backtest's own as-of-T read shapes to the picker's pure-fn inputs ──

/** ChainLegQuoteAsOf -> ChainQuoteForPicker: mirrors picker-chain.ts's raw-source mapping
 * (row.source === "schwab_chain" ? "schwab" : "cboe") -- a data-shape adapter, not scoring
 * logic; every scored field passes through unchanged. */
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

/** The frozen snapshot's events only ever stored tier-1 names (the live writer's own
 * EconomicEvent.name is already that closed union) -- z.enum above already narrows this on
 * parse. `source` is a structural filler: selectCandidates/legSpansEvents never read it. */
function toEconomicEvents(events: StoredSnapshot["events"]): ReadonlyArray<EconomicEvent> {
  return events.map((e) => ({ date: e.date, name: e.name, source: "seed" as const }));
}

/** The frozen gex is reused verbatim (Pattern 1) -- computedAt is unused by gexFitFraction
 * (only flip/wall/nearTerm fields feed scoring; the ok/stale/missing status is already
 * resolved via the frozen gexContextStatus field, never re-derived here). */
function toGexContextForPicker(gex: StoredSnapshot["gex"], observedAt: Date): GexContextForPicker {
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

/**
 * Mirrors computePickerSnapshot.ts's private zeroEventAdjustment EXACTLY (not exported --
 * this task's file scope doesn't touch picker/ files). Same 5-line post-scoring step
 * (zero the eventAdjustment breakdown entry, recompute the total from the breakdown), not a
 * second scoring formula -- required to reproduce the live snapshot when eventsContextStatus
 * was not "ok" at write time.
 */
function zeroEventAdjustment(candidate: ScoredCandidate): ScoredCandidate {
  const breakdown = candidate.breakdown.map((entry) =>
    entry.criterion === "eventAdjustment" ? { ...entry, rawValue: 0, contribution: 0 } : entry,
  );
  const rawScore = breakdown.reduce((sum, entry) => sum + (entry.weight * entry.contribution) / 100, 0);
  const score = Math.min(100, Math.max(0, Math.round(rawScore)));
  return { ...candidate, breakdown, score };
}

/** Compares the stored ruleSet (id/label/kind/weight/status/rationale) against the CURRENT
 * RULE_SET_METADATA. Order-independent (by id) -- robust to a future registry reorder. */
function ruleSetsEqual(
  stored: ReadonlyArray<StoredSnapshot["ruleSet"][number]>,
  current: ReadonlyArray<RuleMetadata>,
): boolean {
  if (stored.length !== current.length) return false;
  const byId = new Map(stored.map((rule) => [rule.id, rule]));
  for (const rule of current) {
    const match = byId.get(rule.id);
    if (match === undefined) return false;
    if (
      match.label !== rule.label ||
      match.kind !== rule.kind ||
      match.weight !== rule.weight ||
      match.status !== rule.status ||
      match.rationale !== rule.rationale
    ) {
      return false;
    }
  }
  return true;
}

/** First breakdown criterion whose rawValue/contribution diverges between replayed and
 * stored -- named in the mismatch detail so a failure points at the diverging rule, never
 * just a bare score diff. */
function findDivergingCriterion(
  replayed: ReadonlyArray<{ readonly criterion: string; readonly rawValue: number; readonly contribution: number }>,
  stored: ReadonlyArray<{ readonly criterion: string; readonly rawValue: number; readonly contribution: number }>,
): string | null {
  const storedByCriterion = new Map(stored.map((entry) => [entry.criterion, entry]));
  for (const entry of replayed) {
    const match = storedByCriterion.get(entry.criterion);
    if (match === undefined) continue;
    if (entry.rawValue !== match.rawValue || entry.contribution !== match.contribution) return entry.criterion;
  }
  return null;
}

/** Diff by Map<id>, never array position (rank order != generation order -- Pitfall,
 * 27-RESEARCH.md). An id present on only one side is a louder membership-mismatch, distinct
 * from a score-mismatch on a matched id. */
function diffCandidatesById(
  replayed: ReadonlyArray<ScoredCandidate>,
  stored: ReadonlyArray<StoredSnapshot["candidates"][number]>,
  observedAtIso: string,
): ReadonlyArray<CohortMismatch> {
  const mismatches: CohortMismatch[] = [];
  const replayedById = new Map(replayed.map((c) => [c.id, c]));
  const storedById = new Map(stored.map((c) => [c.id, c]));

  for (const [id, storedCandidate] of storedById) {
    const replayedCandidate = replayedById.get(id);
    if (replayedCandidate === undefined) {
      mismatches.push({
        kind: "membership-mismatch",
        observedAt: observedAtIso,
        detail: `candidate ${id} present in the stored snapshot but missing from the replay`,
        candidateId: id,
      });
      continue;
    }
    if (replayedCandidate.score !== storedCandidate.score) {
      const divergingCriterion = findDivergingCriterion(replayedCandidate.breakdown, storedCandidate.breakdown);
      const criterionNote = divergingCriterion !== null ? ` (criterion "${divergingCriterion}" diverged first)` : "";
      mismatches.push({
        kind: "score-mismatch",
        observedAt: observedAtIso,
        detail: `candidate ${id} score diverged: replayed=${replayedCandidate.score} stored=${storedCandidate.score}${criterionNote}`,
        candidateId: id,
      });
    }
  }
  for (const id of replayedById.keys()) {
    if (!storedById.has(id)) {
      mismatches.push({
        kind: "membership-mismatch",
        observedAt: observedAtIso,
        detail: `candidate ${id} present in the replay but missing from the stored snapshot`,
        candidateId: id,
      });
    }
  }
  return mismatches;
}

/** gateDrops replayed vs stored are diffed and reported as one record (not per-field --
 * behavior spec just requires "diffed and reported"). */
function diffGateDrops(
  replayed: GateDrops,
  stored: StoredSnapshot["gateDrops"],
  observedAtIso: string,
): ReadonlyArray<CohortMismatch> {
  const diffs: string[] = [];
  if (replayed.liquidity !== stored.liquidity) {
    diffs.push(`liquidity replayed=${replayed.liquidity} stored=${stored.liquidity}`);
  }
  if (replayed.netTheta !== stored.netTheta) {
    diffs.push(`netTheta replayed=${replayed.netTheta} stored=${stored.netTheta}`);
  }
  if (replayed.termInverted !== stored.termInverted) {
    diffs.push(`termInverted replayed=${replayed.termInverted} stored=${stored.termInverted}`);
  }
  if (replayed.eventBlackout !== stored.eventBlackout) {
    diffs.push(`eventBlackout replayed=${replayed.eventBlackout} stored=${stored.eventBlackout}`);
  }
  if (diffs.length === 0) return [];
  return [{ kind: "gate-drop-mismatch", observedAt: observedAtIso, detail: diffs.join("; ") }];
}

// ─── replayPickerCohort ─────────────────────────────────────────────────────────

export type ReplayPickerCohortDeps = {
  readonly readChainAsOf: ForReadingChainAsOf;
  readonly readDailySpotClosesAsOf: ForReadingDailySpotClosesAsOf;
  /** Risk-free rate (decimal), supplied from config -- mirrors computePickerSnapshot.ts. */
  readonly rate: number;
  /** Continuous dividend yield (decimal), supplied from config. */
  readonly dividendYield: number;
};

/** Daily closes read for RV20 -- mirrors computePickerSnapshot.ts's RV_CLOSES_DAYS. */
const RV_CLOSES_DAYS = 21;

export async function replayPickerCohort(
  stored: StoredPickerSnapshotRow,
  deps: ReplayPickerCohortDeps,
): Promise<Result<ReadonlyArray<CohortMismatch>, StorageError>> {
  const observedAtIso = stored.observedAt.toISOString();

  const parsed = storedSnapshotSchema.safeParse(stored.snapshot);
  if (!parsed.success) {
    return err({
      kind: "storage-error",
      message: `replayPickerCohort: malformed stored snapshot at ${observedAtIso} — ${parsed.error.message}`,
    });
  }
  const snapshot = parsed.data;

  // Registry-drift guard FIRST (Pitfall, 27-RESEARCH.md): a mismatch below would be expected
  // drift once rules.ts changes, not a leakage bug -- skip score-equality entirely.
  if (!ruleSetsEqual(snapshot.ruleSet, RULE_SET_METADATA)) {
    return ok([
      {
        kind: "registry-drift",
        observedAt: observedAtIso,
        detail: "stored ruleSet differs from the current RULE_SET_METADATA — rules.ts changed since this cohort was scored, not a leakage bug",
      },
    ]);
  }

  const chainResult = await deps.readChainAsOf(stored.observedAt);
  if (!chainResult.ok) return chainResult;
  const pickerChain = chainResult.value.map(toChainQuoteForPicker);

  // WR-01: propagate a closes-read failure the same way the chain read above does. Silently
  // degrading to [] makes realizedVol20 null, which scores `vrp` differently from the stored
  // snapshot -- a transient DB hiccup would surface as a FABRICATED score-mismatch, poisoning
  // the leakage oracle's entire value (trustworthy mismatch reporting).
  const closesResult = await deps.readDailySpotClosesAsOf(RV_CLOSES_DAYS, stored.observedAt);
  if (!closesResult.ok) return closesResult;
  const realizedVol20Result = closesResult.value;
  const events = toEconomicEvents(snapshot.events);
  const gexContext = snapshot.gexContextStatus === "ok" ? toGexContextForPicker(snapshot.gex, stored.observedAt) : null;

  const { candidates: raw, gateDrops } = selectCandidates(pickerChain, events, {
    r: deps.rate,
    q: deps.dividendYield,
  });
  let scored = scoreCalendarCandidates(raw, gexContext, {
    r: deps.rate,
    q: deps.dividendYield,
    realizedVol20: realizedVol20Result.length > 0 ? realizedVol(realizedVol20Result) : null,
  });
  if (snapshot.eventsContextStatus !== "ok") {
    scored = scored.map(zeroEventAdjustment);
  }
  const ranked = rankAndCapCandidates(scored, PICKER_TOP_N);

  const mismatches = [
    ...diffCandidatesById(ranked, snapshot.candidates, observedAtIso),
    ...diffGateDrops(gateDrops, snapshot.gateDrops, observedAtIso),
  ];
  return ok(mismatches);
}
