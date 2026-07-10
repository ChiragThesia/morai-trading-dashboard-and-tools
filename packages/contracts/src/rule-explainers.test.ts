/**
 * rule-explainers completeness test (Phase 32, Plan 01, B6).
 *
 * The path list under test is DERIVED from the real `ruleConfig` Zod schema (recursive walk
 * of `ruleConfig.shape`), never a hand-copied literal array — a knob added to `ruleConfig`
 * without a matching `RULE_EXPLAINERS` entry must fail this test (Pitfall-4 guard,
 * 32-01-PLAN.md acceptance criteria).
 */

import { describe, it, expect } from "vitest";
import { z } from "zod";
import { ruleConfig } from "./rule-settings.ts";
import { RULE_EXPLAINERS } from "./rule-explainers.ts";

/** Recursively walks a ZodObject into dotted leaf paths — the schema is the only source. */
function walkLeafPaths(schema: z.ZodTypeAny, prefix: string): ReadonlyArray<string> {
  if (schema instanceof z.ZodObject) {
    return Object.entries(schema.shape).flatMap(([key, child]) =>
      walkLeafPaths(child, prefix === "" ? key : `${prefix}.${key}`),
    );
  }
  return [prefix];
}

const schemaPaths = walkLeafPaths(ruleConfig, "");

describe("RULE_EXPLAINERS completeness (schema-derived)", () => {
  it("has a non-empty set of leaf paths derived from ruleConfig.shape", () => {
    // Guards against a walker regression silently degrading this into a vacuous test.
    expect(schemaPaths.length).toBeGreaterThan(20);
  });

  it("has exactly one registry entry per real ruleConfig leaf path — no gaps, no extras", () => {
    expect([...schemaPaths].sort()).toEqual(Object.keys(RULE_EXPLAINERS).sort());
  });

  it.each(schemaPaths)("has non-empty summary/unit/direction copy for %s", (path) => {
    const entry = RULE_EXPLAINERS[path];
    expect(entry).toBeDefined();
    expect(entry?.summary.length ?? 0).toBeGreaterThan(0);
    expect(entry?.unit.length ?? 0).toBeGreaterThan(0);
    expect(entry?.direction.length ?? 0).toBeGreaterThan(0);
  });

  it("tags `affects` correctly per top-level group", () => {
    const expectedByGroup: Record<string, string> = {
      picker: "Picker candidates",
      exits: "Exit verdicts",
      regime: "Regime board",
    };
    for (const path of schemaPaths) {
      const group = path.split(".")[0] ?? "";
      expect(RULE_EXPLAINERS[path]?.affects).toBe(expectedByGroup[group]);
    }
  });
});

describe("RULE_EXPLAINERS — locked copy-tone examples (32-CONTEXT.md)", () => {
  it("deltaBandMax matches the locked tone exactly", () => {
    const entry = RULE_EXPLAINERS["picker.deltaBandMax"];
    expect(entry?.summary).toBe("Upper edge of the short-put delta band.");
    expect(entry?.direction).toBe("Higher (toward −0.30) = closer-to-the-money candidates allowed.");
    expect(entry?.affects).toBe("Picker candidates");
  });

  it("exits.take.plus15Arm matches the locked tone exactly", () => {
    const entry = RULE_EXPLAINERS["exits.take.plus15Arm"];
    expect(entry?.summary).toBe("Profit % that arms the TAKE +15% exit rung.");
    expect(entry?.affects).toBe("Exit verdicts");
  });
});
