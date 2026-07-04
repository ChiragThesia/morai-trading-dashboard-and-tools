/**
 * AdHocCalendarAnalysis.test.tsx — TDD RED→GREEN for the top-of-Analyzer paste-to-analyze panel.
 *
 * Paste a TOS calendar order → parse → reprice through the shared engine → payoff readout
 * (debit = max loss + scenario strip). No score/why-panel — that ranking is the Phase-19 engine,
 * so the panel says so explicitly. Invalid paste → inline error, no readout.
 */
import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";

// Spy-wrap PayoffChart (same precedent as Analyzer.test) so the heavy SVG doesn't dominate.
vi.mock("../charts/PayoffChart.tsx", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../charts/PayoffChart.tsx")>();
  return { ...actual, PayoffChart: vi.fn(() => null) };
});

import { AdHocCalendarAnalysis } from "./AdHocCalendarAnalysis.tsx";

const TODAY = new Date(2026, 6, 2); // local 2026-07-02
const GEX = { putWall: 7400, flip: 7472.65, callWall: 7525 };
const EXAMPLE = "BUY +1 CALENDAR SPX 100 18 SEP 26 [AM]/14 AUG 26 7425 PUT @48.75 LMT GTC";

function renderPanel() {
  render(<AdHocCalendarAnalysis today={TODAY} spot={7498.85} rate={0.045} gex={GEX} />);
}

afterEach(cleanup);

describe("AdHocCalendarAnalysis", () => {
  it("renders a paste input and an analyze button, no readout initially", () => {
    renderPanel();
    expect(screen.getByTestId("adhoc-input")).toBeTruthy();
    expect(screen.getByTestId("adhoc-analyze")).toBeTruthy();
    expect(screen.queryByTestId("adhoc-summary")).toBeNull();
  });

  it("analyzes a pasted TOS calendar: shows debit = max loss and the Phase-19 scoring note", () => {
    renderPanel();
    fireEvent.change(screen.getByTestId("adhoc-input"), { target: { value: EXAMPLE } });
    fireEvent.click(screen.getByTestId("adhoc-analyze"));

    const summary = screen.getByTestId("adhoc-summary");
    expect(summary.textContent).toContain("4,875"); // 48.75 pts × 100 = $4,875 max loss
    expect(screen.queryByTestId("adhoc-error")).toBeNull();
    expect(screen.getByText(/Phase 19/i)).toBeTruthy();
  });

  it("shows an inline error on an unparseable paste and renders no readout", () => {
    renderPanel();
    fireEvent.change(screen.getByTestId("adhoc-input"), { target: { value: "not an order" } });
    fireEvent.click(screen.getByTestId("adhoc-analyze"));

    expect(screen.getByTestId("adhoc-error")).toBeTruthy();
    expect(screen.queryByTestId("adhoc-summary")).toBeNull();
  });

  it("clears the readout", () => {
    renderPanel();
    fireEvent.change(screen.getByTestId("adhoc-input"), { target: { value: EXAMPLE } });
    fireEvent.click(screen.getByTestId("adhoc-analyze"));
    expect(screen.getByTestId("adhoc-summary")).toBeTruthy();

    fireEvent.click(screen.getByTestId("adhoc-clear"));
    expect(screen.queryByTestId("adhoc-summary")).toBeNull();
  });
});
