/**
 * Overview screen tests — the 3-section dashboard:
 *   1. Open positions table (+ net greeks), 2. Market (live GEX + COT/FRED stubs),
 *   3. Book & system summary.
 * Market is mocked to a sentinel (its charts pull heavy deps); data hooks are mocked.
 */
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";

vi.mock("../hooks/usePositions.ts", () => ({ usePositions: vi.fn() }));
vi.mock("../hooks/useGex.ts", () => ({ useGex: vi.fn(() => ({ data: { spot: 7381 } })) }));
vi.mock("../hooks/useStatus.ts", () => ({ useStatus: vi.fn(() => ({ data: undefined })) }));
vi.mock("./Market.tsx", () => ({ Market: (): React.ReactElement => <div data-testid="market-screen" /> }));

import { Overview } from "./Overview.tsx";
import { usePositions } from "../hooks/usePositions.ts";

const mockUsePositions = vi.mocked(usePositions);

function setPositions(positions: unknown): void {
  // eslint-disable-next-line @typescript-eslint/consistent-type-assertions
  mockUsePositions.mockReturnValue({ data: { positions }, isPending: false } as unknown as ReturnType<typeof usePositions>);
}

const POS = {
  occSymbol: "SPXW  260807P07425000",
  putCall: "P" as const,
  longQty: 0,
  shortQty: 1,
  averagePrice: 127.0478,
  marketValue: -17875,
  underlyingSymbol: "$SPX",
};

describe("Overview screen", () => {
  afterEach(() => cleanup());

  it("renders the three section headers", () => {
    setPositions([]);
    render(<Overview />);
    expect(screen.getByText("Open positions · greeks")).toBeDefined();
    expect(screen.getByText(/Market · what the big guys are doing/)).toBeDefined();
    expect(screen.getByText("Book & system")).toBeDefined();
  });

  it("shows COT and FRED as 'needs feed' stubs in the market section", () => {
    setPositions([]);
    render(<Overview />);
    expect(screen.getByText(/CFTC COT/)).toBeDefined();
    expect(screen.getByText("FRED macro")).toBeDefined();
    expect(screen.getAllByText("○ needs feed").length).toBeGreaterThanOrEqual(2);
  });

  it("embeds the live Market (GEX/OI/Volume) section", () => {
    setPositions([]);
    render(<Overview />);
    expect(screen.getByTestId("market-screen")).toBeDefined();
  });

  it("renders the positions table with a row per position", () => {
    setPositions([POS]);
    render(<Overview />);
    // Position label (strike+type) appears in the table
    expect(screen.getAllByText("7425P").length).toBeGreaterThanOrEqual(1);
    // Greeks column headers
    expect(screen.getByText("Θ/d")).toBeDefined();
  });

  it("shows the empty-state copy when there are no positions", () => {
    setPositions([]);
    render(<Overview />);
    expect(screen.getByText(/No open positions/)).toBeDefined();
  });
});
