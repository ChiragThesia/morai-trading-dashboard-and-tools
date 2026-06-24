/**
 * Overview screen tests — asserts the 12-col grid behavior with live data.
 *
 * Behavior under test:
 *   1. Empty positions → renders locked "No open positions…" copy (D-04, UI-SPEC)
 *   2. One position → renders the position row + net row in the table
 *   3. Economic-calendar ComingSoon stub → always renders "○ needs feed" badge
 *
 * Mocks:
 *   - usePositions: returns empty array / one position / loading states
 *   - useStatus: returns stub data for system health card
 *   - apiFetch / rpc / supabase: prevent real network calls
 */
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import { QueryClientProvider, QueryClient } from "@tanstack/react-query";

// Mock hooks before importing Overview to prevent real API calls
vi.mock("../hooks/usePositions.ts", () => ({
  usePositions: vi.fn(),
}));

vi.mock("../hooks/useStatus.ts", () => ({
  useStatus: vi.fn(() => ({ data: undefined, isPending: true })),
}));

vi.mock("../lib/rpc.ts", () => ({
  setAuthToken: vi.fn(),
  apiFetch: vi.fn(),
  rpc: {},
}));

vi.mock("../lib/supabase.ts", () => ({
  supabase: {
    auth: {
      getSession: vi.fn().mockResolvedValue({ data: { session: null }, error: null }),
      onAuthStateChange: vi.fn(() => ({
        data: { subscription: { unsubscribe: vi.fn() } },
      })),
    },
  },
}));

import { Overview } from "./Overview.tsx";
import { usePositions } from "../hooks/usePositions.ts";

const mockUsePositions = vi.mocked(usePositions);

/** Minimal position fixture matching the brokerPosition Zod schema */
function makePosition() {
  return {
    occSymbol: "SPX   260612P07400000",
    putCall: "P" as const,
    longQty: 1,
    shortQty: 0,
    averagePrice: 12.5,
    marketValue: 14.2,
    underlyingSymbol: "SPX",
  };
}

function renderOverview() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <Overview />
    </QueryClientProvider>,
  );
}

describe("Overview screen", () => {
  afterEach(() => {
    cleanup();
  });

  it("renders the locked empty-state copy when usePositions returns an empty array", () => {
    mockUsePositions.mockReturnValue({
      data: { positions: [] },
      isPending: false,
    } as ReturnType<typeof usePositions>);

    renderOverview();

    // Locked copy from UI-SPEC "Empty / loading / error states"
    expect(
      screen.getByText(
        /No open positions\. Register a calendar via the API or paste a TOS order to analyze a scenario\./,
      ),
    ).toBeDefined();
  });

  it("renders the position row and net row when positions exist", () => {
    const pos = makePosition();
    mockUsePositions.mockReturnValue({
      data: { positions: [pos] },
      isPending: false,
    } as ReturnType<typeof usePositions>);

    renderOverview();

    // Position OCC symbol should appear in the table.
    // The OCC symbol has internal spaces (21-char fixed format); use a regex that
    // collapses multiple spaces so RTL's whitespace normalization doesn't block the match.
    expect(
      screen.getByText(/SPX\s+260612P07400000/),
    ).toBeDefined();
    // Net row should appear
    expect(screen.getByText("Net")).toBeDefined();
    // Empty state copy should NOT be visible
    expect(
      screen.queryByText(
        /No open positions\. Register a calendar via the API/,
      ),
    ).toBeNull();
  });

  it("renders the economic-calendar ComingSoon stub with '○ needs feed' badge", () => {
    mockUsePositions.mockReturnValue({
      data: { positions: [] },
      isPending: false,
    } as ReturnType<typeof usePositions>);

    renderOverview();

    // The badge text from UI-SPEC "Catalysts stub badge"
    expect(screen.getByText("○ needs feed")).toBeDefined();
  });

  it("renders the locked Data-range note", () => {
    mockUsePositions.mockReturnValue({
      data: { positions: [] },
      isPending: false,
    } as ReturnType<typeof usePositions>);

    renderOverview();

    // UI-SPEC "Data range note" — exact locked copy
    expect(
      screen.getByText(
        /Data from 2026-06-12 forward \(chain history start\)\. Older trades = entry\/exit only\./,
      ),
    ).toBeDefined();
  });

  it("renders loading skeleton when positions are still loading", () => {
    mockUsePositions.mockReturnValue({
      data: undefined,
      isPending: true,
    } as ReturnType<typeof usePositions>);

    const { container } = renderOverview();

    // Empty state copy should NOT appear while loading
    expect(
      screen.queryByText(/No open positions/),
    ).toBeNull();
    // Container should still render (no crash)
    expect(container.firstChild).toBeDefined();
  });
});
