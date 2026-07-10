import { useState } from "react";
import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import * as fc from "fast-check";

import {
  PayoffChart,
  computeYDomain,
  buildXTicks,
  buildXScale,
  INNER_W,
  EDGE_ARROW_LANE_Y,
} from "./PayoffChart.tsx";
import type { PayoffChartToggles, PayoffChartProps } from "./PayoffChart.tsx";
import type { PayoffPoint } from "../../lib/scenario-engine.ts";

/**
 * PayoffChart — D-05 row-highlight dual-curve dim + D-02 T+0 exclusion note.
 *
 * Mirrors GexBars.test.tsx's render/assert conventions (@testing-library/react,
 * no echarts here so no mock needed — visx renders plain SVG under jsdom).
 */

const TOGGLES: PayoffChartToggles = {
  showFan: false,
  showExpiration: true,
  showWalls: false,
  showProfitZone: false,
};

const TODAY_CURVE: PayoffPoint[] = [
  { spot: 6900, pl: -300 },
  { spot: 7400, pl: 0 },
  { spot: 7900, pl: 300 },
];

const EXP_CURVE: PayoffPoint[] = [
  { spot: 6900, pl: -400 },
  { spot: 7400, pl: 0 },
  { spot: 7900, pl: 400 },
];

const HIGHLIGHT_TODAY_CURVE: PayoffPoint[] = [
  { spot: 6900, pl: -100 },
  { spot: 7400, pl: 0 },
  { spot: 7900, pl: 100 },
];

const HIGHLIGHT_EXP_CURVE: PayoffPoint[] = [
  { spot: 6900, pl: -150 },
  { spot: 7400, pl: 0 },
  { spot: 7900, pl: 150 },
];

const HUGE_EXP_CURVE: PayoffPoint[] = [
  { spot: 6900, pl: -50_000 },
  { spot: 7400, pl: 0 },
  { spot: 7900, pl: 50_000 },
];

/** Grid-line y-axis labels only (text-anchor="end" is unique to them). */
function getGridLabels(container: HTMLElement): string[] {
  return Array.from(container.querySelectorAll('text[text-anchor="end"]')).map(
    (el) => el.textContent ?? "",
  );
}

/** Matches the curve fixtures above (6900-7900) — every existing test keeps exercising the real path (Pitfall 3). */
const DOMAIN = { min: 6900, max: 7900 };

function baseProps(): PayoffChartProps {
  return {
    todayCurve: TODAY_CURVE,
    fanCurves: [],
    expirationCurve: EXP_CURVE,
    rollCurve: null,
    gex: null,
    domain: DOMAIN,
    spot: 7381,
    toggles: TOGGLES,
    fitY: false,
    onFitYConsumed: () => {},
    positionSetSignature: "sig-1",
    baseExpirationCurve: EXP_CURVE,
  };
}

describe("PayoffChart — D-05 row-highlight dual-curve dim", () => {
  afterEach(() => {
    cleanup();
  });

  it("with no highlight, net-book T+0/@exp curves render at full stroke-opacity and no single-position overlay (regression preserved)", () => {
    render(<PayoffChart {...baseProps()} />);

    const t0 = screen.getByTestId("net-book-t0-curve");
    const exp = screen.getByTestId("net-book-exp-curve");
    expect(t0.getAttribute("stroke-opacity")).toBe("1");
    expect(exp.getAttribute("stroke-opacity")).toBe("1");
    expect(screen.queryByTestId("highlighted-t0-curve")).toBeNull();
    expect(screen.queryByTestId("highlighted-exp-curve")).toBeNull();
  });

  it("dims the net-book T+0/@exp curves to stroke-opacity 0.3 when a highlight is active (chart-layer, not opacity-40)", () => {
    render(
      <PayoffChart
        {...baseProps()}
        highlightedPositionId="pos-1"
        highlightedTodayCurve={HIGHLIGHT_TODAY_CURVE}
        highlightedExpirationCurve={HIGHLIGHT_EXP_CURVE}
      />,
    );

    const t0 = screen.getByTestId("net-book-t0-curve");
    const exp = screen.getByTestId("net-book-exp-curve");
    expect(t0.getAttribute("stroke-opacity")).toBe("0.3");
    expect(exp.getAttribute("stroke-opacity")).toBe("0.3");
  });

  it("renders the single highlighted position's T+0/@exp curves at full emphasis with the existing violet/gray-muted stroke tokens", () => {
    render(
      <PayoffChart
        {...baseProps()}
        highlightedPositionId="pos-1"
        highlightedTodayCurve={HIGHLIGHT_TODAY_CURVE}
        highlightedExpirationCurve={HIGHLIGHT_EXP_CURVE}
      />,
    );

    const t0 = screen.getByTestId("highlighted-t0-curve");
    const exp = screen.getByTestId("highlighted-exp-curve");
    expect(t0.getAttribute("stroke")).toBe("#a78bfa");
    expect(t0.getAttribute("stroke-width")).toBe("2.6");
    expect(exp.getAttribute("stroke")).toBe("#7b8696");
    expect(exp.getAttribute("stroke-dasharray")).toBe("5 4");
  });

  it("never introduces the opacity-40 row-exclusion class into the chart-layer dim", () => {
    const { container } = render(
      <PayoffChart
        {...baseProps()}
        highlightedPositionId="pos-1"
        highlightedTodayCurve={HIGHLIGHT_TODAY_CURVE}
        highlightedExpirationCurve={HIGHLIGHT_EXP_CURVE}
      />,
    );
    expect(container.innerHTML.includes("opacity-40")).toBe(false);
  });
});

describe("PayoffChart — D-02 T+0 exclusion note", () => {
  afterEach(() => {
    cleanup();
  });

  it("renders no exclusion note when excludedFromT0Count is 0 or absent", () => {
    render(<PayoffChart {...baseProps()} />);
    expect(screen.queryByTestId("t0-exclusion-note")).toBeNull();
  });

  it("renders the singular exclusion note at count 1", () => {
    render(<PayoffChart {...baseProps()} excludedFromT0Count={1} />);
    const note = screen.getByTestId("t0-exclusion-note");
    expect(note.textContent).toBe("T+0 excludes 1 position: IV n/a");
    expect(note.className).toContain("text-amber");
  });

  it("renders the plural exclusion note at count 3", () => {
    render(<PayoffChart {...baseProps()} excludedFromT0Count={3} />);
    const note = screen.getByTestId("t0-exclusion-note");
    expect(note.textContent).toBe("T+0 excludes 3 positions: IV n/a");
  });
});

describe("PayoffChart — compareCurve overlay (ANLZ-02)", () => {
  afterEach(() => {
    cleanup();
  });

  const COMPARE_CURVE: PayoffPoint[] = [
    { spot: 6900, pl: -200 },
    { spot: 7400, pl: 50 },
    { spot: 7900, pl: 250 },
  ];

  it("renders no extra path when compareCurve is null or omitted (Overview regression guard)", () => {
    const { container: baselineContainer } = render(<PayoffChart {...baseProps()} />);
    const baselineCount = baselineContainer.querySelectorAll("path").length;
    cleanup();

    const { container } = render(<PayoffChart {...baseProps()} compareCurve={null} />);
    expect(container.querySelectorAll("path").length).toBe(baselineCount);
    expect(screen.queryByTestId("compare-curve")).toBeNull();

    cleanup();
    render(<PayoffChart {...baseProps()} />);
    expect(screen.queryByTestId("compare-curve")).toBeNull();
  });

  it("renders exactly one dashed-amber path when compareCurve is supplied (no T+0 twin)", () => {
    const { container: baselineContainer } = render(<PayoffChart {...baseProps()} />);
    const baselineCount = baselineContainer.querySelectorAll("path").length;
    cleanup();

    const { container } = render(
      <PayoffChart {...baseProps()} compareCurve={COMPARE_CURVE} />,
    );
    const compare = screen.getByTestId("compare-curve");
    expect(compare.tagName.toLowerCase()).toBe("path");
    expect(compare.getAttribute("stroke")).toBe("#f0b429");
    expect(compare.getAttribute("stroke-dasharray")).not.toBeNull();
    expect(container.querySelectorAll('[data-testid="compare-curve"]').length).toBe(1);
    expect(container.querySelectorAll("path").length).toBe(baselineCount + 1);
  });

  it("honors a compareCurveColor override", () => {
    render(
      <PayoffChart
        {...baseProps()}
        compareCurve={COMPARE_CURVE}
        compareCurveColor="#00ffaa"
      />,
    );
    expect(screen.getByTestId("compare-curve").getAttribute("stroke")).toBe("#00ffaa");
  });
});

describe("PayoffChart — expectedMoveBand (ANLZ-02)", () => {
  afterEach(() => {
    cleanup();
  });

  const EM_BAND = { spot: 7381, em: 120 };

  it("renders no band elements when expectedMoveBand is null or omitted", () => {
    render(<PayoffChart {...baseProps()} />);
    expect(screen.queryByTestId("em-band")).toBeNull();

    cleanup();
    render(<PayoffChart {...baseProps()} expectedMoveBand={null} />);
    expect(screen.queryByTestId("em-band")).toBeNull();
  });

  it("renders two ticks at spot±em (via xScale) and a connector at the existing zero-P&L y", () => {
    const { container } = render(
      <PayoffChart {...baseProps()} expectedMoveBand={EM_BAND} />,
    );

    const xScale = buildXScale(INNER_W, DOMAIN);
    const expectedLowerX = xScale(EM_BAND.spot - EM_BAND.em);
    const expectedUpperX = xScale(EM_BAND.spot + EM_BAND.em);

    // The existing "Zero line" layer's own <line> is the source of truth for
    // zeroY (reused, not recomputed) — its stroke color is the ZERO_LINE constant.
    const zeroLine = container.querySelector('line[stroke="#46556a"]');
    expect(zeroLine).not.toBeNull();
    const zeroY = zeroLine?.getAttribute("y1") ?? null;
    expect(zeroY).not.toBeNull();

    const lowerTick = screen.getByTestId("em-band-tick-lower");
    const upperTick = screen.getByTestId("em-band-tick-upper");
    const connector = screen.getByTestId("em-band-connector");

    expect(Number(lowerTick.getAttribute("x1"))).toBeCloseTo(expectedLowerX, 6);
    expect(Number(upperTick.getAttribute("x1"))).toBeCloseTo(expectedUpperX, 6);
    expect(connector.getAttribute("y1")).toBe(zeroY);
    expect(connector.getAttribute("y2")).toBe(zeroY);
  });

  it("places the EM-band group before the T+0/@exp curve layers in SVG source order (never occludes a curve)", () => {
    render(<PayoffChart {...baseProps()} expectedMoveBand={EM_BAND} />);

    const band = screen.getByTestId("em-band");
    const expCurve = screen.getByTestId("net-book-exp-curve");
    const t0Curve = screen.getByTestId("net-book-t0-curve");

    // DOCUMENT_POSITION_FOLLOWING on the target means `band` precedes it in source order.
    expect(
      band.compareDocumentPosition(expCurve) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    expect(
      band.compareDocumentPosition(t0Curve) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
  });
});

describe("computeYDomain — combined-curve y-axis (OVW-04)", () => {
  it("returns the fallback domain when both curves are empty", () => {
    expect(computeYDomain([], [])).toEqual({ lo: -500, hi: 500 });
  });

  it("scans the today curve so a tall today curve is not dropped in favor of a small @exp tent", () => {
    // WR-04: the today curve carries the MORE extreme values here (exp is ±100), so every
    // assertion below can ONLY pass if computeYDomain actually scans its first argument.
    // The previous version had exp dwarf today, so a regression that ignored todayCurve
    // still passed — vacuous. Making today the extreme makes the scan load-bearing.
    const tallToday: PayoffPoint[] = [
      { spot: 6900, pl: -20_000 },
      { spot: 7400, pl: 0 },
      { spot: 7900, pl: 20_000 },
    ];
    const smallExp: PayoffPoint[] = [
      { spot: 6900, pl: -100 },
      { spot: 7400, pl: 0 },
      { spot: 7900, pl: 100 },
    ];

    const { lo, hi } = computeYDomain(tallToday, smallExp);

    // Only satisfiable if the today curve IS scanned (exp alone spans ±100).
    expect(lo).toBeLessThanOrEqual(-20_000);
    expect(hi).toBeGreaterThanOrEqual(20_000);

    // And the combined domain must equal the today-only scan (today dwarfs exp),
    // proving the exp curve did not silently replace the today scan.
    const todayOnly = computeYDomain(tallToday, tallToday);
    expect(lo).toBeCloseTo(todayOnly.lo, 6);
    expect(hi).toBeCloseTo(todayOnly.hi, 6);
    expect(hi - lo).toBeGreaterThan(0);
  });
});

describe("buildXTicks — derived round-number x-axis ticks (OVW-04)", () => {
  it("reproduces the round-step tick set for the X_MIN/X_MAX domain (6900-7900 -> step 200)", () => {
    expect(buildXTicks(6900, 7900)).toEqual([7000, 7200, 7400, 7600, 7800]);
  });

  it("keeps every tick within [min, max] and strictly increasing for an arbitrary positive range", () => {
    const ticks = buildXTicks(103, 941);
    expect(ticks.length).toBeGreaterThan(0);
    for (const t of ticks) {
      expect(t).toBeGreaterThanOrEqual(103);
      expect(t).toBeLessThanOrEqual(941);
    }
    for (let i = 1; i < ticks.length; i++) {
      const prev = ticks[i - 1];
      const curr = ticks[i];
      expect(prev).toBeDefined();
      expect(curr).toBeDefined();
      if (prev !== undefined && curr !== undefined) {
        expect(curr).toBeGreaterThan(prev);
      }
    }
  });
});

describe("PayoffChart — WR-03 y-domain lock + fitY without render-phase side effects", () => {
  afterEach(() => {
    cleanup();
  });

  it("locks the y-domain on mount and does NOT rescale when curves change but positionSetSignature is unchanged", () => {
    const { container, rerender } = render(<PayoffChart {...baseProps()} />);
    const initialTopLabel = getGridLabels(container)[5];

    rerender(
      <PayoffChart
        {...baseProps()}
        expirationCurve={HUGE_EXP_CURVE}
        baseExpirationCurve={HUGE_EXP_CURVE}
      />,
    );

    expect(getGridLabels(container)[5]).toBe(initialTopLabel);
  });

  it("recomputes the y-domain when positionSetSignature changes (lock-on-signature still works)", () => {
    const { container, rerender } = render(<PayoffChart {...baseProps()} />);
    const initialTopLabel = getGridLabels(container)[5];

    rerender(
      <PayoffChart
        {...baseProps()}
        expirationCurve={HUGE_EXP_CURVE}
        baseExpirationCurve={HUGE_EXP_CURVE}
        positionSetSignature="sig-2"
      />,
    );

    expect(getGridLabels(container)[5]).not.toBe(initialTopLabel);
  });

  it("fitY forces a refit even when positionSetSignature is unchanged, and calls onFitYConsumed exactly once", () => {
    const onFitYConsumed = vi.fn();
    const { container, rerender } = render(
      <PayoffChart {...baseProps()} onFitYConsumed={onFitYConsumed} />,
    );
    const initialTopLabel = getGridLabels(container)[5];

    rerender(
      <PayoffChart
        {...baseProps()}
        onFitYConsumed={onFitYConsumed}
        expirationCurve={HUGE_EXP_CURVE}
        baseExpirationCurve={HUGE_EXP_CURVE}
        fitY
      />,
    );

    expect(onFitYConsumed).toHaveBeenCalledTimes(1);
    expect(getGridLabels(container)[5]).not.toBe(initialTopLabel);
  });

  it("does not trigger a 'Cannot update a component while rendering a different component' warning when fitY fires the parent callback", () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    function Harness(): React.ReactElement {
      const [, setConsumed] = useState(false);
      return (
        <PayoffChart
          {...baseProps()}
          fitY
          onFitYConsumed={() => setConsumed(true)}
        />
      );
    }

    render(<Harness />);

    const warnedAboutRenderPhaseUpdate = errorSpy.mock.calls.some((call) =>
      call.some(
        (arg) => typeof arg === "string" && arg.includes("Cannot update a component"),
      ),
    );
    expect(warnedAboutRenderPhaseUpdate).toBe(false);

    errorSpy.mockRestore();
  });
});

describe("PayoffChart — curve-color props (OVW-04, D-03 scoped brand override)", () => {
  afterEach(() => {
    cleanup();
  });

  it("with no color props, the T+0 curve stroke is violet and the @exp curve stroke is gray-muted (Analyzer default preserved)", () => {
    render(<PayoffChart {...baseProps()} />);
    const t0 = screen.getByTestId("net-book-t0-curve");
    const exp = screen.getByTestId("net-book-exp-curve");
    expect(t0.getAttribute("stroke")).toBe("#a78bfa");
    expect(exp.getAttribute("stroke")).toBe("#7b8696");
  });

  it("passing todayCurveColor/expirationCurveColor sets those strokes on the respective LinePaths", () => {
    render(
      <PayoffChart
        {...baseProps()}
        todayCurveColor="#e91e8c"
        expirationCurveColor="#22d3ee"
      />,
    );
    const t0 = screen.getByTestId("net-book-t0-curve");
    const exp = screen.getByTestId("net-book-exp-curve");
    expect(t0.getAttribute("stroke")).toBe("#e91e8c");
    expect(exp.getAttribute("stroke")).toBe("#22d3ee");
  });

  it("does not change the highlighted single-position overlay curve colors when curve-color props are passed", () => {
    render(
      <PayoffChart
        {...baseProps()}
        todayCurveColor="#e91e8c"
        expirationCurveColor="#22d3ee"
        highlightedPositionId="pos-1"
        highlightedTodayCurve={HIGHLIGHT_TODAY_CURVE}
        highlightedExpirationCurve={HIGHLIGHT_EXP_CURVE}
      />,
    );
    const t0 = screen.getByTestId("highlighted-t0-curve");
    const exp = screen.getByTestId("highlighted-exp-curve");
    expect(t0.getAttribute("stroke")).toBe("#a78bfa");
    expect(exp.getAttribute("stroke")).toBe("#7b8696");
  });
});

describe("PayoffChart — breakeven pills + red markers (TOS-style)", () => {
  afterEach(cleanup);

  it("renders BE pills above the chart with the today and @exp breakeven strikes", () => {
    const { container } = render(<PayoffChart {...baseProps()} />);
    expect(container.querySelector('[data-testid="be-pills"]')).not.toBeNull();
    const t0 = [...container.querySelectorAll('[data-testid="be-pill-t0"]')].map((e) => e.textContent);
    const exp = [...container.querySelectorAll('[data-testid="be-pill-exp"]')].map((e) => e.textContent);
    expect(t0).toContain("7400"); // TODAY_CURVE crosses zero at 7400
    expect(exp).toContain("7400"); // EXP_CURVE crosses zero at 7400
  });

  it("draws short red vertical BE markers in the chart (CORAL stroke, not full-height dashed text)", () => {
    const { container } = render(<PayoffChart {...baseProps()} />);
    const markers = container.querySelectorAll(
      '[data-testid="be-marker-t0"], [data-testid="be-marker-exp"]',
    );
    expect(markers.length).toBeGreaterThan(0);
    expect(markers[0]?.getAttribute("stroke")).toBe("#ef5350");
    // No more in-chart "BE·T0" text labels (moved to the pills).
    expect(container.textContent).not.toContain("BE·T0");
  });

  it("hides @exp BE pills + markers when showExpiration is off", () => {
    const { container } = render(
      <PayoffChart {...baseProps()} toggles={{ ...TOGGLES, showExpiration: false }} />,
    );
    expect(container.querySelectorAll('[data-testid="be-pill-exp"]').length).toBe(0);
    expect(container.querySelectorAll('[data-testid="be-marker-exp"]').length).toBe(0);
    // today BEs still shown
    expect(container.querySelectorAll('[data-testid="be-pill-t0"]').length).toBeGreaterThan(0);
  });
});

describe("PayoffChart — profit zone toggle", () => {
  afterEach(cleanup);

  it("renders a non-empty @exp profit-zone fill when showProfitZone is on", () => {
    const { container } = render(
      <PayoffChart {...baseProps()} toggles={{ ...TOGGLES, showProfitZone: true }} />,
    );
    const zone = container.querySelector('[data-testid="profit-zone"]');
    expect(zone).not.toBeNull();
    // Path must actually describe a region (EXP_CURVE is profitable above 7400).
    expect((zone?.getAttribute("d") ?? "").length).toBeGreaterThan(0);
  });

  it("removes the profit-zone fill when showProfitZone is off", () => {
    const { container } = render(
      <PayoffChart {...baseProps()} toggles={{ ...TOGGLES, showProfitZone: false }} />,
    );
    expect(container.querySelector('[data-testid="profit-zone"]')).toBeNull();
  });
});

describe("PayoffChart — GEX wall edge-pin (out-of-domain markers must not bleed past the plot)", () => {
  afterEach(() => {
    cleanup();
  });

  const WALL_TOGGLES: PayoffChartToggles = { ...TOGGLES, showWalls: true };
  const xScale = buildXScale(INNER_W, DOMAIN);

  it("pins an out-of-domain call wall (8000 > X_MAX) to the right edge; no label text", () => {
    const { container } = render(
      <PayoffChart
        {...baseProps()}
        toggles={WALL_TOGGLES}
        gex={{ callWall: 8000, putWall: 7400, flip: 7486 }}
      />,
    );

    // No in-chart wall-label text survives the KISS fix (delete-label strategy).
    expect(screen.queryByText(/wall/i)).toBeNull();

    // The line itself is clamped inside the plot — never past INNER_W
    const line = container.querySelector('[data-testid="wall-line-call"]');
    expect(line).not.toBeNull();
    expect(Number(line?.getAttribute("x1"))).toBeLessThanOrEqual(INNER_W);
  });

  it("pins an out-of-domain put wall (6800 < X_MIN) to the left edge; no label text", () => {
    const { container } = render(
      <PayoffChart
        {...baseProps()}
        toggles={WALL_TOGGLES}
        gex={{ callWall: 7600, putWall: 6800, flip: 7486 }}
      />,
    );

    expect(screen.queryByText(/wall/i)).toBeNull();

    const line = container.querySelector('[data-testid="wall-line-put"]');
    expect(line).not.toBeNull();
    expect(Number(line?.getAttribute("x1"))).toBeGreaterThanOrEqual(0);
  });

  it("renders in-domain walls at their true x with no label text (unchanged line geometry)", () => {
    const { container } = render(
      <PayoffChart
        {...baseProps()}
        toggles={WALL_TOGGLES}
        gex={{ callWall: 7600, putWall: 7400, flip: 7486 }}
      />,
    );

    expect(screen.queryByText(/wall/i)).toBeNull();
    expect(screen.queryByText(/γflip/i)).toBeNull();

    const call = container.querySelector('[data-testid="wall-line-call"]');
    const put = container.querySelector('[data-testid="wall-line-put"]');
    expect(Number(call?.getAttribute("x1"))).toBeCloseTo(xScale(7600), 5);
    expect(Number(put?.getAttribute("x1"))).toBeCloseTo(xScale(7400), 5);
  });
});

describe("PayoffChart — GEX wall markers: KISS collision fix (delete labels, fixed-lane edge arrows)", () => {
  afterEach(() => {
    cleanup();
  });

  const WALL_TOGGLES: PayoffChartToggles = { ...TOGGLES, showWalls: true };

  it("EDGE_ARROW_LANE_Y assigns three distinct y lanes to flip/call/put", () => {
    const keys: ReadonlyArray<"flip" | "call" | "put"> = ["flip", "call", "put"];
    const lanes = keys.map((k) => EDGE_ARROW_LANE_Y[k]);
    expect(new Set(lanes).size).toBe(3);
    expect(lanes).toEqual([8, 16, 24]);
  });

  it("fast-check: zero wall/flip label text nodes for arbitrary in-domain levels", () => {
    fc.assert(
      fc.property(
        fc.float({ min: Math.fround(7100), max: Math.fround(8050), noNaN: true }),
        fc.float({ min: Math.fround(7100), max: Math.fround(8050), noNaN: true }),
        fc.float({ min: Math.fround(7100), max: Math.fround(8050), noNaN: true }),
        (put, call, flip) => {
          const { unmount } = render(
            <PayoffChart
              {...baseProps()}
              domain={{ min: 7100, max: 8050 }}
              toggles={WALL_TOGGLES}
              gex={{ callWall: call, putWall: put, flip }}
            />,
          );
          expect(screen.queryByText(/wall/i)).toBeNull();
          expect(screen.queryByText(/γflip/i)).toBeNull();
          unmount();
          return true;
        },
      ),
      { numRuns: 50 },
    );
  });

  it("real-repro 2026-07-10: flip 7488 / putWall 7500 / spot 7544 / callWall 7550 on 7100–8050 — zero wall-label text, lines at true x", () => {
    const domain = { min: 7100, max: 8050 };
    const xScale = buildXScale(INNER_W, domain);
    const { container } = render(
      <PayoffChart
        {...baseProps()}
        domain={domain}
        spot={7544}
        toggles={WALL_TOGGLES}
        gex={{ callWall: 7550, putWall: 7500, flip: 7488 }}
      />,
    );

    expect(screen.queryByText(/wall/i)).toBeNull();
    expect(screen.queryByText(/γflip/i)).toBeNull();

    const put = container.querySelector('[data-testid="wall-line-put"]');
    const call = container.querySelector('[data-testid="wall-line-call"]');
    const flip = container.querySelector('[data-testid="wall-line-flip"]');
    expect(Number(put?.getAttribute("x1"))).toBeCloseTo(xScale(7500), 5);
    expect(Number(call?.getAttribute("x1"))).toBeCloseTo(xScale(7550), 5);
    expect(Number(flip?.getAttribute("x1"))).toBeCloseTo(xScale(7488), 5);
  });

  it("off-domain call wall (8200 > domain.max 8050) renders a single '›' glyph in the call lane (y=16), no label text", () => {
    const domain = { min: 7100, max: 8050 };
    const xScale = buildXScale(INNER_W, domain);
    const { container } = render(
      <PayoffChart
        {...baseProps()}
        domain={domain}
        toggles={WALL_TOGGLES}
        gex={{ callWall: 8200, putWall: 7500, flip: 7488 }}
      />,
    );

    expect(screen.queryByText(/wall/i)).toBeNull();
    const arrow = screen.getByText("›");
    expect(arrow.getAttribute("y")).toBe("16");
    expect(arrow.getAttribute("text-anchor")).toBe("end");
    expect(Number(arrow.getAttribute("x"))).toBeCloseTo(xScale(domain.max) - 3, 5);

    const line = container.querySelector('[data-testid="wall-line-call"]');
    expect(Number(line?.getAttribute("x1"))).toBeCloseTo(xScale(domain.max), 5);
  });

  it("off-domain put wall (6800 < domain.min 7100) renders a single '‹' glyph in the put lane (y=24), no label text", () => {
    const domain = { min: 7100, max: 8050 };
    const xScale = buildXScale(INNER_W, domain);
    render(
      <PayoffChart
        {...baseProps()}
        domain={domain}
        toggles={WALL_TOGGLES}
        gex={{ callWall: 7600, putWall: 6800, flip: 7488 }}
      />,
    );

    expect(screen.queryByText(/wall/i)).toBeNull();
    const arrow = screen.getByText("‹");
    expect(arrow.getAttribute("y")).toBe("24");
    expect(arrow.getAttribute("text-anchor")).toBe("start");
    expect(Number(arrow.getAttribute("x"))).toBeCloseTo(xScale(domain.min) + 3, 5);
  });
});

describe("PayoffChart — crosshair inverts through the domain xScale (D-01, Phase 30)", () => {
  afterEach(() => {
    cleanup();
  });

  // jsdom doesn't lay out SVG, so stub getBoundingClientRect/clientLeft/clientTop the way a
  // real browser would post-layout (same technique as LifecycleChart.test.tsx's svgOf/firePointerMove).
  function svgOf(container: HTMLElement): SVGSVGElement {
    const svg = container.querySelector("svg");
    expect(svg).not.toBeNull();
    if (svg === null) throw new Error("unreachable");
    const rect: DOMRect = {
      x: 0,
      y: 0,
      width: 1000, // SVG_W — 1:1 logical/rendered pixel mapping
      height: 470,
      top: 0,
      left: 0,
      right: 1000,
      bottom: 470,
      toJSON: () => "",
    };
    vi.spyOn(svg, "getBoundingClientRect").mockReturnValue(rect);
    Object.defineProperty(svg, "clientLeft", { value: 0, configurable: true });
    Object.defineProperty(svg, "clientTop", { value: 0, configurable: true });
    return svg;
  }

  function firePointerMove(svg: SVGSVGElement, clientX: number, clientY: number): void {
    fireEvent(svg, new MouseEvent("pointermove", { clientX, clientY, bubbles: true }));
  }

  it("reports a hover at the right plot edge as ≈ domain.max, not the old hardcoded 7900", () => {
    const narrowDomain = { min: 7100, max: 7600 };
    const { container } = render(<PayoffChart {...baseProps()} domain={narrowDomain} />);
    const svg = svgOf(container);

    // PAD.left=56, INNER_W=930 (SVG_W 1000 - PAD.left 56 - PAD.right 14) — clientX at the
    // right plot edge is PAD.left + INNER_W.
    firePointerMove(svg, 56 + INNER_W, 100);

    const tooltip = screen.getByTestId("payoff-tooltip");
    const spans = tooltip.querySelectorAll("span");
    expect(spans[0]?.textContent).toBe("SPX");
    expect(Number(spans[1]?.textContent)).toBe(narrowDomain.max);
  });
});
