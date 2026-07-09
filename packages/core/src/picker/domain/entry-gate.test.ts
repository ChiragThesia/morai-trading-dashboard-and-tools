/**
 * entry-gate.ts — RED: the pure market-level entry-gate evaluator (28-01-PLAN.md behavior block).
 *
 * Invariants locked here:
 *   1. VIX >= 25 or ratio >= 0.95 each resolve state 'blocked' (worse regime wins).
 *   2. Penalty band: linear 1.0 -> 0.3 across VIX 20-25 / ratio 0.90-0.95, monotonic, never a
 *      step at the boundary. Combined multiplier = min(vixMultiplier, ratioMultiplier).
 *   3. businessDaysSince > 3 (or asOf null / macro missing) -> state 'blind', fails closed.
 *   4. Hysteresis: blocked/penalty state holds across a disarm band -- no flap on noise
 *      (fast-check, both the VIX and the ratio ladder).
 *   5. businessDaysSince is NYSE-holiday-aware and correct across a 3-day weekend + Thanksgiving.
 *   6. Brake passthrough: maxOpenBrake / cooldownBrake -> entriesAllowed false, brake named.
 *   7. applyGatePenaltyScore rounds + clamps into [0, 100].
 *   8. VIX_LADDER has no gap/overlap across its four tiers.
 */

import { describe, it, expect } from "vitest";
import * as fc from "fast-check";
import {
  VIX_LADDER,
  VIX_BLOCK_ARM,
  VIX_BLOCK_DISARM,
  VIX_PENALTY_FLOOR,
  VIX_PENALTY_DISARM,
  RATIO_BLOCK_ARM,
  RATIO_BLOCK_DISARM,
  GATE_BLIND_MAX_BIZDAYS,
  extractVixPair,
  businessDaysSince,
  resolveEntryGate,
  applyGatePenaltyScore,
} from "./entry-gate.ts";
import type { EntryGateState, MacroSeriesRow } from "./entry-gate.ts";

// ─── Fixture helpers ────────────────────────────────────────────────────────

function rows(vix: number, vix3m: number, date: string): ReadonlyArray<MacroSeriesRow> {
  return [
    { seriesId: "VIXCLS", date, value: vix },
    { seriesId: "VXVCLS", date, value: vix3m },
  ];
}

/** A calm, fresh gate input -- everything else in a test overrides just what it needs. */
function makeInput(overrides: {
  readonly vix?: number;
  readonly vix3m?: number;
  readonly asOf?: string;
  readonly nowIso?: string;
  readonly maxOpenBrake?: boolean;
  readonly cooldownBrake?: boolean;
  readonly previousState?: EntryGateState | null;
  readonly rowsOverride?: ReadonlyArray<MacroSeriesRow>;
}) {
  const asOf = overrides.asOf ?? "2026-07-08";
  const nowIso = overrides.nowIso ?? "2026-07-09";
  return {
    rows: overrides.rowsOverride ?? rows(overrides.vix ?? 14, overrides.vix3m ?? 20, asOf),
    nowIso,
    maxOpenBrake: overrides.maxOpenBrake ?? false,
    cooldownBrake: overrides.cooldownBrake ?? false,
    previousState: overrides.previousState ?? null,
  };
}

// ─── extractVixPair ─────────────────────────────────────────────────────────

describe("extractVixPair", () => {
  it("pairs the latest VIXCLS + VXVCLS row per series", () => {
    const input: ReadonlyArray<MacroSeriesRow> = [
      { seriesId: "VIXCLS", date: "2026-07-06", value: 18 },
      { seriesId: "VIXCLS", date: "2026-07-08", value: 20 },
      { seriesId: "VXVCLS", date: "2026-07-07", value: 22 },
      { seriesId: "VXVCLS", date: "2026-07-08", value: 21 },
    ];
    const pair = extractVixPair(input);
    expect(pair).not.toBeNull();
    expect(pair?.vix).toBe(20);
    expect(pair?.vix3m).toBe(21);
    expect(pair?.ratio).toBeCloseTo(20 / 21, 10);
  });

  it("asOf is the OLDER of the two series dates -- never overstates freshness", () => {
    const input: ReadonlyArray<MacroSeriesRow> = [
      { seriesId: "VIXCLS", date: "2026-07-08", value: 20 },
      { seriesId: "VXVCLS", date: "2026-07-06", value: 21 },
    ];
    const pair = extractVixPair(input);
    expect(pair?.asOf).toBe("2026-07-06");
  });

  it("returns null when VIXCLS is absent", () => {
    const pair = extractVixPair([{ seriesId: "VXVCLS", date: "2026-07-08", value: 21 }]);
    expect(pair).toBeNull();
  });

  it("returns null when VXVCLS is absent", () => {
    const pair = extractVixPair([{ seriesId: "VIXCLS", date: "2026-07-08", value: 20 }]);
    expect(pair).toBeNull();
  });

  it("returns null on a non-finite ratio (zero denominator)", () => {
    const pair = extractVixPair(rows(20, 0, "2026-07-08"));
    expect(pair).toBeNull();
  });

  it("never consumes VIX9D -- only VIXCLS/VXVCLS feed the pair", () => {
    const input: ReadonlyArray<MacroSeriesRow> = [
      { seriesId: "VIX9D", date: "2026-07-08", value: 99 },
      { seriesId: "VIXCLS", date: "2026-07-08", value: 20 },
      { seriesId: "VXVCLS", date: "2026-07-08", value: 21 },
    ];
    const pair = extractVixPair(input);
    expect(pair?.vix).toBe(20);
  });
});

// ─── businessDaysSince ──────────────────────────────────────────────────────

describe("businessDaysSince", () => {
  it("the asOf day itself is not counted as stale", () => {
    expect(businessDaysSince("2026-07-08", "2026-07-08")).toBe(0);
  });

  it("counts Mon-Fri only, correct across a weekend", () => {
    // Fri 2026-07-10 -> Mon 2026-07-13: Sat/Sun excluded, only Mon counts.
    expect(businessDaysSince("2026-07-10", "2026-07-13")).toBe(1);
  });

  it("correct across a 3-day weekend (Fri asOf, Tue after a Monday holiday)", () => {
    // Fri 2026-09-04 -> Tue 2026-09-08; Mon 2026-09-07 is Labor Day (NYSE holiday).
    // Sat 9/5, Sun 9/6 weekend; Mon 9/7 holiday; Tue 9/8 counts. = 1
    expect(businessDaysSince("2026-09-04", "2026-09-08")).toBe(1);
  });

  it("skips Thanksgiving (2026-11-26) but counts the day after (half-close treated as normal)", () => {
    // Tue 2026-11-24 -> Mon 2026-11-30: Wed 25 (count), Thu 26 holiday (skip),
    // Fri 27 (count), Sat/Sun weekend (skip), Mon 30 (count) = 3
    expect(businessDaysSince("2026-11-24", "2026-11-30")).toBe(3);
  });

  it("returns 0 when now is before asOf", () => {
    expect(businessDaysSince("2026-07-10", "2026-07-08")).toBe(0);
  });
});

// ─── resolveEntryGate — blocking ────────────────────────────────────────────

describe("resolveEntryGate — hard block", () => {
  it("VIX >= 25 resolves state 'blocked'", () => {
    const state = resolveEntryGate(makeInput({ vix: 25, vix3m: 40 }));
    expect(state.state).toBe("blocked");
    expect(state.entriesAllowed).toBe(false);
  });

  it("ratio >= 0.95 resolves state 'blocked' even with a calm VIX", () => {
    const state = resolveEntryGate(makeInput({ vix: 12, vix3m: 12.5 })); // ratio ~0.96
    expect(state.state).toBe("blocked");
    expect(state.entriesAllowed).toBe(false);
  });

  it("the worse of the two regimes wins -- VIX calm, ratio crisis still blocks", () => {
    const state = resolveEntryGate(makeInput({ vix: 14, vix3m: 14.5 })); // ratio ~0.966
    expect(state.state).toBe("blocked");
  });
});

// ─── resolveEntryGate — penalty band ────────────────────────────────────────

describe("resolveEntryGate — penalty band (linear, not a cliff)", () => {
  it("VIX exactly at the penalty floor (20) -> multiplier 1.0", () => {
    const state = resolveEntryGate(makeInput({ vix: 20, vix3m: 40 }));
    expect(state.penaltyMultiplier).toBeCloseTo(1.0, 10);
  });

  it("a mid-band VIX (22.5) -> multiplier strictly between 0.3 and 1.0", () => {
    const state = resolveEntryGate(makeInput({ vix: 22.5, vix3m: 40 }));
    expect(state.penaltyMultiplier).toBeGreaterThan(0.3);
    expect(state.penaltyMultiplier).toBeLessThan(1.0);
    expect(state.state).toBe("penalty");
  });

  it("penalty multiplier is monotonic decreasing across the VIX band", () => {
    const low = resolveEntryGate(makeInput({ vix: 21, vix3m: 40 })).penaltyMultiplier;
    const mid = resolveEntryGate(makeInput({ vix: 23, vix3m: 40 })).penaltyMultiplier;
    const high = resolveEntryGate(makeInput({ vix: 24.9, vix3m: 40 })).penaltyMultiplier;
    expect(low).toBeGreaterThan(mid);
    expect(mid).toBeGreaterThan(high);
  });

  it("ratio mid-band (0.925) -> multiplier strictly between 0.3 and 1.0", () => {
    const state = resolveEntryGate(makeInput({ vix: 10, vix3m: 10 / 0.925 }));
    expect(state.penaltyMultiplier).toBeGreaterThan(0.3);
    expect(state.penaltyMultiplier).toBeLessThan(1.0);
  });

  it("combined multiplier is the min of the two regimes (worse wins)", () => {
    // VIX deep in penalty (24 -> near 0.3), ratio calm (< 0.90 -> 1.0).
    const state = resolveEntryGate(makeInput({ vix: 24, vix3m: 40 }));
    const vixOnly = resolveEntryGate(makeInput({ vix: 24, vix3m: 400 })).penaltyMultiplier;
    expect(state.penaltyMultiplier).toBeCloseTo(vixOnly, 5);
  });

  it("fast-check: penalty multiplier is monotonic non-increasing as VIX rises through the band", () => {
    fc.assert(
      fc.property(
        fc.double({ min: 20, max: 24.999, noNaN: true }),
        fc.double({ min: 0, max: 4.999, noNaN: true }),
        (base, delta) => {
          const higher = Math.min(base + delta, 24.999);
          const lowMultiplier = resolveEntryGate(makeInput({ vix: base, vix3m: 40 })).penaltyMultiplier;
          const highMultiplier = resolveEntryGate(makeInput({ vix: higher, vix3m: 40 })).penaltyMultiplier;
          expect(highMultiplier).toBeLessThanOrEqual(lowMultiplier + 1e-9);
        },
      ),
      { numRuns: 100 },
    );
  });
});

// ─── resolveEntryGate — GATE BLIND ──────────────────────────────────────────

describe("resolveEntryGate — GATE BLIND (fails closed)", () => {
  it("businessDaysSince > 3 resolves state 'blind' regardless of a calm VIX", () => {
    const state = resolveEntryGate(
      makeInput({ vix: 12, vix3m: 20, asOf: "2026-07-01", nowIso: "2026-07-08" }),
    );
    expect(businessDaysSince("2026-07-01", "2026-07-08")).toBeGreaterThan(GATE_BLIND_MAX_BIZDAYS);
    expect(state.state).toBe("blind");
    expect(state.entriesAllowed).toBe(false);
  });

  it("exactly 3 business days stale is still accepted (not blind)", () => {
    // Wed 2026-07-08 asOf -> Mon 2026-07-13 now: Thu/Fri/Mon = 3 business days.
    expect(businessDaysSince("2026-07-08", "2026-07-13")).toBe(3);
    const state = resolveEntryGate(
      makeInput({ vix: 12, vix3m: 20, asOf: "2026-07-08", nowIso: "2026-07-13" }),
    );
    expect(state.state).not.toBe("blind");
  });

  it("asOf null (macro entirely missing) resolves state 'blind'", () => {
    const state = resolveEntryGate(
      makeInput({ rowsOverride: [{ seriesId: "VIXCLS", date: "2026-07-08", value: 12 }] }),
    );
    expect(state.state).toBe("blind");
    expect(state.entriesAllowed).toBe(false);
  });
});

// ─── resolveEntryGate — hysteresis ──────────────────────────────────────────

describe("resolveEntryGate — VIX hysteresis (no-flap)", () => {
  it("a VIX that falls into [24, 25) after being blocked stays 'blocked'", () => {
    const armed = resolveEntryGate(makeInput({ vix: 25, vix3m: 40 }));
    expect(armed.state).toBe("blocked");
    const held = resolveEntryGate(makeInput({ vix: 24.5, vix3m: 40, previousState: armed }));
    expect(held.state).toBe("blocked");
  });

  it("only below 24 does a previously-blocked VIX de-arm to 'penalty'", () => {
    const armed = resolveEntryGate(makeInput({ vix: 25, vix3m: 40 }));
    const disarmed = resolveEntryGate(makeInput({ vix: 23.9, vix3m: 40, previousState: armed }));
    expect(disarmed.state).toBe("penalty");
  });

  it("without a previous armed state, 24.5 (below 25, above disarm) is only 'penalty', not 'blocked'", () => {
    const fresh = resolveEntryGate(makeInput({ vix: 24.5, vix3m: 40, previousState: null }));
    expect(fresh.state).toBe("penalty");
  });

  it("fast-check: no state flip for any VIX sequence oscillating within the blocked disarm band [24, 25)", () => {
    fc.assert(
      fc.property(fc.array(fc.double({ min: VIX_BLOCK_DISARM, max: VIX_BLOCK_ARM - 0.001, noNaN: true }), { minLength: 2, maxLength: 6 }), (values) => {
        let previous: EntryGateState | null = resolveEntryGate(makeInput({ vix: VIX_BLOCK_ARM, vix3m: 40 }));
        expect(previous.state).toBe("blocked");
        for (const v of values) {
          const next = resolveEntryGate(makeInput({ vix: v, vix3m: 40, previousState: previous }));
          expect(next.state).toBe("blocked");
          previous = next;
        }
      }),
      { numRuns: 50 },
    );
  });

  it("fast-check: no state flip for a ratio sequence oscillating within the blocked disarm band", () => {
    fc.assert(
      fc.property(
        fc.array(fc.double({ min: RATIO_BLOCK_DISARM, max: RATIO_BLOCK_ARM - 0.0001, noNaN: true }), { minLength: 2, maxLength: 6 }),
        (values) => {
          let previous: EntryGateState | null = resolveEntryGate(makeInput({ vix: 10, vix3m: 10 / RATIO_BLOCK_ARM }));
          expect(previous.state).toBe("blocked");
          for (const ratio of values) {
            const next = resolveEntryGate(makeInput({ vix: 10, vix3m: 10 / ratio, previousState: previous }));
            expect(next.state).toBe("blocked");
            previous = next;
          }
        },
      ),
      { numRuns: 50 },
    );
  });

  it("penalty state holds across its own disarm band [19, 20) before releasing to 'open'", () => {
    const armed = resolveEntryGate(makeInput({ vix: VIX_PENALTY_FLOOR, vix3m: 40 }));
    expect(armed.state).toBe("penalty");
    const held = resolveEntryGate(makeInput({ vix: VIX_PENALTY_DISARM + 0.5, vix3m: 40, previousState: armed }));
    expect(held.state).toBe("penalty");
    const released = resolveEntryGate(makeInput({ vix: VIX_PENALTY_DISARM - 0.001, vix3m: 40, previousState: held }));
    expect(released.state).toBe("open");
  });
});

// ─── resolveEntryGate — brake passthrough ───────────────────────────────────

describe("resolveEntryGate — anti-criteria brake passthrough", () => {
  it("maxOpenBrake=true blocks entries even with a calm VIX/ratio, and names the brake", () => {
    const state = resolveEntryGate(makeInput({ vix: 12, vix3m: 20, maxOpenBrake: true }));
    expect(state.state).toBe("open");
    expect(state.entriesAllowed).toBe(false);
    expect(state.reasons).toContain("maxOpen");
  });

  it("cooldownBrake=true blocks entries even with a calm VIX/ratio, and names the brake", () => {
    const state = resolveEntryGate(makeInput({ vix: 12, vix3m: 20, cooldownBrake: true }));
    expect(state.entriesAllowed).toBe(false);
    expect(state.reasons).toContain("cooldown");
  });

  it("no brake tripped and calm regime -> entriesAllowed true", () => {
    const state = resolveEntryGate(makeInput({ vix: 12, vix3m: 20 }));
    expect(state.entriesAllowed).toBe(true);
    expect(state.reasons).not.toContain("maxOpen");
    expect(state.reasons).not.toContain("cooldown");
  });
});

// ─── applyGatePenaltyScore ───────────────────────────────────────────────────

describe("applyGatePenaltyScore", () => {
  it("scales and rounds", () => {
    expect(applyGatePenaltyScore(80, 0.65)).toBe(52);
  });

  it("clamps to [0, 100]", () => {
    expect(applyGatePenaltyScore(80, 2)).toBe(100);
    expect(applyGatePenaltyScore(80, -1)).toBe(0);
  });

  it("multiplier 1.0 is a no-op (rounded)", () => {
    expect(applyGatePenaltyScore(77, 1.0)).toBe(77);
  });
});

// ─── VIX_LADDER — no gap/overlap ─────────────────────────────────────────────

describe("VIX_LADDER", () => {
  it("has four tiers, contiguous, no gap or overlap", () => {
    expect(VIX_LADDER).toHaveLength(4);
    for (let i = 1; i < VIX_LADDER.length; i += 1) {
      const prev = VIX_LADDER[i - 1];
      const curr = VIX_LADDER[i];
      expect(prev).toBeDefined();
      expect(curr).toBeDefined();
      if (prev !== undefined && curr !== undefined) {
        expect(curr.min).toBe(prev.max);
      }
    }
  });

  it("fast-check: every VIX value in [0, 100) falls in exactly one tier", () => {
    fc.assert(
      fc.property(fc.double({ min: 0, max: 99.999, noNaN: true }), (vix) => {
        const matches = VIX_LADDER.filter((tier) => vix >= tier.min && vix < tier.max);
        expect(matches).toHaveLength(1);
      }),
      { numRuns: 200 },
    );
  });
});
