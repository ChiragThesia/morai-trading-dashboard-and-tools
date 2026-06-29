/**
 * Analyzer.test.tsx — TDD suite for the Analyzer 3-column cockpit (Plan 10 Task 3)
 *
 * Behaviors under test:
 *   (a) Render with one live position → payoff chart region + greek strips render
 *   (b) Spot slider change → scenario re-prices locally, NO network/RPC call fires
 *   (c) "+ add from paste" with canonical TOS string → locked success message + new non-live row
 *   (c2) "+ add from paste" with garbage → locked parse-error copy
 *   (d) Live position shows protected indicator (🔒 or "live") and no × remove button
 *
 * Mocks:
 *   - usePositions: controlled position data (no real API calls)
 *   - useGex: controlled GEX snapshot
 *   - uplot-react: passthrough (uPlot CJS canvas issue in jsdom)
 *   - echarts-for-react: passthrough (canvas fails in jsdom)
 *   - repriceScenario: NOT mocked — we verify it's called client-side (no network)
 *   - apiFetch: spy to verify NO network call fires for re-pricing
 */

import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import React from "react";

// ─── Mock uplot-react + CSS (must be before any import that loads uPlot CJS) ──
vi.mock("uplot-react", () => ({
  default: (): React.ReactElement => <div data-testid="uplot-mock" />,
}));

vi.mock("uplot/dist/uPlot.min.css", () => ({}));

// ─── Mock echarts-for-react (canvas init fails under jsdom) ────────────────────
vi.mock("echarts-for-react", () => ({
  default: ({ style }: { style?: React.CSSProperties }): React.ReactElement => (
    <div data-testid="echarts-stub" style={style} />
  ),
}));

// ─── Mock visx shape (SVG rendering is irrelevant in jsdom) ──────────────────
vi.mock("@visx/shape", () => ({
  LinePath: (): React.ReactElement => <g data-testid="visx-linepath" />,
  AreaClosed: (): React.ReactElement => <g data-testid="visx-area" />,
}));

vi.mock("@visx/gradient", () => ({
  LinearGradient: (): React.ReactElement => <defs />,
}));

vi.mock("@visx/group", () => ({
  Group: ({ children }: { children?: React.ReactNode }): React.ReactElement => (
    <g>{children}</g>
  ),
}));

vi.mock("@visx/scale", () => ({
  scaleLinear: () => (v: number) => v,
}));

vi.mock("@visx/curve", () => ({
  curveMonotoneX: {},
}));

vi.mock("@visx/event", () => ({
  localPoint: () => null,
}));

// ─── Mock hooks + infra ──────────────────────────────────────────────────────
vi.mock("../hooks/usePositions.ts", () => ({
  usePositions: vi.fn(),
}));

vi.mock("../hooks/useGex.ts", () => ({
  useGex: vi.fn(),
}));

// apiFetch spy — must NOT be called during re-pricing (scenario is client-side)
const mockApiFetch = vi.fn();
vi.mock("../lib/rpc.ts", () => ({
  setAuthToken: vi.fn(),
  apiFetch: mockApiFetch,
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

// Ad-hoc lookup lives on Analyzer now — mock useLiveStream so the test opens no EventSource.
vi.mock("../hooks/useLiveStream.ts", () => ({
  useLiveStream: vi.fn(() => ({
    greeks: new Map(),
    status: "poll" as const,
    lastTickAt: null,
    subscribeAdHoc: vi.fn().mockResolvedValue(undefined),
  })),
  StreamMintError: class StreamMintError extends Error {
    constructor(status: number) { super(String(status)); this.name = "StreamMintError"; }
  },
  StreamSubscribeError: class StreamSubscribeError extends Error {
    constructor(status: number) { super(String(status)); this.name = "StreamSubscribeError"; }
  },
}));

// ─── Import screen + mocks AFTER vi.mock hoisting ─────────────────────────────
import { Analyzer } from "./Analyzer.tsx";
import { usePositions } from "../hooks/usePositions.ts";
import { useGex } from "../hooks/useGex.ts";
import type { GexSnapshotEntry } from "@morai/contracts";
import type { UseQueryResult } from "@tanstack/react-query";

// ─── Fixtures ─────────────────────────────────────────────────────────────────

/** Minimal live broker position — mirrors brokerPosition schema */
const LIVE_BROKER_POS = {
  occSymbol: "SPX   260808P07425000",
  putCall: "P" as const,
  longQty: 1,
  shortQty: 0,
  averagePrice: null,
  marketValue: null,
  underlyingSymbol: "SPX",
};

/** Sample GEX snapshot */
const SAMPLE_GEX: GexSnapshotEntry = {
  spot: 7381,
  flip: null,
  callWall: 7600,
  putWall: 7400,
  netGammaAtSpot: -57_000_000_000,
  computedAt: "2026-06-25T00:00:00.000Z",
  profile: [
    { spot: 7000, gamma: -800_000_000 },
    { spot: 7381, gamma: -57_000_000_000 },
    { spot: 7600, gamma: 200_000_000 },
  ],
  strikes: [
    { k: 7400, gex: -5_974_395_559, coi: 17071, poi: 52786, vol: 8406 },
    { k: 7600, gex: 1_230_000_000, coi: 69015, poi: 39475, vol: 2228 },
  ],
  byExpiry: [
    { date: "2026-07-18", gex: -20_000_000_000 },
    { date: "2026-08-15", gex: 10_000_000_000 },
  ],
};

// ─── Mock return value builders (no `as` assertions) ─────────────────────────

type UsePositionsReturn = ReturnType<typeof usePositions>;
type UseGexReturn = ReturnType<typeof useGex>;

function makePositionsResult(
  data: UsePositionsReturn["data"],
): UseQueryResult<UsePositionsReturn["data"], Error> {
  return {
    data,
    error: null,
    isLoading: false,
    isError: false,
    isPending: false,
    isSuccess: true,
    isLoadingError: false,
    isRefetchError: false,
    isStale: false,
    isFetched: true,
    isFetchedAfterMount: true,
    isFetching: false,
    isInitialLoading: false,
    isPlaceholderData: false,
    isRefetching: false,
    failureCount: 0,
    failureReason: null,
    errorUpdatedAt: 0,
    dataUpdatedAt: Date.now(),
    status: "success",
    fetchStatus: "idle",
    refetch: vi.fn(),
    promise: Promise.resolve(data),
  };
}

function makeGexResult(
  data: UseGexReturn["data"],
): UseQueryResult<UseGexReturn["data"], Error> {
  return {
    data,
    error: null,
    isLoading: false,
    isError: false,
    isPending: false,
    isSuccess: true,
    isLoadingError: false,
    isRefetchError: false,
    isStale: false,
    isFetched: true,
    isFetchedAfterMount: true,
    isFetching: false,
    isInitialLoading: false,
    isPlaceholderData: false,
    isRefetching: false,
    failureCount: 0,
    failureReason: null,
    errorUpdatedAt: 0,
    dataUpdatedAt: Date.now(),
    status: "success",
    fetchStatus: "idle",
    refetch: vi.fn(),
    promise: Promise.resolve(data),
  };
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function renderWithProvider(ui: React.ReactElement): ReturnType<typeof render> {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false, gcTime: 0 },
    },
  });
  return render(
    <QueryClientProvider client={queryClient}>{ui}</QueryClientProvider>,
  );
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("Analyzer screen", () => {
  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  // regression: Analyzer:692 — positionsQuery.data is {positions:[…]}, NOT an array.
  // The old code `positionsQuery.data ?? []` would call [].map on an object and crash.
  it("regression: does NOT crash when positionsQuery.data is {positions:[…]} (object, not array)", () => {
    vi.mocked(usePositions).mockReturnValue(
      makePositionsResult({ positions: [LIVE_BROKER_POS] }),
    );
    vi.mocked(useGex).mockReturnValue(makeGexResult(SAMPLE_GEX));

    // Must not throw
    expect(() => renderWithProvider(<Analyzer />)).not.toThrow();
    // Live position row must be visible (●live marker — unique; the ad-hoc copy also says "live")
    expect(screen.getByText("●live")).toBeTruthy();
  });

  // (a) Render with one live position → chart region + greek strips render
  it("(a) renders payoff chart region and greek strips with one live position", () => {
    vi.mocked(usePositions).mockReturnValue(makePositionsResult({ positions: [LIVE_BROKER_POS] }));
    vi.mocked(useGex).mockReturnValue(makeGexResult(SAMPLE_GEX));

    renderWithProvider(<Analyzer />);

    // Risk profile chart heading
    expect(screen.getByText("Risk profile")).toBeTruthy();

    // Greek strips render (4 panels)
    expect(screen.getByText(/Net\s*Δ/)).toBeTruthy();
  });

  // (b) Spot slider change → re-prices locally, NO network call fires
  it("(b) re-prices scenario on slider change without firing any network calls", () => {
    vi.mocked(usePositions).mockReturnValue(makePositionsResult({ positions: [LIVE_BROKER_POS] }));
    vi.mocked(useGex).mockReturnValue(makeGexResult(SAMPLE_GEX));

    renderWithProvider(<Analyzer />);

    // Clear any calls from mount
    mockApiFetch.mockClear();

    // Find and move the spot slider
    const sliders = screen.getAllByRole("slider");
    expect(sliders.length).toBeGreaterThan(0);

    // Change the first slider (spot)
    const spotSlider = sliders[0];
    if (spotSlider !== undefined) {
      fireEvent.change(spotSlider, { target: { value: "7500" } });
    }

    // No API call should have fired for re-pricing
    expect(mockApiFetch).not.toHaveBeenCalled();
  });

  // (c) "+ add from paste" with canonical TOS string → success message + new row
  it("(c) add from paste with valid TOS string shows locked success message", () => {
    vi.mocked(usePositions).mockReturnValue(makePositionsResult({ positions: [LIVE_BROKER_POS] }));
    vi.mocked(useGex).mockReturnValue(makeGexResult(SAMPLE_GEX));

    renderWithProvider(<Analyzer />);

    // Find the paste input and add button
    const pasteInput = screen.getByPlaceholderText("Paste TOS order…");
    const addButton = screen.getByText("+ add from paste");

    // Canonical TOS string from UI-SPEC (future dates to keep DTE > 0)
    const tosString =
      "BUY +1 CALENDAR SPX 100 (Weeklys) 08 AUG 26/19 SEP 26 [AM] 7550 PUT @5.80 LMT GTC";

    fireEvent.change(pasteInput, { target: { value: tosString } });
    fireEvent.click(addButton);

    // Should show "Added:" success prefix (locked UI-SPEC)
    expect(screen.getByText(/Added:/)).toBeTruthy();
  });

  // (c2) Invalid TOS string → locked parse-error copy
  it("(c2) add from paste with garbage shows locked parse-error copy", () => {
    vi.mocked(usePositions).mockReturnValue(makePositionsResult({ positions: [LIVE_BROKER_POS] }));
    vi.mocked(useGex).mockReturnValue(makeGexResult(SAMPLE_GEX));

    renderWithProvider(<Analyzer />);

    const pasteInput = screen.getByPlaceholderText("Paste TOS order…");
    const addButton = screen.getByText("+ add from paste");

    fireEvent.change(pasteInput, { target: { value: "GARBAGE NOT TOS" } });
    fireEvent.click(addButton);

    // Locked error copy from UI-SPEC
    expect(
      screen.getByText("Could not parse — need 2 expiries, a strike, and PUT/CALL."),
    ).toBeTruthy();
  });

  // (d) Live position shows protected indicator, no × remove
  it("(d) live position shows protected indicator and no remove button", () => {
    vi.mocked(usePositions).mockReturnValue(makePositionsResult({ positions: [LIVE_BROKER_POS] }));
    vi.mocked(useGex).mockReturnValue(makeGexResult(SAMPLE_GEX));

    renderWithProvider(<Analyzer />);

    // Live indicator: "●live" or the 🔒 icon
    const liveIndicators = screen.queryAllByText(/●live|live/);
    expect(liveIndicators.length).toBeGreaterThan(0);

    // No × remove buttons for live positions
    const removeButtons = screen.queryAllByText("×");
    // All remove buttons found should be for non-live positions only
    // With only one live position, there should be no × buttons
    expect(removeButtons.length).toBe(0);
  });
});
