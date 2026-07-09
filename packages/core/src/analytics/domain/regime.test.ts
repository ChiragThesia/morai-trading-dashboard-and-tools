/**
 * regime domain tests (Phase 24, Plan 24-03) — example + fast-check, per tdd.md numerical rule.
 *
 * Four pure banding functions classify one indicator's value into calm|warning|crisis at the
 * cuts documented in 24-RESEARCH.md's Per-Indicator Adjudication table. Boundary values are
 * inclusive on the warning/crisis side (>= cut), matching the domain constants in regime.ts.
 */

import { describe, it, expect } from "vitest";
import fc from "fast-check";
import {
  bandVixTermStructure,
  bandVvix,
  bandVix9dRatio,
  bandHyOas,
} from "./regime.ts";
import type { RegimeBand } from "./regime.ts";

const bandFns: ReadonlyArray<{ name: string; fn: (value: number) => RegimeBand }> = [
  { name: "bandVixTermStructure", fn: bandVixTermStructure },
  { name: "bandVvix", fn: bandVvix },
  { name: "bandVix9dRatio", fn: bandVix9dRatio },
  { name: "bandHyOas", fn: bandHyOas },
];

// ─── Example boundary tests (24-RESEARCH.md cuts) ──────────────────────────────

describe("bandVixTermStructure", () => {
  it("calm below 0.90", () => {
    expect(bandVixTermStructure(0.89)).toBe("calm");
  });

  it("warning at 0.90", () => {
    expect(bandVixTermStructure(0.9)).toBe("warning");
  });

  it("crisis at 0.95", () => {
    expect(bandVixTermStructure(0.95)).toBe("crisis");
  });
});

describe("bandVvix", () => {
  it("calm below 100", () => {
    expect(bandVvix(99)).toBe("calm");
  });

  it("warning at 100", () => {
    expect(bandVvix(100)).toBe("warning");
  });

  it("crisis at 115", () => {
    expect(bandVvix(115)).toBe("crisis");
  });
});

describe("bandVix9dRatio", () => {
  it("calm below 1.0", () => {
    expect(bandVix9dRatio(0.99)).toBe("calm");
  });

  it("warning at 1.0", () => {
    expect(bandVix9dRatio(1.0)).toBe("warning");
  });

  it("crisis at 1.1", () => {
    expect(bandVix9dRatio(1.1)).toBe("crisis");
  });
});

describe("bandHyOas", () => {
  it("calm below 3.0", () => {
    expect(bandHyOas(2.99)).toBe("calm");
  });

  it("warning at 3.0", () => {
    expect(bandHyOas(3.0)).toBe("warning");
  });

  it("crisis at 5.0", () => {
    expect(bandHyOas(5.0)).toBe("crisis");
  });
});

// ─── Fast-check properties: monotonic + total, no gap/overlap ─────────────────

describe("banding functions — fast-check properties", () => {
  const valueArb = fc.float({ min: Math.fround(-1000), max: Math.fround(1000), noNaN: true });
  const BAND_ORDER: Readonly<Record<RegimeBand, number>> = { calm: 0, warning: 1, crisis: 2 };

  for (const { name, fn } of bandFns) {
    it(`${name}: monotonic non-decreasing in value`, () => {
      fc.assert(
        fc.property(valueArb, valueArb, (a, b) => {
          const lo = Math.min(a, b);
          const hi = Math.max(a, b);
          return BAND_ORDER[fn(lo)] <= BAND_ORDER[fn(hi)];
        }),
        { numRuns: 1000 },
      );
    });

    it(`${name}: total — every value maps to exactly one of calm|warning|crisis`, () => {
      fc.assert(
        fc.property(valueArb, (value) => {
          const band = fn(value);
          return band === "calm" || band === "warning" || band === "crisis";
        }),
        { numRuns: 1000 },
      );
    });
  }
});
