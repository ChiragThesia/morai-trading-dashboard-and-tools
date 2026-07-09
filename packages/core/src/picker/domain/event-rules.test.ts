/**
 * event-rules tests (28-05, PLAY-04) — the event-calendar bucket's SEPARATE rule registry.
 *
 * `EVENT_RULE_SET_METADATA` is a second, bucket-scoped registry (rules.ts): `backEventBonus`
 * is promoted from experimental (weight 0) to an active scored criterion, the other 9 score
 * criteria are scaled down proportionally so THIS table sums to 100 -- the primary
 * `RULE_SET_METADATA` and its own weight-sum-100 test (rules.test.ts) are never touched.
 */

import { describe, it, expect } from "vitest";
import { EVENT_RULE_SET_METADATA, RULE_SET_METADATA, WEIGHT_BACK_EVENT_BONUS } from "./rules.ts";

describe("EVENT_RULE_SET_METADATA — bucket registry invariants (T-28-13)", () => {
  it("active score weights sum to exactly 100 (bucket-scoped, separate from the primary registry)", () => {
    const total = EVENT_RULE_SET_METADATA.filter(
      (r) => r.kind === "score" && r.status === "active",
    ).reduce((sum, r) => sum + r.weight, 0);
    expect(total).toBeCloseTo(100, 9);
  });

  it("backEventBonus is promoted to an active score row with the bucket-scoped weight", () => {
    const row = EVENT_RULE_SET_METADATA.find((r) => r.id === "backEventBonus");
    expect(row).toBeDefined();
    expect(row?.kind).toBe("score");
    expect(row?.status).toBe("active");
    expect(row?.weight).toBe(WEIGHT_BACK_EVENT_BONUS);
  });

  it("the primary RULE_SET_METADATA is untouched -- backEventBonus stays experimental there", () => {
    const row = RULE_SET_METADATA.find((r) => r.id === "backEventBonus");
    expect(row?.status).toBe("experimental");
    expect(row?.weight).toBe(0);
    const primaryTotal = RULE_SET_METADATA.filter(
      (r) => r.kind === "score" && r.status === "active",
    ).reduce((sum, r) => sum + r.weight, 0);
    expect(primaryTotal).toBe(100);
  });

  it("the two universe-membership gates are unchanged from the primary registry", () => {
    const gates = EVENT_RULE_SET_METADATA.filter((r) => r.kind === "gate" && r.status === "active");
    expect(gates.map((r) => r.id).sort()).toEqual(["liquidity", "net-theta-positive"]);
    for (const gate of gates) {
      expect(gate.weight).toBe(0);
    }
  });

  it("REFUTED criteria never appear in the bucket registry either (same Phase-19 guard)", () => {
    const text = EVENT_RULE_SET_METADATA.flatMap((r) => [r.id, r.label, r.rationale])
      .join(" ")
      .toLowerCase();
    expect(text).not.toMatch(/iv[\s-]?rank/);
    expect(text).not.toMatch(/iv[\s-]?percentile/);
    expect(text).not.toMatch(/25[\s]?[-–][\s]?40\s?%/); // "fair debit 25-40% of back premium"
    expect(text).not.toMatch(/[-−]1\s?%?\s?to\s?[-−]3\s?%/); // "−1% to −3% ideal band"
    const ids = EVENT_RULE_SET_METADATA.map((r) => r.id);
    expect(ids).not.toContain("ivRank");
    expect(ids).not.toContain("debitPctOfBack");
    expect(ids).not.toContain("ivDifferentialBand");
  });

  it("every bucket row carries a non-empty rationale and source (provenance required)", () => {
    for (const rule of EVENT_RULE_SET_METADATA) {
      expect(rule.rationale.length).toBeGreaterThan(0);
      expect(rule.source.length).toBeGreaterThan(0);
    }
  });
});
