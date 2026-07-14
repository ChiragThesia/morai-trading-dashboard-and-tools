/**
 * useAnalyzerModel.test.ts — TDD suite for the live-aware spot seam (Phase 41, AUI-07/D-07).
 *
 * Direct port of useOverviewModel.test.ts's live-seam suite (Phase 38 LIVE-04) onto the
 * Analyzer's snapshot-based spot: same double-gate law (status==="live" && liveSpot!==null),
 * same catch #26 regression (a non-null liveSpot while quiet/stalled must NOT drive spot —
 * a frozen live value is never shown as fresh).
 *
 * Hooks are mocked (renderHook, no screen render) — usePicker/useRepullChains/
 * useAnalyzeCalendar mocks mirror Analyzer.test.tsx's harness (lines 58-81) so the hook
 * resolves without a QueryClientProvider.
 */
import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import { renderHook, cleanup } from "@testing-library/react";
import { pickerSnapshotFixture } from "@morai/contracts";
import type { PickerSnapshotResponse, AnalyzeAdHocCalendarResponse } from "@morai/contracts";

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

const { mockUsePicker } = vi.hoisted(() => ({ mockUsePicker: vi.fn() }));
vi.mock("../../hooks/usePicker.ts", () => ({ usePicker: mockUsePicker }));

const { mockRepull } = vi.hoisted(() => ({
  mockRepull: vi.fn(() => ({ mutate: vi.fn(), isPending: false, isSuccess: false, isError: false })),
}));
vi.mock("../../hooks/useRepullChains.ts", () => ({ useRepullChains: mockRepull }));

const { mockAnalyzeCalendarMutateAsync } = vi.hoisted(() => ({
  mockAnalyzeCalendarMutateAsync: vi.fn(
    (): Promise<AnalyzeAdHocCalendarResponse> =>
      Promise.resolve({ scored: false, candidate: null, reason: "mocked" }),
  ),
}));
vi.mock("../../hooks/useAnalyzeCalendar.ts", () => ({
  useAnalyzeCalendar: () => ({ mutateAsync: mockAnalyzeCalendarMutateAsync }),
}));

import { useAnalyzerModel } from "./useAnalyzerModel.ts";
import { useLiveStream } from "../../hooks/useLiveStream.ts";

const mockUseLiveStream = vi.mocked(useLiveStream);

function mockUsePickerReturn(data: PickerSnapshotResponse | null): void {
  mockUsePicker.mockReturnValue({ data, isPending: false, isError: false, refetch: vi.fn() });
}

// Deliberately distinct from the fixture's spot (7498.85) and the 0 cold-start fallback
// (catch #20 — a test that would also pass on a stale/fallback value proves nothing).
const LIVE_SPOT = 7521.4;

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

describe("useAnalyzerModel — live-aware spot seam (AUI-07, D-07 port of LIVE-04)", () => {
  beforeEach(() => {
    setLiveStream("quiet", null);
    mockUsePickerReturn(pickerSnapshotFixture);
  });

  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it("live branch: status 'live' + non-null liveSpot -> model.spot equals liveSpot (never snapshot.spot)", () => {
    setLiveStream("live", LIVE_SPOT);

    const { result } = renderHook(() => useAnalyzerModel());

    expect(result.current.spot).toBe(LIVE_SPOT);
  });

  it("quiet branch: status 'quiet' -> model.spot equals snapshot.spot (unchanged 30-min behavior)", () => {
    setLiveStream("quiet", null);

    const { result } = renderHook(() => useAnalyzerModel());

    expect(result.current.spot).toBe(pickerSnapshotFixture.spot);
  });

  it("a non-null liveSpot while stalled does NOT drive spot (live gate, not just non-null — catch #26)", () => {
    setLiveStream("stalled", LIVE_SPOT);

    const { result } = renderHook(() => useAnalyzerModel());

    expect(result.current.spot).toBe(pickerSnapshotFixture.spot);
  });

  it("cold-start: no snapshot + not live -> model.spot falls back to 0 (existing behavior preserved)", () => {
    setLiveStream("quiet", null);
    mockUsePickerReturn(null);

    const { result } = renderHook(() => useAnalyzerModel());

    expect(result.current.spot).toBe(0);
  });

  it("exposes liveBadgeProps with the 6 fields LiveStatusBadge/useOverviewModel use", () => {
    setLiveStream("live", LIVE_SPOT);

    const { result } = renderHook(() => useAnalyzerModel());

    expect(result.current.liveBadgeProps.status).toBe("live");
    expect(result.current.liveBadgeProps.lastTickAt).toBeNull();
    expect(result.current.liveBadgeProps.isRth).toBeNull();
    expect(result.current.liveBadgeProps.hasReceivedFirstTick).toBe(false);
    expect(result.current.liveBadgeProps.isReconnecting).toBe(false);
    expect(typeof result.current.liveBadgeProps.onReconnect).toBe("function");
  });
});
