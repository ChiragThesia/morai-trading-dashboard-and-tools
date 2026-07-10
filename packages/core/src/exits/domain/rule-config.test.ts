/**
 * rule-config.test.ts — resolveExitRuleConfig pure merge (Phase 29-05).
 *
 * Locked behavior (29-05-PLAN.md):
 *   1. Omission reproduces TAKE_RUNGS/STOP_RUNGS byte-identically (deep-equal).
 *   2. A single-field override changes exactly that field; sibling rungs stay at defaults.
 *   3. Rung order is preserved (TAKE highest->lowest, STOP deepest->shallowest).
 */

import { describe, it, expect } from "vitest";
import * as fc from "fast-check";
import { resolveExitRuleConfig } from "./rule-config.ts";
import { TAKE_RUNGS, STOP_RUNGS } from "./exit-rules.ts";

describe("resolveExitRuleConfig — omission reproduces defaults", () => {
  it("no overrides -> takeRungs/stopRungs deep-equal the exit-rules.ts constants", () => {
    const config = resolveExitRuleConfig();
    expect(config.takeRungs).toEqual(TAKE_RUNGS);
    expect(config.stopRungs).toEqual(STOP_RUNGS);
  });

  it("explicit undefined -> same as omission", () => {
    const config = resolveExitRuleConfig(undefined);
    expect(config.takeRungs).toEqual(TAKE_RUNGS);
    expect(config.stopRungs).toEqual(STOP_RUNGS);
  });

  it("fast-check: every no-overrides call is deep-equal to the constants", () => {
    fc.assert(
      fc.property(fc.constant(undefined), () => {
        const config = resolveExitRuleConfig();
        expect(config.takeRungs).toEqual(TAKE_RUNGS);
        expect(config.stopRungs).toEqual(STOP_RUNGS);
      }),
    );
  });
});

describe("resolveExitRuleConfig — single-field TAKE override", () => {
  it("plus15Arm/plus15Disarm override only the +15% rung, others stay default", () => {
    const config = resolveExitRuleConfig({ take: { plus15Arm: 0.16, plus15Disarm: 0.14 } });
    expect(config.takeRungs[0]).toEqual({ label: "+15%", arm: 0.16, disarm: 0.14 });
    expect(config.takeRungs[1]).toEqual(TAKE_RUNGS[1]);
    expect(config.takeRungs[2]).toEqual(TAKE_RUNGS[2]);
    expect(config.stopRungs).toEqual(STOP_RUNGS);
  });
});

describe("resolveExitRuleConfig — single-field STOP override", () => {
  it("minus25Arm/minus25Disarm override only the -25% rung, -50% stays default", () => {
    const config = resolveExitRuleConfig({ stop: { minus25Arm: -0.3, minus25Disarm: -0.28 } });
    expect(config.stopRungs[0]).toEqual(STOP_RUNGS[0]);
    expect(config.stopRungs[1]).toEqual({ label: "-25%", arm: -0.3, disarm: -0.28 });
    expect(config.takeRungs).toEqual(TAKE_RUNGS);
  });
});

describe("resolveExitRuleConfig — rung order preserved", () => {
  it("takeRungs label order matches TAKE_RUNGS (highest->lowest)", () => {
    const config = resolveExitRuleConfig();
    expect(config.takeRungs.map((r) => r.label)).toEqual(TAKE_RUNGS.map((r) => r.label));
  });

  it("stopRungs label order matches STOP_RUNGS (deepest->shallowest)", () => {
    const config = resolveExitRuleConfig();
    expect(config.stopRungs.map((r) => r.label)).toEqual(STOP_RUNGS.map((r) => r.label));
  });
});
