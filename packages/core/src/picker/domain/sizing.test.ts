/**
 * sizing.ts tests (28-04, PLAY-03) — VIX-tiered discrete contract-count registry.
 *
 * Covers:
 *   - SIZING_TIERS reuses VIX_LADDER's edges exactly (one shared ladder, never a second
 *     band system).
 *   - resolveSizingTier: correct discrete count at each tier and at the 15/20/25
 *     boundaries (half-open [min, max) — exactly 20 resolves "elevated").
 *   - null/NaN vix -> no recommendation (null), never a guessed tier.
 *   - fast-check: every finite, non-negative vix resolves to exactly one tier whose
 *     contract count is one of the registry's own values (never fabricated).
 */

import { describe, it, expect } from "vitest";
import * as fc from "fast-check";
import { VIX_LADDER, resolveVixLadder } from "./entry-gate.ts";
import { SIZING_TIERS, resolveSizingTier, DEFAULT_TIER_CONTRACTS } from "./sizing.ts";

describe("SIZING_TIERS", () => {
  it("reuses VIX_LADDER's edges exactly -- one shared ladder, never a second band system", () => {
    expect(SIZING_TIERS.map((row) => ({ tier: row.tier, vixMin: row.vixMin, vixMax: row.vixMax }))).toEqual(
      VIX_LADDER.map((row) => ({ tier: row.tier, vixMin: row.min, vixMax: row.max })),
    );
  });

  it("has exactly one row per tier, in ladder order", () => {
    expect(SIZING_TIERS.map((row) => row.tier)).toEqual(["low", "normal", "elevated", "crisis"]);
  });
});

describe("resolveSizingTier", () => {
  it("resolves 'low' well under the first boundary", () => {
    expect(resolveSizingTier(5)?.tier).toBe("low");
    expect(resolveSizingTier(5)?.contracts).toBe(2);
  });

  it("resolves 'normal' well inside its band", () => {
    expect(resolveSizingTier(17)?.tier).toBe("normal");
    expect(resolveSizingTier(17)?.contracts).toBe(2);
  });

  it("resolves 'elevated' well inside its band", () => {
    expect(resolveSizingTier(23)?.tier).toBe("elevated");
    expect(resolveSizingTier(23)?.contracts).toBe(1);
  });

  it("resolves 'crisis' well past the last boundary -- 0 contracts, coincides with the gate's hard block", () => {
    expect(resolveSizingTier(30)?.tier).toBe("crisis");
    expect(resolveSizingTier(30)?.contracts).toBe(0);
  });

  // ─── Boundary cases (half-open [min, max) convention) ──────────────────────
  it("exactly 15 resolves 'normal' (the low/normal edge)", () => {
    expect(resolveSizingTier(15)?.tier).toBe("normal");
  });

  it("just under 15 resolves 'low'", () => {
    expect(resolveSizingTier(14.99)?.tier).toBe("low");
  });

  it("exactly 20 resolves 'elevated' (the normal/elevated edge)", () => {
    expect(resolveSizingTier(20)?.tier).toBe("elevated");
  });

  it("just under 20 resolves 'normal'", () => {
    expect(resolveSizingTier(19.99)?.tier).toBe("normal");
  });

  it("exactly 25 resolves 'crisis' (the elevated/crisis edge)", () => {
    expect(resolveSizingTier(25)?.tier).toBe("crisis");
  });

  it("just under 25 resolves 'elevated'", () => {
    expect(resolveSizingTier(24.99)?.tier).toBe("elevated");
  });

  // ─── Null-honest ─────────────────────────────────────────────────────────
  it("null vix resolves no recommendation, never a guessed tier", () => {
    expect(resolveSizingTier(null)).toBeNull();
  });

  it("NaN vix resolves no recommendation, never a guessed tier", () => {
    expect(resolveSizingTier(Number.NaN)).toBeNull();
  });

  // ─── Property: every finite non-negative vix resolves a real registry row ──
  it("every finite, non-negative vix resolves exactly one SIZING_TIERS row's own contract count", () => {
    fc.assert(
      fc.property(fc.double({ min: 0, max: 1000, noNaN: true }), (vix) => {
        const resolved = resolveSizingTier(vix);
        expect(resolved).not.toBeNull();
        expect(SIZING_TIERS).toContainEqual(resolved);
      }),
    );
  });

  // ─── override path (29-04, RUNTIME-*) ───────────────────────────────────────

  it("DEFAULT_TIER_CONTRACTS is exported and matches the registry's own default counts", () => {
    expect(DEFAULT_TIER_CONTRACTS).toEqual({ low: 2, normal: 2, elevated: 1, crisis: 0 });
  });

  it("omitting the override reproduces today's tier lookup for a sampled set of VIX values", () => {
    for (const vix of [5, 17, 23, 30]) {
      expect(resolveSizingTier(vix)).toEqual(resolveSizingTier(vix, undefined));
    }
  });

  it("contracts override changes only the resolved row's contract count", () => {
    const row = resolveSizingTier(22, { contracts: { elevated: 3 } });
    expect(row?.tier).toBe("elevated");
    expect(row?.contracts).toBe(3);
  });

  it("a contracts override for a DIFFERENT tier leaves this vix's row unchanged", () => {
    const row = resolveSizingTier(22, { contracts: { low: 5 } });
    expect(row?.tier).toBe("elevated");
    expect(row?.contracts).toBe(1);
  });

  it("ladder override resolves the tier against the overridden boundaries", () => {
    // vix=18 is "normal" under the default ladder but "elevated" once elevatedMin drops to 15.
    const row = resolveSizingTier(18, { ladder: { elevatedMin: 15 } });
    expect(row?.tier).toBe("elevated");
    expect(row?.contracts).toBe(1);
  });

  it("combined ladder + contracts override compose correctly", () => {
    const row = resolveSizingTier(18, { ladder: { elevatedMin: 15 }, contracts: { elevated: 4 } });
    expect(row?.tier).toBe("elevated");
    expect(row?.contracts).toBe(4);
  });

  it("null/NaN vix still resolves null with an override present", () => {
    expect(resolveSizingTier(null, { contracts: { low: 5 } })).toBeNull();
    expect(resolveSizingTier(Number.NaN, { contracts: { low: 5 } })).toBeNull();
  });

  it("the override path's ladder rebuild matches resolveVixLadder's own contiguous rows", () => {
    const overriddenLadder = resolveVixLadder({ elevatedMin: 15 });
    const row = resolveSizingTier(18, { ladder: { elevatedMin: 15 } });
    const expectedTierRow = overriddenLadder.find((r) => 18 >= r.min && 18 < r.max);
    expect(row?.tier).toBe(expectedTierRow?.tier);
  });
});
