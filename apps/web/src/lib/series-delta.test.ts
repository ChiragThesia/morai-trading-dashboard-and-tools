/**
 * series-delta tests — trend deltas for the Market-regime rail and COT card (2026-07-16).
 *
 * The rail shows each metric's change vs its PRIOR observation (daily EOD for vol/rates,
 * weekly for COT) so the trend reads at a glance. Pure derivation from the macro history
 * the client already fetches — no backend change, never fabricated: missing/short series
 * or a zero denominator → null, no chip.
 */
import { describe, it, expect } from "vitest";
import { seriesDelta, ratioDelta, formatDelta, pctOfPrev } from "./series-delta.ts";

const PTS = [
  { time: "2026-07-13", value: 17.16 },
  { time: "2026-07-14", value: 16.5 },
];

describe("seriesDelta", () => {
  it("returns prev/latest/delta from the last two observations", () => {
    expect(seriesDelta(PTS)).toEqual({
      prev: 17.16,
      latest: 16.5,
      delta: 16.5 - 17.16,
      vsDate: "2026-07-13",
    });
  });

  it("null when fewer than 2 points (never fabricated)", () => {
    expect(seriesDelta([{ time: "2026-07-14", value: 16.5 }])).toBeNull();
    expect(seriesDelta([])).toBeNull();
    expect(seriesDelta(undefined)).toBeNull();
  });
});

describe("ratioDelta (VIX/VIX3M, VIX9D/VIX — aligned by shared dates)", () => {
  it("computes the ratio at the last two dates BOTH series have", () => {
    const num = [
      { time: "2026-07-13", value: 17.16 },
      { time: "2026-07-14", value: 16.5 },
      { time: "2026-07-15", value: 16.39 },
    ];
    const den = [
      { time: "2026-07-13", value: 19.5 },
      { time: "2026-07-14", value: 19.4 },
    ]; // 07-15 missing in denominator → shared dates end at 07-14
    const d = ratioDelta(num, den);
    expect(d).not.toBeNull();
    expect(d?.prev).toBeCloseTo(17.16 / 19.5, 10);
    expect(d?.latest).toBeCloseTo(16.5 / 19.4, 10);
    expect(d?.vsDate).toBe("2026-07-13");
  });

  it("null when fewer than 2 shared dates or a zero denominator", () => {
    expect(ratioDelta(PTS, [{ time: "2026-07-14", value: 19.4 }])).toBeNull();
    expect(
      ratioDelta(PTS, [
        { time: "2026-07-13", value: 0 },
        { time: "2026-07-14", value: 19.4 },
      ]),
    ).toBeNull();
  });
});

describe("formatDelta", () => {
  const d = { prev: 17.16, latest: 16.5, delta: -0.66, vsDate: "2026-07-13" };

  it("level-pct: signed percent of prev (VVIX-style levels)", () => {
    expect(formatDelta("level-pct", d)).toBe("▼3.8%");
    expect(formatDelta("level-pct", { prev: 100, latest: 101.2, delta: 1.2, vsDate: "x" })).toBe("▲1.2%");
  });

  it("bp: signed basis points (rates, curve spreads, HY OAS)", () => {
    expect(formatDelta("bp", { prev: 2.69, latest: 2.72, delta: 0.03, vsDate: "x" })).toBe("▲3bp");
    expect(formatDelta("bp", { prev: 0.42, latest: 0.4, delta: -0.02, vsDate: "x" })).toBe("▼2bp");
  });

  it("ratio: signed raw delta 2dp (VIX/VIX3M-style ratios)", () => {
    expect(formatDelta("ratio", { prev: 0.88, latest: 0.85, delta: -0.03, vsDate: "x" })).toBe("▼0.03");
  });

  it("flat delta renders as an explicit unchanged chip", () => {
    expect(formatDelta("bp", { prev: 3.63, latest: 3.63, delta: 0, vsDate: "x" })).toBe("· 0bp");
  });
});

describe("pctOfPrev (COT week-over-week %)", () => {
  it("percent of |prev net|, one decimal", () => {
    expect(pctOfPrev(25_000, -756_000)).toBe("3.3%");
    expect(pctOfPrev(-22_000, 993_000)).toBe("2.2%");
  });

  it("null when prev is 0 (never Infinity)", () => {
    expect(pctOfPrev(25_000, 0)).toBeNull();
  });
});
