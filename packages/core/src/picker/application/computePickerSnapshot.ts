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

import { ok, err, assertDefined } from "@morai/shared";
import type { Result } from "@morai/shared";
import { selectCandidates } from "../domain/candidate-selection.ts";
import { scoreCalendarCandidates } from "../domain/scoring.ts";
import type { ScoredCandidate } from "../domain/types.ts";
import type {
  ChainQuoteForPicker,
  EconomicEvent,
  ForPersistingPickerSnapshot,
  ForReadingChainForPicker,
  ForReadingEconomicEvents,
  ForReadingGexContext,
  ForRunningComputePicker,
  GexContextForPicker,
  PickerCandidateDomain,
  PickerSnapshot,
  StorageError,
} from "./ports.ts";

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
function toPickerCandidateDomain(candidate: ScoredCandidate): PickerCandidateDomain {
  return {
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

    // ── Step 4: Select + score (D-17: pass null gexContext whenever not "ok") ──
    const raw = selectCandidates(chain, events, { r: deps.rate, q: deps.dividendYield });
    const gexContextForScoring = gexContextStatus === "ok" ? gexContext : null;
    let scored = scoreCalendarCandidates(raw, gexContextForScoring, {
      r: deps.rate,
      q: deps.dividendYield,
    });
    if (eventsContextStatus !== "ok") {
      scored = scored.map(zeroEventAdjustment);
    }

    // ── Step 5: Rank (stable id tie-break) + cap at PICKER_TOP_N (D-03) ──────
    const ranked = rankAndCapCandidates(scored, PICKER_TOP_N);
    const candidates: ReadonlyArray<PickerCandidateDomain> = ranked.map(toPickerCandidateDomain);

    // ── Step 6: Assemble the snapshot ────────────────────────────────────────
    const gexForSnapshot =
      gexContext !== null
        ? {
            flip: gexContext.flip,
            callWall: gexContext.callWall,
            putWall: gexContext.putWall,
            netGammaAtSpot: gexContext.netGammaAtSpot,
            absGammaStrike: gexContext.absGammaStrike,
          }
        : { flip: null, callWall: null, putWall: null, netGammaAtSpot: 0, absGammaStrike: null };

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
      termStructure,
      gex: gexForSnapshot,
      events: eventsForSnapshot,
      candidates,
    };

    // ── Step 7: Persist (D-06 append-only; observedAt = cohort data time, NEVER now()) ──
    const persistResult = await deps.persistPickerSnapshot({ observedAt: latestTime, snapshot });
    if (!persistResult.ok) return err(persistResult.error);

    return ok(undefined);
  };
}
