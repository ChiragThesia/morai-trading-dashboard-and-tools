import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";

import { LifecycleChart } from "./LifecycleChart.tsx";
import type { LifecycleResponse } from "@morai/contracts";

/**
 * LifecycleChart — D-08 stacked-panel engine (JRNL-01, phase 22 plan 05).
 *
 * Mirrors PayoffChart.test.tsx's render/assert conventions (@testing-library/react,
 * visx renders plain SVG under jsdom, no mock needed).
 *
 * Series layout used by these fixtures:
 *   idx 0,1 — normal
 *   idx 2   — true feed gap (isGap=true) — every panel must break here (D-05)
 *   idx 3   — normal
 *   idx 4   — forwardVolGuard "inverted" (forwardVol null) but isGap=false — ONLY the
 *             vol panel's forward-vol line should break here (D-02, independent of D-05)
 *   idx 5   — normal
 */

type Snapshot = LifecycleResponse["snapshots"][number];

function snap(overrides: Partial<Snapshot> & { time: string }): Snapshot {
  return {
    calendarId: "11111111-1111-1111-1111-111111111111",
    spot: "7450",
    netMark: "10",
    frontMark: "5",
    backMark: "6",
    frontIv: "14.5",
    backIv: "14.9",
    frontIvRaw: "14.5",
    backIvRaw: "14.9",
    netDelta: "-1.1",
    netGamma: "-0.02",
    netTheta: "30",
    netVega: "250",
    termSlope: "1.02",
    dteFront: 20,
    dteBack: 44,
    pnlOpen: "0",
    source: "cboe",
    isGap: false,
    forwardVol: 15.2,
    forwardVolGuard: "ok",
    cumTheta: 0,
    cumVega: 0,
    cumDeltaGamma: 0,
    cumResidual: 0,
    ...overrides,
  };
}

// LifecycleChartProps.snapshots is LifecycleResponse["snapshots"], a mutable array (the
// zod z.array() inference) — declared as a plain array here, not ReadonlyArray, so it
// assigns without a variance error.
const SERIES: Snapshot[] = [
  snap({
    time: "2026-06-22T14:00:00.000Z",
    spot: "7450",
    frontIv: "15.0",
    backIv: "15.4",
    forwardVol: 15.6,
    cumTheta: 0,
    cumVega: 0,
    cumDeltaGamma: 0,
    cumResidual: 0,
    netDelta: "-1.0",
    netGamma: "-0.020",
    netTheta: "30",
    netVega: "240",
  }),
  snap({
    time: "2026-06-23T14:00:00.000Z",
    spot: "7460",
    frontIv: "14.8",
    backIv: "15.2",
    forwardVol: 15.5,
    cumTheta: 20,
    cumVega: -5,
    cumDeltaGamma: 2,
    cumResidual: 1,
    netDelta: "-1.05",
    netGamma: "-0.021",
    netTheta: "31",
    netVega: "245",
  }),
  snap({
    time: "2026-06-24T14:00:00.000Z",
    spot: "0",
    frontIv: "NaN",
    backIv: "NaN",
    isGap: true,
    forwardVol: null,
    forwardVolGuard: "inverted",
    cumTheta: null,
    cumVega: null,
    cumDeltaGamma: null,
    cumResidual: null,
    netDelta: "NaN",
    netGamma: "NaN",
    netTheta: "NaN",
    netVega: "NaN",
  }),
  snap({
    time: "2026-06-25T14:00:00.000Z",
    spot: "7470",
    frontIv: "14.2",
    backIv: "15.0",
    forwardVol: 15.4,
    cumTheta: 60,
    cumVega: -15,
    cumDeltaGamma: -10,
    cumResidual: 2,
    netDelta: "-1.1",
    netGamma: "-0.022",
    netTheta: "33",
    netVega: "250",
  }),
  snap({
    time: "2026-06-25T14:30:00.000Z",
    spot: "7472",
    frontIv: "14.1",
    backIv: "14.95",
    forwardVol: null,
    forwardVolGuard: "inverted",
    cumTheta: 68,
    cumVega: -16,
    cumDeltaGamma: -12,
    cumResidual: 2,
    netDelta: "-1.12",
    netGamma: "-0.0225",
    netTheta: "33.5",
    netVega: "252",
  }),
  snap({
    time: "2026-06-26T14:00:00.000Z",
    spot: "7480",
    frontIv: "14.0",
    backIv: "14.9",
    forwardVol: 15.8,
    cumTheta: 90,
    cumVega: -20,
    cumDeltaGamma: -35,
    cumResidual: 3,
    netDelta: "-1.15",
    netGamma: "-0.023",
    netTheta: "34",
    netVega: "255",
  }),
];

/** Count SVG path "moveto" commands — one per contiguous, gap-broken run (D-05). */
function countMoves(path: Element | null): number {
  const d = path?.getAttribute("d") ?? "";
  return (d.match(/M/g) ?? []).length;
}

describe("LifecycleChart — D-08 stacked-panel engine (Task 1)", () => {
  afterEach(() => {
    cleanup();
  });

  it("renders all five stacked regions sharing one time axis", () => {
    render(<LifecycleChart snapshots={SERIES} />);
    expect(screen.getByTestId("hero-net-line")).toBeTruthy();
    expect(screen.getByTestId("vol-line-front")).toBeTruthy();
    expect(screen.getByTestId("vol-line-back")).toBeTruthy();
    expect(screen.getByTestId("vol-line-forward")).toBeTruthy();
    expect(screen.getByTestId("greek-line-delta")).toBeTruthy();
    expect(screen.getByTestId("greek-line-gamma")).toBeTruthy();
    expect(screen.getByTestId("greek-line-theta")).toBeTruthy();
    expect(screen.getByTestId("greek-line-vega")).toBeTruthy();
    expect(screen.getByTestId("price-line-spot")).toBeTruthy();
  });

  it("uses viewBox 0 0 840 700 with preserveAspectRatio xMinYMin meet (never 'none' for a multi-panel stack)", () => {
    const { container } = render(<LifecycleChart snapshots={SERIES} />);
    const svg = container.querySelector("svg");
    expect(svg?.getAttribute("viewBox")).toBe("0 0 840 700");
    expect(svg?.getAttribute("preserveAspectRatio")).toBe("xMinYMin meet");
  });

  it("always renders all 4 hero legend entries (theta/vega/delta-gamma/residual), never guarding residual on magnitude", () => {
    render(<LifecycleChart snapshots={SERIES} />);
    expect(screen.getByTestId("hero-legend-theta")).toBeTruthy();
    expect(screen.getByTestId("hero-legend-vega")).toBeTruthy();
    expect(screen.getByTestId("hero-legend-deltaGamma")).toBeTruthy();
    expect(screen.getByTestId("hero-legend-residual")).toBeTruthy();
    // Even with every residual value pinned at 0, the band + legend must still render.
    const zeroResidSeries = SERIES.map((s) => ({ ...s, cumResidual: s.isGap ? null : 0 }));
    cleanup();
    render(<LifecycleChart snapshots={zeroResidSeries} />);
    expect(screen.getByTestId("hero-legend-residual")).toBeTruthy();
    expect(screen.getByTestId("hero-band-residual")).toBeTruthy();
  });

  it("renders the hero stacked bands and net line with the locked UI-SPEC colors", () => {
    render(<LifecycleChart snapshots={SERIES} />);
    expect(screen.getByTestId("hero-band-theta").getAttribute("fill")).toBe("#26a69a");
    expect(screen.getByTestId("hero-band-vega").getAttribute("fill")).toBe("#5b9cf6");
    expect(screen.getByTestId("hero-band-deltaGamma").getAttribute("fill")).toBe("#a78bfa");
    expect(screen.getByTestId("hero-band-residual").getAttribute("fill")).toBe("#3a4453");
    const net = screen.getByTestId("hero-net-line");
    expect(net.getAttribute("stroke")).toBe("#d6dbe4");
    expect(net.getAttribute("stroke-width")).toBe("2.4");
  });

  it("renders forward vol / front IV / back IV as three distinct LinePaths — never a blended/averaged line", () => {
    render(<LifecycleChart snapshots={SERIES} />);
    const front = screen.getByTestId("vol-line-front");
    const back = screen.getByTestId("vol-line-back");
    const fwd = screen.getByTestId("vol-line-forward");
    expect(front.getAttribute("stroke")).toBe("#d6dbe4");
    expect(back.getAttribute("stroke")).toBe("#7b8696");
    expect(back.getAttribute("stroke-dasharray")).not.toBeNull();
    expect(fwd.getAttribute("stroke")).toBe("#f0b429");
    expect(fwd.getAttribute("stroke-width")).toBe("2.6");
  });

  it("breaks every panel's line at the true feed gap (idx 2), never interpolating across it", () => {
    render(<LifecycleChart snapshots={SERIES} />);
    // idx 0,1 | gap at 2 | idx 3,4,5 -> exactly one break -> 2 moveto commands.
    expect(countMoves(screen.getByTestId("hero-net-line"))).toBe(2);
    expect(countMoves(screen.getByTestId("vol-line-front"))).toBe(2);
    expect(countMoves(screen.getByTestId("vol-line-back"))).toBe(2);
    expect(countMoves(screen.getByTestId("greek-line-delta"))).toBe(2);
    expect(countMoves(screen.getByTestId("greek-line-gamma"))).toBe(2);
    expect(countMoves(screen.getByTestId("greek-line-theta"))).toBe(2);
    expect(countMoves(screen.getByTestId("greek-line-vega"))).toBe(2);
    expect(countMoves(screen.getByTestId("price-line-spot"))).toBe(2);
  });

  it("breaks the forward-vol line independently at an inverted-guard point (idx 4) that is NOT a feed gap", () => {
    render(<LifecycleChart snapshots={SERIES} />);
    // Forward vol excludes idx 2 (gap) AND idx 4 (inverted) -> three runs -> 3 movetos,
    // while front/back (unaffected by the guard) only break at idx 2 -> 2 movetos.
    expect(countMoves(screen.getByTestId("vol-line-forward"))).toBe(3);
    expect(countMoves(screen.getByTestId("vol-line-front"))).toBe(2);
  });

  it("renders each greek small-multiple with a zero baseline and the UI-SPEC per-greek color", () => {
    render(<LifecycleChart snapshots={SERIES} />);
    expect(screen.getByTestId("greek-zero-delta")).toBeTruthy();
    expect(screen.getByTestId("greek-zero-gamma")).toBeTruthy();
    expect(screen.getByTestId("greek-zero-theta")).toBeTruthy();
    expect(screen.getByTestId("greek-zero-vega")).toBeTruthy();
    expect(screen.getByTestId("greek-line-delta").getAttribute("stroke")).toBe("#a78bfa");
    expect(screen.getByTestId("greek-line-gamma").getAttribute("stroke")).toBe("#ef5350");
    expect(screen.getByTestId("greek-line-theta").getAttribute("stroke")).toBe("#26a69a");
    expect(screen.getByTestId("greek-line-vega").getAttribute("stroke")).toBe("#5b9cf6");
  });

  it("renders the price line but no strike reference when strike is omitted", () => {
    render(<LifecycleChart snapshots={SERIES} />);
    expect(screen.getByTestId("price-line-spot")).toBeTruthy();
    expect(screen.queryByTestId("price-line-strike")).toBeNull();
  });

  it("renders a dashed violet strike reference line when strike is supplied", () => {
    render(<LifecycleChart snapshots={SERIES} strike={7425} />);
    const strikeLine = screen.getByTestId("price-line-strike");
    expect(strikeLine.getAttribute("stroke")).toBe("#a78bfa");
    expect(strikeLine.getAttribute("stroke-dasharray")).not.toBeNull();
  });
});

describe("LifecycleChart — shared crosshair + tooltip (Task 2)", () => {
  afterEach(() => {
    cleanup();
  });

  function svgOf(container: HTMLElement): SVGSVGElement {
    const svg = container.querySelector("svg");
    expect(svg).not.toBeNull();
    if (svg === null) throw new Error("unreachable");
    const rect: DOMRect = {
      x: 0,
      y: 0,
      width: 840,
      height: 700,
      top: 0,
      left: 0,
      right: 840,
      bottom: 700,
      toJSON: () => "",
    };
    vi.spyOn(svg, "getBoundingClientRect").mockReturnValue(rect);
    // jsdom doesn't implement clientLeft/clientTop on SVGElement (they're 0 in any real
    // browser after layout) — @visx/event's localPoint fallback path subtracts them, so an
    // undefined value here would NaN the mapping. Stub them the way a real layout would.
    Object.defineProperty(svg, "clientLeft", { value: 0, configurable: true });
    Object.defineProperty(svg, "clientTop", { value: 0, configurable: true });
    return svg;
  }

  // jsdom (this environment) does not implement a `PointerEvent` constructor at all
  // (`window.PointerEvent` is undefined), so `fireEvent.pointerMove`'s event-map lookup
  // silently falls back to a bare `Event` with no clientX/clientY — @visx/event's
  // localPoint then computes NaN. Firing a `MouseEvent` typed as "pointermove"/
  // "pointerleave" carries clientX/clientY correctly and still reaches the component's
  // onPointerMove/onPointerLeave handlers (React's synthetic-event system dispatches by
  // the native event's `.type` string, not its constructor).
  function firePointerMove(svg: SVGSVGElement, clientX: number, clientY: number): void {
    fireEvent(svg, new MouseEvent("pointermove", { clientX, clientY, bubbles: true }));
  }
  function firePointerLeave(svg: SVGSVGElement): void {
    // React synthesizes onPointerLeave from the bubbling native "pointerout" event (plus
    // a relatedTarget check), not from a native "pointerleave" listener — mirrors how
    // onMouseLeave is derived from "mouseout".
    fireEvent(svg, new MouseEvent("pointerout", { bubbles: true, relatedTarget: null }));
  }

  it("reports the hovered index via onCrosshairChange on move and null on leave", () => {
    const onCrosshairChange = vi.fn();
    const { container } = render(
      <LifecycleChart snapshots={SERIES} onCrosshairChange={onCrosshairChange} />,
    );
    const svg = svgOf(container);

    // x=54 is the chart's left edge (index 0); clientX maps 1:1 given width=840=SVG_W.
    firePointerMove(svg, 54, 100);
    expect(onCrosshairChange).toHaveBeenCalledWith(0);

    firePointerLeave(svg);
    expect(onCrosshairChange).toHaveBeenLastCalledWith(null);
  });

  it("shows the locked tooltip row order on a non-gap hover", () => {
    const { container } = render(<LifecycleChart snapshots={SERIES} />);
    const svg = svgOf(container);

    firePointerMove(svg, 54, 100);

    const tooltip = screen.getByTestId("lifecycle-tooltip");
    const rows = [
      "tooltip-row-header",
      "tooltip-row-net",
      "tooltip-row-theta",
      "tooltip-row-vega",
      "tooltip-row-deltaGamma",
      "tooltip-row-forwardVol",
      "tooltip-row-spot",
    ];
    const order = rows.map((testId) => {
      const el = tooltip.querySelector(`[data-testid="${testId}"]`);
      expect(el).not.toBeNull();
      return el;
    });
    for (let i = 1; i < order.length; i++) {
      const prev = order[i - 1];
      const curr = order[i];
      expect(prev).toBeDefined();
      expect(curr).toBeDefined();
      if (prev !== undefined && curr !== null && prev !== null && curr !== undefined) {
        expect(prev.compareDocumentPosition(curr) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
      }
    }
  });

  it("shows ONLY 'feed lapsed — no data' on a gap-index hover, suppressing every other row", () => {
    const { container } = render(<LifecycleChart snapshots={SERIES} />);
    const svg = svgOf(container);

    // Index 2 is the true gap; x-scale places index 2 at CHART_X0 + 2/5 * (CHART_X1-CHART_X0).
    const x0 = 54;
    const x1 = 840 - 56;
    const gapX = x0 + (2 / (SERIES.length - 1)) * (x1 - x0);
    firePointerMove(svg, gapX, 100);

    const tooltip = screen.getByTestId("lifecycle-tooltip");
    expect(tooltip.textContent).toContain("feed lapsed — no data");
    expect(tooltip.querySelector('[data-testid="tooltip-row-net"]')).toBeNull();
    expect(tooltip.querySelector('[data-testid="tooltip-row-theta"]')).toBeNull();
    expect(tooltip.querySelector('[data-testid="tooltip-row-forwardVol"]')).toBeNull();
  });

  it("does not render a tooltip before any hover", () => {
    render(<LifecycleChart snapshots={SERIES} />);
    expect(screen.queryByTestId("lifecycle-tooltip")).toBeNull();
  });
});
