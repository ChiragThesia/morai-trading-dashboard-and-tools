import { describe, it, expect, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import * as fc from "fast-check";

import { PayoffChartMarks, EDGE_ARROW_LANE_Y } from "./PayoffChartMarks.tsx";
import type { PayoffChartMarksProps } from "./PayoffChartMarks.tsx";
import { buildXScale, INNER_W } from "./PayoffChart.tsx";

/**
 * PayoffChartMarks — the three genuinely-custom PayoffChart marks (RESEARCH D-08):
 * EM-band ticks/connector/label, BE-marker bars, off-domain edge-arrow glyphs.
 * Rendered directly into a bare <svg> with an explicit scale — no Recharts
 * container needed (Assumption A2 fallback: scale-driven, not recharts-internal).
 */

const DOMAIN = { min: 6900, max: 7900 };
const ZERO_Y = 200;
const xScale = buildXScale(INNER_W, DOMAIN);

function baseProps(): PayoffChartMarksProps {
  return {
    xScale,
    innerWidth: INNER_W,
    zeroY: ZERO_Y,
    domain: DOMAIN,
    expectedMoveBand: null,
    beTodayStrikes: [],
    beExpStrikes: [],
    gex: null,
  };
}

function renderMarks(overrides: Partial<PayoffChartMarksProps> = {}) {
  return render(
    <svg>
      <PayoffChartMarks {...baseProps()} {...overrides} />
    </svg>,
  );
}

describe("PayoffChartMarks — EM band (ANLZ-02)", () => {
  afterEach(cleanup);

  it("renders no band elements when expectedMoveBand is null", () => {
    renderMarks();
    expect(screen.queryByTestId("em-band")).toBeNull();
  });

  it("renders two ticks at spot±em (via xScale) and a connector at zeroY", () => {
    const band = { spot: 7381, em: 120 };
    renderMarks({ expectedMoveBand: band });

    const expectedLowerX = xScale(band.spot - band.em);
    const expectedUpperX = xScale(band.spot + band.em);

    const lowerTick = screen.getByTestId("em-band-tick-lower");
    const upperTick = screen.getByTestId("em-band-tick-upper");
    const connector = screen.getByTestId("em-band-connector");

    expect(Number(lowerTick.getAttribute("x1"))).toBeCloseTo(expectedLowerX, 6);
    expect(Number(upperTick.getAttribute("x1"))).toBeCloseTo(expectedUpperX, 6);
    expect(connector.getAttribute("y1")).toBe(String(ZERO_Y));
    expect(connector.getAttribute("y2")).toBe(String(ZERO_Y));
  });

  it("clamps every EM-band x-coordinate into [0, innerWidth] when em vastly exceeds the domain width (2563bd6 page-bleed regression)", () => {
    // Regression: Phase 30's tent-fitted domains are often narrower than spot±1σ.
    // Unclamped xScale coords + SVG overflow:visible drew the connector across the
    // whole page (user screenshot 2026-07-10). Every EM x must stay in [0, innerWidth].
    const wideBand = { spot: (DOMAIN.min + DOMAIN.max) / 2, em: (DOMAIN.max - DOMAIN.min) * 5 };
    renderMarks({ expectedMoveBand: wideBand });

    const xs = [
      ...["x1", "x2"].map((a) => Number(screen.getByTestId("em-band-tick-lower").getAttribute(a))),
      ...["x1", "x2"].map((a) => Number(screen.getByTestId("em-band-tick-upper").getAttribute(a))),
      ...["x1", "x2"].map((a) => Number(screen.getByTestId("em-band-connector").getAttribute(a))),
      Number(screen.getByTestId("em-band-label").getAttribute("x")),
    ];
    for (const x of xs) {
      expect(x).toBeGreaterThanOrEqual(0);
      expect(x).toBeLessThanOrEqual(INNER_W);
    }
  });
});

describe("PayoffChartMarks — BE markers (TOS-style)", () => {
  afterEach(cleanup);

  it("renders no BE markers when both strike lists are empty", () => {
    renderMarks();
    expect(screen.queryByTestId("be-marker-t0")).toBeNull();
    expect(screen.queryByTestId("be-marker-exp")).toBeNull();
  });

  it("renders a short coral vertical centered on zeroY for be-marker-t0", () => {
    renderMarks({ beTodayStrikes: [7400] });
    const marker = screen.getByTestId("be-marker-t0");
    expect(marker.getAttribute("stroke")).toBe("#ef5350");
    expect(Number(marker.getAttribute("y1"))).toBe(ZERO_Y - 9);
    expect(Number(marker.getAttribute("y2"))).toBe(ZERO_Y + 9);
  });

  it("renders a short coral vertical centered on zeroY for be-marker-exp", () => {
    renderMarks({ beExpStrikes: [7400] });
    const marker = screen.getByTestId("be-marker-exp");
    expect(marker.getAttribute("stroke")).toBe("#ef5350");
    expect(Number(marker.getAttribute("y1"))).toBe(ZERO_Y - 9);
    expect(Number(marker.getAttribute("y2"))).toBe(ZERO_Y + 9);
  });
});

describe("PayoffChartMarks — edge-arrow lanes (KISS collision fix, 31-01 DEFECT-1)", () => {
  afterEach(cleanup);

  it("EDGE_ARROW_LANE_Y assigns three distinct y lanes to flip/call/put", () => {
    const keys: ReadonlyArray<"flip" | "call" | "put"> = ["flip", "call", "put"];
    const lanes = keys.map((k) => EDGE_ARROW_LANE_Y[k]);
    expect(new Set(lanes).size).toBe(3);
    expect(lanes).toEqual([8, 16, 24]);
  });

  it("renders no arrows when gex is null", () => {
    renderMarks({ gex: null });
    expect(screen.queryByText("›")).toBeNull();
    expect(screen.queryByText("‹")).toBeNull();
  });

  it("renders no arrows when all walls are in-domain", () => {
    renderMarks({ gex: { callWall: 7600, putWall: 7400, flip: 7486 } });
    expect(screen.queryByText("›")).toBeNull();
    expect(screen.queryByText("‹")).toBeNull();
    expect(screen.queryByText(/wall/i)).toBeNull();
  });

  it("off-domain call wall renders a single '›' glyph at the call lane (y=16), text-anchor end, no label text", () => {
    renderMarks({ gex: { callWall: 8200, putWall: 7400, flip: 7486 } });
    const arrow = screen.getByText("›");
    expect(arrow.getAttribute("y")).toBe("16");
    expect(arrow.getAttribute("text-anchor")).toBe("end");
    expect(screen.queryByText(/wall/i)).toBeNull();
  });

  it("off-domain put wall renders a single '‹' glyph at the put lane (y=24), text-anchor start, no label text", () => {
    renderMarks({ gex: { callWall: 7600, putWall: 6800, flip: 7486 } });
    const arrow = screen.getByText("‹");
    expect(arrow.getAttribute("y")).toBe("24");
    expect(arrow.getAttribute("text-anchor")).toBe("start");
    expect(screen.queryByText(/wall/i)).toBeNull();
  });

  it("fast-check: zero wall-label text and zero arrow glyphs for arbitrary in-domain wall/flip levels", () => {
    fc.assert(
      fc.property(
        fc.float({ min: Math.fround(DOMAIN.min + 50), max: Math.fround(DOMAIN.max - 50), noNaN: true }),
        fc.float({ min: Math.fround(DOMAIN.min + 50), max: Math.fround(DOMAIN.max - 50), noNaN: true }),
        fc.float({ min: Math.fround(DOMAIN.min + 50), max: Math.fround(DOMAIN.max - 50), noNaN: true }),
        (put, call, flip) => {
          const { unmount } = renderMarks({ gex: { callWall: call, putWall: put, flip } });
          expect(screen.queryByText(/wall/i)).toBeNull();
          expect(screen.queryByText("›")).toBeNull();
          expect(screen.queryByText("‹")).toBeNull();
          unmount();
          return true;
        },
      ),
      { numRuns: 50 },
    );
  });
});
