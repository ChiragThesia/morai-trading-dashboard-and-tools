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
import type { GexSnapshotEntry, StreamIndicesEvent } from "@morai/contracts";

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

function setLiveStream(
  status: "live" | "quiet" | "stalled",
  liveSpot: number | null,
  liveIndices: StreamIndicesEvent | null = null,
): void {
  mockUseLiveStream.mockReturnValue({
    greeks: new Map(),
    status,
    lastTickAt: null,
    isRth: null,
    hasReceivedFirstTick: false,
    isReconnecting: false,
    liveSpot,
    liveIndices,
    reconnectNow: vi.fn(),
    subscribeAdHoc: vi.fn().mockResolvedValue(undefined),
  });
}

// Deliberately distinct from any EOD macro fixture value — only the live path can pass.
const LIVE_INDICES: StreamIndicesEvent = {
  vix: 18.42,
  vvix: 101.3,
  vix9d: 17.9,
  vix3m: 19.6,
  ts: "2026-07-15T14:00:00.000Z",
};

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

  it("live indices: status 'live' -> displayVix/displayVvix come from the stream (2026-07-15)", () => {
    setLiveStream("live", LIVE_SPOT, LIVE_INDICES);

    const { result } = renderHook(() => useOverviewModel());

    expect(result.current.displayVix).toBe(18.42);
    expect(result.current.displayVvix).toBe(101.3);
  });

  it("quiet stream: displayVix/displayVvix fall back to the EOD macro values (null fixture -> null)", () => {
    setLiveStream("quiet", null, LIVE_INDICES);

    const { result } = renderHook(() => useOverviewModel());

    expect(result.current.displayVix).toBeNull();
    expect(result.current.displayVvix).toBeNull();
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

// ─── buildCalendarPosition — per-calendar tick consistency (2026-07-20 regression) ────
//
// A leg with no tick (expiry outside the chain-fetch window never gets observations)
// must not leave its sibling priced off a tick from a different instant/spot: the
// mixed pair broke the calendar's hedge cancellation and showed +$1.4k phantom T+0
// (BEs pushed ~40pts wide vs TOS). Tick IVs are trusted only when BOTH legs have
// ticks; otherwise BOTH legs calibrate from the broker REST marks (one instant).
import { buildCalendarPosition } from "./useOverviewModel.ts";
import type { CalendarGroup } from "../../lib/pair-calendars.ts";
import type { BrokerPositionResponse, StreamLiveGreekEvent } from "@morai/contracts";

const NOW = new Date("2026-07-20T15:00:00Z");

function calLeg(occSymbol: string, long: boolean, averagePrice: number, marketValue: number): BrokerPositionResponse {
  return {
    occSymbol,
    putCall: "P",
    longQty: long ? 1 : 0,
    shortQty: long ? 0 : 1,
    averagePrice,
    marketValue,
    underlyingSymbol: "$SPX",
  };
}

const FRONT = calLeg("SPXW  261016P07450000", false, 159.1678, -18605);
const BACK = calLeg("SPXW  261130P07450000", true, 206.8422, 23330);

const CAL: CalendarGroup = {
  key: "$SPX|7450|P",
  underlyingSymbol: "$SPX",
  strike: 7450,
  optionType: "P",
  front: FRONT,
  back: BACK,
  netUnreal: null,
  dteFront: 88,
  dteBack: 133,
};

function tickFor(occSymbol: string, bsmIv: number): StreamLiveGreekEvent {
  return {
    occSymbol,
    mark: 184.17,
    bid: 184,
    ask: 184.4,
    bsmIv,
    bsmDelta: -0.4,
    bsmGamma: 0.002,
    bsmTheta: -0.9,
    bsmVega: 9.1,
    ts: "2026-07-20T14:59:00Z",
  };
}

describe("buildCalendarPosition — per-calendar tick consistency", () => {
  const SPOT = 7474.6;

  it("one leg ticked, sibling not → BOTH legs ignore ticks and calibrate from broker marks", () => {
    const frontOnly = new Map([[FRONT.occSymbol, tickFor(FRONT.occSymbol, 0.31)]]);
    const withTicks = buildCalendarPosition(CAL, SPOT, frontOnly, NOW, true, undefined);
    const restOnly = buildCalendarPosition(CAL, SPOT, new Map(), NOW, true, undefined);

    expect(withTicks.position.frontIv).not.toBeCloseTo(0.31, 6);
    expect(withTicks.position.frontIv).toBeCloseTo(restOnly.position.frontIv, 10);
    expect(withTicks.position.backIv).toBeCloseTo(restOnly.position.backIv, 10);
    expect(withTicks.position.frontIvStatus).toBe("ok");
    expect(withTicks.position.backIvStatus).toBe("ok");
  });

  // Tick IVs are solved SERVER-side under the server's own (rate, q, spot, T) — inputs
  // the client cannot reproduce — so repricing them client-side breaks the mark→IV→mark
  // identity exactly like the carry bug below. The payoff curve therefore NEVER uses
  // tick IVs: every leg calibrates from the broker REST marks (self-consistent loop,
  // ≤30s stale via the positions poll). Ticks still drive row greeks and live badges.
  it("both legs ticked → curve IVs still calibrate from broker marks, never tick IVs", () => {
    const both = new Map([
      [FRONT.occSymbol, tickFor(FRONT.occSymbol, 0.31)],
      [BACK.occSymbol, tickFor(BACK.occSymbol, 0.29)],
    ]);
    const withTicks = buildCalendarPosition(CAL, SPOT, both, NOW, true, undefined);
    const restOnly = buildCalendarPosition(CAL, SPOT, new Map(), NOW, true, undefined);

    expect(withTicks.position.frontIv).toBeCloseTo(restOnly.position.frontIv, 10);
    expect(withTicks.position.backIv).toBeCloseTo(restOnly.position.backIv, 10);
    expect(withTicks.position.frontIv).not.toBeCloseTo(0.31, 6);
  });
});

// ─── buildCalendarPosition — calibration/repricing carry identity (2026-07-20 #2) ─────
//
// resolveLegIv inverted marks with the flat DEFAULT_RATE/DEFAULT_DIV while the scenario
// engine repriced with each leg's parity-implied carry from the GEX snapshot. Inverting
// at one (r,q) and repricing at another breaks the mark→IV→mark identity: the whole T+0
// curve floated ~+$265 at spot (site showed +$194 while broker truth was −$20) and BEs
// widened ~45pts. Calibration must use the SAME carry the engine prices with.
import { repriceScenario as repriceForCarryTest } from "../../lib/scenario-engine.ts";

describe("buildCalendarPosition — carry identity", () => {
  const SPOT2 = 7479.1;
  const GEX_WITH_CARRY: GexSnapshotEntry = {
    ...GEX_FIXTURE,
    impliedCarry: [
      { expiration: "2026-10-16", rate: 0.038372777777777776, divYield: 0.0049856229554864975 },
    ],
  };

  it("T+0 book P&L at spot reproduces the broker-mark P&L when parity carry is present", () => {
    // Broker-mark truth: (backMark − frontMark − entryNet) × 100
    const frontMark = 185.5; // |−18550| / 100
    const backMark = 232.75; // 23275 / 100
    const entryNet = 206.8422 - 159.1678;
    const truth = (backMark - frontMark - entryNet) * 100;

    const cal: CalendarGroup = {
      ...CAL,
      front: calLeg("SPXW  261016P07450000", false, 159.1678, -18550),
      back: calLeg("SPXW  261130P07450000", true, 206.8422, 23275),
    };
    const built = buildCalendarPosition(cal, SPOT2, new Map(), NOW, true, GEX_WITH_CARRY);
    const r = repriceForCarryTest([built.position], {
      spot: SPOT2,
      daysForward: 0,
      ivShift: 0,
      rate: 0.045,
      divYield: 0.013,
    });
    const atSpot = r.payoffCurve.reduce((b, p) =>
      Math.abs(p.spot - SPOT2) < Math.abs(b.spot - SPOT2) ? p : b,
    );
    // Within grid-interpolation + settlement-fraction noise — nowhere near the +$265 float.
    expect(Math.abs(atSpot.pl - truth)).toBeLessThan(60);
  });
});
