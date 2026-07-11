import { useState } from "react";
import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import * as fc from "fast-check";

import { mockResponsiveContainer } from "../test/recharts-test-utils.tsx";

mockResponsiveContainer();

import {
  PayoffChart,
  PayoffTooltipContent,
  computeYDomain,
  buildXTicks,
  buildXScale,
  INNER_W,
  EDGE_ARROW_LANE_Y,
} from "./PayoffChart.tsx";
import type { PayoffChartToggles, PayoffChartProps } from "./PayoffChart.tsx";
import type { PayoffPoint } from "../../lib/scenario-engine.ts";

/**
 * PayoffChart — Recharts DOM re-expression (33-06). Preserves every locked behavior's
 * intent from the pre-migration visx suite (D-05 dim, D-02 note, D-03 colors, ANLZ-02
 * compare/EM-band, WR-03 lock/fitY, profit zone, BE pills, GEX wall edge-pin, crosshair)
 * against the Recharts DOM shape. Element-level EM-band/BE-bar/edge-arrow assertions live
 * in PayoffChartMarks.test.tsx (33-02) — this file keeps only assembled-chart concerns:
 * z-order placement and wall-line structural clip.
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

/**
 * Y-axis grid-tick labels — hand-rendered (not native Recharts axis tick chrome, see
 * PayoffChartGrid in PayoffChart.tsx: native tick label text renders through a zIndex
 * portal not populated synchronously under jsdom, and auto-expands the margin beyond
 * PAD). text-anchor="end" is unique to these labels among the chart's rendered text.
 */
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

  it("renders no compare-curve element when compareCurve is null or omitted (Overview regression guard)", () => {
    render(<PayoffChart {...baseProps()} compareCurve={null} />);
    expect(screen.queryByTestId("compare-curve")).toBeNull();

    cleanup();
    render(<PayoffChart {...baseProps()} />);
    expect(screen.queryByTestId("compare-curve")).toBeNull();
  });

  it("renders exactly one dashed-amber compare-curve element when compareCurve is supplied", () => {
    render(<PayoffChart {...baseProps()} compareCurve={COMPARE_CURVE} />);
    const compare = screen.getByTestId("compare-curve");
    expect(compare.getAttribute("stroke")).toBe("#f0b429");
    expect(compare.getAttribute("stroke-dasharray")).not.toBeNull();
    expect(screen.getAllByTestId("compare-curve").length).toBe(1);
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

describe("PayoffChart — expectedMoveBand (ANLZ-02) — marks-layer wiring, z-order only", () => {
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

  it("renders the em-band group when expectedMoveBand is supplied", () => {
    render(<PayoffChart {...baseProps()} expectedMoveBand={EM_BAND} />);
    expect(screen.queryByTestId("em-band")).not.toBeNull();
  });

  it("places the em-band group before the T+0/@exp curve layers in DOM source order (A1: marks paint under curves, never occlude one)", () => {
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

describe("PayoffChart — 9-layer z-order (A1, proven empirically in 33-01: zIndex bands + JSX tiebreak)", () => {
  afterEach(() => {
    cleanup();
  });

  it("profit-zone fill precedes the T+0 curve line in DOM order (Area zIndex 100 < Line zIndex 400)", () => {
    render(
      <PayoffChart
        {...baseProps()}
        toggles={{ ...TOGGLES, showProfitZone: true }}
      />,
    );
    const zone = screen.getByTestId("profit-zone");
    const t0 = screen.getByTestId("net-book-t0-curve");
    expect(zone.compareDocumentPosition(t0) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it("wall lines precede the T+0 curve line in DOM order (same zIndex band 400 — JSX order is the tiebreak)", () => {
    render(
      <PayoffChart
        {...baseProps()}
        toggles={{ ...TOGGLES, showWalls: true }}
        gex={{ callWall: 7600, putWall: 7400, flip: 7486 }}
      />,
    );
    const wall = screen.getByTestId("wall-line-call");
    const t0 = screen.getByTestId("net-book-t0-curve");
    expect(wall.compareDocumentPosition(t0) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it("the spot line renders after the T+0 curve line in DOM order (locked stack: T+0 line -> spot)", () => {
    render(<PayoffChart {...baseProps()} />);
    const t0 = screen.getByTestId("net-book-t0-curve");
    const spotLine = screen.getByTestId("spot-line");
    expect(t0.compareDocumentPosition(spotLine) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  // CR-01: the pre-migration component painted BE-marker bars and edge-arrow glyphs ON TOP
  // of the profit-zone fill, both T+0 fills, the fan/tent/roll/compare curves, and the GEX
  // wall lines -- only ever under the final T+0 stroke. The Customized/PayoffChartMarks
  // wiring above (which paints under EVERY zIndex band by construction) inverted that
  // relationship for these two marks. These three tests assert the old on-top relationship
  // holds against the same fixtures the "precedes" tests above use.
  const MARK_PARITY_TOGGLES: PayoffChartToggles = {
    ...TOGGLES,
    showProfitZone: true,
    showExpiration: true,
    showWalls: true,
  };

  it("be-marker-t0 renders on top of (after, in DOM order) the profit-zone fill, wall lines, and the expiration tent curve", () => {
    render(
      <PayoffChart
        {...baseProps()}
        toggles={MARK_PARITY_TOGGLES}
        gex={{ callWall: 7600, putWall: 7400, flip: 7486 }}
      />,
    );
    const marker = screen.getByTestId("be-marker-t0");
    const zone = screen.getByTestId("profit-zone");
    const wall = screen.getByTestId("wall-line-call");
    const tent = screen.getByTestId("net-book-exp-curve");
    expect(zone.compareDocumentPosition(marker) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(wall.compareDocumentPosition(marker) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(tent.compareDocumentPosition(marker) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it("be-marker-exp renders on top of (after, in DOM order) the profit-zone fill, wall lines, and the expiration tent curve", () => {
    render(
      <PayoffChart
        {...baseProps()}
        toggles={MARK_PARITY_TOGGLES}
        gex={{ callWall: 7600, putWall: 7400, flip: 7486 }}
      />,
    );
    const marker = screen.getByTestId("be-marker-exp");
    const zone = screen.getByTestId("profit-zone");
    const wall = screen.getByTestId("wall-line-call");
    const tent = screen.getByTestId("net-book-exp-curve");
    expect(zone.compareDocumentPosition(marker) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(wall.compareDocumentPosition(marker) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(tent.compareDocumentPosition(marker) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it("the off-domain edge-arrow glyph renders on top of (after, in DOM order) the profit-zone fill, wall lines, and the expiration tent curve", () => {
    render(
      <PayoffChart
        {...baseProps()}
        toggles={MARK_PARITY_TOGGLES}
        gex={{ callWall: 7600, putWall: 6500, flip: 7486 }}
      />,
    );
    const arrow = screen.getByText("‹");
    const zone = screen.getByTestId("profit-zone");
    const wall = screen.getByTestId("wall-line-call");
    const tent = screen.getByTestId("net-book-exp-curve");
    expect(zone.compareDocumentPosition(arrow) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(wall.compareDocumentPosition(arrow) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(tent.compareDocumentPosition(arrow) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });
});

describe("computeYDomain — combined-curve y-axis (OVW-04)", () => {
  it("returns the fallback domain when both curves are empty", () => {
    expect(computeYDomain([], [])).toEqual({ lo: -500, hi: 500 });
  });

  it("scans the today curve so a tall today curve is not dropped in favor of a small @exp tent", () => {
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

    expect(lo).toBeLessThanOrEqual(-20_000);
    expect(hi).toBeGreaterThanOrEqual(20_000);

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

describe("buildXScale — pure 0-based linear scale (unchanged contract, PayoffChartMarks depends on it)", () => {
  it("maps the domain endpoints to [0, innerWidth]", () => {
    const xScale = buildXScale(INNER_W, DOMAIN);
    expect(xScale(DOMAIN.min)).toBeCloseTo(0, 6);
    expect(xScale(DOMAIN.max)).toBeCloseTo(INNER_W, 6);
  });
});

describe("PayoffChart — WR-03 y-domain lock + fitY without render-phase side effects", () => {
  afterEach(() => {
    cleanup();
  });

  it("locks the y-domain on mount and does NOT rescale when curves change but positionSetSignature is unchanged", () => {
    const { container, rerender } = render(<PayoffChart {...baseProps()} />);
    const initialLabels = getGridLabels(container);

    rerender(
      <PayoffChart
        {...baseProps()}
        expirationCurve={HUGE_EXP_CURVE}
        baseExpirationCurve={HUGE_EXP_CURVE}
      />,
    );

    expect(getGridLabels(container)).toEqual(initialLabels);
  });

  it("recomputes the y-domain when positionSetSignature changes (lock-on-signature still works)", () => {
    const { container, rerender } = render(<PayoffChart {...baseProps()} />);
    const initialLabels = getGridLabels(container);

    rerender(
      <PayoffChart
        {...baseProps()}
        expirationCurve={HUGE_EXP_CURVE}
        baseExpirationCurve={HUGE_EXP_CURVE}
        positionSetSignature="sig-2"
      />,
    );

    expect(getGridLabels(container)).not.toEqual(initialLabels);
  });

  it("fitY forces a refit even when positionSetSignature is unchanged, and calls onFitYConsumed exactly once", () => {
    const onFitYConsumed = vi.fn();
    const { container, rerender } = render(
      <PayoffChart {...baseProps()} onFitYConsumed={onFitYConsumed} />,
    );
    const initialLabels = getGridLabels(container);

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
    expect(getGridLabels(container)).not.toEqual(initialLabels);
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

  it("passing todayCurveColor/expirationCurveColor sets those strokes on the respective curves", () => {
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

describe("PayoffChart — breakeven pills (TOS-style, plain HTML overlay — D-09, unchanged)", () => {
  afterEach(cleanup);

  it("renders BE pills above the chart with the today and @exp breakeven strikes", () => {
    const { container } = render(<PayoffChart {...baseProps()} />);
    expect(container.querySelector('[data-testid="be-pills"]')).not.toBeNull();
    const t0 = [...container.querySelectorAll('[data-testid="be-pill-t0"]')].map((e) => e.textContent);
    const exp = [...container.querySelectorAll('[data-testid="be-pill-exp"]')].map((e) => e.textContent);
    expect(t0).toContain("7400"); // TODAY_CURVE crosses zero at 7400
    expect(exp).toContain("7400"); // EXP_CURVE crosses zero at 7400
  });

  it("hides @exp BE pills when showExpiration is off", () => {
    const { container } = render(
      <PayoffChart {...baseProps()} toggles={{ ...TOGGLES, showExpiration: false }} />,
    );
    expect(container.querySelectorAll('[data-testid="be-pill-exp"]').length).toBe(0);
    // today BEs still shown
    expect(container.querySelectorAll('[data-testid="be-pill-t0"]').length).toBeGreaterThan(0);
  });
});

describe("PayoffChart — profit zone toggle", () => {
  afterEach(cleanup);

  it("renders the profit-zone element when showProfitZone is on", () => {
    render(<PayoffChart {...baseProps()} toggles={{ ...TOGGLES, showProfitZone: true }} />);
    expect(screen.queryByTestId("profit-zone")).not.toBeNull();
  });

  it("removes the profit-zone element when showProfitZone is off", () => {
    render(<PayoffChart {...baseProps()} toggles={{ ...TOGGLES, showProfitZone: false }} />);
    expect(screen.queryByTestId("profit-zone")).toBeNull();
  });
});

describe("PayoffChart — GEX wall structural clip (allowDataOverflow + auto clipPath replaces the hand pinMarker clamp)", () => {
  afterEach(() => {
    cleanup();
  });

  const WALL_TOGGLES: PayoffChartToggles = { ...TOGGLES, showWalls: true };

  it("in-domain walls render with the correct stroke color and no label text", () => {
    render(
      <PayoffChart
        {...baseProps()}
        toggles={WALL_TOGGLES}
        gex={{ callWall: 7600, putWall: 7400, flip: 7486 }}
      />,
    );

    expect(screen.queryByText(/wall/i)).toBeNull();
    expect(screen.getByTestId("wall-line-call").getAttribute("stroke")).toBe("#26a69a");
    expect(screen.getByTestId("wall-line-put").getAttribute("stroke")).toBe("#ef5350");
    expect(screen.getByTestId("wall-line-flip").getAttribute("stroke")).toBe("#f0b429");
  });

  it("an off-domain call wall (8000 > domain.max 7900) renders inside a structurally-clipped ancestor sized to the plot area, not a hand-clamped coordinate", () => {
    render(
      <PayoffChart
        {...baseProps()}
        toggles={WALL_TOGGLES}
        gex={{ callWall: 8000, putWall: 7400, flip: 7486 }}
      />,
    );

    // No in-chart wall-label text (KISS fix carries over).
    expect(screen.queryByText(/wall/i)).toBeNull();

    const line = screen.getByTestId("wall-line-call");
    // Real structural clipping: the element (or its closest clipped ancestor) carries a
    // clip-path resolving to a <clipPath><rect> in <defs> sized to the plot area
    // (SVG dims minus PAD margins) — this FAILS under the old hand-clamp approach, which
    // produced an unclipped coordinate with no clip-path at all.
    const clipped = line.closest("[clip-path]");
    expect(clipped).not.toBeNull();
    if (clipped === null) throw new Error("unreachable");
    const clipPathAttr = clipped.getAttribute("clip-path");
    expect(clipPathAttr).not.toBeNull();
    if (clipPathAttr === null) throw new Error("unreachable");
    const idMatch = /url\(#([^)]+)\)/.exec(clipPathAttr);
    expect(idMatch).not.toBeNull();
    if (idMatch === null) throw new Error("unreachable");
    const clipId = idMatch[1];
    expect(clipId).toBeDefined();
    if (clipId === undefined) throw new Error("unreachable");

    const svg = line.closest("svg");
    expect(svg).not.toBeNull();
    if (svg === null) throw new Error("unreachable");
    const clipPathEl = Array.from(svg.querySelectorAll("defs clipPath")).find(
      (el) => el.getAttribute("id") === clipId,
    );
    expect(clipPathEl).not.toBeUndefined();
    if (clipPathEl === undefined) throw new Error("unreachable");
    const clipRect = clipPathEl.querySelector("rect");
    expect(clipRect).not.toBeNull();
    if (clipRect === null) throw new Error("unreachable");

    // Plot area = SVG dims minus PAD margins (PAD.left=56/right=14/top=14/bottom=24,
    // SVG_W=1000/SVG_H=470 -> width=930, height=432).
    expect(Number(clipRect.getAttribute("width"))).toBeCloseTo(930, 5);
    expect(Number(clipRect.getAttribute("height"))).toBeCloseTo(432, 5);
  });

  it("fast-check: zero wall-label text nodes for arbitrary in-domain/out-of-domain levels", () => {
    fc.assert(
      fc.property(
        fc.float({ min: Math.fround(6800), max: Math.fround(8050), noNaN: true }),
        fc.float({ min: Math.fround(6800), max: Math.fround(8050), noNaN: true }),
        fc.float({ min: Math.fround(6800), max: Math.fround(8050), noNaN: true }),
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
          unmount();
          return true;
        },
      ),
      { numRuns: 50 },
    );
  });
});

describe("PayoffChart — native Tooltip crosshair content (D-10, D-12: typed content component, no manual localPoint block)", () => {
  afterEach(() => {
    cleanup();
  });

  it("PayoffTooltipContent reports the hovered spot from the payload label, not a hardcoded value", () => {
    render(
      <PayoffTooltipContent
        active
        payload={[{ graphicalItemId: "today", name: "today", value: 123.4 }]}
        label={7550}
        coordinate={undefined}
        accessibilityLayer={false}
        activeIndex={null}
        gex={null}
      />,
    );
    expect(screen.getByText("SPX")).toBeTruthy();
    expect(screen.getByText("7550")).toBeTruthy();
  });

  it("PayoffTooltipContent formats P&L from the payload value (teal for positive, coral for negative)", () => {
    const { unmount } = render(
      <PayoffTooltipContent
        active
        payload={[{ graphicalItemId: "today", name: "today", value: 1234 }]}
        label={7500}
        coordinate={undefined}
        accessibilityLayer={false}
        activeIndex={null}
        gex={null}
      />,
    );
    expect(screen.getByText("+$1.2k")).toBeTruthy();
    unmount();

    render(
      <PayoffTooltipContent
        active
        payload={[{ graphicalItemId: "today", name: "today", value: -500 }]}
        label={7300}
        coordinate={undefined}
        accessibilityLayer={false}
        activeIndex={null}
        gex={null}
      />,
    );
    expect(screen.getByText("−$500")).toBeTruthy();
  });

  it("PayoffTooltipContent renders nothing when inactive or payload is empty", () => {
    const { container: c1 } = render(
      <PayoffTooltipContent
        active={false}
        payload={[{ graphicalItemId: "today", name: "today", value: 1 }]}
        label={7500}
        coordinate={undefined}
        accessibilityLayer={false}
        activeIndex={null}
        gex={null}
      />,
    );
    expect(c1.firstChild).toBeNull();

    cleanup();
    const { container: c2 } = render(
      <PayoffTooltipContent
        active
        payload={[]}
        label={7500}
        coordinate={undefined}
        accessibilityLayer={false}
        activeIndex={null}
        gex={null}
      />,
    );
    expect(c2.firstChild).toBeNull();
  });
});
