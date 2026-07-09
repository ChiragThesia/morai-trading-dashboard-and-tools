/**
 * makeComputePickerSnapshotUseCase — the compute-picker use-case (Phase 19, Plan 06).
 *
 * Reads the latest chain cohort + GEX context + economic events, selects the delta-targeted
 * put-calendar universe (19-03 `selectCandidates`), scores it (19-03 `scoreCalendarCandidates`),
 * tags degraded contexts honestly (D-17: "ok" | "stale" | "missing", never silent), ranks with
 * a stable id tie-break and caps at PICKER_TOP_N (D-03), and persists exactly ONE
 * PickerSnapshotRow stamped with the cohort's own data instant.
 *
 * Mirrors `analytics/application/computeGexSnapshot.ts`'s read->guard-empty->compute->persist
 * shape exactly: observedAt is NEVER now() — it derives from the chain cohort's latest quote
 * time. now() is injected for freshness-window bounding ONLY (06-06 CR-01/CR-02 precedent).
 *
 * D-17 never-silent guard-tagging (mirrors the fwdIv guard convention, 19-PATTERNS.md): when
 * gexContextStatus/eventsContextStatus is not "ok", the corresponding scoring term contributes
 * 0 exactly — a degraded context never produces a falsely-clean score. GEX is zeroed by passing
 * `null` into `scoreCalendarCandidates` (the domain function already treats null as "no
 * credit"); events has no analogous null-passthrough at the scoring layer (the domain function
 * derives its event penalty from `RawCandidate.frontEvents`, already resolved), so the
 * eventAdjustment breakdown entry is zeroed and the score recomputed as a post-scoring step
 * when eventsContextStatus is not "ok".
 *
 * D-18: an empty chain cohort writes no row (ok(undefined), no crash, no NaN row). A chain
 * present but zero candidates surviving the net-theta>0 filter (criterion 6) still persists a
 * row with `candidates: []` — so the UI can render "no put calendars meet net-theta>0 over the
 * {asOf} snapshot" against a real asOf/source, distinct from the cold-start "no row yet" case.
 *
 * Hexagon law (architecture-boundaries §2): imports only `@morai/shared` + this bounded
 * context's own `application/ports.ts` and `domain/*.ts` siblings.
 */

import { ok, err, assertDefined, isWithinRth, isNyseHoliday } from "@morai/shared";
import type { Result } from "@morai/shared";
import { selectCandidates, selectEventCandidates, autoTuneTargetDelta } from "../domain/candidate-selection.ts";
import { scoreCalendarCandidates, scoreEventCandidates } from "../domain/scoring.ts";
import { realizedVol } from "../domain/realized-vol.ts";
import { RULE_SET_METADATA } from "../domain/rules.ts";
import type { ScoredCandidate } from "../domain/types.ts";
import { resolveEntryGate, businessDaysSince, applyGatePenaltyScore } from "../domain/entry-gate.ts";
import type { EntryGateState } from "../domain/entry-gate.ts";
import { maxOpenTripped, cooldownActive, cooldownCutoff, COOLDOWN_BIZDAYS, LOSS_COOLDOWN_PCT } from "../domain/brakes.ts";
import { resolveSizingTier } from "../domain/sizing.ts";
import type {
  ChainQuoteForPicker,
  EconomicEvent,
  ForPersistingPickerSnapshot,
  ForReadingChainForPicker,
  ForReadingDailySpotCloses,
  ForReadingEconomicEvents,
  ForReadingGexContext,
  ForReadingPickerSlopeHistory,
  ForReadingPickerSnapshot,
  ForRunningComputePicker,
  GexContextForPicker,
  PickerCandidateDomain,
  PickerGate,
  PickerSizing,
  PickerSnapshot,
  StorageError,
} from "./ports.ts";
// 28-03 (PLAY-01/PLAY-02): cross-context reads for the entry gate — application-layer import of
// another bounded context's application ports (architecture-boundaries rule 7), same convention
// analytics/application/getRegimeBoard.ts already established for ForReadingMacroObservations.
import type {
  ForGettingOpenCalendars,
  ForReadingMacroObservations,
  ForReadingRecentClosedCalendars,
} from "../../journal/index.ts";

// ─── Tunables (D-03/D-17; documented, not empirically calibrated) ──────────────

/** Top-N cap (D-03: "6-8" per the approved mockup card count) — matches the mockup's
 * `top.slice(0,8)` cap verbatim (playground-v4.html). */
export const PICKER_TOP_N = 8;

/** GEX staleness window: compute-picker runs chain-triggered right after compute-gex-snapshot
 * (D-04), so anything older than this indicates the compute pipeline stalled. */
export const GEX_FRESHNESS_WINDOW_MS = 2 * 60 * 60 * 1000; // 2 hours

/** Economic-events staleness window: the events table refreshes on a weekly cron (D-14); this
 * allows one missed run before tagging the feed stale. */
export const EVENTS_FRESHNESS_WINDOW_MS = 14 * 24 * 60 * 60 * 1000; // 14 days

/** Daily closes fetched for RV20 (21 closes → 20 log returns). */
export const RV_CLOSES_DAYS = 21;

/** Trailing candidate slopes read for the experimental slopePercentile rule. */
export const SLOPE_HISTORY_LIMIT = 60;

// ─── Deps ───────────────────────────────────────────────────────────────────────

export type ComputePickerSnapshotDeps = {
  /** Read the latest full chain cohort for candidate selection. */
  readonly readChainForPicker: ForReadingChainForPicker;
  /** Read the most recent GEX context for scoring (criterion 7). */
  readonly readGexContext: ForReadingGexContext;
  /** Read persisted economic-events rows. */
  readonly readEconomicEvents: ForReadingEconomicEvents;
  /** Persist one PickerSnapshotRow (append-only, D-06). */
  readonly persistPickerSnapshot: ForPersistingPickerSnapshot;
  /** Trailing daily closes for the experimental `vrp` rule (RV20). */
  readonly readDailySpotCloses: ForReadingDailySpotCloses;
  /** Trailing candidate slopes for the experimental `slopePercentile` rule. */
  readonly readPickerSlopeHistory: ForReadingPickerSlopeHistory;
  /** Latest macro observations (VIXCLS/VXVCLS pair) for the market-level entry gate (28-03). */
  readonly readMacroObservations: ForReadingMacroObservations;
  /** Currently-open calendars — feeds the max-open anti-criteria brake (28-02/28-03). */
  readonly readOpenCalendars: ForGettingOpenCalendars;
  /** Calendars closed since the cooldown cutoff — feeds the loss-cooldown brake (28-02/28-03). */
  readonly readRecentClosedCalendars: ForReadingRecentClosedCalendars;
  /** The previously persisted snapshot — self-read for the gate's arm/disarm hysteresis (28-03). */
  readonly readPickerSnapshot: ForReadingPickerSnapshot;
  /** Risk-free rate (decimal), supplied from config. */
  readonly rate: number;
  /** Continuous dividend yield (decimal), supplied from config. */
  readonly dividendYield: number;
  /**
   * Clock injection — now() bounds gex/events freshness resolution ONLY
   * (architecture-boundaries §2 / 06-06 CR-01/CR-02 precedent). NEVER used as observedAt.
   */
  readonly now: () => Date;
};

// ─── Helpers ────────────────────────────────────────────────────────────────────

/**
 * Parse a YYYY-MM-DD ISO calendar date into a UTC instant (midnight UTC), via `Date.UTC` on
 * the parsed components — never a Date-instant constructor call across timezones
 * (candidate-selection.ts `isoDayNumber` precedent, Pitfall 3).
 */
function isoDateToUtcMs(iso: string): number {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  assertDefined(match, `isoDateToUtcMs: malformed ISO date "${iso}"`);
  const [, y, m, d] = match;
  assertDefined(y, "isoDateToUtcMs: year component");
  assertDefined(m, "isoDateToUtcMs: month component");
  assertDefined(d, "isoDateToUtcMs: day component");
  return Date.UTC(Number(y), Number(m) - 1, Number(d));
}

/** D-17: gexContextStatus — "missing" when absent, "stale" beyond the freshness window, else "ok". */
function resolveGexContextStatus(
  gexContext: GexContextForPicker | null,
  now: Date,
): "ok" | "stale" | "missing" {
  if (gexContext === null) return "missing";
  const age = now.getTime() - gexContext.computedAt.getTime();
  return age > GEX_FRESHNESS_WINDOW_MS ? "stale" : "ok";
}

/** D-17: eventsContextStatus — "missing" when empty, "stale" when the furthest-known event has
 * receded more than the freshness window into the past (the feed needs a refresh with new
 * upcoming dates), else "ok". */
function resolveEventsContextStatus(
  events: ReadonlyArray<EconomicEvent>,
  now: Date,
): "ok" | "stale" | "missing" {
  if (events.length === 0) return "missing";
  const maxEventMs = Math.max(...events.map((event) => isoDateToUtcMs(event.date)));
  const age = now.getTime() - maxEventMs;
  return age > EVENTS_FRESHNESS_WINDOW_MS ? "stale" : "ok";
}

/**
 * D-17: zero the eventAdjustment breakdown entry and recompute the total score from the
 * (possibly-modified) breakdown — the same `sum(weight * contribution / 100)` reduction
 * scoring.ts's `scoreOne` uses internally, so this is a pure post-scoring override, never a
 * second scoring formula.
 */
function zeroEventAdjustment(candidate: ScoredCandidate): ScoredCandidate {
  const breakdown = candidate.breakdown.map((entry) =>
    entry.criterion === "eventAdjustment" ? { ...entry, rawValue: 0, contribution: 0 } : entry,
  );
  const rawScore = breakdown.reduce((sum, entry) => sum + (entry.weight * entry.contribution) / 100, 0);
  const score = Math.min(100, Math.max(0, Math.round(rawScore)));
  return { ...candidate, breakdown, score };
}

// ─── Entry-gate wiring helpers (28-03, PLAY-01/PLAY-02) ─────────────────────────

/**
 * T-28-07: any of the macro/open-calendars/recent-closed reads failing fails the gate CLOSED
 * — never a silent default-open. Mirrors resolveEntryGate's own GATE BLIND shape (the
 * macro-missing path) so a read failure reads identically to "the market data is gone".
 */
const GATE_READ_ERROR: PickerGate = {
  vix: null,
  vix3m: null,
  ratio: null,
  asOf: null,
  state: "blind",
  penaltyMultiplier: 0,
  brakes: { maxOpen: false, cooldown: false, cooldownUntil: null },
  reasons: ["gateReadError"],
};

/**
 * Reconstruct enough of EntryGateState from a persisted PickerGate to feed resolveEntryGate's
 * `previousState` — only `.reasons` is actually read by the hysteresis walk (previousLabelFor
 * in entry-gate.ts), but the parameter type requires the full shape.
 */
function toEntryGateState(gate: PickerGate): EntryGateState {
  return {
    vix: gate.vix,
    vix3m: gate.vix3m,
    ratio: gate.ratio,
    asOf: gate.asOf,
    state: gate.state,
    penaltyMultiplier: gate.penaltyMultiplier,
    entriesAllowed: gate.state === "open" || gate.state === "penalty",
    reasons: gate.reasons,
  };
}

/** Project resolveEntryGate's pure output + the two brake booleans/cooldownUntil into the
 * persisted PickerGate wire shape. */
function toPickerGate(
  state: EntryGateState,
  maxOpenBrake: boolean,
  cooldownBrake: boolean,
  cooldownUntil: string | null,
): PickerGate {
  return {
    vix: state.vix,
    vix3m: state.vix3m,
    ratio: state.ratio,
    asOf: state.asOf,
    state: state.state,
    penaltyMultiplier: state.penaltyMultiplier,
    brakes: { maxOpen: maxOpenBrake, cooldown: cooldownBrake, cooldownUntil },
    reasons: state.reasons,
  };
}

/**
 * cooldownUntilFrom — the ISO date COOLDOWN_BIZDAYS business days after `closedAtIso`, walked
 * forward one day at a time using businessDaysSince as the oracle — the symmetric partner to
 * brakes.ts's cooldownCutoff (which walks BACKWARD from "now" to find the read window's start).
 * Local here: only this wiring layer needs "when does an ALREADY-TRIPPED cooldown lift" —
 * brakes.ts answers the opposite question ("how far back should the read window reach").
 */
export function cooldownUntilFrom(closedAtIso: string): string {
  const cursor = new Date(`${closedAtIso}T00:00:00.000Z`);
  for (;;) {
    cursor.setUTCDate(cursor.getUTCDate() + 1);
    const candidateIso = cursor.toISOString().slice(0, 10);
    if (businessDaysSince(closedAtIso, candidateIso) > COOLDOWN_BIZDAYS) return candidateIso;
  }
}

/**
 * toPickerSizing — resolves the VIX-tiered sizing recommendation (28-04, PLAY-03) from the
 * SAME cohort VIX the gate already resolved (`gate.vix`) — one shared read, no second macro
 * lookup. `tier`/`contracts` are null together whenever `resolveSizingTier` finds no tier
 * (null/NaN vix — GATE BLIND/gate-read-error/cold-start), never a guessed tier (T-28-11).
 */
function toPickerSizing(vix: number | null): PickerSizing {
  const resolved = resolveSizingTier(vix);
  return { tier: resolved?.tier ?? null, contracts: resolved?.contracts ?? null, vix };
}

/**
 * applyGatePenalty — scales a candidate's score by the gate's combined multiplier (28-03),
 * mirroring zeroEventAdjustment's post-scoring-override shape. Breakdown is untouched: the
 * gate penalty is explicitly NOT one of the 9 weighted scoring criteria (picker-rules.md).
 * A no-op at multiplier 1 (open state, or the read-error/blind/blocked paths where the whole
 * candidate list is zeroed out downstream anyway).
 */
function applyGatePenalty(candidate: ScoredCandidate, multiplier: number): ScoredCandidate {
  return { ...candidate, score: applyGatePenaltyScore(candidate.score, multiplier) };
}

/**
 * D-03: rank score-desc with a stable ascending-id tie-break, then cap at `topN`. Exported for
 * direct unit coverage of the tie-break path.
 */
export function rankAndCapCandidates(
  candidates: ReadonlyArray<ScoredCandidate>,
  topN: number,
): ReadonlyArray<ScoredCandidate> {
  return [...candidates]
    .sort((a, b) => b.score - a.score || a.id.localeCompare(b.id))
    .slice(0, topN);
}

/** Map a domain ScoredCandidate onto the application/contracts PickerCandidateDomain shape. */
function toPickerCandidateDomain(
  candidate: ScoredCandidate,
  bucket: "standard" | "event-calendar",
): PickerCandidateDomain {
  return {
    bucket,
    id: candidate.id,
    name: candidate.name,
    score: candidate.score,
    breakdown: candidate.breakdown,
    debit: candidate.debit,
    theta: candidate.theta,
    vega: candidate.vega,
    delta: candidate.delta,
    fwdIv: candidate.fwdIv,
    fwdIvGuard: candidate.fwdIvGuard,
    slope: candidate.slope,
    fwdEdge: candidate.fwdEdge,
    expectedMove: candidate.expectedMove,
    frontEvents: candidate.frontEvents,
    backEvents: candidate.backEvents,
    context: candidate.context,
    frontLeg: {
      strike: candidate.frontLeg.strike,
      putCall: candidate.frontLeg.putCall,
      dte: candidate.frontLeg.dte,
      iv: candidate.frontLeg.iv,
    },
    backLeg: {
      strike: candidate.backLeg.strike,
      putCall: candidate.backLeg.putCall,
      dte: candidate.backLeg.dte,
      iv: candidate.backLeg.iv,
    },
    exitPlan: candidate.exitPlan,
  };
}

/**
 * Derive a display-only ATM-IV term-structure curve from the chain cohort: one {dte, iv} point
 * per available expiry, taking the put quote whose strike is nearest the cohort spot. Not used
 * by scoring (scoring.ts consumes per-candidate leg IVs directly) — purely for the snapshot's
 * `termStructure` display field.
 */
function buildTermStructure(
  chain: ReadonlyArray<ChainQuoteForPicker>,
  spot: number,
  asOfMs: number,
): ReadonlyArray<{ readonly dte: number; readonly iv: number }> {
  const byExpiry = new Map<string, ChainQuoteForPicker[]>();
  for (const quote of chain) {
    if (quote.contractType !== "P") continue;
    if (quote.bsmIv === null) continue;
    if (!Number.isFinite(Number(quote.bsmIv))) continue;
    const bucket = byExpiry.get(quote.expiration);
    if (bucket === undefined) {
      byExpiry.set(quote.expiration, [quote]);
    } else {
      bucket.push(quote);
    }
  }

  const points: Array<{ dte: number; iv: number }> = [];
  for (const [expiration, quotes] of byExpiry) {
    let nearest: ChainQuoteForPicker | undefined;
    let nearestDiff = Number.POSITIVE_INFINITY;
    for (const quote of quotes) {
      const diff = Math.abs(quote.strike / 1000 - spot);
      if (diff < nearestDiff) {
        nearestDiff = diff;
        nearest = quote;
      }
    }
    if (nearest === undefined || nearest.bsmIv === null) continue;
    const dte = Math.round((isoDateToUtcMs(expiration) - asOfMs) / 86_400_000);
    points.push({ dte, iv: Number(nearest.bsmIv) });
  }

  return points.sort((a, b) => a.dte - b.dte);
}

// ─── Use-case ───────────────────────────────────────────────────────────────────

export function makeComputePickerSnapshotUseCase(
  deps: ComputePickerSnapshotDeps,
): ForRunningComputePicker {
  return async (): Promise<Result<void, StorageError>> => {
    // ── Step 1: Read the latest chain cohort ─────────────────────────────────
    const chainResult = await deps.readChainForPicker();
    if (!chainResult.ok) return err(chainResult.error);
    const chain = chainResult.value;

    // Empty cohort → no usable data; write no row and return ok (D-18).
    if (chain.length === 0) return ok(undefined);

    // ── Step 2: Resolve cohort spot/asOf/source (candidate-selection.ts precedent) ──
    const latestTime = chain.reduce<Date | undefined>((max, quote) => {
      if (max === undefined) return quote.time;
      return quote.time.getTime() > max.getTime() ? quote.time : max;
    }, undefined);
    assertDefined(latestTime, "computePickerSnapshot: latestTime (chain is non-empty)");
    const asOfIso = latestTime.toISOString().slice(0, 10);

    const spot = chain.reduce((sum, quote) => sum + quote.underlyingPrice, 0) / chain.length;

    const firstQuote = chain[0];
    assertDefined(firstQuote, "computePickerSnapshot: firstQuote (chain is non-empty)");
    const source = firstQuote.source;

    // ── Step 3: Read GEX + economic-events contexts ──────────────────────────
    const gexResult = await deps.readGexContext();
    if (!gexResult.ok) return err(gexResult.error);
    const gexContext = gexResult.value;

    const eventsResult = await deps.readEconomicEvents();
    if (!eventsResult.ok) return err(eventsResult.error);
    const events = eventsResult.value;

    const now = deps.now();
    const gexContextStatus = resolveGexContextStatus(gexContext, now);
    const eventsContextStatus = resolveEventsContextStatus(events, now);

    // ── Step 3c: entry-gate inputs — macro pair, open-calendar count, recent-closed rows,
    // and the previous cycle's gate for hysteresis (28-03, PLAY-01/PLAY-02) ──
    const nowIso = now.toISOString().slice(0, 10);
    const cooldownSinceIso = cooldownCutoff(nowIso);

    const macroResult = await deps.readMacroObservations();
    const openCalendarsResult = await deps.readOpenCalendars();
    const recentClosedResult = await deps.readRecentClosedCalendars(cooldownSinceIso);
    const previousSnapshotResult = await deps.readPickerSnapshot();

    // ── Step 3d: resolve the gate ONCE per cohort — never per candidate (T-28-10 regression
    // guard: the retired term-inversion gate's per-candidate placement mistake). T-28-07: any
    // of the three reads above failing fails the gate CLOSED, never a silent default-open. ──
    let gate: PickerGate;
    if (!macroResult.ok || !openCalendarsResult.ok || !recentClosedResult.ok) {
      gate = GATE_READ_ERROR;
    } else {
      const openCount = openCalendarsResult.value.length;
      const recentClosed = recentClosedResult.value;
      const maxOpenBrake = maxOpenTripped(openCount);
      const cooldownBrake = cooldownActive(recentClosed);
      const previousGate =
        previousSnapshotResult.ok && previousSnapshotResult.value !== null
          ? toEntryGateState(previousSnapshotResult.value.snapshot.gate)
          : null;

      const gateState = resolveEntryGate({
        rows: macroResult.value,
        nowIso,
        maxOpenBrake,
        cooldownBrake,
        previousState: previousGate,
      });

      // ponytail: re-filters the SAME -25% trigger cooldownActive already checked, just to find
      // WHICH row(s) tripped it (for cooldownUntil's display date) — small, local duplication
      // kept out of brakes.ts (28-02, already shipped/tested) rather than adding a second export
      // there for one caller.
      const triggeringLosses = recentClosed.filter(
        (row) =>
          row.openNetDebit !== 0 &&
          row.realizedPnl !== null &&
          row.realizedPnl / row.openNetDebit <= LOSS_COOLDOWN_PCT,
      );
      const latestTriggerClosedAt = triggeringLosses.reduce<Date | undefined>((max, row) => {
        if (max === undefined) return row.closedAt;
        return row.closedAt.getTime() > max.getTime() ? row.closedAt : max;
      }, undefined);
      const cooldownUntil =
        latestTriggerClosedAt === undefined
          ? null
          : cooldownUntilFrom(latestTriggerClosedAt.toISOString().slice(0, 10));

      gate = toPickerGate(gateState, maxOpenBrake, cooldownBrake, cooldownUntil);
    }
    const entriesAllowed =
      (gate.state === "open" || gate.state === "penalty") &&
      !gate.brakes.maxOpen &&
      !gate.brakes.cooldown;

    // ── Step 3b: Experimental-rule inputs (null-honest — a failed read degrades to
    // "insufficient history", it never fails the compute or fabricates a value) ──
    const closesResult = await deps.readDailySpotCloses(RV_CLOSES_DAYS);
    const realizedVol20 = closesResult.ok ? realizedVol(closesResult.value) : null;

    const slopeHistoryResult = await deps.readPickerSlopeHistory(SLOPE_HISTORY_LIMIT);
    const slopeHistory = slopeHistoryResult.ok ? slopeHistoryResult.value : [];

    // ── Step 4: Select + score (D-17: pass null gexContext whenever not "ok") ──
    // 28-04 (PLAY-05): autoTuneTargetDelta nudges the band's deep edge toward the far-OTM
    // edge as the cohort VIX rises (the SAME vix the gate already resolved) — a universe-
    // membership preference, never a scoring criterion (RULE_SET_METADATA untouched).
    const { candidates: raw, gateDrops } = selectCandidates(chain, events, {
      r: deps.rate,
      q: deps.dividendYield,
      effectiveDeltaMin: autoTuneTargetDelta(gate.vix),
    });
    const gexContextForScoring = gexContextStatus === "ok" ? gexContext : null;
    let scored = scoreCalendarCandidates(raw, gexContextForScoring, {
      r: deps.rate,
      q: deps.dividendYield,
      realizedVol20,
      slopeHistory,
    });
    if (eventsContextStatus !== "ok") {
      scored = scored.map(zeroEventAdjustment);
    }
    // ── Step 4b: post-scoring gate penalty (28-03) — breakdown untouched, mirrors
    // zeroEventAdjustment's post-scoring-override shape. A no-op at multiplier 1 (open state). ──
    scored = scored.map((candidate) => applyGatePenalty(candidate, gate.penaltyMultiplier));

    // ── Step 4c: event-calendar bucket (28-05, PLAY-04) — a second universe for short-gap
    // (3-10d) calendars intentionally owning an event, scored with the bucket-scoped
    // EVENT_SCORE_WEIGHTS registry. SAME gate/events-degradation/gate-penalty machinery as
    // the primary universe — T-28-15: no second un-gated entry path. ──
    const { candidates: rawEvent } = selectEventCandidates(chain, events, {
      r: deps.rate,
      q: deps.dividendYield,
      effectiveDeltaMin: autoTuneTargetDelta(gate.vix),
    });
    let scoredEvent = scoreEventCandidates(rawEvent, gexContextForScoring, {
      r: deps.rate,
      q: deps.dividendYield,
      realizedVol20,
      slopeHistory,
    });
    if (eventsContextStatus !== "ok") {
      scoredEvent = scoredEvent.map(zeroEventAdjustment);
    }
    scoredEvent = scoredEvent.map((candidate) => applyGatePenalty(candidate, gate.penaltyMultiplier));

    // ── Step 5: Rank (stable id tie-break) + cap at PICKER_TOP_N (D-03), each universe
    // independently, then concatenate — the primary universe's own ranking is unaffected
    // by the event bucket's presence. ──
    const ranked = rankAndCapCandidates(scored, PICKER_TOP_N);
    const rankedEvent = rankAndCapCandidates(scoredEvent, PICKER_TOP_N);
    // Blocked/blind/braked -> ship candidates: [] (Step 6 truth) for BOTH universes;
    // termStructure/gex/events below stay populated regardless — the board and Analyzer
    // keep their context.
    const candidates: ReadonlyArray<PickerCandidateDomain> = entriesAllowed
      ? [
          ...ranked.map((c) => toPickerCandidateDomain(c, "standard")),
          ...rankedEvent.map((c) => toPickerCandidateDomain(c, "event-calendar")),
        ]
      : [];

    // ── Step 6: Assemble the snapshot ────────────────────────────────────────
    const gexForSnapshot =
      gexContext !== null
        ? {
            flip: gexContext.flip,
            callWall: gexContext.callWall,
            putWall: gexContext.putWall,
            netGammaAtSpot: gexContext.netGammaAtSpot,
            absGammaStrike: gexContext.absGammaStrike,
            nearTerm:
              gexContext.nearTermFlip !== null ||
              gexContext.nearTermCallWall !== null ||
              gexContext.nearTermPutWall !== null
                ? {
                    callWall: gexContext.nearTermCallWall,
                    putWall: gexContext.nearTermPutWall,
                    flip: gexContext.nearTermFlip,
                  }
                : null,
          }
        : {
            flip: null,
            callWall: null,
            putWall: null,
            netGammaAtSpot: 0,
            absGammaStrike: null,
            nearTerm: null,
          };

    const eventsForSnapshot = events.map((event) => ({ date: event.date, name: event.name }));

    const asOfMs = isoDateToUtcMs(asOfIso);
    const termStructure = buildTermStructure(chain, spot, asOfMs);

    const snapshot: PickerSnapshot = {
      asOf: asOfIso,
      observedAt: latestTime.toISOString(), // WR-03: real instant, mirrors row.observedAt
      spot,
      source,
      gexContextStatus,
      eventsContextStatus,
      marketSession:
        isWithinRth(latestTime) && !isNyseHoliday(latestTime) ? "rth" : "after-hours",
      termStructure,
      gex: gexForSnapshot,
      events: eventsForSnapshot,
      candidates,
      // The registry rows this snapshot was scored with — the UI methodology panel's
      // single source of truth (rules.ts).
      ruleSet: RULE_SET_METADATA.map((rule) => ({
        id: rule.id,
        label: rule.label,
        kind: rule.kind,
        weight: rule.weight,
        status: rule.status,
        rationale: rule.rationale,
      })),
      // Per-gate drop counts — gating is never a silent cap.
      gateDrops,
      // The market-level entry gate + anti-criteria brakes (28-03, PLAY-01/PLAY-02).
      gate,
      // VIX-tiered sizing (28-04, PLAY-03) -- resolved from the SAME cohort VIX the gate read.
      sizing: toPickerSizing(gate.vix),
    };

    // ── Step 7: Persist (D-06 append-only; observedAt = cohort data time, NEVER now()) ──
    const persistResult = await deps.persistPickerSnapshot({ observedAt: latestTime, snapshot });
    if (!persistResult.ok) return err(persistResult.error);

    return ok(undefined);
  };
}
