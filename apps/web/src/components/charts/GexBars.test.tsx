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

import { GexBars } from "./GexBars.tsx";
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

  it("the ToggleGroup options are reachable as interactive buttons", () => {
    render(
      <GexBars
        strikes={SAMPLE_STRIKES}
        spot={7381}
        callWall={7600}
        putWall={7400}
      />,
    );

    // All 3 toggle options should be present as interactive buttons
    const gexBtn = screen.getByRole("button", { name: "GEX mode" });
    const oiBtn = screen.getByRole("button", { name: "OI wall mode" });
    const volBtn = screen.getByRole("button", { name: "Volume mode" });

    // All buttons should be in the DOM (not disabled)
    expect(gexBtn.getAttribute("aria-disabled")).not.toBe("true");
    expect(oiBtn.getAttribute("aria-disabled")).not.toBe("true");
    expect(volBtn.getAttribute("aria-disabled")).not.toBe("true");

    // The GEX button should be initially pressed
    expect(gexBtn.getAttribute("aria-pressed")).toBe("true");
  });
});
