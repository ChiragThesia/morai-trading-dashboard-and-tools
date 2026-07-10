/**
 * makeAnalyzeAdHocCalendarUseCase — the ad-hoc analyze use-case (Phase 30, Plan 04, D-02).
 *
 * Scores ONE user-pasted PUT calendar through the SAME engine path as auto-surfaced
 * candidates: build a single RawCandidate mirroring `selectCandidates`'s own construction
 * (candidate-selection.ts:370-411), then score it with `scoreCalendarCandidates` — the exact
 * function the compute-picker use-case calls — so an ad-hoc calendar and an identical engine
 * candidate produce byte-identical score/breakdown/exitPlan (T-30-10 parity).
 *
 * T-28-10 (retired-gate scar): the gate/sizing/spot/asOf and the gex/events freshness
 * VERDICT (not the values) come verbatim off the latest persisted snapshot — this use-case
 * never calls `resolveEntryGate` and has no macro/open-calendar/recent-closed/chain reads in
 * its deps at all (structural exclusion, not a runtime guard). The rule-config overrides are
 * resolved FRESH per call (Phase-29 parity), same as compute-picker.
 *
 * D-02 binding #2 / binding #8 (T-19-17): no snapshot yet degrades to
 * `{scored:false, reason:"no-snapshot"}`; this use-case never throws and never persists.
 *
 * Hexagon law (architecture-boundaries §2): imports only `@morai/shared`, `@morai/quant`,
 * this bounded context's own `application`/`domain` siblings, and the settings context's
 * application port (computePickerSnapshot.ts precedent for cross-context reads).
 */

import { ok, err, assertDefined } from "@morai/shared";
import type { Result } from "@morai/shared";
import { bsmGreeks } from "@morai/quant";
import { legSpansEvents, resolveEventExit, daysBetween } from "../domain/candidate-selection.ts";
import { scoreCalendarCandidates } from "../domain/scoring.ts";
import { realizedVol } from "../domain/realized-vol.ts";
import { resolvePickerRuleConfig } from "../domain/rule-config.ts";
import type { RawCandidate } from "../domain/types.ts";
import {
  toPickerCandidateDomain,
  applyGatePenalty,
  zeroEventAdjustment,
  isPickerRuleOverrides,
  RV_CLOSES_DAYS,
  SLOPE_HISTORY_LIMIT,
} from "./computePickerSnapshot.ts";
import type {
  AdHocCalendarAnalysis,
  AdHocCalendarInput,
  ForAnalyzingAdHocCalendar,
  ForReadingDailySpotCloses,
  ForReadingEconomicEvents,
  ForReadingGexContext,
  ForReadingPickerSlopeHistory,
  ForReadingPickerSnapshot,
  StorageError,
} from "./ports.ts";
// Cross-context read of the settings bounded context's own application port — same convention
// computePickerSnapshot.ts already established (29-10, RUNTIME-*).
import type { ForReadingRuleOverrides } from "../../settings/application/ports.ts";

export type AnalyzeAdHocCalendarDeps = {
  /** The latest persisted picker snapshot — gate/sizing/spot/asOf reused verbatim (T-28-10). */
  readonly readPickerSnapshot: ForReadingPickerSnapshot;
  /** Fresh GEX context for scoring (criterion 7) — credited only when the snapshot's own
   * gexContextStatus is "ok" (the freshness VERDICT is reused, never re-derived). */
  readonly readGexContext: ForReadingGexContext;
  /** Fresh economic-events rows — feeds frontEvents/backEvents/exitBeforeIso resolution. */
  readonly readEconomicEvents: ForReadingEconomicEvents;
  /** Trailing daily closes for the experimental `vrp` rule (RV20); degrades to null on failure. */
  readonly readDailySpotCloses: ForReadingDailySpotCloses;
  /** Trailing candidate slopes for the experimental `slopePercentile` rule; degrades to []. */
  readonly readPickerSlopeHistory: ForReadingPickerSlopeHistory;
  /** Runtime rule-settings overrides (29-10), read FRESH per call — mirrors compute-picker. */
  readonly readRuleOverrides: ForReadingRuleOverrides;
  /** Risk-free rate (decimal), supplied from config. */
  readonly rate: number;
  /** Continuous dividend yield (decimal), supplied from config. */
  readonly dividendYield: number;
};

export function makeAnalyzeAdHocCalendarUseCase(
  deps: AnalyzeAdHocCalendarDeps,
): ForAnalyzingAdHocCalendar {
  return async (input: AdHocCalendarInput): Promise<Result<AdHocCalendarAnalysis, StorageError>> => {
    // ── Step 1: the latest snapshot — gate/sizing/spot/asOf/context-status reused verbatim
    // (T-28-10). No snapshot yet is a clean, documented degradation, never a throw (D-02). ──
    const snapshotResult = await deps.readPickerSnapshot();
    if (!snapshotResult.ok) return err(snapshotResult.error);
    const snapshotRow = snapshotResult.value;
    if (snapshotRow === null) return ok({ scored: false, reason: "no-snapshot" });
    const { snapshot } = snapshotRow;

    // ── Step 2: fresh rule-config overrides (29-10 parity) — a failed/malformed read degrades
    // to defaults, never fails the whole analysis (computePickerSnapshot precedent). ──
    const overridesResult = await deps.readRuleOverrides();
    const pickerOverridesRaw = overridesResult.ok ? overridesResult.value["picker"] : undefined;
    const pickerOverrides = isPickerRuleOverrides(pickerOverridesRaw) ? pickerOverridesRaw : undefined;
    const config = resolvePickerRuleConfig(pickerOverrides);

    // ── Step 3: fresh GEX + events reads — critical (computePickerSnapshot precedent: a
    // failed read here fails the whole call, never a silent stale substitution). ──
    const gexResult = await deps.readGexContext();
    if (!gexResult.ok) return err(gexResult.error);
    const gexContext = gexResult.value;

    const eventsResult = await deps.readEconomicEvents();
    if (!eventsResult.ok) return err(eventsResult.error);
    const events = eventsResult.value;

    // ── Step 3b: experimental-rule inputs — non-critical, null-honest degradation
    // (computePickerSnapshot precedent). ──
    const closesResult = await deps.readDailySpotCloses(RV_CLOSES_DAYS);
    const realizedVol20 = closesResult.ok ? realizedVol(closesResult.value) : null;

    const slopeHistoryResult = await deps.readPickerSlopeHistory(SLOPE_HISTORY_LIMIT);
    const slopeHistory = slopeHistoryResult.ok ? slopeHistoryResult.value : [];

    // ── Step 4: build ONE RawCandidate, mirroring selectCandidates' own construction
    // (candidate-selection.ts:370-411) exactly — the parity guarantee (T-30-10). ──
    const { rate: r, dividendYield: q } = deps;
    const spot = snapshot.spot;
    const asOfIso = snapshot.asOf;
    const K = input.strike;
    const tf = input.frontDte;
    const tb = input.backDte;
    const ivF = input.frontIv;
    const ivB = input.backIv;
    const fe = input.frontExpiry;
    const be = input.backExpiry;

    // CR-01: frontDte/backDte must agree with frontExpiry/backExpiry relative to the
    // snapshot's own asOf, or a caller could submit a mismatched pair that scores one
    // date's greeks against another date's exit plan (silent, money-facing desync).
    // `fe`/`be` are already Zod-validated YYYY-MM-DD strings at this point (30-05 boundary),
    // so `daysBetween`'s `isoDayNumber` call is a true invariant here, never a throw.
    if (daysBetween(asOfIso, fe) !== tf || daysBetween(asOfIso, be) !== tb) {
      return ok({ scored: false, reason: "dte-expiry-mismatch" });
    }

    const gF = bsmGreeks(spot, K, tf / 365, ivF, r, q, "P");
    const gB = bsmGreeks(spot, K, tb / 365, ivB, r, q, "P");
    const theta = (gB.theta - gF.theta) * 100;
    const vega = (gB.vega - gF.vega) * 100;
    const delta = (gB.delta - gF.delta) * 100;
    const slope = ((ivB - ivF) / (tb - tf)) * 365;

    const frontEvents = legSpansEvents(fe, asOfIso, events);
    const backEventsAll = legSpansEvents(be, asOfIso, events);
    const backEvents = backEventsAll.filter((name) => !frontEvents.includes(name));
    const { exitBeforeIso, eventInPeakTheta } = resolveEventExit(fe, events);

    // Label = the actual front |Δ| in whole delta points (band-scan/ad-hoc has no rungs).
    const deltaLabel = `${Math.round(Math.abs(gF.delta) * 100)}D`;

    // Debit = the user-supplied per-contract debit *100 (engine per-contract dollar
    // convention, matches candidate-selection's *100) — qty is NOT folded in (parity).
    const raw: RawCandidate = {
      id: `adhoc-${deltaLabel}-${K}-${fe}-${be}`,
      name: `${K}P ${fe} / ${be}`,
      frontLeg: { strike: K, putCall: "P", expiration: fe, dte: tf, iv: ivF },
      backLeg: { strike: K, putCall: "P", expiration: be, dte: tb, iv: ivB },
      deltaRung: deltaLabel,
      spot,
      theta,
      vega,
      delta,
      debit: input.debit * 100,
      slope,
      frontEvents,
      backEvents,
      exitBeforeIso,
      eventInPeakTheta,
    };

    // ── Step 5: score — the SAME formula compute-picker uses, reused verbatim (T-30-10). The
    // snapshot's own gexContextStatus/eventsContextStatus is the freshness VERDICT (never
    // re-derived with now() — this use-case has no clock dep at all). ──
    const gexContextForScoring = snapshot.gexContextStatus === "ok" ? gexContext : null;
    const [scoredRaw] = scoreCalendarCandidates([raw], gexContextForScoring, {
      r,
      q,
      realizedVol20,
      slopeHistory,
      weights: config.weights,
      debitBand: config.debitBand,
    });
    assertDefined(scoredRaw, "analyzeAdHocCalendar: scoredRaw (exactly one raw candidate scored)");
    const zeroed = snapshot.eventsContextStatus !== "ok" ? zeroEventAdjustment(scoredRaw) : scoredRaw;
    // Gate penalty applies unconditionally — even a BLOCKED gate still scores (binding #1):
    // the penalty multiplier is 0 in that state, never a hidden/withheld analysis.
    const scored = applyGatePenalty(zeroed, snapshot.gate.penaltyMultiplier);

    return ok({ scored: true, candidate: toPickerCandidateDomain(scored, "standard") });
  };
}
