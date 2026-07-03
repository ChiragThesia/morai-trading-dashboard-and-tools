import { describe, it, expect, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";

import { PayoffChart } from "./PayoffChart.tsx";
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
