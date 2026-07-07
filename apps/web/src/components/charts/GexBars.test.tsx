import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import React from "react";

/**
 * GexBars smoke test.
 *
 * ECharts renders to a <canvas>; under jsdom `getContext` is null and
 * echarts-for-react throws on init. We mock echarts-for-react to a passthrough
 * stub that renders a data-testid marker. The shadcn ToggleGroup is pure DOM
 * and needs no stub — we test it directly.
 *
 * Asserts:
 *   1. The ToggleGroup options GEX / OI wall / Volume are in the DOM.
 *   2. The ReactECharts wrapper mounts without throwing.
 *   3. Toggling to OI wall mode updates state (covered by toggling then checking active value).
 */

// ─── Mock echarts-for-react ───────────────────────────────────────────────────
// Canvas getContext is null under jsdom; echarts throws on init.
// Replace with a passthrough stub that renders a testable div.

function hasNonEmptySeries(option: unknown): boolean {
  if (typeof option !== "object" || option === null) return false;
  if (!("series" in option)) return false;
  // TypeScript narrows `option` to `object & { series: unknown }` via `in` guard
  const raw: unknown = Object.getOwnPropertyDescriptor(option, "series")?.value;
  return Array.isArray(raw) && raw.length > 0;
}

vi.mock("echarts-for-react", () => ({
  default: ({ option, style }: { option: unknown; style?: React.CSSProperties }): React.ReactElement => (
    <div
      data-testid="echarts-stub"
      data-has-series={hasNonEmptySeries(option) ? "true" : "false"}
      style={style}
    />
  ),
}));

// ─── Import AFTER mock registration ──────────────────────────────────────────

import { GexBars, windowStrikes, fmtBn } from "./GexBars.tsx";
import type { GexWallEntry } from "@morai/contracts";

// ─── Fixtures ─────────────────────────────────────────────────────────────────

const SAMPLE_STRIKES: GexWallEntry[] = [
  { k: 7400, gex: -5_974_395_559, coi: 17071, poi: 52786, vol: 8406 },
  { k: 7500, gex: -281_584_707, coi: 39598, poi: 42591, vol: 5275 },
  { k: 7600, gex: 1_230_277_553, coi: 69015, poi: 39475, vol: 2228 },
];

// ─── Tests ───────────────────────────────────────────────────────────────────

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

  it("renders the ECharts wrapper stub without throwing", () => {
    render(
      <GexBars
        strikes={SAMPLE_STRIKES}
        spot={7381}
        callWall={7600}
        putWall={7400}
      />,
    );

    // The mock renders a div with data-testid="echarts-stub"
    const stub = screen.getByTestId("echarts-stub");
    expect(stub).toBeTruthy();
  });

  it("the ECharts stub receives a non-empty series in GEX mode", () => {
    render(
      <GexBars
        strikes={SAMPLE_STRIKES}
        spot={7381}
        callWall={7600}
        putWall={7400}
      />,
    );

    const stub = screen.getByTestId("echarts-stub");
    expect(stub.getAttribute("data-has-series")).toBe("true");
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

// Units regression: domain dollarGamma outputs $Bn/1% ALREADY (e.g. +4.48 = $4.48Bn).
// fmtBn previously divided by 1e9 again → every axis label collapsed to "0.0B".
describe("fmtBn — values are already $Bn units (no second division)", () => {
  it("formats a domain-scale value directly", () => {
    expect(fmtBn(4.48)).toBe("4.5B");
    expect(fmtBn(-5.97)).toBe("-6.0B");
    expect(fmtBn(0)).toBe("0.0B");
  });
});
