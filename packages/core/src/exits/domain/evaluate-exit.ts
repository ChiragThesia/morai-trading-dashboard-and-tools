/**
 * evaluate-exit.ts — the pure exit-verdict evaluator (Phase 26, Plan 02).
 *
 * `evaluateExit(position, context, previousVerdict)` walks `EXIT_PRECEDENCE` in order; the
 * first rule whose condition holds (fresh-arm, OR hysteresis-held-armed via previousVerdict)
 * wins. The session/staleness/NaN gate runs FIRST: it never blocks rule evaluation itself
 * (the underlying rule identity still surfaces for display, RESEARCH Pitfall 4), it only
 * forces `indicative:true` + `escalate:false` on the output.
 *
 * Hexagon law (architecture-boundaries §2): imports only @morai/shared, this context's own
 * exit-rules.ts/types.ts, and picker's exported `haircutFill` — extracted in 26-01 specifically
 * so ROLL pricing reuses the one shared fill model instead of re-deriving it (RESEARCH
 * Pitfall 2), not a foreign `domain/` port import.
 */

import { assertDefined } from "@morai/shared";
import { haircutFill } from "../../picker/domain/candidate-selection.ts";
import {
  EXIT_PRECEDENCE,
  TAKE_RUNGS,
  STOP_RUNGS,
  TERM_INVERSION_MIN,
  TERM_INVERSION_DISARM,
  GAMMA_OFF_STRIKE,
  GAMMA_OFF_STRIKE_DISARM,
  GAMMA_FRONT_DTE_MAX,
  EVT_BLACKOUT_DAYS,
  ROLL_FRONT_DTE_MAX,
  ROLL_SPOT_BAND,
  ROLL_PROFIT_MAX,
  ROLL_REPLACEMENT_DTE_MIN,
  ROLL_REPLACEMENT_DTE_MAX,
} from "./exit-rules.ts";
import type { ExitRuleId } from "./exit-rules.ts";
import type {
  HeldPosition,
  MarketContext,
  ExitVerdict,
  ExitVerdictKind,
  ExitMetric,
  ExitRollSuggestion,
  PreviousVerdict,
  RollCandidateQuote,
  Tier1Event,
} from "./types.ts";

/**
 * Staleness tolerance — matches journal's `SNAPSHOT_LEG_STALENESS_TOLERANCE_MS` value (45 min,
 * snapshotCalendars.ts). An exits-owned constant, not a cross-context import (domain layer
 * only imports @morai/shared).
 */
const STALENESS_TOLERANCE_MS = 45 * 60 * 1000;

// ─── Pure calendar-day arithmetic (mirrors candidate-selection.ts's convention) ────────────

function isoDayNumber(iso: string): number {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  assertDefined(match, `evaluateExit: malformed ISO date "${iso}"`);
  const [, y, m, d] = match;
  assertDefined(y, "evaluateExit: year component");
  assertDefined(m, "evaluateExit: month component");
  assertDefined(d, "evaluateExit: day component");
  return Date.UTC(Number(y), Number(m) - 1, Number(d)) / 86_400_000;
}

function daysBetween(fromIso: string, toIso: string): number {
  return isoDayNumber(toIso) - isoDayNumber(fromIso);
}

// ─── Per-rule evaluators — each returns a hit or null ──────────────────────────────────────

type RuleHit = {
  readonly verdict: ExitVerdictKind;
  readonly rung: string | null;
  readonly metric: ExitMetric;
  readonly roll: ExitRollSuggestion | null;
};

/** A rung/rule is "held armed" from the prior cycle only if the SAME ruleId+rung fired last time. */
function wasArmed(previousVerdict: PreviousVerdict, ruleId: ExitRuleId, rung: string | null): boolean {
  return previousVerdict !== null && previousVerdict.ruleId === ruleId && previousVerdict.rung === rung;
}

function evalStop(pnlPct: number, previousVerdict: PreviousVerdict): RuleHit | null {
  for (const rung of STOP_RUNGS) {
    const freshArm = pnlPct <= rung.arm;
    const heldArmed = wasArmed(previousVerdict, "stop", rung.label) && pnlPct <= rung.disarm;
    if (freshArm || heldArmed) {
      return {
        verdict: "STOP",
        rung: rung.label,
        metric: { name: "pnlPct", value: pnlPct, threshold: rung.arm },
        roll: null,
      };
    }
  }
  return null;
}

function evalEvt(frontExpiry: string, tier1Events: ReadonlyArray<Tier1Event>, cohortNowIso: string): RuleHit | null {
  const feDay = isoDayNumber(frontExpiry);
  let exitBeforeDay: number | null = null;
  let nearestDaysToExpiry = Number.POSITIVE_INFINITY;
  for (const ev of tier1Events) {
    const evDay = isoDayNumber(ev.date);
    const daysToExpiry = feDay - evDay;
    if (evDay <= feDay && daysToExpiry <= EVT_BLACKOUT_DAYS) {
      const dayBefore = evDay - 1;
      if (exitBeforeDay === null || dayBefore < exitBeforeDay) exitBeforeDay = dayBefore;
      if (daysToExpiry < nearestDaysToExpiry) nearestDaysToExpiry = daysToExpiry;
    }
  }
  if (exitBeforeDay === null) return null;
  const nowDay = isoDayNumber(cohortNowIso);
  if (nowDay < exitBeforeDay) return null;
  return {
    verdict: "EXIT_PRE_EVENT",
    rung: null,
    metric: { name: "daysToEvent", value: nearestDaysToExpiry, threshold: EVT_BLACKOUT_DAYS },
    roll: null,
  };
}

function evalGamma(
  spot: number,
  strike: number,
  dteFront: number,
  previousVerdict: PreviousVerdict,
): RuleHit | null {
  const offStrike = Math.abs(spot - strike) / strike;
  const dteOk = dteFront < GAMMA_FRONT_DTE_MAX;
  const freshArm = offStrike > GAMMA_OFF_STRIKE && dteOk;
  const heldArmed = wasArmed(previousVerdict, "gamma", null) && offStrike >= GAMMA_OFF_STRIKE_DISARM && dteOk;
  if (!freshArm && !heldArmed) return null;
  return {
    verdict: "STOP",
    rung: null,
    metric: { name: "gammaOffStrike", value: offStrike, threshold: GAMMA_OFF_STRIKE },
    roll: null,
  };
}

function evalTerm(frontIv: number, backIv: number, previousVerdict: PreviousVerdict): RuleHit | null {
  const inversion = frontIv - backIv;
  const freshArm = inversion >= TERM_INVERSION_MIN;
  const heldArmed = wasArmed(previousVerdict, "term", null) && inversion >= TERM_INVERSION_DISARM;
  if (!freshArm && !heldArmed) return null;
  return {
    verdict: "STOP",
    rung: null,
    metric: { name: "termInversion", value: inversion, threshold: TERM_INVERSION_MIN },
    roll: null,
  };
}

function evalTake(pnlPct: number, previousVerdict: PreviousVerdict): RuleHit | null {
  for (const rung of TAKE_RUNGS) {
    const freshArm = pnlPct >= rung.arm;
    const heldArmed = wasArmed(previousVerdict, "take", rung.label) && pnlPct >= rung.disarm;
    if (freshArm || heldArmed) {
      return {
        verdict: "TAKE",
        rung: rung.label,
        metric: { name: "pnlPct", value: pnlPct, threshold: rung.arm },
        roll: null,
      };
    }
  }
  return null;
}

/**
 * ROLL has no hysteresis (not in the docs/architecture/exit-rules.md band table) — a plain
 * four-way AND gate. Picks the [14,21]-DTE replacement front nearest the window midpoint, tie
 * broken by earliest expiration; prices it via the SHARED `haircutFill` (sell side — mirrors
 * the entry formula's front-leg-sell convention; ROLL only re-prices the front, the back leg
 * is unchanged and its current quote is not part of this evaluator's inputs).
 */
function evalRoll(
  position: HeldPosition,
  context: MarketContext,
  dteFront: number,
  pnlPct: number,
  blockedByEvent: boolean,
): RuleHit | null {
  if (blockedByEvent) return null;
  if (dteFront >= ROLL_FRONT_DTE_MAX) return null;
  const offStrike = Math.abs(context.spot - position.strike) / position.strike;
  if (offStrike > ROLL_SPOT_BAND) return null;
  if (pnlPct >= ROLL_PROFIT_MAX) return null;

  const cohortNowIso = context.cohortNow.toISOString().slice(0, 10);
  const midpoint = (ROLL_REPLACEMENT_DTE_MIN + ROLL_REPLACEMENT_DTE_MAX) / 2;
  let best: RollCandidateQuote | null = null;
  let bestDistance = Number.POSITIVE_INFINITY;
  for (const candidate of context.rollChain.candidates) {
    const dte = daysBetween(cohortNowIso, candidate.expiration);
    if (dte < ROLL_REPLACEMENT_DTE_MIN || dte > ROLL_REPLACEMENT_DTE_MAX) continue;
    const distance = Math.abs(dte - midpoint);
    const isCloser = distance < bestDistance;
    const isTieButEarlier = distance === bestDistance && best !== null && candidate.expiration < best.expiration;
    if (best === null || isCloser || isTieButEarlier) {
      best = candidate;
      bestDistance = distance;
    }
  }
  if (best === null) return null;

  return {
    verdict: "ROLL",
    rung: null,
    metric: { name: "dteFront", value: dteFront, threshold: ROLL_FRONT_DTE_MAX },
    roll: { suggestedFrontExpiry: best.expiration, estDebit: haircutFill(best, "sell") },
  };
}

// ─── evaluateExit — the pure 3-arg entrypoint ──────────────────────────────────────────────

export function evaluateExit(
  position: HeldPosition,
  context: MarketContext,
  previousVerdict: PreviousVerdict,
): ExitVerdict {
  // P&L basis (EXIT-02): derived ONLY from the passed ledger fields, never recomputed elsewhere.
  const pnlPct = (context.netMark - position.openNetDebit) / position.openNetDebit;

  // Gate FIRST (Pitfall 4): AH / stale / NaN-sentinel never renders as an actionable escalation.
  // MarketContext carries no separate net-greeks field (26-01) — the NaN sentinel check covers
  // the BSM-derived numeric fields (frontIv/backIv/netMark).
  const isAfterHours = context.marketSession === "after-hours";
  const elapsedMs = context.cohortNow.getTime() - context.snapshotTime.getTime();
  const isStale = elapsedMs > STALENESS_TOLERANCE_MS;
  const hasNaN = Number.isNaN(context.frontIv) || Number.isNaN(context.backIv) || Number.isNaN(context.netMark);
  const indicative = isAfterHours || isStale || hasNaN;

  const evtHit = evalEvt(position.frontExpiry, context.tier1Events, context.cohortNow.toISOString().slice(0, 10));

  let winnerRuleId: ExitRuleId = "hold";
  let hit: RuleHit | null = null;

  for (const ruleId of EXIT_PRECEDENCE) {
    switch (ruleId) {
      case "stop":
        hit = evalStop(pnlPct, previousVerdict);
        break;
      case "evt":
        hit = evtHit;
        break;
      case "gamma":
        hit = evalGamma(context.spot, position.strike, context.dteFront, previousVerdict);
        break;
      case "term":
        hit = evalTerm(context.frontIv, context.backIv, previousVerdict);
        break;
      case "take":
        hit = evalTake(pnlPct, previousVerdict);
        break;
      case "roll":
        hit = evalRoll(position, context, context.dteFront, pnlPct, evtHit !== null);
        break;
      case "hold":
        hit = {
          verdict: "HOLD",
          rung: null,
          metric: { name: "pnlPct", value: pnlPct, threshold: 0 },
          roll: null,
        };
        break;
    }
    if (hit !== null) {
      winnerRuleId = ruleId;
      break;
    }
  }

  // "hold" is always evaluated last in EXIT_PRECEDENCE and always returns a hit — the loop
  // cannot exit with hit still null.
  assertDefined(hit, "evaluateExit: EXIT_PRECEDENCE always terminates on a hold hit");

  const escalate = !indicative && (hit.verdict === "STOP" || hit.verdict === "EXIT_PRE_EVENT");

  return {
    verdict: hit.verdict,
    rung: hit.rung,
    ruleId: winnerRuleId,
    metric: hit.metric,
    indicative,
    escalate,
    roll: hit.roll,
  };
}
