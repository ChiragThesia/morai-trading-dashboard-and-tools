/**
 * computeAttributionSeries tests (Phase 22, Plan 02) — example + fast-check property, per
 * tdd.md's numerical-code rule (attribution explicitly named).
 *
 * Invariants:
 *   - isGapRow: spot === "0" OR any of frontIv/backIv/netDelta/netGamma/netTheta/netVega
 *     non-finite -> true; an all-finite, non-zero-spot row -> false.
 *   - Index 0 (or the first non-gap row) is the accumulation baseline: all four cumulatives = 0.
 *   - Δt is derived from `time`, not dteFront/dteBack (Pitfall 3) — a 30-min interval yields a
 *     nonzero theta bucket.
 *   - A gap row in the middle has null cumulatives; the interval(s) touching it are skipped, so
 *     the post-gap cumulative equals the pre-gap cumulative.
 *   - pnlOpen is dollars, never divided by 100 (Pitfall 1).
 *   - Accumulation identity: sum of (theta+vega+deltaGamma+residual) over any contiguous
 *     non-gap span equals pnlOpen[end] - pnlOpen[start] (residual is the exact plug).
 *
 * fc.float v4 requires 32-bit bounds via Math.fround() (Phase 1/5/22-01 precedent).
 */

import { describe, it, expect } from "vitest";
import fc from "fast-check";
import { computeAttributionSeries, isGapRow } from "./attribution.ts";
import type { AttributionRow } from "./attribution.ts";

const BASE_ROW: AttributionRow = {
  time: "2026-01-05T10:00:00Z",
  spot: "500",
  frontIv: "0.20",
  backIv: "0.22",
  netDelta: "2",
  netGamma: "0.05",
  netTheta: "-10",
  netVega: "8",
  pnlOpen: "1000",
};

describe("isGapRow", () => {
  it("returns true when spot is the literal zero-string gap marker", () => {
    expect(isGapRow({ ...BASE_ROW, spot: "0" })).toBe(true);
  });

  it("returns true when any greek/IV field is a non-finite NaN string", () => {
    const gapFields = ["frontIv", "backIv", "netDelta", "netGamma", "netTheta", "netVega"] as const;
    for (const field of gapFields) {
      expect(isGapRow({ ...BASE_ROW, [field]: "NaN" })).toBe(true);
    }
  });

  it("returns false for an all-finite, non-zero-spot row", () => {
    expect(isGapRow(BASE_ROW)).toBe(false);
  });
});

describe("computeAttributionSeries", () => {
  it("index 0 cumulatives are 0 for a non-gap first row", () => {
    const series = computeAttributionSeries([BASE_ROW]);
    expect(series).toEqual([
      { isGap: false, cumTheta: 0, cumVega: 0, cumDeltaGamma: 0, cumResidual: 0 },
    ]);
  });

  it("theta bucket uses Δt from `time` (a 30-min same-day interval yields nonzero theta, proving dteFront is not used)", () => {
    const flat = { spot: "500", frontIv: "0.20", backIv: "0.20", netDelta: "0", netGamma: "0", netVega: "0" };
    const rows: AttributionRow[] = [
      { ...flat, time: "2026-01-05T10:00:00Z", netTheta: "-48", pnlOpen: "1000" },
      { ...flat, time: "2026-01-05T10:30:00Z", netTheta: "-48", pnlOpen: "999" },
    ];
    const series = computeAttributionSeries(rows);
    const point = series[1];
    expect(point).toBeDefined();
    if (point === undefined) return;
    const expectedTheta = -48 * (0.5 / 24);
    expect(point.cumTheta).not.toBeNull();
    expect(point.cumTheta ?? Number.NaN).toBeCloseTo(expectedTheta, 6);
  });

  it("a gap row in the middle has null cumulatives; the spanning intervals are skipped (post-gap cum === pre-gap cum)", () => {
    const rows: AttributionRow[] = [
      { ...BASE_ROW, time: "2026-01-05T10:00:00Z", pnlOpen: "1000" },
      { ...BASE_ROW, time: "2026-01-05T10:30:00Z", spot: "505", pnlOpen: "1050" },
      { ...BASE_ROW, time: "2026-01-05T11:00:00Z", spot: "0", frontIv: "NaN" }, // gap row
      { ...BASE_ROW, time: "2026-01-05T11:30:00Z", spot: "510", pnlOpen: "1200" },
    ];
    const series = computeAttributionSeries(rows);
    const gapPoint = series[2];
    const preGap = series[1];
    const postGap = series[3];
    expect(gapPoint).toEqual({ isGap: true, cumTheta: null, cumVega: null, cumDeltaGamma: null, cumResidual: null });
    expect(preGap).toBeDefined();
    expect(postGap).toBeDefined();
    if (preGap === undefined || postGap === undefined) return;
    expect(postGap.cumTheta ?? Number.NaN).toBeCloseTo(preGap.cumTheta ?? Number.NaN, 10);
    expect(postGap.cumVega ?? Number.NaN).toBeCloseTo(preGap.cumVega ?? Number.NaN, 10);
    expect(postGap.cumDeltaGamma ?? Number.NaN).toBeCloseTo(preGap.cumDeltaGamma ?? Number.NaN, 10);
    expect(postGap.cumResidual ?? Number.NaN).toBeCloseTo(preGap.cumResidual ?? Number.NaN, 10);
  });

  it("residual uses pnlOpen as dollars (never ÷100) — magnitude sanity + exact plug check", () => {
    const rows: AttributionRow[] = [
      { time: "2026-01-05T10:00:00Z", spot: "500", frontIv: "0.20", backIv: "0.22", netDelta: "2", netGamma: "0.05", netTheta: "-10", netVega: "8", pnlOpen: "1000" },
      { time: "2026-01-05T10:30:00Z", spot: "505", frontIv: "0.21", backIv: "0.23", netDelta: "2", netGamma: "0.05", netTheta: "-10", netVega: "8", pnlOpen: "1500" },
    ];
    const series = computeAttributionSeries(rows);
    const point = series[1];
    expect(point).toBeDefined();
    if (point === undefined) return;

    const theta = -10 * (0.5 / 24);
    const dSpot = 5;
    const deltaGamma = 2 * dSpot + 0.5 * 0.05 * dSpot * dSpot;
    const dIv = (0.21 + 0.23) / 2 - (0.2 + 0.22) / 2;
    const vega = 8 * dIv * 100;
    const expectedResidual = (1500 - 1000) - theta - vega - deltaGamma;

    expect(point.cumResidual).not.toBeNull();
    expect(point.cumResidual ?? Number.NaN).toBeCloseTo(expectedResidual, 6);
    // Smoke check: if pnlOpen were wrongly divided by 100 this magnitude would collapse to ~5.
    expect(Math.abs(expectedResidual)).toBeGreaterThan(50);
  });

  it("property: accumulation identity holds over any contiguous non-gap span (residual is the exact plug)", () => {
    const rowValueArb = fc.record({
      spot: fc.float({ min: Math.fround(1), max: Math.fround(500), noNaN: true }),
      frontIv: fc.float({ min: Math.fround(0.01), max: Math.fround(2), noNaN: true }),
      backIv: fc.float({ min: Math.fround(0.01), max: Math.fround(2), noNaN: true }),
      netDelta: fc.float({ min: Math.fround(-500), max: Math.fround(500), noNaN: true }),
      netGamma: fc.float({ min: Math.fround(-50), max: Math.fround(50), noNaN: true }),
      netTheta: fc.float({ min: Math.fround(-500), max: Math.fround(500), noNaN: true }),
      netVega: fc.float({ min: Math.fround(-500), max: Math.fround(500), noNaN: true }),
      pnlOpen: fc.float({ min: Math.fround(-10_000), max: Math.fround(10_000), noNaN: true }),
      timeIncMs: fc.integer({ min: 1, max: 100_000 }),
    });

    const spanArb = fc.array(rowValueArb, { minLength: 2, maxLength: 15 }).chain((values) =>
      fc.record({
        values: fc.constant(values),
        a: fc.nat({ max: values.length - 1 }),
        b: fc.nat({ max: values.length - 1 }),
      }),
    );

    fc.assert(
      fc.property(spanArb, ({ values, a, b }) => {
        const lo = Math.min(a, b);
        const hi = Math.max(a, b);

        let t = 0;
        const rows: AttributionRow[] = values.map((v) => {
          t += v.timeIncMs;
          return {
            time: new Date(t).toISOString(),
            spot: String(v.spot),
            frontIv: String(v.frontIv),
            backIv: String(v.backIv),
            netDelta: String(v.netDelta),
            netGamma: String(v.netGamma),
            netTheta: String(v.netTheta),
            netVega: String(v.netVega),
            pnlOpen: String(v.pnlOpen),
          };
        });

        const series = computeAttributionSeries(rows);
        const rowLo = rows[lo];
        const rowHi = rows[hi];
        const seriesLo = series[lo];
        const seriesHi = series[hi];
        if (rowLo === undefined || rowHi === undefined || seriesLo === undefined || seriesHi === undefined) {
          return false;
        }

        const pnlDelta = parseFloat(rowHi.pnlOpen) - parseFloat(rowLo.pnlOpen);
        const sumDelta =
          (seriesHi.cumTheta ?? 0) -
          (seriesLo.cumTheta ?? 0) +
          ((seriesHi.cumVega ?? 0) - (seriesLo.cumVega ?? 0)) +
          ((seriesHi.cumDeltaGamma ?? 0) - (seriesLo.cumDeltaGamma ?? 0)) +
          ((seriesHi.cumResidual ?? 0) - (seriesLo.cumResidual ?? 0));

        expect(sumDelta).toBeCloseTo(pnlDelta, 6);
        return true;
      }),
      { numRuns: 500 },
    );
  });
});
