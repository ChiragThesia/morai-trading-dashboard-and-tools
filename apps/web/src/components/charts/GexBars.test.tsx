import { describe, it, expect, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import { mockResponsiveContainer } from "../test/recharts-test-utils.tsx";

mockResponsiveContainer();

import { GexBars, windowStrikes, fmtBn } from "./GexBars.tsx";
import type { GexWallEntry } from "@morai/contracts";

/**
 * GexBars spec — Recharts DOM (33-05 migration off echarts-for-react).
 *
 * Asserts against the Recharts-rendered SVG: per-bar Cell sign coloring in GEX mode
 * (queried off the actual <path class="recharts-rectangle"> shapes Cell overrides —
 * confirmed empirically that Cell's fill lands directly on the shape, no wrapper <g>
 * indirection, unlike className on ReferenceLine/Area), and the spot/call-wall/put-wall
 * ReferenceLines (className lands on the wrapping <g> here, per 33-03's finding — query
 * via a descendant combinator). Tab-picker + windowStrikes + fmtBn coverage preserved
 * unchanged from the pre-migration spec.
 */

const TEAL = "#26a69a";
const CORAL = "#ef5350";
const BLUE = "#5b9cf6";

const SAMPLE_STRIKES: GexWallEntry[] = [
  { k: 7400, gex: -5_974_395_559, coi: 17071, poi: 52786, vol: 8406 },
  { k: 7500, gex: -281_584_707, coi: 39598, poi: 42591, vol: 5275 },
  { k: 7600, gex: 1_230_277_553, coi: 69015, poi: 39475, vol: 2228 },
];

describe("GexBars", () => {
  afterEach(() => {
    cleanup();
  });

  it("renders the GEX / OI wall / Volume ToggleGroup options in the DOM", () => {
    render(
      <GexBars
        strikes={SAMPLE_STRIKES}
        spot={7381}
        callWall={7600}
        putWall={7400}
      />,
    );

    expect(screen.getByText("GEX")).toBeTruthy();
    expect(screen.getByText("OI wall")).toBeTruthy();
    expect(screen.getByText("Volume")).toBeTruthy();
  });

  it("GEX mode: bars carry per-strike sign coloring via Cell (teal >= 0, coral < 0)", () => {
    const { container } = render(
      <GexBars
        strikes={SAMPLE_STRIKES}
        spot={7381}
        callWall={7600}
        putWall={7400}
      />,
    );

    const bars = container.querySelectorAll("path.recharts-rectangle");
    expect(bars.length).toBe(SAMPLE_STRIKES.length);
    const fills = Array.from(bars).map((b) => b.getAttribute("fill"));
    // SAMPLE_STRIKES gex: -5.97e9 (coral), -2.8e8 (coral), +1.23e9 (teal)
    expect(fills).toEqual([CORAL, CORAL, TEAL]);
  });

  it("renders the spot, call-wall, and put-wall reference lines over the bars", () => {
    const { container } = render(
      <GexBars
        strikes={SAMPLE_STRIKES}
        spot={7381}
        callWall={7600}
        putWall={7400}
      />,
    );

    const spotLine = container.querySelector(".gex-spot-line line");
    const callWallLine = container.querySelector(".gex-call-wall-line line");
    const putWallLine = container.querySelector(".gex-put-wall-line line");

    expect(spotLine).not.toBeNull();
    expect(spotLine?.getAttribute("stroke")).toBe(BLUE);
    expect(callWallLine).not.toBeNull();
    expect(callWallLine?.getAttribute("stroke")).toBe(TEAL);
    expect(putWallLine).not.toBeNull();
    expect(putWallLine?.getAttribute("stroke")).toBe(CORAL);
  });

  it("omits the call-wall / put-wall reference lines when null", () => {
    const { container } = render(
      <GexBars
        strikes={SAMPLE_STRIKES}
        spot={7381}
        callWall={null}
        putWall={null}
      />,
    );

    expect(container.querySelector(".gex-call-wall-line")).toBeNull();
    expect(container.querySelector(".gex-put-wall-line")).toBeNull();
  });

  it("the metric options are reachable as tabs with GEX initially active", () => {
    render(
      <GexBars
        strikes={SAMPLE_STRIKES}
        spot={7381}
        callWall={7600}
        putWall={7400}
      />,
    );

    // All 3 options are now tabs (shadcn Tabs) rather than toggle buttons
    const gexTab = screen.getByRole("tab", { name: "GEX mode" });
    const oiTab = screen.getByRole("tab", { name: "OI wall mode" });
    const volTab = screen.getByRole("tab", { name: "Volume mode" });

    expect(gexTab.getAttribute("aria-disabled")).not.toBe("true");
    expect(oiTab.getAttribute("aria-disabled")).not.toBe("true");
    expect(volTab.getAttribute("aria-disabled")).not.toBe("true");

    // GEX is the initial mode → its tab is the selected/active one (base-ui marks
    // the active tab with aria-selected / data-selected / data-active).
    const gexActive =
      gexTab.getAttribute("aria-selected") === "true" ||
      gexTab.hasAttribute("data-selected") ||
      gexTab.hasAttribute("data-active");
    expect(gexActive).toBe(true);
  });
});

describe("windowStrikes", () => {
  // 7 strikes 100 apart; spot 7381 → ATM is 7400 (index 3).
  const STRIKES: GexWallEntry[] = [7100, 7200, 7300, 7400, 7500, 7600, 7700].map((k) => ({
    k,
    gex: 0,
    coi: 0,
    poi: 0,
    vol: 0,
  }));

  it("returns the full list for 'all'", () => {
    expect(windowStrikes(STRIKES, 7381, "all")).toHaveLength(7);
  });

  it("keeps ATM ± N strikes (N=1 → 3 strikes around the nearest)", () => {
    const out = windowStrikes(STRIKES, 7381, 1);
    expect(out.map((s) => s.k)).toEqual([7300, 7400, 7500]);
  });

  it("clamps at the edges without going out of bounds", () => {
    const out = windowStrikes(STRIKES, 7100, 2); // ATM=7100 (index 0)
    expect(out.map((s) => s.k)).toEqual([7100, 7200, 7300]);
  });
});

// Units regression: domain dollarGamma outputs $Bn units ALREADY (e.g. +4.48 = $4.48Bn).
// fmtBn previously divided by 1e9 again → every axis label collapsed to "0.0B".
describe("fmtBn — values are already $Bn units (no second division)", () => {
  it("formats a domain-scale value directly", () => {
    expect(fmtBn(4.48)).toBe("4.5B");
    expect(fmtBn(-5.97)).toBe("-6.0B");
    expect(fmtBn(0)).toBe("0.0B");
  });
});
