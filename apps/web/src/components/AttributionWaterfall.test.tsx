/**
 * AttributionWaterfall.test.tsx — isolated RTL smoke-render test
 *
 * AttributionWaterfall is pure DOM (no canvas) — no stub needed.
 * Tests:
 *   - Positions 5-item variant renders "residual" row label and total row
 *   - Analyzer 4-item variant also renders "residual" row label and total row
 *   - Both variants mount without throwing
 */

import { describe, it, expect } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import { AttributionWaterfall } from "./AttributionWaterfall.tsx";

describe("AttributionWaterfall", () => {
  describe("positions variant (5-item)", () => {
    it("mounts without throwing", () => {
      expect(() => {
        render(
          <AttributionWaterfall
            variant="positions"
            data={{
              spotDelta: 12.5,
              theta: -8.2,
              vegaFront: -5.1,
              vegaBack: 14.3,
              residual: -1.2,
            }}
          />,
        );
      }).not.toThrow();
      cleanup();
    });

    it("renders the 'residual' row label", () => {
      render(
        <AttributionWaterfall
          variant="positions"
          data={{
            spotDelta: 12.5,
            theta: -8.2,
            vegaFront: -5.1,
            vegaBack: 14.3,
            residual: -1.2,
          }}
        />,
      );
      expect(screen.getByText("residual")).toBeDefined();
      cleanup();
    });

    it("renders all 5 row labels", () => {
      render(
        <AttributionWaterfall
          variant="positions"
          data={{
            spotDelta: 12.5,
            theta: -8.2,
            vegaFront: -5.1,
            vegaBack: 14.3,
            residual: -1.2,
          }}
        />,
      );
      expect(screen.getByText("spot Δ")).toBeDefined();
      expect(screen.getByText("theta")).toBeDefined();
      expect(screen.getByText("vega front")).toBeDefined();
      expect(screen.getByText("vega back")).toBeDefined();
      expect(screen.getByText("residual")).toBeDefined();
      cleanup();
    });

    it("renders the total row", () => {
      render(
        <AttributionWaterfall
          variant="positions"
          data={{
            spotDelta: 12.5,
            theta: -8.2,
            vegaFront: -5.1,
            vegaBack: 14.3,
            residual: -1.2,
          }}
        />,
      );
      expect(screen.getByTestId("waterfall-total-row")).toBeDefined();
      cleanup();
    });

    it("renders optional note text", () => {
      render(
        <AttributionWaterfall
          variant="positions"
          data={{
            spotDelta: 0,
            theta: 0,
            vegaFront: 0,
            vegaBack: 0,
            residual: 0,
          }}
          note="For a calendar the headline is vega split + theta"
        />,
      );
      expect(screen.getByTestId("waterfall-note")).toBeDefined();
      cleanup();
    });
  });

  describe("analyzer variant (4-item / combined book)", () => {
    it("mounts without throwing", () => {
      expect(() => {
        render(
          <AttributionWaterfall
            variant="analyzer"
            data={{
              spotDelta: 8.1,
              theta: -4.3,
              vega: 6.2,
              residual: -0.8,
            }}
          />,
        );
      }).not.toThrow();
      cleanup();
    });

    it("renders the 'residual' row label in analyzer variant", () => {
      render(
        <AttributionWaterfall
          variant="analyzer"
          data={{
            spotDelta: 8.1,
            theta: -4.3,
            vega: 6.2,
            residual: -0.8,
          }}
        />,
      );
      expect(screen.getByText("residual")).toBeDefined();
      cleanup();
    });

    it("renders all 4 row labels", () => {
      render(
        <AttributionWaterfall
          variant="analyzer"
          data={{
            spotDelta: 8.1,
            theta: -4.3,
            vega: 6.2,
            residual: -0.8,
          }}
        />,
      );
      expect(screen.getByText("spot Δ")).toBeDefined();
      expect(screen.getByText("theta")).toBeDefined();
      expect(screen.getByText("vega")).toBeDefined();
      expect(screen.getByText("residual")).toBeDefined();
      cleanup();
    });

    it("renders the total row in analyzer variant", () => {
      render(
        <AttributionWaterfall
          variant="analyzer"
          data={{
            spotDelta: 8.1,
            theta: -4.3,
            vega: 6.2,
            residual: -0.8,
          }}
        />,
      );
      expect(screen.getByTestId("waterfall-total-row")).toBeDefined();
      cleanup();
    });
  });
});
