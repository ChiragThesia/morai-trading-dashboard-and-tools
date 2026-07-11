import { describe, it, expect, afterEach } from "vitest";
import { render, cleanup } from "@testing-library/react";
import { mockResponsiveContainer } from "../test/recharts-test-utils.tsx";

mockResponsiveContainer();

import { GammaProfile } from "./GammaProfile.tsx";
import type { GexSnapshotEntry } from "@morai/contracts";

/**
 * GammaProfile spec — Recharts DOM (33-03 Wave-0 gap closure, no prior test file existed).
 *
 * Asserts against the Recharts-rendered SVG, not visx: the split teal/coral area fill
 * (gradient stop colors), the amber-dashed flip ReferenceLine (present/absent on flip),
 * the blue-solid spot ReferenceLine + zero-baseline dot, compact vs full ChartContainer
 * pixel sizing, and the <2-point null guard. Stable queries (className, stroke/fill
 * color, style string) over exact pixel geometry, per the plan's own guidance —
 * Recharts owns the scale math.
 */

const TEAL = "#26a69a";
const CORAL = "#ef5350";
const AMBER = "#f0b429";
const BLUE = "#5b9cf6";

const MIXED_PROFILE: GexSnapshotEntry["profile"] = [
  { spot: 7300, gamma: -10 },
  { spot: 7350, gamma: 0 },
  { spot: 7400, gamma: 15 },
  { spot: 7450, gamma: 20 },
];

describe("GammaProfile", () => {
  afterEach(() => {
    cleanup();
  });

  it("returns null when the profile has fewer than 2 points", () => {
    const { container } = render(
      <GammaProfile profile={[{ spot: 7400, gamma: 5 }]} spot={7400} flip={null} />,
    );
    expect(container.firstChild).toBeNull();
  });

  it("splits the area fill teal above zero and coral below zero", () => {
    const { container } = render(
      <GammaProfile profile={MIXED_PROFILE} spot={7375} flip={null} />,
    );

    const stops = container.querySelectorAll("stop");
    expect(stops.length).toBe(2);
    const colors = Array.from(stops).map((s) => s.getAttribute("stop-color"));
    expect(colors).toContain(TEAL);
    expect(colors).toContain(CORAL);

    const area = container.querySelector(".gamma-area path.recharts-area-area");
    expect(area).not.toBeNull();
    expect(area?.getAttribute("fill") ?? "").toContain("url(#");
  });

  it("renders the amber dashed flip reference line when flip is non-null", () => {
    const { container } = render(
      <GammaProfile profile={MIXED_PROFILE} spot={7375} flip={7350} />,
    );

    const flipLine = container.querySelector(".gamma-flip-line line");
    expect(flipLine).not.toBeNull();
    expect(flipLine?.getAttribute("stroke")).toBe(AMBER);
    expect(flipLine?.getAttribute("stroke-dasharray")).toBeTruthy();
  });

  it("omits the flip reference line when flip is null", () => {
    const { container } = render(
      <GammaProfile profile={MIXED_PROFILE} spot={7375} flip={null} />,
    );

    expect(container.querySelector(".gamma-flip-line")).toBeNull();
  });

  // WR-01: MIXED_PROFILE's x-domain is [minSpot, maxSpot] = [7300, 7450] — a flip/spot value
  // outside that range used to still draw (visx's overflow:visible), just past the nominal
  // plot bounds. ReferenceLine's default ifOverflow="discard" silently omits an off-domain
  // line entirely instead; ifOverflow="hidden" keeps it rendered (structurally clipped).
  it("still renders a flip reference line when flip is outside the profile's own domain (WR-01, ifOverflow=hidden parity)", () => {
    const { container } = render(
      <GammaProfile profile={MIXED_PROFILE} spot={7375} flip={7500} />,
    );

    expect(container.querySelector(".gamma-flip-line line")).not.toBeNull();
  });

  it("still renders the spot reference line when spot is outside the profile's own domain (WR-01, ifOverflow=hidden parity)", () => {
    const { container } = render(
      <GammaProfile profile={MIXED_PROFILE} spot={7500} flip={null} />,
    );

    expect(container.querySelector(".gamma-spot-line line")).not.toBeNull();
  });

  it("renders a solid blue spot reference line and a spot dot at the zero baseline", () => {
    const { container } = render(
      <GammaProfile profile={MIXED_PROFILE} spot={7375} flip={null} />,
    );

    const spotLine = container.querySelector(".gamma-spot-line line");
    expect(spotLine).not.toBeNull();
    expect(spotLine?.getAttribute("stroke")).toBe(BLUE);
    expect(spotLine?.getAttribute("stroke-dasharray")).toBeFalsy();

    const spotDot = container.querySelector(".gamma-spot-dot circle");
    expect(spotDot).not.toBeNull();
    expect(spotDot?.getAttribute("fill")).toBe(BLUE);
    const zeroLine = container.querySelector(".gamma-zero-line line");
    expect(spotDot?.getAttribute("cy")).toBe(zeroLine?.getAttribute("y1"));
  });

  it("renders full size at 720x230 by default", () => {
    const { container } = render(
      <GammaProfile profile={MIXED_PROFILE} spot={7375} flip={null} />,
    );

    const chart = container.querySelector('[data-slot="chart"]');
    expect(chart).not.toBeNull();
    const style = chart?.getAttribute("style") ?? "";
    expect(style).toContain("720px");
    expect(style).toContain("230px");
  });

  it("renders compact size at 300x130 when compact is set", () => {
    const { container } = render(
      <GammaProfile profile={MIXED_PROFILE} spot={7375} flip={null} compact />,
    );

    const chart = container.querySelector('[data-slot="chart"]');
    expect(chart).not.toBeNull();
    const style = chart?.getAttribute("style") ?? "";
    expect(style).toContain("300px");
    expect(style).toContain("130px");
  });
});
