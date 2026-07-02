/**
 * Overview screen tests — the 3-section dashboard:
 *   1. Open positions table (+ net greeks + live overlay), 2. Market (live GEX + COT/FRED stubs),
 *   3. Book & system summary.
 * Market is mocked to a sentinel (its charts pull heavy deps); data hooks are mocked.
 *
 * Phase 12-07 additions (gap-closure STRM-01 + D-04):
 *   - useLiveStream mock placed before Overview import (vitest hoists all vi.mock calls)
 *   - LiveStatusBadge renders POLL by default; LIVE/STALE when stream active
 *   - .live-cell class applied to greek cells when liveTs is not null (STRM-01)
 *   - .live-cell.stale applied when status is 'stale' (Surface 2 color-dim, not opacity)
 */
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import type { StreamLiveGreekEvent } from "@morai/contracts";

// Phase 12-07: mock useLiveStream BEFORE Overview import (intent: no real EventSource)
vi.mock("../hooks/useLiveStream.ts", () => ({
  useLiveStream: vi.fn(() => ({
    greeks: new Map<string, StreamLiveGreekEvent>(),
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

vi.mock("../hooks/usePositions.ts", () => ({ usePositions: vi.fn() }));
vi.mock("../hooks/useGex.ts", () => ({ useGex: vi.fn(() => ({ data: { spot: 7381 } })) }));
vi.mock("../hooks/useStatus.ts", () => ({ useStatus: vi.fn(() => ({ data: undefined })) }));
vi.mock("../hooks/useCot.ts", () => ({ useCot: vi.fn(() => ({ data: undefined })) }));
vi.mock("./Market.tsx", () => ({ Market: (): React.ReactElement => <div data-testid="market-screen" /> }));

import { Overview } from "./Overview.tsx";
import { usePositions } from "../hooks/usePositions.ts";
import { useLiveStream } from "../hooks/useLiveStream.ts";

const mockUsePositions = vi.mocked(usePositions);
const mockUseLiveStream = vi.mocked(useLiveStream);

function setPositions(positions: unknown): void {
  // eslint-disable-next-line @typescript-eslint/consistent-type-assertions
  mockUsePositions.mockReturnValue({ data: { positions }, isPending: false } as unknown as ReturnType<typeof usePositions>);
}

/** Override the useLiveStream mock for live/stale overlay tests. */
function setLiveStream(
  status: "live" | "stale" | "reconnecting" | "poll",
  greeks: ReadonlyMap<string, StreamLiveGreekEvent>,
): void {
  mockUseLiveStream.mockReturnValue({
    greeks,
    status,
    lastTickAt: status !== "poll" ? new Date("2026-06-29T14:31:00Z") : null,
    subscribeAdHoc: vi.fn().mockResolvedValue(undefined),
  });
}

/** Fixture position: short 7425P on SPXW. */
const POS = {
  occSymbol: "SPXW  260807P07425000",
  putCall: "P" as const,
  longQty: 0,
  shortQty: 1,
  averagePrice: 127.0478,
  marketValue: -17875,
  underlyingSymbol: "$SPX",
};

/** A realistic live tick for the fixture position. */
function makeTick(): StreamLiveGreekEvent {
  return {
    occSymbol: POS.occSymbol,
    mark: 180.0,
    bid: 179.5,
    ask: 180.5,
    bsmIv: 0.22,
    bsmDelta: -0.55,
    bsmGamma: 0.003,
    bsmTheta: -0.18,
    bsmVega: 2.1,
    ts: "2026-06-29T14:31:00Z",
  };
}

describe("Overview screen", () => {
  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
    // Reset useLiveStream to default poll/empty-map state after each test
    mockUseLiveStream.mockReturnValue({
      greeks: new Map(),
      status: "poll",
      lastTickAt: null,
      subscribeAdHoc: vi.fn().mockResolvedValue(undefined),
    });
  });

  // ── Existing tests (unchanged assertions) ─────────────────────────────────────

  it("renders the three section headers", () => {
    setPositions([]);
    render(<Overview />);
    expect(screen.getByText("Open positions · greeks")).toBeDefined();
    expect(screen.getByText(/Market · what the big guys are doing/)).toBeDefined();
    expect(screen.getByText("Book & system")).toBeDefined();
  });

  it("renders the live COT card and keeps FRED as a 'needs feed' stub", () => {
    setPositions([]);
    render(<Overview />);
    // COT is now a wired card (Phase 13), not a stub — its heading is present.
    expect(screen.getByText(/CFTC COT/)).toBeDefined();
    // FRED remains the only "needs feed" stub until Phase 14.
    expect(screen.getByText("FRED macro")).toBeDefined();
    expect(screen.getAllByText("○ needs feed").length).toBe(1);
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

  // ── Phase 12-07: live overlay + badge tests ───────────────────────────────────

  it("renders a LiveStatusBadge showing POLL in the 'Open positions' section header when stream has no ticks", () => {
    setPositions([POS]);
    render(<Overview />);
    // Badge renders "POLL" when status is 'poll' (D-04 state machine)
    expect(screen.getByText("POLL")).toBeDefined();
  });

  it("no .live-cell class present on greek cells when liveGreeks Map is empty (static fallback)", () => {
    setPositions([POS]);
    const { container } = render(<Overview />);
    // With an empty greeks Map, liveTs is null → no live-cell class applied
    expect(container.querySelector(".live-cell")).toBeNull();
  });

  it("badge shows LIVE and .live-cell class applied when useLiveStream returns status live with a tick for the position", () => {
    setPositions([POS]);
    setLiveStream("live", new Map([[POS.occSymbol, makeTick()]]));
    const { container } = render(<Overview />);
    // Badge reflects live stream (Surface 3 — D-04)
    expect(screen.getByText("LIVE")).toBeDefined();
    // Greek cells carry live-cell class (STRM-01)
    expect(container.querySelector(".live-cell")).not.toBeNull();
  });

  it("badge shows STALE and cells carry both live-cell and stale classes when status is stale (Surface 2 color-dim, not opacity)", () => {
    setPositions([POS]);
    setLiveStream("stale", new Map([[POS.occSymbol, makeTick()]]));
    const { container } = render(<Overview />);
    // Badge reflects stale state
    expect(screen.getByText("STALE")).toBeDefined();
    // Both live-cell AND stale class present — .live-cell.stale dims by color (never opacity)
    expect(container.querySelector(".live-cell.stale")).not.toBeNull();
  });
});
