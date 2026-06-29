/**
 * Overview screen tests — Overview is now a pure composition of the Positions deep-dive
 * (top) and the Market structure screen (below). Positions + Market each own their
 * behavioral tests; here we only assert Overview mounts both, in that order.
 */
import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";

// Mock the two child screens with sentinels — Overview's only job is to compose them.
vi.mock("./Positions.tsx", () => ({
  Positions: (): React.ReactElement => <div data-testid="positions-screen" />,
}));
vi.mock("./Market.tsx", () => ({
  Market: (): React.ReactElement => <div data-testid="market-screen" />,
}));

import { Overview } from "./Overview.tsx";

describe("Overview screen", () => {
  afterEach(() => {
    cleanup();
  });

  it("composes the Positions deep-dive and the Market structure screen", () => {
    render(<Overview />);
    expect(screen.getByTestId("positions-screen")).toBeDefined();
    expect(screen.getByTestId("market-screen")).toBeDefined();
  });

  it("renders Positions before Market (book on top, market structure below)", () => {
    const { container } = render(<Overview />);
    const positions = screen.getByTestId("positions-screen");
    const market = screen.getByTestId("market-screen");
    // DOCUMENT_POSITION_FOLLOWING (4) → market comes after positions in document order
    expect(positions.compareDocumentPosition(market) & 4).toBeTruthy();
    expect(container.firstChild).toBeDefined();
  });
});
