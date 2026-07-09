/**
 * reuse-exports.test.ts (Phase 27, Plan 02) — reachability guard for BT-01's "zero
 * reimplementation" lock.
 *
 * The backtest harness (03/05) must import every live picker/exit pure function and
 * registry constant from `@morai/core` rather than reimplementing them. This test is the
 * cheap regression that catches a missed barrel thread (picker/index.ts, exits/index.ts, or
 * core/index.ts) before those later plans need the symbol — a broken import here fails loud
 * at plan-02 time instead of silently at plan-03/05 authoring time.
 *
 * Pure reachability + typeof assertions only — no behavior coverage (that's scoring.test.ts,
 * rules.test.ts, evaluate-exit.test.ts, etc., all of which stay untouched and green).
 */

import { describe, it, expect } from "vitest";
import {
  selectCandidates,
  haircutFill,
  scoreCalendarCandidates,
  RULE_SET_METADATA,
  realizedVol,
  rankAndCapCandidates,
  PICKER_TOP_N,
  evaluateExit,
  EXIT_RULE_METADATA,
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
} from "@morai/core";

describe("PICK-04 reuse-exports reachability guard", () => {
  it("threads every reused picker pure function from @morai/core", () => {
    expect(typeof selectCandidates).toBe("function");
    expect(typeof haircutFill).toBe("function");
    expect(typeof scoreCalendarCandidates).toBe("function");
    expect(typeof realizedVol).toBe("function");
    expect(typeof rankAndCapCandidates).toBe("function");
  });

  it("threads the picker rule-set registry + PICKER_TOP_N from @morai/core", () => {
    expect(Array.isArray(RULE_SET_METADATA)).toBe(true);
    expect(RULE_SET_METADATA.length).toBeGreaterThan(0);
    expect(typeof PICKER_TOP_N).toBe("number");
  });

  it("threads the exit pure evaluator from @morai/core", () => {
    expect(typeof evaluateExit).toBe("function");
  });

  it("threads every reused exit-rule registry constant from @morai/core", () => {
    expect(Array.isArray(EXIT_RULE_METADATA)).toBe(true);
    expect(Array.isArray(EXIT_PRECEDENCE)).toBe(true);
    expect(Array.isArray(TAKE_RUNGS)).toBe(true);
    expect(Array.isArray(STOP_RUNGS)).toBe(true);
    expect(typeof TERM_INVERSION_MIN).toBe("number");
    expect(typeof TERM_INVERSION_DISARM).toBe("number");
    expect(typeof GAMMA_OFF_STRIKE).toBe("number");
    expect(typeof GAMMA_OFF_STRIKE_DISARM).toBe("number");
    expect(typeof GAMMA_FRONT_DTE_MAX).toBe("number");
    expect(typeof EVT_BLACKOUT_DAYS).toBe("number");
    expect(typeof ROLL_FRONT_DTE_MAX).toBe("number");
    expect(typeof ROLL_SPOT_BAND).toBe("number");
    expect(typeof ROLL_PROFIT_MAX).toBe("number");
    expect(typeof ROLL_REPLACEMENT_DTE_MIN).toBe("number");
    expect(typeof ROLL_REPLACEMENT_DTE_MAX).toBe("number");
  });
});
