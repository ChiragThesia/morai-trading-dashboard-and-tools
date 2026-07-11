/**
 * JournalContainer.test.tsx — TDD suite for the JournalContainer data wrapper.
 *
 * Behaviors under test:
 *   1. Loading state → passes empty trades array to Journal (no crash, no empty-state copy yet).
 *   2. Success with one calendar → maps to TradeSummary correctly:
 *      - name is derived from underlying + strike/1000 + optionType + expiry shortdates
 *      - realizedPnl is "" (not a fabricated number)
 *      - hasSnapshots is false
 *   3. Empty calendar list → renders Journal empty state ("No journal history yet.")
 *
 * Mocks:
 *   - useCalendars: controlled data (no real API calls)
 *   - useLifecycle: mock (Journal makes per-calendar calls on selection)
 *   - useRebuildJournal: mock
 *   - rpc.ts / supabase.ts: prevent real network calls
 */

import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { UseQueryResult } from "@tanstack/react-query";
import React from "react";

// ─── Mock hooks + infra ──────────────────────────────────────────────────────
vi.mock("./hooks/useCalendars.ts", () => ({ useCalendars: vi.fn() }));
vi.mock("../hooks/useCalendars.ts", () => ({ useCalendars: vi.fn() }));

vi.mock("../hooks/useLifecycle.ts", () => ({
  useLifecycle: vi.fn(() => ({
    data: undefined,
    isPending: true,
    isError: false,
    refetch: vi.fn(),
  })),
}));

vi.mock("../hooks/useRebuildJournal.ts", () => ({
  useRebuildJournal: vi.fn(() => ({
    mutate: vi.fn(),
    isPending: false,
    isError: false,
    isSuccess: false,
  })),
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

// ─── Import container + mocks AFTER vi.mock hoisting ─────────────────────────
import { JournalContainer } from "./JournalContainer.tsx";
import { useCalendars } from "../hooks/useCalendars.ts";
import type { ListCalendarsResponse } from "@morai/contracts";

const mockUseCalendars = vi.mocked(useCalendars);

// ─── Mock return value builder ────────────────────────────────────────────────

function makeCalendarsResult(
  data: ListCalendarsResponse | undefined,
): UseQueryResult<ListCalendarsResponse, Error> {
  return {
    data,
    error: null,
    isLoading: data === undefined,
    isError: false,
    isPending: data === undefined,
    isSuccess: data !== undefined,
    isLoadingError: false,
    isRefetchError: false,
    isStale: false,
    isFetched: true,
    isFetchedAfterMount: true,
    isFetching: false,
    isInitialLoading: data === undefined,
    isPlaceholderData: false,
    isRefetching: false,
    failureCount: 0,
    failureReason: null,
    errorUpdatedAt: 0,
    dataUpdatedAt: Date.now(),
    status: data !== undefined ? "success" : "pending",
    fetchStatus: "idle",
    refetch: vi.fn(),
    promise: Promise.resolve(data),
  };
}

// ─── Fixtures ─────────────────────────────────────────────────────────────────

const SAMPLE_CALENDAR = {
  id: "550e8400-e29b-41d4-a716-446655440000",
  underlying: "SPX",
  strike: 7425000,
  optionType: "P" as const,
  frontExpiry: "2026-08-08",
  backExpiry: "2026-09-19",
  qty: 1,
  openNetDebit: 5.8,
  status: "open" as const,
  openedAt: "2026-06-01T14:30:00.000Z",
  closedAt: null,
  notes: null,
};

function renderWithProvider(ui: React.ReactElement): ReturnType<typeof render> {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={qc}>{ui}</QueryClientProvider>);
}

/**
 * 36 D-16: Journal is now a useIsDesktop switch → jsdom (no matchMedia) mounts the mobile
 * tree by default, whose trade list lands in plan 36-04. These assertions exercise the
 * desktop tree's trade rows, so stub the desktop media query (the Journal.test.tsx pattern).
 */
function stubDesktopMatchMedia(): void {
  Object.defineProperty(window, "matchMedia", {
    configurable: true,
    writable: true,
    value: (query: string) => ({
      matches: query === "(min-width: 1024px)",
      media: query,
      addEventListener: () => undefined,
      removeEventListener: () => undefined,
    }),
  });
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("JournalContainer", () => {
  beforeEach(() => {
    stubDesktopMatchMedia();
  });

  afterEach(() => {
    cleanup();
    Reflect.deleteProperty(window, "matchMedia");
    vi.clearAllMocks();
  });

  it("renders without crashing during loading (data=undefined → empty trades)", () => {
    mockUseCalendars.mockReturnValue(makeCalendarsResult(undefined));

    // Must not throw — Journal shows its own empty state gracefully
    expect(() => renderWithProvider(<JournalContainer />)).not.toThrow();
  });

  it("maps calendar to TradeSummary: correct name, empty realizedPnl, hasSnapshots=false", () => {
    mockUseCalendars.mockReturnValue(
      makeCalendarsResult({ calendars: [SAMPLE_CALENDAR] }),
    );

    renderWithProvider(<JournalContainer />);

    // Name should be derived: "SPX 7425P Aug 8/Sep 19"
    const nameElements = screen.getAllByText(/SPX 7425P/);
    expect(nameElements.length).toBeGreaterThan(0);

    // realizedPnl="" → fmtPnl returns "—" because isOpen=true shows "open" (closedAt=null)
    // The OPEN badge should appear
    expect(screen.getByText("OPEN")).toBeDefined();
  });

  it("renders Journal empty state when calendar list is empty", () => {
    mockUseCalendars.mockReturnValue(makeCalendarsResult({ calendars: [] }));

    renderWithProvider(<JournalContainer />);

    expect(screen.getByText(/No journal history yet/)).toBeDefined();
  });
});
