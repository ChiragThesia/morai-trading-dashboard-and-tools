import type { ReactElement, ReactNode } from "react";
import { cloneElement, isValidElement } from "react";
import { describe, it, expect, afterEach, vi } from "vitest";
import { render, cleanup } from "@testing-library/react";

/**
 * Live-UAT regression (2026-07-10, catch #20): in the real browser
 * ResponsiveContainer resizes the chart (e.g. 1160x545) while the hand-rendered
 * grid labels, BE-marker bars, EM band, and edge arrows were positioned by
 * buildXScale/buildYScale closures over the fixed SVG_W/SVG_H constants — two
 * coordinate systems on one chart. Every other test file coincidentally renders
 * at exactly SVG_W x SVG_H (the jsdom mock strips ResponsiveContainer), where the
 * two systems agree, so the whole suite stayed green while every scale-driven
 * mark sat visibly off the recharts-rendered curves on morai.wtf.
 *
 * This mock reproduces the browser mechanism: clone the chart child at
 * NON-default dims (580x273), exactly like ResponsiveContainer overriding the
 * explicit width/height. The invariant: a native recharts element (spot
 * ReferenceLine) and a hand-rendered mark (grid tick label) for the SAME domain
 * value must land on the same x pixel — at ANY chart size.
 */
const RESIZED = { width: 580, height: 273 };

function isChartElement(node: ReactNode): node is ReactElement<{ width?: number; height?: number }> {
  return isValidElement(node);
}

vi.mock("recharts", async (importOriginal) => {
  const actual = await importOriginal<typeof import("recharts")>();
  return {
    ...actual,
    ResponsiveContainer: ({ children }: { children: ReactNode }): ReactNode => {
      if (isChartElement(children)) {
        return cloneElement(children, RESIZED);
      }
      return children;
    },
  };
});

import { PayoffChart } from "./PayoffChart.tsx";
import type { PayoffChartProps, PayoffChartToggles } from "./PayoffChart.tsx";
import type { PayoffPoint } from "../../lib/scenario-engine.ts";

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

// buildXTicks(6900, 7900) => step 200, ticks 7000..7800 — 7400 is both a grid
// tick and the spot below, so the same domain value renders through BOTH
// coordinate systems.
const DOMAIN = { min: 6900, max: 7900 };
const SPOT_AT_TICK = 7400;

function props(): PayoffChartProps {
  return {
    todayCurve: TODAY_CURVE,
    fanCurves: [],
    expirationCurve: EXP_CURVE,
    rollCurve: null,
    gex: null,
    domain: DOMAIN,
    spot: SPOT_AT_TICK,
    toggles: TOGGLES,
    fitY: false,
    onFitYConsumed: () => {},
    positionSetSignature: "sig-resize",
    baseExpirationCurve: EXP_CURVE,
  };
}

describe("PayoffChart — resized-chart coordinate consistency (catch #20)", () => {
  afterEach(() => {
    cleanup();
  });

  it("hand-rendered grid tick label and native spot ReferenceLine agree on x for the same domain value when the chart renders at non-default dims", () => {
    const { container } = render(<PayoffChart {...props()} />);

    const spotLine = container.querySelector('[data-testid="spot-line"]');
    expect(spotLine).not.toBeNull();
    if (spotLine === null) throw new Error("spot-line missing");
    const nativeX = Number(spotLine.getAttribute("x1"));
    expect(Number.isFinite(nativeX)).toBe(true);

    const tickTexts = [...container.querySelectorAll("text")].filter(
      (t) => t.textContent === String(SPOT_AT_TICK),
    );
    expect(tickTexts.length).toBeGreaterThan(0);
    const gridLabel = tickTexts[0];
    if (gridLabel === undefined) throw new Error("grid tick label missing");
    // Grid labels live inside a translate(plotX, plotY) group; their x attr is
    // plot-relative. Resolve to absolute by adding the group's translate.
    const group = gridLabel.closest("g[transform]");
    expect(group).not.toBeNull();
    if (group === null) throw new Error("grid translate group missing");
    const outerGroup = ((): Element => {
      let el: Element = group;
      let candidate: Element | null = group.parentElement;
      while (candidate !== null && candidate.tagName.toLowerCase() === "g") {
        if (candidate.getAttribute("transform") !== null) el = candidate;
        candidate = candidate.parentElement;
      }
      return el;
    })();
    const transform = outerGroup.getAttribute("transform") ?? "";
    const match = /translate\(([-\d.]+)[,\s]+([-\d.]+)\)/.exec(transform);
    const translateX = match === null ? 0 : Number(match[1]);
    const labelAbsoluteX = translateX + Number(gridLabel.getAttribute("x"));

    // The whole bug: at 580px wide these differ by ~200px under constant-space
    // scales. Native recharts x is the single source of truth.
    expect(Math.abs(labelAbsoluteX - nativeX)).toBeLessThan(1);
  });

  it("renders the marks/grid inside the actual plot area at resized dims (no element positioned past the real chart width)", () => {
    const { container } = render(<PayoffChart {...props()} />);
    const texts = [...container.querySelectorAll("text")];
    expect(texts.length).toBeGreaterThan(0);
    for (const t of texts) {
      const g = t.closest("g[transform]");
      const transform = g?.getAttribute("transform") ?? "";
      const match = /translate\(([-\d.]+)[,\s]+([-\d.]+)\)/.exec(transform);
      const tx = match === null ? 0 : Number(match[1]);
      const x = tx + Number(t.getAttribute("x"));
      expect(x).toBeLessThanOrEqual(RESIZED.width);
    }
  });
});
