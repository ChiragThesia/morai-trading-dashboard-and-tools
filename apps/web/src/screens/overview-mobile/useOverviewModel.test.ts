/**
 * useOverviewModel.test.ts — TDD suite for the live-aware spot seam (Phase 38 LIVE-04).
 *
 * Behaviors under test:
 *   1. Live branch: liveStatus "live" + a non-round liveSpot -> model.spot AND
 *      model.displaySpot both equal liveSpot (never the EOD gex.spot, never 5800).
 *   2. Fallback branch: liveStatus "quiet" -> model.spot AND model.displaySpot both
 *      equal gex.spot (the 30-min snapshot, unchanged behavior).
 *   3. Cold-start branch: gex undefined -> model.spot falls back to 5800 (engine-only
 *      default), but model.displaySpot is null (never the 5800 engine fallback —
 *      honest "—" state for the header/hero chip, catch #26).
 *
 * Hooks are mocked (renderHook, no screen render) — mirrors Overview.test.tsx's
 * vi.mock blocks so the model resolves without a QueryClientProvider.
 */
import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import { renderHook, cleanup } from "@testing-library/react";
import type { UseQueryResult } from "@tanstack/react-query";
import type { GexSnapshotEntry } from "@morai/contracts";

vi.mock("../../hooks/useLiveStream.ts", () => ({
  useLiveStream: vi.fn(() => ({
    greeks: new Map(),
    status: "quiet" as const,
    lastTickAt: null,
    isRth: null,
    hasReceivedFirstTick: false,
    isReconnecting: false,
    liveSpot: null,
    liveIndices: null,
    reconnectNow: vi.fn(),
    subscribeAdHoc: vi.fn().mockResolvedValue(undefined),
  })),
}));

vi.mock("../../hooks/usePositions.ts", () => ({
  usePositions: vi.fn(() => ({ data: undefined, isPending: false })),
}));
vi.mock("../../hooks/useGex.ts", () => ({ useGex: vi.fn(() => ({ data: undefined })) }));
vi.mock("../../hooks/useCot.ts", () => ({ useCot: vi.fn(() => ({ data: undefined })) }));
vi.mock("../../hooks/useMacro.ts", () => ({
  useMacro: vi.fn(() => ({ data: undefined, isPending: false })),
}));
vi.mock("../../hooks/useExits.ts", () => ({
  useExits: vi.fn(() => ({ data: null, isPending: false, isError: false, refetch: vi.fn() })),
}));

import { useOverviewModel } from "./useOverviewModel.ts";
import { useLiveStream } from "../../hooks/useLiveStream.ts";
import { useGex } from "../../hooks/useGex.ts";

const mockUseLiveStream = vi.mocked(useLiveStream);
const mockUseGex = vi.mocked(useGex);

// Minimal-but-type-complete GexSnapshotEntry fixture (mirrors Overview.test.tsx's GEX_FIXTURE).
const GEX_FIXTURE: GexSnapshotEntry = {
  spot: 7381.12,
  flip: 7350,
  callWall: 7450,
  putWall: 7300,
  netGammaAtSpot: 12.5,
  profile: [],
  strikes: [],
  byExpiry: [{ date: "2026-06-29", gex: -9.8 }],
  nearTerm: null,
  impliedCarry: null,
  computedAt: "2026-06-29T14:00:00.000Z",
};

// Full UseQueryResult shape (mirrors JournalContainer.test.tsx's makeCalendarsResult) —
// mockUseGex.mockReturnValue is checked against the real useGex() return type, which
// (built on useQuery) is a discriminated union that a partial { data } object can't satisfy.
function makeGexResult(data: GexSnapshotEntry | undefined): UseQueryResult<GexSnapshotEntry, Error> {
  const common = {
    error: null,
    isLoadingError: false,
    isRefetchError: false,
    isStale: false,
    isFetched: true,
    isFetchedAfterMount: true,
    isFetching: false,
    isPlaceholderData: false,
    isRefetching: false,
    failureCount: 0,
    failureReason: null,
    errorUpdatedAt: 0,
    errorUpdateCount: 0,
    dataUpdatedAt: Date.now(),
    fetchStatus: "idle" as const,
    isPaused: false,
    isEnabled: true,
    refetch: vi.fn(),
  } as const;
  if (data === undefined) {
    return {
      ...common,
      data: undefined,
      isLoading: true,
      isPending: true,
      isSuccess: false,
      isError: false,
      isInitialLoading: true,
      status: "pending",
      // .promise is typed Promise<TData> even in the pending state (no TData exists yet
      // here) — a never-resolving placeholder satisfies the type without a cast.
      promise: new Promise<GexSnapshotEntry>(() => undefined),
    };
  }
  return {
    ...common,
    data,
    isLoading: false,
    isPending: false,
    isSuccess: true,
    isError: false,
    isInitialLoading: false,
    status: "success",
    promise: Promise.resolve(data),
  };
}

// Deliberately distinct from GEX_FIXTURE.spot (7381.12) and the 5800 engine default —
// a test can only pass on the real live path (catch #20).
const LIVE_SPOT = 7402.875;

function setLiveStream(status: "live" | "quiet" | "stalled", liveSpot: number | null): void {
  mockUseLiveStream.mockReturnValue({
    greeks: new Map(),
    status,
    lastTickAt: null,
    isRth: null,
    hasReceivedFirstTick: false,
    isReconnecting: false,
    liveSpot,
    liveIndices: null,
    reconnectNow: vi.fn(),
    subscribeAdHoc: vi.fn().mockResolvedValue(undefined),
  });
}

describe("useOverviewModel — live-aware spot seam (LIVE-04)", () => {
  beforeEach(() => {
    setLiveStream("quiet", null);
    mockUseGex.mockReturnValue(makeGexResult(GEX_FIXTURE));
  });

  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it("live branch: status 'live' + non-round liveSpot -> spot AND displaySpot equal liveSpot", () => {
    setLiveStream("live", LIVE_SPOT);

    const { result } = renderHook(() => useOverviewModel());

    expect(result.current.spot).toBe(LIVE_SPOT);
    expect(result.current.displaySpot).toBe(LIVE_SPOT);
  });

  it("fallback branch: status 'quiet' -> spot AND displaySpot equal gex.spot", () => {
    setLiveStream("quiet", null);

    const { result } = renderHook(() => useOverviewModel());

    expect(result.current.spot).toBe(GEX_FIXTURE.spot);
    expect(result.current.displaySpot).toBe(GEX_FIXTURE.spot);
  });

  it("cold-start branch: gex undefined -> spot falls back to 5800, displaySpot is null (never 5800)", () => {
    setLiveStream("quiet", null);
    mockUseGex.mockReturnValue(makeGexResult(undefined));

    const { result } = renderHook(() => useOverviewModel());

    expect(result.current.spot).toBe(5800);
    expect(result.current.displaySpot).toBeNull();
  });

  it("a non-null liveSpot while status is 'quiet' does NOT drive spot/displaySpot (live gate, not just non-null, catch #26)", () => {
    setLiveStream("quiet", LIVE_SPOT);

    const { result } = renderHook(() => useOverviewModel());

    expect(result.current.spot).toBe(GEX_FIXTURE.spot);
    expect(result.current.displaySpot).toBe(GEX_FIXTURE.spot);
  });

  it("exposes liveSpot and liveIndices on the model", () => {
    setLiveStream("live", LIVE_SPOT);

    const { result } = renderHook(() => useOverviewModel());

    expect(result.current.liveSpot).toBe(LIVE_SPOT);
    expect(result.current.liveIndices).toBeNull();
  });
});
