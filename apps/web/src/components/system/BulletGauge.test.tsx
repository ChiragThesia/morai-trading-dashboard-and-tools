/**
 * BulletGauge.test.tsx — unit contract for the shared bullet-gauge track (39-01, GAUGE-01).
 * Extracted from RegimeBoard's Row; this suite proves the extraction preserves the exact
 * markup/clamp math RegimeBoard.test.tsx already asserts against the composed component.
 */
import { describe, it, expect, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import * as fc from "fast-check";
import { assertDefined } from "@morai/shared";
import { BulletGauge } from "./BulletGauge.tsx";

afterEach(() => {
  cleanup();
});

describe("BulletGauge", () => {
  it("renders a role=meter track with min/max/aria wiring; aria-valuenow clamps, aria-valuetext carries the raw string verbatim", () => {
    render(
      <BulletGauge
        variant="banded"
        min={0.6}
        max={1.2}
        value={2.0}
        bandWarn={0.9}
        bandCrisis={0.95}
        markerColorClass="bg-amber"
        ariaLabel="VIX/VIX3M gauge"
        ariaValueText="2.00 — warning"
        testId="gauge-test"
        markerTestId="gauge-test-marker"
      />,
    );
    const meter = screen.getByTestId("gauge-test");
    expect(meter.getAttribute("role")).toBe("meter");
    expect(meter.getAttribute("aria-valuemin")).toBe("0.6");
    expect(meter.getAttribute("aria-valuemax")).toBe("1.2");
    // value 2.0 is outside [0.6, 1.2] — aria-valuenow clamps to the axis max (meter contract).
    expect(meter.getAttribute("aria-valuenow")).toBe("1.2");
    // aria-valuetext carries the passed-in, unclamped string verbatim.
    expect(meter.getAttribute("aria-valuetext")).toBe("2.00 — warning");
    expect(meter.getAttribute("aria-label")).toBe("VIX/VIX3M gauge");
  });

  it("banded variant renders exactly [warn, crisis, marker] with the documented left/width + marker color", () => {
    render(
      <BulletGauge
        variant="banded"
        min={0.6}
        max={1.2}
        value={0.92}
        bandWarn={0.9}
        bandCrisis={0.95}
        markerColorClass="bg-amber"
        ariaLabel="gauge"
        ariaValueText="0.92 — warning"
        testId="gauge-banded"
        markerTestId="gauge-banded-marker"
      />,
    );
    const meter = screen.getByTestId("gauge-banded");
    const segments = meter.querySelectorAll<HTMLElement>(":scope > div");
    expect(segments).toHaveLength(3);
    const [warnSeg, crisisSeg, marker] = segments;
    assertDefined(warnSeg, "warn segment present");
    assertDefined(crisisSeg, "crisis segment present");
    assertDefined(marker, "marker present");

    // bandWarn 0.9 on [0.6,1.2] -> 50%; bandCrisis 0.95 -> 58.33% (same fixture as RegimeBoard.test.tsx)
    expect(parseFloat(warnSeg.style.left)).toBeCloseTo(50, 5);
    expect(parseFloat(crisisSeg.style.left)).toBeCloseTo(58.333, 1);
    expect(warnSeg.className).toContain("bg-amber/30");
    expect(crisisSeg.className).toContain("bg-down/30");
    expect(marker.getAttribute("data-testid")).toBe("gauge-banded-marker");
    expect(marker.className).toContain("bg-amber");
  });

  it("neutral variant renders exactly one child — the marker — no band segments", () => {
    render(
      <BulletGauge
        variant="neutral"
        min={0}
        max={8}
        value={4.33}
        markerColorClass="bg-dim"
        ariaLabel="Fed Funds gauge"
        ariaValueText="4.33% — position"
        testId="gauge-neutral"
        markerTestId="gauge-neutral-marker"
      />,
    );
    const meter = screen.getByTestId("gauge-neutral");
    const segments = meter.querySelectorAll<HTMLElement>(":scope > div");
    expect(segments).toHaveLength(1);
    expect(segments[0]?.getAttribute("data-testid")).toBe("gauge-neutral-marker");
  });

  it("clamps the marker + banded segment positions for arbitrary value/min/max (fast-check, mirrors RegimeBoard's CR-01 guard)", () => {
    fc.assert(
      fc.property(
        fc.float({ min: Math.fround(-1000), max: Math.fround(1000), noNaN: true }),
        fc.float({ min: Math.fround(-1000), max: Math.fround(1000), noNaN: true }),
        fc.float({ min: Math.fround(-1000), max: Math.fround(1000), noNaN: true }),
        (value, min, max) => {
          if (max <= min) return; // degenerate scale, not a real axis
          cleanup();
          render(
            <BulletGauge
              variant="banded"
              min={min}
              max={max}
              value={value}
              bandWarn={min}
              bandCrisis={max}
              markerColorClass="bg-txt"
              ariaLabel="gauge"
              ariaValueText={`${value} — calm`}
              testId="gauge-fc"
              markerTestId="gauge-fc-marker"
            />,
          );
          const marker = screen.getByTestId("gauge-fc-marker");
          const left = parseFloat(marker.style.left);
          expect(left).toBeGreaterThanOrEqual(0);
          expect(left).toBeLessThanOrEqual(100);

          const meter = screen.getByTestId("gauge-fc");
          const segments = meter.querySelectorAll<HTMLElement>(":scope > div");
          const warnSeg = segments[0];
          const crisisSeg = segments[1];
          assertDefined(warnSeg, "warn segment present");
          assertDefined(crisisSeg, "crisis segment present");
          const warnLeft = parseFloat(warnSeg.style.left);
          const warnWidth = parseFloat(warnSeg.style.width);
          const crisisLeft = parseFloat(crisisSeg.style.left);
          const crisisWidth = parseFloat(crisisSeg.style.width);
          expect(warnLeft).toBeGreaterThanOrEqual(0);
          expect(warnLeft).toBeLessThanOrEqual(100);
          expect(warnWidth).toBeGreaterThanOrEqual(0);
          expect(crisisLeft).toBeGreaterThanOrEqual(0);
          expect(crisisLeft).toBeLessThanOrEqual(100);
          expect(crisisWidth).toBeGreaterThanOrEqual(0);
        },
      ),
      { numRuns: 50 },
    );
  });
});
