import { useState } from "react";
import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";

import { PayoffChart, computeYDomain, buildXTicks, buildXScale, INNER_W } from "./PayoffChart.tsx";
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

function baseProps(): PayoffChartProps {
  return {
    todayCurve: TODAY_CURVE,
    fanCurves: [],
    expirationCurve: EXP_CURVE,
    rollCurve: null,
    gex: null,
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

    const xScale = buildXScale(INNER_W);
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
