/**
 * CotCard.test.tsx — TDD suite for the COT positioning card (Phase 13 FE wiring).
 *
 * Behaviors under test:
 *   1. Renders latest-week net positioning per trader class (sign-formatted, K/M compact).
 *   2. Shows the "as of" report date from the newest entry.
 *   3. Renders week-over-week delta arrows against the previous entry.
 *   4. Empty state when useCot has no data.
 */

import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";

const { mockUseCot } = vi.hoisted(() => ({ mockUseCot: vi.fn() }));
vi.mock("../hooks/useCot.ts", () => ({ useCot: mockUseCot }));

import { CotCard } from "./CotCard.tsx";

const WEEK_LATEST = {
  asOf: "2026-06-23",
  publishedAt: "2026-07-01T16:48:14.548Z",
  contractCode: "13874A",
  openInterest: 1980254,
  dealerLong: 112578, dealerShort: 868478, netDealer: -755900,
  assetMgrLong: 1171421, assetMgrShort: 178692, netAssetManager: 992729,
  levMoneyLong: 185058, levMoneyShort: 558526, netLeveraged: -373468,
  otherReptLong: 62151, otherReptShort: 48090, netOther: 14061,
  nonreptLong: 260145, nonreptShort: 137567, netNonreportable: 122578,
};

const WEEK_PREV = {
  ...WEEK_LATEST,
  asOf: "2026-06-16",
  netDealer: -625169,
  netAssetManager: 984009,
  netLeveraged: -515520,
};

function setData(data: unknown): void {
  mockUseCot.mockReturnValue({ data });
}

describe("CotCard", () => {
  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it("renders the empty state when there is no COT data", () => {
    setData(undefined);
    render(<CotCard />);
    expect(screen.getByTestId("cot-empty")).toBeDefined();
  });

  it("renders latest-week net positioning per class, sign + K-compact", () => {
    setData([WEEK_LATEST, WEEK_PREV]);
    render(<CotCard />);
    expect(screen.getByTestId("cot-card")).toBeDefined();
    // Dealer net short −755,900 → −756K
    expect(screen.getByTestId("cot-net-netDealer").textContent).toBe("−756K");
    // Asset manager net long +992,729 → +993K
    expect(screen.getByTestId("cot-net-netAssetManager").textContent).toBe("+993K");
    // Leveraged (headline) net short −373,468 → −373K
    expect(screen.getByTestId("cot-net-netLeveraged").textContent).toBe("−373K");
  });

  it("shows the report date of the newest entry", () => {
    setData([WEEK_LATEST, WEEK_PREV]);
    render(<CotCard />);
    expect(screen.getByText(/2026-06-23/)).toBeDefined();
  });

  it("renders week-over-week delta arrows vs the previous entry", () => {
    setData([WEEK_LATEST, WEEK_PREV]);
    render(<CotCard />);
    // Leveraged went from −515,520 → −373,468: net +142,052 ⇒ ▲ 142K
    const wow = screen.getByTestId("cot-wow-netLeveraged").textContent ?? "";
    expect(wow).toContain("▲");
    expect(wow).toContain("142K");
  });
});
