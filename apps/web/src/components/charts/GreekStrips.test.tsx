/**
 * GreekStrips.test.tsx — isolated RTL smoke-render test
 *
 * uPlot runs window.matchMedia at CJS module load time (before our test code
 * can stub it), so we mock the entire `uplot-react` module to a passthrough
 * <div> — the PLAN read_first note explicitly permits this approach.
 *
 * This is the standard pattern for testing uPlot wrappers in jsdom: we test that
 * the component mounts without throwing and that the four panel labels render in
 * the DOM. Canvas pixel rendering is not tested.
 */

import { describe, it, expect, vi } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";

// Mock uplot-react before any imports that load uPlot CJS bundle
vi.mock("uplot-react", () => ({
  default: () => <div data-testid="uplot-mock" />,
}));

// Also mock the uPlot CSS import to avoid vite transform issues
vi.mock("uplot/dist/uPlot.min.css", () => ({}));

import { GreekStrips, type GreekStripData } from "./GreekStrips.tsx";

// ─── Fixtures ─────────────────────────────────────────────────────────────────

function makeMockData(): GreekStripData {
  const spots = [5700, 5750, 5800, 5850, 5900];
  return {
    spots,
    delta: [-0.3, -0.32, -0.35, -0.38, -0.4],
    gamma: [0.001, 0.0012, 0.0013, 0.0012, 0.001],
    theta: [-2.5, -2.6, -2.7, -2.6, -2.5],
    vega: [1.2, 1.3, 1.4, 1.3, 1.2],
    currentSpot: 5800,
  };
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("GreekStrips", () => {
  it("mounts without throwing under jsdom with uplot-react mock", () => {
    expect(() => {
      render(<GreekStrips data={makeMockData()} />);
    }).not.toThrow();
    cleanup();
  });

  it("renders the Net Δ panel label", () => {
    render(<GreekStrips data={makeMockData()} />);
    expect(screen.getByText("Net Δ")).toBeDefined();
    cleanup();
  });

  it("renders the Net Γ panel label", () => {
    render(<GreekStrips data={makeMockData()} />);
    expect(screen.getByText("Net Γ")).toBeDefined();
    cleanup();
  });

  it("renders the Net Θ/d panel label", () => {
    render(<GreekStrips data={makeMockData()} />);
    expect(screen.getByText("Net Θ/d")).toBeDefined();
    cleanup();
  });

  it("renders the Net Vega panel label", () => {
    render(<GreekStrips data={makeMockData()} />);
    expect(screen.getByText("Net Vega")).toBeDefined();
    cleanup();
  });

  it("renders all four panel labels in the same render", () => {
    render(<GreekStrips data={makeMockData()} />);
    expect(screen.getByText("Net Δ")).toBeDefined();
    expect(screen.getByText("Net Γ")).toBeDefined();
    expect(screen.getByText("Net Θ/d")).toBeDefined();
    expect(screen.getByText("Net Vega")).toBeDefined();
    cleanup();
  });

  it("renders with optional strikeSpot prop (Positions variant)", () => {
    const data: GreekStripData = { ...makeMockData(), strikeSpot: 7400 };
    expect(() => {
      render(<GreekStrips data={data} />);
    }).not.toThrow();
    cleanup();
  });

  it("renders with custom panel dimensions", () => {
    expect(() => {
      render(<GreekStrips data={makeMockData()} panelWidth={150} panelHeight={80} />);
    }).not.toThrow();
    cleanup();
  });
});
