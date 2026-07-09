/**
 * evaluate-exit.ts — RED: the pure 3-arg exit evaluator.
 *
 * Invariants locked here (26-02-PLAN.md behavior block):
 *   1. Indicative gate (AH/stale/NaN) runs FIRST — never an actionable escalate on a gated cohort.
 *   2. Precedence: STOP > EVT > GAMMA > TERM > TAKE > ROLL > HOLD, first match wins (fast-check).
 *   3. Hysteresis: TAKE/STOP rungs hold armed across a hover band, both directions (fast-check).
 *   4. P&L basis: pnlPct === (netMark − openNetDebit) / openNetDebit, never a parallel recompute.
 *   5. TERM/GAMMA boundary thresholds fire exactly at the locked literal, not before.
 *   6. ROLL prices the nearest [14,21]-DTE replacement front via the SHARED haircutFill.
 *
 * Fixtures use distinct timestamps per describe block (green-suite lesson #1).
 */

import { describe, it, expect } from "vitest";
import * as fc from "fast-check";
import { evaluateExit } from "./evaluate-exit.ts";
import { haircutFill } from "../../picker/domain/candidate-selection.ts";
import {
  TAKE_RUNGS,
  STOP_RUNGS,
  TERM_INVERSION_MIN,
  GAMMA_OFF_STRIKE,
  GAMMA_FRONT_DTE_MAX,
  ROLL_FRONT_DTE_MAX,
  ROLL_SPOT_BAND,
  ROLL_PROFIT_MAX,
} from "./exit-rules.ts";
import type { HeldPosition, MarketContext, ExitVerdict, PreviousVerdict, RollCandidateQuote } from "./types.ts";

// ─── Fixture helpers ────────────────────────────────────────────────────────

function makePosition(overrides: Partial<HeldPosition> = {}): HeldPosition {
  return {
    calendarId: "cal-1",
    name: "7000P calendar",
    strike: 7000,
    qty: 1,
    openNetDebit: 4000,
    frontExpiry: "2026-08-14",
    backExpiry: "2026-09-18",
    ...overrides,
  };
}

function makeContext(overrides: Partial<MarketContext> = {}): MarketContext {
  const cohortNow = new Date("2026-07-10T15:00:00.000Z");
  return {
    netMark: 4000,
    pnlOpen: 0,
    spot: 7000,
    frontIv: 0.2,
    backIv: 0.25,
    dteFront: 30,
    dteBack: 60,
    snapshotTime: cohortNow,
    cohortNow,
    marketSession: "rth",
    tier1Events: [],
    rollChain: { candidates: [] },
    ...overrides,
  };
}

function toPreviousVerdict(verdict: ExitVerdict, armedAt: Date): PreviousVerdict {
  return { verdict: verdict.verdict, rung: verdict.rung, ruleId: verdict.ruleId, armedAt };
}

/** Pure day-number arithmetic mirroring candidate-selection.ts's convention (test-local). */
function isoDayNumber(iso: string): number {
  const [y, m, d] = iso.split("-").map(Number);
  return Date.UTC(y ?? 0, (m ?? 1) - 1, d ?? 0) / 86_400_000;
}
function addDaysIso(iso: string, delta: number): string {
  return new Date((isoDayNumber(iso) + delta) * 86_400_000).toISOString().slice(0, 10);
}

// ─── P&L basis oracle ────────────────────────────────────────────────────────

describe("evaluateExit — P&L basis (never a parallel recompute)", () => {
  it("pnlPct = (netMark - openNetDebit) / openNetDebit for a known trade", () => {
    const position = makePosition({ openNetDebit: 4000 });
    const context = makeContext({ netMark: 4400 }); // +10.0% exactly
    const result = evaluateExit(position, context, null);
    expect(result.verdict).toBe("TAKE");
    expect(result.rung).toBe("+10%");
    expect(result.metric.name).toBe("pnlPct");
    expect(result.metric.value).toBeCloseTo(0.1, 10);
  });
});

// ─── Indicative gate (AH / stale / NaN) ──────────────────────────────────────

describe("evaluateExit — indicative gate runs first", () => {
  const cohortNow = new Date("2026-07-11T15:00:00.000Z");

  it("after-hours cohort is indicative, escalate forced false, even on a STOP-worthy loss", () => {
    const position = makePosition();
    const context = makeContext({
      cohortNow,
      snapshotTime: cohortNow,
      netMark: 1800, // -55%
      marketSession: "after-hours",
    });
    const result = evaluateExit(position, context, null);
    expect(result.indicative).toBe(true);
    expect(result.escalate).toBe(false);
  });

  it("stale snapshot (>45min old) is indicative", () => {
    const position = makePosition();
    const staleSnapshot = new Date(cohortNow.getTime() - 46 * 60_000);
    const context = makeContext({ cohortNow, snapshotTime: staleSnapshot });
    const result = evaluateExit(position, context, null);
    expect(result.indicative).toBe(true);
    expect(result.escalate).toBe(false);
  });

  it("fresh snapshot exactly at the 45min tolerance is NOT stale", () => {
    const position = makePosition();
    const freshSnapshot = new Date(cohortNow.getTime() - 45 * 60_000);
    const context = makeContext({ cohortNow, snapshotTime: freshSnapshot });
    const result = evaluateExit(position, context, null);
    expect(result.indicative).toBe(false);
  });

  it("NaN frontIv is indicative", () => {
    const position = makePosition();
    const context = makeContext({ cohortNow, snapshotTime: cohortNow, frontIv: Number.NaN });
    const result = evaluateExit(position, context, null);
    expect(result.indicative).toBe(true);
    expect(result.escalate).toBe(false);
  });

  it("clean RTH, fresh, non-NaN cohort is NOT indicative", () => {
    const position = makePosition();
    const context = makeContext({ cohortNow, snapshotTime: cohortNow });
    const result = evaluateExit(position, context, null);
    expect(result.indicative).toBe(false);
  });
});

// ─── Precedence — deterministic first-match-wins (fast-check) ───────────────

describe("evaluateExit — precedence (fast-check, multi-trigger contexts)", () => {
  const PNL_TABLE: Record<string, number> = {
    stop50: -0.55,
    stop25: -0.3,
    none: 0,
    take5: 0.06,
    take10: 0.11,
    take15: 0.2,
  };

  it("resolves to the highest-precedence rule that actually fires (STOP>EVT>GAMMA>TERM>TAKE>ROLL>HOLD)", () => {
    fc.assert(
      fc.property(
        fc.constantFrom(...Object.keys(PNL_TABLE)),
        fc.constantFrom(0, 0.03), // offStrikeFrac: 0 = roll-eligible spot, 0.03 = gamma-eligible spot
        fc.constantFrom(5, 10, 30), // dteFrontChoice
        fc.boolean(), // termFires
        fc.boolean(), // evtFires
        (pnlKey, offStrikeFrac, dteFront, termFires, evtFires) => {
          const pnlPct = PNL_TABLE[pnlKey] ?? 0;
          const strike = 7000;
          const spot = strike * (1 + offStrikeFrac);
          const openNetDebit = 4000;
          const netMark = openNetDebit * (1 + pnlPct);
          const frontExpiry = "2026-08-14";

          const cohortNow = evtFires ? new Date("2026-08-11T15:00:00.000Z") : new Date("2026-07-15T15:00:00.000Z");
          const cohortNowIso = cohortNow.toISOString().slice(0, 10);
          const tier1Events = evtFires ? [{ date: "2026-08-12", name: "FOMC" as const }] : [];
          const rollCandidate: RollCandidateQuote = {
            expiration: addDaysIso(cohortNowIso, 18),
            bid: 10,
            ask: 12,
          };

          const position = makePosition({ strike, openNetDebit, frontExpiry });
          const context = makeContext({
            netMark,
            spot,
            frontIv: termFires ? 0.3 : 0.2,
            backIv: termFires ? 0.29 : 0.25,
            dteFront,
            cohortNow,
            snapshotTime: cohortNow,
            marketSession: "rth",
            tier1Events,
            rollChain: { candidates: [rollCandidate] },
          });

          const stopFlag = pnlPct <= -0.25;
          const evtFlag = evtFires;
          const gammaFlag = offStrikeFrac === 0.03 && dteFront < GAMMA_FRONT_DTE_MAX;
          const termFlag = termFires;
          const takeFlag = pnlPct >= 0.05;
          const rollFlag = !evtFires && dteFront < ROLL_FRONT_DTE_MAX && offStrikeFrac <= ROLL_SPOT_BAND && pnlPct < ROLL_PROFIT_MAX;

          const expected =
            (stopFlag && "stop") ||
            (evtFlag && "evt") ||
            (gammaFlag && "gamma") ||
            (termFlag && "term") ||
            (takeFlag && "take") ||
            (rollFlag && "roll") ||
            "hold";

          const result = evaluateExit(position, context, null);
          expect(result.ruleId).toBe(expected);
        },
      ),
      { numRuns: 200 },
    );
  });
});

// ─── Hysteresis — both directions (fast-check) ───────────────────────────────

describe("evaluateExit — TAKE hysteresis (fast-check, no-flap both directions)", () => {
  const cohortNow = new Date("2026-07-12T15:00:00.000Z");
  const position = makePosition({ openNetDebit: 4000 });

  function contextAtPnl(pnlPct: number): MarketContext {
    return makeContext({
      netMark: position.openNetDebit * (1 + pnlPct),
      spot: position.strike,
      dteFront: 30,
      cohortNow,
      snapshotTime: cohortNow,
    });
  }

  it("stays armed while hovering inside [disarm, arm], disarms only past disarm", () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 0, max: 2 }),
        fc.array(fc.double({ min: 0.02, max: 0.98, noNaN: true }), { minLength: 2, maxLength: 4 }),
        (rungIdx, fractions) => {
          const rung = TAKE_RUNGS[rungIdx];
          if (rung === undefined) return;

          let previous: PreviousVerdict = null;

          // Fresh arm at the exact threshold.
          const armResult = evaluateExit(position, contextAtPnl(rung.arm), previous);
          expect(armResult.rung).toBe(rung.label);
          previous = toPreviousVerdict(armResult, cohortNow);

          // Hover inside the open (disarm, arm) band — must stay armed on this rung.
          for (const fraction of fractions) {
            const hoverPnl = rung.disarm + fraction * (rung.arm - rung.disarm);
            const hoverResult = evaluateExit(position, contextAtPnl(hoverPnl), previous);
            expect(hoverResult.rung).toBe(rung.label);
            previous = toPreviousVerdict(hoverResult, cohortNow);
          }

          // Cross past disarm — must release this rung.
          const disarmedResult = evaluateExit(position, contextAtPnl(rung.disarm - 0.001), previous);
          expect(disarmedResult.rung).not.toBe(rung.label);
        },
      ),
      { numRuns: 50 },
    );
  });
});

describe("evaluateExit — STOP hysteresis (fast-check, no-flap both directions)", () => {
  const cohortNow = new Date("2026-07-13T15:00:00.000Z");
  const position = makePosition({ openNetDebit: 4000 });

  function contextAtPnl(pnlPct: number): MarketContext {
    return makeContext({
      netMark: position.openNetDebit * (1 + pnlPct),
      spot: position.strike,
      dteFront: 30,
      cohortNow,
      snapshotTime: cohortNow,
    });
  }

  it("stays armed while hovering inside [arm, disarm], disarms only past disarm", () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 0, max: 1 }),
        fc.array(fc.double({ min: 0.02, max: 0.98, noNaN: true }), { minLength: 2, maxLength: 4 }),
        (rungIdx, fractions) => {
          const rung = STOP_RUNGS[rungIdx];
          if (rung === undefined) return;

          let previous: PreviousVerdict = null;

          const armResult = evaluateExit(position, contextAtPnl(rung.arm), previous);
          expect(armResult.rung).toBe(rung.label);
          expect(armResult.verdict).toBe("STOP");
          previous = toPreviousVerdict(armResult, cohortNow);

          for (const fraction of fractions) {
            const hoverPnl = rung.arm + fraction * (rung.disarm - rung.arm);
            const hoverResult = evaluateExit(position, contextAtPnl(hoverPnl), previous);
            expect(hoverResult.rung).toBe(rung.label);
            previous = toPreviousVerdict(hoverResult, cohortNow);
          }

          const disarmedResult = evaluateExit(position, contextAtPnl(rung.disarm + 0.001), previous);
          expect(disarmedResult.rung).not.toBe(rung.label);
        },
      ),
      { numRuns: 50 },
    );
  });
});

// ─── TERM boundary ────────────────────────────────────────────────────────

describe("evaluateExit — TERM boundary", () => {
  const cohortNow = new Date("2026-07-14T15:00:00.000Z");

  it("fires at exactly the 0.005 inversion boundary", () => {
    const position = makePosition();
    const context = makeContext({
      cohortNow,
      snapshotTime: cohortNow,
      frontIv: 0.305,
      backIv: 0.3, // diff = 0.005
      spot: position.strike,
      dteFront: 30,
    });
    const result = evaluateExit(position, context, null);
    expect(result.ruleId).toBe("term");
    expect(result.verdict).toBe("STOP");
    expect(result.metric.value).toBeCloseTo(TERM_INVERSION_MIN, 10);
  });

  it("does NOT fire at 0.00499 (just under the boundary)", () => {
    const position = makePosition();
    const context = makeContext({
      cohortNow,
      snapshotTime: cohortNow,
      frontIv: 0.30499,
      backIv: 0.3, // diff = 0.00499
      spot: position.strike,
      dteFront: 30,
    });
    const result = evaluateExit(position, context, null);
    expect(result.ruleId).not.toBe("term");
  });
});

// ─── GAMMA both-halves ────────────────────────────────────────────────────

describe("evaluateExit — GAMMA requires BOTH halves of the AND", () => {
  const cohortNow = new Date("2026-07-15T15:00:00.000Z");

  it("does not fire when off-strike > 2% but front DTE >= 7", () => {
    const position = makePosition({ strike: 7000 });
    const context = makeContext({
      cohortNow,
      snapshotTime: cohortNow,
      spot: 7210, // 3% off
      dteFront: 10,
    });
    const result = evaluateExit(position, context, null);
    expect(result.ruleId).not.toBe("gamma");
  });

  it("does not fire when front DTE < 7 but off-strike <= 2%", () => {
    const position = makePosition({ strike: 7000 });
    const context = makeContext({
      cohortNow,
      snapshotTime: cohortNow,
      spot: 7050, // 0.71% off
      dteFront: 5,
    });
    const result = evaluateExit(position, context, null);
    expect(result.ruleId).not.toBe("gamma");
  });

  it("fires when both halves hold", () => {
    const position = makePosition({ strike: 7000 });
    const context = makeContext({
      cohortNow,
      snapshotTime: cohortNow,
      spot: 7210, // 3% off
      dteFront: 5,
    });
    const result = evaluateExit(position, context, null);
    expect(result.ruleId).toBe("gamma");
    expect(result.verdict).toBe("STOP");
    expect(result.metric.threshold).toBe(GAMMA_OFF_STRIKE);
  });
});

// ─── EVT day-before stamp ─────────────────────────────────────────────────

describe("evaluateExit — EVT day-before stamp", () => {
  it("fires once today reaches the day-before-event deadline", () => {
    const position = makePosition({ frontExpiry: "2026-08-14" });
    const cohortNow = new Date("2026-08-11T15:00:00.000Z"); // day-before Aug-12 event
    const context = makeContext({
      cohortNow,
      snapshotTime: cohortNow,
      tier1Events: [{ date: "2026-08-12", name: "FOMC" }],
    });
    const result = evaluateExit(position, context, null);
    expect(result.verdict).toBe("EXIT_PRE_EVENT");
    expect(result.ruleId).toBe("evt");
    expect(result.escalate).toBe(true);
  });

  it("does not fire before the day-before deadline", () => {
    const position = makePosition({ frontExpiry: "2026-08-14" });
    const cohortNow = new Date("2026-08-10T15:00:00.000Z"); // one day before the deadline
    const context = makeContext({
      cohortNow,
      snapshotTime: cohortNow,
      tier1Events: [{ date: "2026-08-12", name: "FOMC" }],
    });
    const result = evaluateExit(position, context, null);
    expect(result.ruleId).not.toBe("evt");
  });
});

// ─── ROLL — boundaries + shared haircutFill pricing ──────────────────────

describe("evaluateExit — ROLL boundaries + haircutFill pricing", () => {
  const cohortNow = new Date("2026-07-16T15:00:00.000Z");
  const cohortNowIso = cohortNow.toISOString().slice(0, 10);
  const candidateInWindow: RollCandidateQuote = { expiration: addDaysIso(cohortNowIso, 18), bid: 100, ask: 106 };

  it("fires just under the 14 DTE ceiling and prices via the shared haircutFill", () => {
    const position = makePosition({ strike: 7000, openNetDebit: 4000 });
    const context = makeContext({
      cohortNow,
      snapshotTime: cohortNow,
      spot: 7000,
      dteFront: 13,
      netMark: 4000,
      rollChain: { candidates: [candidateInWindow] },
    });
    const result = evaluateExit(position, context, null);
    expect(result.verdict).toBe("ROLL");
    expect(result.ruleId).toBe("roll");
    expect(result.roll).not.toBeNull();
    expect(result.roll?.suggestedFrontExpiry).toBe(candidateInWindow.expiration);
    expect(result.roll?.estDebit).toBeCloseTo(haircutFill(candidateInWindow, "sell"), 10);
  });

  it("does not fire at exactly 14 DTE (not < 14)", () => {
    const position = makePosition({ strike: 7000 });
    const context = makeContext({
      cohortNow,
      snapshotTime: cohortNow,
      spot: 7000,
      dteFront: ROLL_FRONT_DTE_MAX,
      rollChain: { candidates: [candidateInWindow] },
    });
    const result = evaluateExit(position, context, null);
    expect(result.ruleId).not.toBe("roll");
  });

  it("fires at exactly the 1% spot band (inclusive)", () => {
    const position = makePosition({ strike: 7000 });
    const context = makeContext({
      cohortNow,
      snapshotTime: cohortNow,
      spot: 7000 * (1 + ROLL_SPOT_BAND),
      dteFront: 10,
      rollChain: { candidates: [candidateInWindow] },
    });
    const result = evaluateExit(position, context, null);
    expect(result.ruleId).toBe("roll");
  });

  it("does not fire past the 1% spot band", () => {
    const position = makePosition({ strike: 7000 });
    const context = makeContext({
      cohortNow,
      snapshotTime: cohortNow,
      spot: 7000 * (1 + ROLL_SPOT_BAND) + 1,
      dteFront: 10,
      rollChain: { candidates: [candidateInWindow] },
    });
    const result = evaluateExit(position, context, null);
    expect(result.ruleId).not.toBe("roll");
  });

  it("does not fire at exactly 15% profit (not < 15%)", () => {
    const position = makePosition({ strike: 7000, openNetDebit: 4000 });
    const context = makeContext({
      cohortNow,
      snapshotTime: cohortNow,
      spot: 7000,
      dteFront: 10,
      netMark: 4000 * (1 + ROLL_PROFIT_MAX),
      rollChain: { candidates: [candidateInWindow] },
    });
    const result = evaluateExit(position, context, null);
    expect(result.ruleId).not.toBe("roll");
  });

  it("does not fire when a blocking event is present, even if the roll gate is otherwise open", () => {
    const position = makePosition({ strike: 7000, frontExpiry: "2026-07-20" });
    const eventCohortNow = new Date("2026-07-18T15:00:00.000Z");
    const context = makeContext({
      cohortNow: eventCohortNow,
      snapshotTime: eventCohortNow,
      spot: 7000,
      dteFront: 10,
      tier1Events: [{ date: "2026-07-19", name: "CPI" }],
      rollChain: { candidates: [candidateInWindow] },
    });
    const result = evaluateExit(position, context, null);
    expect(result.ruleId).toBe("evt");
  });

  it("selects the nearest [14,21]-DTE candidate to the window midpoint", () => {
    const near: RollCandidateQuote = { expiration: addDaysIso(cohortNowIso, 15), bid: 50, ask: 54 };
    const far: RollCandidateQuote = { expiration: addDaysIso(cohortNowIso, 21), bid: 90, ask: 96 };
    const midpoint: RollCandidateQuote = { expiration: addDaysIso(cohortNowIso, 17), bid: 70, ask: 76 };
    const position = makePosition({ strike: 7000 });
    const context = makeContext({
      cohortNow,
      snapshotTime: cohortNow,
      spot: 7000,
      dteFront: 10,
      rollChain: { candidates: [near, far, midpoint] },
    });
    const result = evaluateExit(position, context, null);
    expect(result.roll?.suggestedFrontExpiry).toBe(midpoint.expiration);
    expect(result.roll?.estDebit).toBeCloseTo(haircutFill(midpoint, "sell"), 10);
  });

  it("does not fire (falls through to HOLD) when no candidate is in the [14,21] DTE window", () => {
    const outOfWindow: RollCandidateQuote = { expiration: addDaysIso(cohortNowIso, 40), bid: 10, ask: 12 };
    const position = makePosition({ strike: 7000 });
    const context = makeContext({
      cohortNow,
      snapshotTime: cohortNow,
      spot: 7000,
      dteFront: 10,
      rollChain: { candidates: [outOfWindow] },
    });
    const result = evaluateExit(position, context, null);
    expect(result.ruleId).toBe("hold");
  });
});

// ─── Escalate ─────────────────────────────────────────────────────────────

describe("evaluateExit — escalate true only for STOP-kind and EXIT_PRE_EVENT verdicts", () => {
  const cohortNow = new Date("2026-07-17T15:00:00.000Z");

  it("STOP escalates", () => {
    const position = makePosition({ openNetDebit: 4000 });
    const context = makeContext({ cohortNow, snapshotTime: cohortNow, netMark: 3000, spot: position.strike, dteFront: 30 });
    const result = evaluateExit(position, context, null);
    expect(result.verdict).toBe("STOP");
    expect(result.escalate).toBe(true);
  });

  it("TAKE does not escalate", () => {
    const position = makePosition({ openNetDebit: 4000 });
    const context = makeContext({ cohortNow, snapshotTime: cohortNow, netMark: 4400, spot: position.strike, dteFront: 30 });
    const result = evaluateExit(position, context, null);
    expect(result.verdict).toBe("TAKE");
    expect(result.escalate).toBe(false);
  });

  it("HOLD does not escalate", () => {
    const position = makePosition({ openNetDebit: 4000 });
    const context = makeContext({ cohortNow, snapshotTime: cohortNow, netMark: 4000, spot: position.strike, dteFront: 30 });
    const result = evaluateExit(position, context, null);
    expect(result.verdict).toBe("HOLD");
    expect(result.escalate).toBe(false);
  });
});

// ─── CR-01: non-finite P&L basis (zero/NULL openNetDebit) never renders actionable ──────────

describe("evaluateExit — non-finite P&L basis is indicative (CR-01)", () => {
  const cohortNow = new Date("2026-07-18T15:00:00.000Z");

  it("openNetDebit=0 with a gain is indicative, never an actionable TAKE (+Infinity pnlPct)", () => {
    const position = makePosition({ openNetDebit: 0 });
    const context = makeContext({ cohortNow, snapshotTime: cohortNow, netMark: 500, spot: position.strike, dteFront: 30 });
    const result = evaluateExit(position, context, null);
    expect(result.indicative).toBe(true);
    expect(result.escalate).toBe(false);
  });

  it("openNetDebit=0 with a loss is indicative, never an escalated STOP (−Infinity pnlPct)", () => {
    const position = makePosition({ openNetDebit: 0 });
    const context = makeContext({ cohortNow, snapshotTime: cohortNow, netMark: -500, spot: position.strike, dteFront: 30 });
    const result = evaluateExit(position, context, null);
    expect(result.indicative).toBe(true);
    expect(result.escalate).toBe(false);
  });
});
