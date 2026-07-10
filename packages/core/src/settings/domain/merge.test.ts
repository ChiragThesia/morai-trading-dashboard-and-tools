/**
 * merge.test.ts — computeEffective + mergeStoredOverrides pure merge helpers (Phase 29-09).
 *
 * Locked behavior (29-09-PLAN.md):
 *   1. computeEffective(defaults, {}) deep-equals defaults.
 *   2. computeEffective applies a single override field, leaving siblings at their default.
 *   3. mergeStoredOverrides({ picker: null }) deletes the picker group entirely.
 *   4. mergeStoredOverrides({ picker: {...} }) shallow-merges into the picker group, other
 *      groups untouched.
 *   5. mergeStoredOverrides never emits a null group in its output.
 */

import { describe, it, expect } from "vitest";
import { computeEffective, mergeStoredOverrides } from "./merge.ts";
import type { RuleConfig, StoredRuleOverrides } from "./merge.ts";

const defaults: RuleConfig = {
  picker: {
    deltaBandMin: -0.49,
    deltaBandMax: -0.3,
    maxOpenCalendars: 6,
    weights: { slope: 10, fwdEdge: 25 },
  },
  exits: {
    take: { plus15Arm: 0.15, plus15Disarm: 0.13 },
    stop: { minus50Arm: -0.5, minus50Disarm: -0.45 },
  },
  regime: { vixTermStructureWarn: 0.9, vixTermStructureCrisis: 0.95 },
};

describe("computeEffective", () => {
  it("empty overrides deep-equals defaults", () => {
    expect(computeEffective(defaults, {})).toEqual(defaults);
  });

  it("a single override field wins; all sibling fields stay at their default", () => {
    const effective = computeEffective(defaults, { picker: { maxOpenCalendars: 8 } });
    expect(effective["picker"]).toEqual({
      deltaBandMin: -0.49,
      deltaBandMax: -0.3,
      maxOpenCalendars: 8,
      weights: { slope: 10, fwdEdge: 25 },
    });
    expect(effective["exits"]).toEqual(defaults["exits"]);
    expect(effective["regime"]).toEqual(defaults["regime"]);
  });

  it("partial nested override merges within the sub-object (exits.take single rung)", () => {
    const effective = computeEffective(defaults, {
      exits: { take: { plus15Arm: 0.16, plus15Disarm: 0.14 } },
    });
    expect(effective["exits"]).toEqual({
      take: { plus15Arm: 0.16, plus15Disarm: 0.14 },
      stop: { minus50Arm: -0.5, minus50Disarm: -0.45 },
    });
  });
});

describe("mergeStoredOverrides", () => {
  const current: StoredRuleOverrides = {
    picker: { maxOpenCalendars: 8, deltaBandMin: -0.45 },
    exits: { take: { plus15Arm: 0.16, plus15Disarm: 0.14 } },
  };

  it("a group set to null deletes that group entirely", () => {
    const merged = mergeStoredOverrides(current, { picker: null });
    expect(merged).toEqual({
      exits: { take: { plus15Arm: 0.16, plus15Disarm: 0.14 } },
    });
    expect(Object.prototype.hasOwnProperty.call(merged, "picker")).toBe(false);
  });

  it("an object patch shallow-merges into the group; other groups untouched", () => {
    const merged = mergeStoredOverrides(current, { picker: { maxOpenCalendars: 5 } });
    expect(merged).toEqual({
      picker: { maxOpenCalendars: 5, deltaBandMin: -0.45 },
      exits: { take: { plus15Arm: 0.16, plus15Disarm: 0.14 } },
    });
  });

  it("never emits a null group in its output, even when the patch resets a group that had no prior value", () => {
    const merged = mergeStoredOverrides({}, { picker: null, exits: { take: { plus10Arm: 0.1 } } });
    expect(merged).toEqual({ exits: { take: { plus10Arm: 0.1 } } });
    for (const value of Object.values(merged)) {
      expect(value).not.toBeNull();
    }
  });

  it("adding a brand-new group (not present in current) is a plain insert", () => {
    const merged = mergeStoredOverrides({}, { regime: { vvixWarn: 105 } });
    expect(merged).toEqual({ regime: { vvixWarn: 105 } });
  });
});
