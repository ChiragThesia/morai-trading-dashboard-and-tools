/**
 * Overview screen tests — TOS-dock layout (Phase 17 redesign):
 *   1. Pill header, 2. payoff hero + docked positions table (left) / GEX rail (right),
 *   3. Positioning & macro detail (CotCard + MacroCard), 4. Book & system.
 * Data hooks are mocked; GEX rail uses a full GexSnapshotEntry fixture (GAMMAProfile/GexBars
 * need profile/strikes/computedAt, not just spot).
 *
 * Phase 12-07 additions (gap-closure STRM-01 + D-04), preserved through the 17-04 rewrite:
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

// Full GexSnapshotEntry fixture — 17-04's GEX rail (GammaProfile/GexBars/key levels/staleness
// badge) reads profile/strikes/computedAt/callWall/putWall/flip, not just spot.
const GEX_FIXTURE = {
  spot: 7381.12,
  flip: 7350,
  callWall: 7450,
  putWall: 7300,
  netGammaAtSpot: 12.5,
  profile: [
    { spot: 7300, gamma: -10 },
    { spot: 7350, gamma: 0 },
    { spot: 7400, gamma: 15 },
    { spot: 7450, gamma: 20 },
  ],
  strikes: [
    { k: 7300, gex: -1_000_000_000, coi: 100, poi: 200, vol: 50 },
    { k: 7400, gex: 1_000_000_000, coi: 150, poi: 90, vol: 80 },
  ],
  byExpiry: [],
  computedAt: "2026-06-29T14:00:00.000Z",
};

vi.mock("../hooks/usePositions.ts", () => ({ usePositions: vi.fn() }));
vi.mock("../hooks/useGex.ts", () => ({ useGex: vi.fn(() => ({ data: GEX_FIXTURE })) }));
vi.mock("../hooks/useStatus.ts", () => ({ useStatus: vi.fn(() => ({ data: undefined })) }));
vi.mock("../hooks/useCot.ts", () => ({ useCot: vi.fn(() => ({ data: undefined })) }));
vi.mock("../hooks/useMacro.ts", () => ({ useMacro: vi.fn(() => ({ data: undefined, isPending: false })) }));

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

  it("renders the TOS-dock section headers", () => {
    setPositions([]);
    render(<Overview />);
    expect(screen.getByText("Risk profile — combined book")).toBeDefined();
    // "Positions" also appears as a BookSummary Stat label — assert the docked-table
    // panel heading (an <h3>) specifically.
    expect(screen.getByRole("heading", { name: "Positions" })).toBeDefined();
    expect(screen.getByText("Dealer γ profile")).toBeDefined();
    expect(screen.getByText("GEX by strike")).toBeDefined();
    expect(screen.getByText("Key levels")).toBeDefined();
    expect(screen.getByText("Net book greeks")).toBeDefined();
    expect(screen.getByText("Book & system")).toBeDefined();
  });

  it("renders the live COT card and the live MacroCard — no more 'FRED macro' stub", () => {
    setPositions([]);
    render(<Overview />);
    // COT is a wired card (Phase 13) — its heading is present.
    expect(screen.getByText(/CFTC COT/)).toBeDefined();
    // FRED macro is now a wired card (Phase 14, D-12) — the "needs feed" stub is gone.
    expect(screen.queryByText("FRED macro")).toBeNull();
    expect(screen.queryByText("○ needs feed")).toBeNull();
    expect(screen.getByTestId("macro-empty")).toBeDefined();
  });

  it("renders the payoff hero risk profile chart (visx SVG) for the combined book", () => {
    setPositions([]);
    const { container } = render(<Overview />);
    expect(container.querySelector('svg[aria-label="Risk profile payoff chart"]')).not.toBeNull();
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
