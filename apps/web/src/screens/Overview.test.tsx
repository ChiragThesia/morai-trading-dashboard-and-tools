/**
 * Overview screen tests — TOS-dock layout (Phase 17 redesign):
 *   1. Pill header, 2. payoff hero + docked positions table (left) / GEX rail (right),
 *   3. Positioning & macro detail (CotCard + RegimeBoard's merged "Market regime"
 *      panel — absorbs the former standalone FRED macro card), 4. Book & system.
 * Data hooks are mocked; GEX rail uses a full GexSnapshotEntry fixture (GAMMAProfile/GexBars
 * need profile/strikes/computedAt, not just spot).
 *
 * Phase 12-07 additions (gap-closure STRM-01 + D-04), preserved through the 17-04 rewrite,
 * updated to the WATCH-01 3-state model (Phase 20 D-01):
 *   - useLiveStream mock placed before Overview import (vitest hoists all vi.mock calls)
 *   - LiveStatusBadge renders QUIET by default; LIVE/STALLED when stream active
 *   - .live-cell class applied to greek cells when liveTs is not null (STRM-01)
 *   - .live-cell.stale applied when status is 'stalled' (Surface 2 color-dim, not opacity)
 */
import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import { render, screen, cleanup, fireEvent, within } from "@testing-library/react";
import { ok, err, assertDefined } from "@morai/shared";
import type { StreamLiveGreekEvent, ExitsResponse, GexSnapshotResponse } from "@morai/contracts";
import type { UseQueryResult } from "@tanstack/react-query";
import { toDateInputValue } from "../lib/date-projection.ts";
import { pairPositionsIntoCalendars, bookUnrealizedPnl } from "../lib/pair-calendars.ts";
import { resolveLivePositionRow } from "../lib/live-position-greeks.ts";
import { usd, signedUsd } from "../lib/position-format.ts";
import { DEFAULT_RATE, DEFAULT_DIV } from "../lib/resolve-carry.ts";

// 17.1-03 (OVW-06): spy-wrap PayoffChart so tests can inspect the exact curve/signature
// props Overview hands it — the real component still renders (importOriginal), this only
// records calls. Needed to prove a checkbox toggle reaches BOTH curves, not just the total.
vi.mock("../components/charts/PayoffChart.tsx", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../components/charts/PayoffChart.tsx")>();
  return { ...actual, PayoffChart: vi.fn(actual.PayoffChart) };
});

// Phase 12-07: mock useLiveStream BEFORE Overview import (intent: no real EventSource)
vi.mock("../hooks/useLiveStream.ts", () => ({
  useLiveStream: vi.fn(() => ({
    greeks: new Map<string, StreamLiveGreekEvent>(),
    status: "quiet" as const,
    lastTickAt: null,
    isRth: null,
    hasReceivedFirstTick: false,
    isReconnecting: false,
    reconnectNow: vi.fn(),
    subscribeAdHoc: vi.fn().mockResolvedValue(undefined),
  })),
  StreamMintError: class StreamMintError extends Error {
    constructor(status: number) { super(String(status)); this.name = "StreamMintError"; }
  },
  StreamSubscribeError: class StreamSubscribeError extends Error {
    constructor(status: number) { super(String(status)); this.name = "StreamSubscribeError"; }
  },
  STALL_THRESHOLD_MS: 20_000,
}));

// 17-04 Task 2: mock resolveLegIv so calibration outcomes (ok/non-convergent/no-price) are
// deterministic per test — the wrapper's own math is already covered by 17-01's tests;
// this file tests Overview's WIRING of the Result into badges/exclusion/curves.
vi.mock("../lib/iv-calibration.ts", () => ({ resolveLegIv: vi.fn() }));

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
    { k: 7300, gex: -1.0, coi: 100, poi: 200, vol: 50 },
    { k: 7400, gex: 1.0, coi: 150, poi: 90, vol: 80 },
  ],
  byExpiry: [{ date: "2026-06-29", gex: -9.8 }],
  nearTerm: { callWall: 7420, putWall: 7320, flip: 7355 },
  computedAt: "2026-06-29T14:00:00.000Z",
};

vi.mock("../hooks/usePositions.ts", () => ({ usePositions: vi.fn() }));
vi.mock("../hooks/useGex.ts", () => ({ useGex: vi.fn(() => ({ data: GEX_FIXTURE })) }));
vi.mock("../hooks/useStatus.ts", () => ({ useStatus: vi.fn(() => ({ data: undefined })) }));
vi.mock("../hooks/useCot.ts", () => ({ useCot: vi.fn(() => ({ data: undefined })) }));
vi.mock("../hooks/useMacro.ts", () => ({ useMacro: vi.fn(() => ({ data: undefined, isPending: false })) }));
// Phase 24: RegimeBoard's own hook — mocked so mounting the board doesn't require a
// QueryClientProvider in this file's plain render() calls (matches useMacro's pattern).
vi.mock("../hooks/useRegimeBoard.ts", () => ({
  useRegimeBoard: vi.fn(() => ({ data: undefined, isPending: false, isError: false })),
}));
// 28-06: RegimeBoard also reads usePicker() for its entry-gate tile — mocked the same way
// (no snapshot -> no gate tile, T-24-09 "never fabricate" precedent) so this file's plain
// render() calls keep working without a QueryClientProvider.
vi.mock("../hooks/usePicker.ts", () => ({
  usePicker: vi.fn(() => ({ data: undefined, isPending: false, isError: false })),
}));

// Held positions + exit rules (moved from Analyzer, 26-06-PLAN.md): mocked the same way as
// usePicker — no network needed. Defaults to the cold-start shape (data: null) so every
// pre-existing test in this file is unaffected; the held-positions/exit-rules describe block
// below overrides per test via setExitsReturn.
vi.mock("../hooks/useExits.ts", () => ({
  useExits: vi.fn(() => ({ data: null, isPending: false, isError: false, refetch: vi.fn() })),
}));

import { Overview, formatExpiryCell, buildCalendarPosition } from "./Overview.tsx";
import { usePositions } from "../hooks/usePositions.ts";
import { useLiveStream } from "../hooks/useLiveStream.ts";
import { useExits } from "../hooks/useExits.ts";
import { resolveLegIv } from "../lib/iv-calibration.ts";
import { PayoffChart } from "../components/charts/PayoffChart.tsx";

const mockUsePositions = vi.mocked(usePositions);
const mockUseLiveStream = vi.mocked(useLiveStream);
const mockUseExits = vi.mocked(useExits);
const mockResolveLegIv = vi.mocked(resolveLegIv);
const mockPayoffChart = vi.mocked(PayoffChart);

type MockExitsResult = Pick<UseQueryResult<ExitsResponse | null>, "data" | "isPending" | "isError" | "refetch">;

function setExitsReturn(overrides: Partial<MockExitsResult>): void {
  mockUseExits.mockReturnValue({
    data: null,
    isPending: false,
    isError: false,
    refetch: vi.fn(),
    ...overrides,
  });
}

/** Props of the most recent PayoffChart render (throws if it never rendered). */
function latestPayoffChartProps(): import("../components/charts/PayoffChart.tsx").PayoffChartProps {
  const call = mockPayoffChart.mock.calls.at(-1);
  assertDefined(call, "PayoffChart rendered at least once");
  return call[0];
}

function setPositions(positions: unknown): void {
  // eslint-disable-next-line @typescript-eslint/consistent-type-assertions
  mockUsePositions.mockReturnValue({ data: { positions }, isPending: false } as unknown as ReturnType<typeof usePositions>);
}

/** Override the useLiveStream mock for live/stalled overlay tests. */
function setLiveStream(
  status: "live" | "quiet" | "stalled",
  greeks: ReadonlyMap<string, StreamLiveGreekEvent>,
): void {
  mockUseLiveStream.mockReturnValue({
    greeks,
    status,
    lastTickAt: status !== "quiet" ? new Date("2026-06-29T14:31:00Z") : null,
    isRth: status !== "quiet",
    hasReceivedFirstTick: status !== "quiet",
    isReconnecting: false,
    reconnectNow: vi.fn(),
    subscribeAdHoc: vi.fn().mockResolvedValue(undefined),
  });
}

/**
 * 35.1 D-10: desktop matchMedia stub (the MarketRail.test.tsx pattern) — jsdom has no
 * matchMedia, so useIsDesktop() reports mobile by default and Overview mounts the mobile
 * tree. Pre-existing desktop-tree describes install this in beforeEach to keep exercising
 * OverviewDesktop byte-identically; each installing describe deletes it in afterEach via
 * `Reflect.deleteProperty(window, "matchMedia")`.
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

/** Calendar pair fixture: short 7425P front (near expiry) / long 7425P back (far expiry). */
const CAL_FRONT = {
  occSymbol: "SPXW  301120P07425000",
  putCall: "P" as const,
  longQty: 0,
  shortQty: 1,
  averagePrice: 50,
  marketValue: -5000,
  underlyingSymbol: "$SPX",
};
const CAL_BACK = {
  occSymbol: "SPXW  301130P07425000",
  putCall: "P" as const,
  longQty: 1,
  shortQty: 0,
  averagePrice: 60,
  marketValue: 6000,
  underlyingSymbol: "$SPX",
};
/** Matches pair-calendars.ts's key format: `${underlyingSymbol}|${strike}|${type}`. */
const CAL_ROW_KEY = "$SPX|7425|P";

/** A pair of calendars at widely-different strikes (D-01, Phase 30) — proves the combined-book
 *  domain brackets a multi-strike book rather than clipping to a single candidate's tent
 *  (Pitfall 4: computePayoffDomain must take the FULL positions list). */
const CAL3_FRONT = {
  occSymbol: "SPXW  301120P07000000",
  putCall: "P" as const,
  longQty: 0,
  shortQty: 1,
  averagePrice: 40,
  marketValue: -4000,
  underlyingSymbol: "$SPX",
};
const CAL3_BACK = {
  occSymbol: "SPXW  301130P07000000",
  putCall: "P" as const,
  longQty: 1,
  shortQty: 0,
  averagePrice: 50,
  marketValue: 5000,
  underlyingSymbol: "$SPX",
};
const CAL4_FRONT = {
  occSymbol: "SPXW  301120P07600000",
  putCall: "P" as const,
  longQty: 0,
  shortQty: 1,
  averagePrice: 55,
  marketValue: -5500,
  underlyingSymbol: "$SPX",
};
const CAL4_BACK = {
  occSymbol: "SPXW  301130P07600000",
  putCall: "P" as const,
  longQty: 1,
  shortQty: 0,
  averagePrice: 65,
  marketValue: 6500,
  underlyingSymbol: "$SPX",
};

/** A second, distinct calendar pair fixture (different strike) — used to prove that
 *  excluding ONE calendar leaves the OTHER's contribution on the chart curves (OVW-06). */
const CAL2_FRONT = {
  occSymbol: "SPXW  301120P07500000",
  putCall: "P" as const,
  longQty: 0,
  shortQty: 1,
  averagePrice: 45,
  marketValue: -4500,
  underlyingSymbol: "$SPX",
};
const CAL2_BACK = {
  occSymbol: "SPXW  301130P07500000",
  putCall: "P" as const,
  longQty: 1,
  shortQty: 0,
  averagePrice: 55,
  marketValue: 5500,
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

// 26-06 (moved from Analyzer): a distinct-timestamp exitsResponse fixture covering every
// verdict/severity/indicative/changed/roll combination the held-positions panel renders. No
// packages/contracts fixture exists for this response shape — inline, mirroring this file's
// own local GEX_FIXTURE convention above.
const EXITS_FIXTURE: ExitsResponse = {
  asOf: "2026-07-09",
  observedAt: "2026-07-09T14:30:00.000Z",
  marketSession: "rth",
  positions: [
    {
      calendarId: "cal-hold",
      name: "SPX 18SEP/14AUG 7425P",
      strike: 7425,
      optionType: "P",
      verdict: "HOLD",
      rung: null,
      ruleId: "hold",
      metric: { name: "pnlPct", value: 0.02, threshold: 0 },
      indicative: false,
      changed: false,
      escalate: false,
      pnlPct: 0.02,
      basis: { openNetDebit: 480, netMark: 490 },
      roll: null,
    },
    {
      calendarId: "cal-take",
      name: "SPX 18SEP/14AUG 7450P",
      strike: 7450,
      optionType: "P",
      verdict: "TAKE",
      rung: "+10%",
      ruleId: "take",
      metric: { name: "pnlPct", value: 0.11, threshold: 0.1 },
      indicative: false,
      changed: true,
      escalate: false,
      pnlPct: 0.11,
      basis: { openNetDebit: 500, netMark: 555 },
      roll: null,
    },
    {
      calendarId: "cal-stop",
      name: "SPX 18SEP/14AUG 7400P",
      strike: 7400,
      optionType: "P",
      verdict: "STOP",
      rung: "-25%",
      ruleId: "stop",
      metric: { name: "pnlPct", value: -0.261, threshold: -0.25 },
      indicative: false,
      changed: false,
      escalate: true,
      pnlPct: -0.261,
      basis: { openNetDebit: 500, netMark: 369.5 },
      roll: null,
    },
    {
      calendarId: "cal-exit",
      name: "SPX 21AUG/14AUG 7500P",
      strike: 7500,
      optionType: "P",
      verdict: "EXIT_PRE_EVENT",
      rung: null,
      ruleId: "evt",
      metric: { name: "daysToEvent", value: 2, threshold: 3 },
      indicative: false,
      changed: false,
      escalate: true,
      pnlPct: 0.03,
      basis: { openNetDebit: 400, netMark: 412 },
      roll: null,
    },
    {
      calendarId: "cal-indicative",
      name: "SPX 18SEP/14AUG 7350P",
      strike: 7350,
      optionType: "P",
      verdict: "STOP",
      rung: "-50%",
      ruleId: "stop",
      metric: { name: "pnlPct", value: -0.55, threshold: -0.5 },
      indicative: true,
      changed: false,
      escalate: false,
      pnlPct: -0.55,
      basis: { openNetDebit: 400, netMark: 180 },
      roll: null,
    },
    {
      calendarId: "cal-roll",
      name: "SPX 28AUG/21AUG 7420P",
      strike: 7420,
      optionType: "P",
      verdict: "ROLL",
      rung: null,
      ruleId: "roll",
      metric: { name: "dteFront", value: 10, threshold: 14 },
      indicative: false,
      changed: false,
      escalate: false,
      pnlPct: 0.04,
      basis: { openNetDebit: 420, netMark: 437 },
      roll: { suggestedFrontExpiry: "2026-09-11", estNewFrontCredit: 410 },
    },
  ],
  ruleSet: [
    { id: "stop", kind: "trigger", rationale: "Capital preservation is non-negotiable." },
    { id: "evt", kind: "trigger", rationale: "A fixed calendar date, not a noise-driven trigger." },
    { id: "gamma", kind: "trigger", rationale: "Pin/whipsaw risk in the final DTE window." },
    { id: "term", kind: "trigger", rationale: "Front-back IV inversion means the edge is gone." },
    { id: "take", kind: "profit-take", rationale: "Profit-taking is patient, evaluated last." },
    { id: "roll", kind: "roll", rationale: "A constructive continuation, evaluated only once nothing urgent fired." },
    { id: "hold", kind: "hold", rationale: "Default verdict when no other rule fired." },
  ],
};

describe("Overview screen", () => {
  // 35.1 D-10: every pre-existing describe in this file asserts desktop-tree output —
  // the stub keeps them exercising OverviewDesktop (jsdom default is now the mobile tree).
  beforeEach(stubDesktopMatchMedia);
  afterEach(() => {
    cleanup();
    Reflect.deleteProperty(window, "matchMedia");
    vi.clearAllMocks();
    // Reset useLiveStream to default quiet/empty-map state after each test
    mockUseLiveStream.mockReturnValue({
      greeks: new Map(),
      status: "quiet",
      lastTickAt: null,
      isRth: null,
      hasReceivedFirstTick: false,
      isReconnecting: false,
      reconnectNow: vi.fn(),
      subscribeAdHoc: vi.fn().mockResolvedValue(undefined),
    });
  });

  // ── Existing tests (unchanged assertions) ─────────────────────────────────────

  it("renders the three-column shell headers (left rail, center hero+positions, GEX rail)", () => {
    setPositions([]);
    render(<Overview />);
    // LEFT — the persistent MarketRail context column.
    expect(screen.getByTestId("market-rail")).toBeDefined();
    // CENTER — hero + docked positions table.
    expect(screen.getByText("Risk profile — combined book")).toBeDefined();
    expect(screen.getByRole("heading", { name: "Positions" })).toBeDefined();
    // RIGHT — GEX rail (untouched).
    expect(screen.getByText("Dealer γ profile")).toBeDefined();
    expect(screen.getByText("GEX by strike")).toBeDefined();
    expect(screen.getByText("Key levels")).toBeDefined();
    expect(screen.getByText("Net book greeks")).toBeDefined();
    // The old full-width below-fold sections are gone (their content lives in the rail).
    expect(screen.queryByText("Book & system")).toBeNull();
    expect(screen.queryByText("Positioning & macro detail")).toBeNull();
    expect(screen.queryByText("Held positions & exit rules")).toBeNull();
  });

  it("renders the live COT card and the merged Market regime panel — no more standalone FRED macro card", () => {
    setPositions([]);
    render(<Overview />);
    // COT is a wired card (Phase 13) — its heading is present.
    expect(screen.getByText(/CFTC COT/)).toBeDefined();
    // The standalone FRED macro card/stub is gone — its rates row is absorbed into
    // RegimeBoard's "Market regime" panel (post-v1.3 merge).
    expect(screen.queryByText("FRED macro")).toBeNull();
    expect(screen.queryByText("○ needs feed")).toBeNull();
    expect(screen.getByText("Market regime")).toBeDefined();
    expect(screen.getByTestId("regime-empty")).toBeDefined();
    // useMacro is mocked with data: undefined for this file — the rates row is
    // silently omitted rather than fabricated (T-24-09 precedent).
    expect(screen.queryByTestId("regime-rates-row")).toBeNull();
  });

  it("mounts the merged 'Market regime' panel inside the left MarketRail (Option A relocation)", () => {
    setPositions([]);
    render(<Overview />);
    const rail = screen.getByTestId("market-rail");
    expect(within(rail).getByText("Market regime")).toBeDefined();
    expect(within(rail).getByTestId("regime-empty")).toBeDefined();
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

  it("renders a LiveStatusBadge showing QUIET in the 'Open positions' section header when stream has no ticks", () => {
    setPositions([POS]);
    render(<Overview />);
    // Badge renders "QUIET" when status is 'quiet' (WATCH-01 3-state model, D-01)
    expect(screen.getByText("QUIET")).toBeDefined();
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

  it("badge shows STALLED and cells carry both live-cell and stale classes when status is stalled (Surface 2 color-dim, not opacity)", () => {
    setPositions([POS]);
    setLiveStream("stalled", new Map([[POS.occSymbol, makeTick()]]));
    const { container } = render(<Overview />);
    // Badge reflects stalled state
    expect(screen.getByText("STALLED")).toBeDefined();
    // Both live-cell AND stale class present — .live-cell.stale dims by color (never opacity)
    expect(container.querySelector(".live-cell.stale")).not.toBeNull();
  });

  // ── 17-04 Task 2: calibrated IV + staleness badges + row-highlight ───────────

  describe("calibrated IV, staleness badges, row-highlight (17-04 D-01..D-07)", () => {
    beforeEach(() => {
      // Default: every leg resolves ok (converged) — individual tests override per-occSymbol.
      mockResolveLegIv.mockImplementation(() => ok(0.2));
    });

    it("a non-convergent leg renders an 'IV n/a' badge on its row and the net-book T+0 exclusion note", () => {
      mockResolveLegIv.mockImplementation((occSymbol: string) => {
        if (occSymbol === CAL_FRONT.occSymbol) return err({ kind: "below-intrinsic" });
        return ok(0.2);
      });
      setPositions([CAL_FRONT, CAL_BACK]);
      render(<Overview />);
      // Scoped to the desktop table (35-04: the mobile card list renders the same badge
      // text off the same row, an expected duplication in jsdom with no real media query).
      expect(within(screen.getByRole("table")).getByText("IV n/a")).toBeDefined();
      expect(screen.getByTestId("t0-exclusion-note")).toBeDefined();
      expect(screen.getByText(/T\+0 excludes 1 position: IV n\/a/)).toBeDefined();
    });

    it("a cold-start leg (no tick, marketValue===null) does NOT render an 'IV n/a' badge (Pitfall 2 / T-17-09)", () => {
      mockResolveLegIv.mockImplementation((occSymbol: string) => {
        if (occSymbol === CAL_FRONT.occSymbol) return err({ kind: "no-price" });
        return ok(0.2);
      });
      setPositions([
        { ...CAL_FRONT, marketValue: null },
        CAL_BACK,
      ]);
      render(<Overview />);
      // The row-level "IV n/a" badge is reserved for a genuine invertIv non-convergence
      // (Pitfall 2 / T-17-09) — a cold-start "no-price" leg must never be badged that way.
      expect(screen.queryByText("IV n/a")).toBeNull();
      // The leg is still honestly excluded from the T+0 aggregate (never a fabricated
      // guessed IV, T-17-05) — the net-book self-flag note is expected to appear, just
      // without the misleading "did not converge" badge language on the row itself.
      expect(screen.getByTestId("t0-exclusion-note")).toBeDefined();
    });

    it("renders the GEX 'as of' staleness badge (amber — the fixture snapshot is stale)", () => {
      setPositions([]);
      const { container } = render(<Overview />);
      const badge = screen.getByTestId("gex-freshness");
      expect(badge.textContent).toContain("GEX as of");
      expect(container.querySelector('[data-testid="gex-freshness"] .bg-amber')).not.toBeNull();
    });

    it("renders the live-mark badge amber when the last tick is older than 5 minutes", () => {
      mockUseLiveStream.mockReturnValue({
        greeks: new Map(),
        status: "live",
        lastTickAt: new Date(Date.now() - 6 * 60 * 1000),
        isRth: true,
        hasReceivedFirstTick: true,
        isReconnecting: false,
        reconnectNow: vi.fn(),
        subscribeAdHoc: vi.fn().mockResolvedValue(undefined),
      });
      setPositions([]);
      const { container } = render(<Overview />);
      const badge = screen.getByTestId("live-mark-freshness");
      expect(badge.textContent).toContain("mark as of");
      expect(container.querySelector('[data-testid="live-mark-freshness"] .bg-amber')).not.toBeNull();
    });

    it("selecting a docked-table row highlights that position's curve in PayoffChart (dims the net book)", () => {
      setPositions([CAL_FRONT, CAL_BACK]);
      const { container } = render(<Overview />);
      const row = screen.getByTestId(`position-row-${CAL_ROW_KEY}`);
      fireEvent.click(row);
      expect(container.querySelector('[data-testid="highlighted-t0-curve"]')).not.toBeNull();
      const netBookCurve = container.querySelector('[data-testid="net-book-t0-curve"]');
      expect(netBookCurve?.getAttribute("stroke-opacity")).toBe("0.3");
    });
  });

  // ── 17.1-03 (OVW-06): lifted calendar inclusion drives BOTH chart curves ────

  describe("OVW-06: unified calendar inclusion (single lifted source of truth)", () => {
    beforeEach(() => {
      mockResolveLegIv.mockImplementation(() => ok(0.2));
      // 34-05: buildCalendarPosition's dteExact() is wall-clock-fractional (no longer
      // whole-day-ceiled) — pin the clock so the two separately-mounted renders these
      // tests compare (cleanup() + render() pairs) share the identical `now`, matching
      // what they were written to prove (exclusion equivalence), not clock drift between
      // two `new Date()` calls milliseconds apart.
      vi.useFakeTimers({ toFake: ["Date"] });
      vi.setSystemTime(new Date("2026-07-11T14:00:00Z"));
    });

    afterEach(() => {
      vi.useRealTimers();
    });

    it("unchecking a calendar row removes its contribution from BOTH payoff curves and moves positionSetSignature", () => {
      setPositions([CAL_FRONT, CAL_BACK, CAL2_FRONT, CAL2_BACK]);
      render(<Overview />);

      const before = latestPayoffChartProps();
      const beforeSignature = before.positionSetSignature;
      const beforeTodayCurve = before.todayCurve;
      const beforeExpirationCurve = before.expirationCurve;

      // Scoped to the desktop table (35-04: the mobile card list renders a sibling checkbox
      // with the same accessible name off the same row).
      const checkbox = within(screen.getByRole("table")).getByRole("checkbox", {
        name: "Include 7425P in risk profile & total",
      });
      fireEvent.click(checkbox);

      const after = latestPayoffChartProps();
      expect(after.positionSetSignature).not.toBe(beforeSignature);
      expect(after.todayCurve).not.toEqual(beforeTodayCurve);
      expect(after.expirationCurve).not.toEqual(beforeExpirationCurve);

      // The remaining curve after excluding the 7425P calendar must match the
      // 7500P-only scenario exactly — proof the exclusion reaches the chart, not
      // just the table total (the literal decoupling gap this requirement closes).
      cleanup();
      setPositions([CAL2_FRONT, CAL2_BACK]);
      render(<Overview />);
      const singleOnly = latestPayoffChartProps();
      expect(after.todayCurve).toEqual(singleOnly.todayCurve);
      expect(after.expirationCurve).toEqual(singleOnly.expirationCurve);
    });

    it("default state (nothing excluded) reproduces the untouched two-calendar chart — no regression", () => {
      setPositions([CAL_FRONT, CAL_BACK, CAL2_FRONT, CAL2_BACK]);
      render(<Overview />);
      const props = latestPayoffChartProps();
      expect(props.todayCurve.length).toBeGreaterThan(0);
      expect(props.positionSetSignature).toContain(`${CAL_ROW_KEY}:ok:ok:true`);
    });

    it("checkbox accessible name matches the UI-SPEC copywriting contract", () => {
      setPositions([CAL_FRONT, CAL_BACK]);
      render(<Overview />);
      // Scoped to the desktop table (35-04: the mobile card list's checkbox carries the
      // exact same accessible name — byte-identical parity, per the UI-SPEC).
      expect(
        within(screen.getByRole("table")).getByRole("checkbox", { name: "Include 7425P in risk profile & total" }),
      ).toBeDefined();
    });

    it("one checkbox click updates BOTH the Net included/total count AND the chart curve props from a single interaction", () => {
      setPositions([CAL_FRONT, CAL_BACK, CAL2_FRONT, CAL2_BACK]);
      render(<Overview />);

      // Net · 2/2 before any toggle
      expect(screen.getByText(/2\/2/)).toBeDefined();
      const beforeCurve = latestPayoffChartProps().todayCurve;

      // Scoped to the desktop table (35-04: the mobile card list renders a sibling checkbox
      // with the same accessible name off the same row).
      fireEvent.click(
        within(screen.getByRole("table")).getByRole("checkbox", { name: "Include 7425P in risk profile & total" }),
      );

      // Same interaction updates the table total...
      expect(screen.getByText(/1\/2/)).toBeDefined();
      // ...and the chart curve, in one click.
      expect(latestPayoffChartProps().todayCurve).not.toEqual(beforeCurve);
    });

    it("CR-01 regression: a non-convergent calendar contributes nothing to EITHER curve even with its checkbox left checked", () => {
      // CAL2's front leg genuinely fails to converge (a real IvError, not "no-price") —
      // includedForT0 = pos.included && !isIvExcludedFromT0 must still drop it, proving
      // the lifted `included` wiring composes with the pre-existing CR-01 guard rather
      // than bypassing it.
      mockResolveLegIv.mockImplementation((occSymbol: string) => {
        if (occSymbol === CAL2_FRONT.occSymbol) return err({ kind: "below-intrinsic" });
        return ok(0.2);
      });
      setPositions([CAL_FRONT, CAL_BACK, CAL2_FRONT, CAL2_BACK]);
      render(<Overview />);

      // Neither checkbox was touched — both calendars stay `included: true`.
      const withNonConvergent = latestPayoffChartProps();

      cleanup();
      mockResolveLegIv.mockImplementation(() => ok(0.2));
      setPositions([CAL_FRONT, CAL_BACK]);
      render(<Overview />);
      const convergentOnly = latestPayoffChartProps();

      expect(withNonConvergent.todayCurve).toEqual(convergentOnly.todayCurve);
      expect(withNonConvergent.expirationCurve).toEqual(convergentOnly.expirationCurve);
    });

    it("D-01: combined book at widely-different strikes (7000/7600) gets a domain that brackets BOTH — no clip (Pitfall 4)", () => {
      setPositions([CAL3_FRONT, CAL3_BACK, CAL4_FRONT, CAL4_BACK]);
      render(<Overview />);

      const props = latestPayoffChartProps();
      expect(props.domain.min).toBeLessThanOrEqual(7000);
      expect(props.domain.max).toBeGreaterThanOrEqual(7600);
      // The data grid follows the SAME window as the chart scale (Pitfall 1) — the curve's
      // own endpoints are exactly the domain bounds, not an independently-clipped window.
      const firstSpot = props.todayCurve[0]?.spot;
      const lastSpot = props.todayCurve.at(-1)?.spot;
      expect(firstSpot).toBe(props.domain.min);
      expect(lastSpot).toBe(props.domain.max);
    });
  });

  // ── 17.1-04 (OVW-05): TOS-style date picker projects the today curve ────────

  describe("OVW-05: date picker projects the today/date curve via daysForward", () => {
    beforeEach(() => {
      mockResolveLegIv.mockImplementation(() => ok(0.2));
    });

    it("shows the Date: label and Previous day / Next day / Today controls with min/max on the native input", () => {
      setPositions([CAL_FRONT, CAL_BACK]);
      render(<Overview />);

      expect(screen.getByText("Date:")).toBeDefined();
      expect(screen.getByRole("button", { name: "Previous day" })).toBeDefined();
      expect(screen.getByRole("button", { name: "Next day" })).toBeDefined();
      expect(screen.getByRole("button", { name: "Today" })).toBeDefined();

      const input = screen.getByTestId("date-picker-input");
      expect(input.getAttribute("min")).not.toBeNull();
      expect(input.getAttribute("max")).not.toBeNull();
      expect(input.style.colorScheme).toBe("dark");
    });

    it("picking a future date moves the today curve but leaves the expiration curve fixed (D-01)", () => {
      setPositions([CAL_FRONT, CAL_BACK]);
      render(<Overview />);
      const before = latestPayoffChartProps();

      const future = new Date();
      future.setDate(future.getDate() + 5);
      const input = screen.getByTestId("date-picker-input");
      fireEvent.change(input, { target: { value: toDateInputValue(future) } });

      const after = latestPayoffChartProps();
      expect(after.todayCurve).not.toEqual(before.todayCurve);
      expect(after.expirationCurve).toEqual(before.expirationCurve);
    });

    it("clicking › steps the projected date forward by one day, moving the today curve", () => {
      setPositions([CAL_FRONT, CAL_BACK]);
      render(<Overview />);
      const before = latestPayoffChartProps().todayCurve;

      fireEvent.click(screen.getByRole("button", { name: "Next day" }));

      expect(latestPayoffChartProps().todayCurve).not.toEqual(before);
    });

    it("clicking ‹ at the today baseline is clamped — the today curve does not change", () => {
      setPositions([CAL_FRONT, CAL_BACK]);
      render(<Overview />);
      const baseline = latestPayoffChartProps().todayCurve;

      fireEvent.click(screen.getByRole("button", { name: "Previous day" }));

      expect(latestPayoffChartProps().todayCurve).toEqual(baseline);
    });

    it("clicking Today resets the projected date back to daysForward 0", () => {
      setPositions([CAL_FRONT, CAL_BACK]);
      render(<Overview />);
      const baseline = latestPayoffChartProps().todayCurve;

      fireEvent.click(screen.getByRole("button", { name: "Next day" }));
      fireEvent.click(screen.getByRole("button", { name: "Next day" }));
      expect(latestPayoffChartProps().todayCurve).not.toEqual(baseline);

      fireEvent.click(screen.getByRole("button", { name: "Today" }));
      expect(latestPayoffChartProps().todayCurve).toEqual(baseline);
    });
  });

  // ── Shared PayoffControls series toggles (follow-on) — chip click flips PayoffChart visibility ──

  describe("series toggles (shared PayoffControls)", () => {
    it("clicking the @ exp toggle flips PayoffChart toggles.showExpiration off (others unaffected)", () => {
      setPositions([CAL_FRONT, CAL_BACK]);
      render(<Overview />);
      expect(latestPayoffChartProps().toggles.showExpiration).toBe(true);

      fireEvent.click(screen.getByTestId("toggle-showExpiration"));

      expect(latestPayoffChartProps().toggles.showExpiration).toBe(false);
      expect(latestPayoffChartProps().toggles.showWalls).toBe(true);
    });

    it("clicking the Fan toggle turns the fan on (default off)", () => {
      setPositions([CAL_FRONT, CAL_BACK]);
      render(<Overview />);
      expect(latestPayoffChartProps().toggles.showFan).toBe(false);

      fireEvent.click(screen.getByTestId("toggle-showFan"));

      expect(latestPayoffChartProps().toggles.showFan).toBe(true);
    });
  });

  // ── OVW-04: MORAI default curve palette (violet/gray) — TOS behavior, MORAI look ──

  describe("OVW-04: Overview hero uses the MORAI default curve palette (matches Analyzer)", () => {
    it("renders the today curve in MORAI violet and the @exp curve in gray (no TOS override)", () => {
      setPositions([CAL_FRONT, CAL_BACK]);
      const { container } = render(<Overview />);
      const t0Curve = container.querySelector('[data-testid="net-book-t0-curve"]');
      const expCurve = container.querySelector('[data-testid="net-book-exp-curve"]');
      // PayoffChart defaults (VIOLET / GRAY_MUTED) — Overview passes no color override.
      expect(t0Curve?.getAttribute("stroke")).toBe("#a78bfa");
      expect(expCurve?.getAttribute("stroke")).toBe("#7b8696");
    });

    it("legend swatches use bg-violet (T+0) and bg-muted-foreground (@ exp), not TOS neon", () => {
      setPositions([CAL_FRONT, CAL_BACK]);
      const { container } = render(<Overview />);
      expect(container.querySelector(".bg-violet")).not.toBeNull();
      expect(container.querySelector(".bg-muted-foreground")).not.toBeNull();
      expect(container.querySelector(".bg-tos-magenta")).toBeNull();
      expect(container.querySelector(".bg-cyan")).toBeNull();
    });
  });

  // ── 17.1-05 (OVW-03): positions-box expiry/DTE reformat ─────────────────────

  describe("formatExpiryCell (OVW-03)", () => {
    it("formats a calendar row: two expiry dates + both DTEs + calendar width", () => {
      const cell = formatExpiryCell({
        kind: "calendar",
        frontOccSymbol: "SPXW  260808P07425000",
        backOccSymbol: "SPXW  260905P07425000",
        dteFront: 32,
        dteBack: 59,
      });
      expect(cell.line1).toBe("Aug 8 → Sep 5");
      expect(cell.line2).toBe("32d/59d · 27d wide");
    });

    it("formats a single-leg row: one expiry date + its DTE, no calendar width", () => {
      const cell = formatExpiryCell({
        kind: "single",
        occSymbol: "SPXW  260808P07425000",
        dte: 32,
      });
      expect(cell.line1).toBe("Aug 8");
      expect(cell.line2).toBe("32d");
    });

    it("falls back to '—' for line1 without throwing when parseOccSymbol fails", () => {
      expect(() =>
        formatExpiryCell({ kind: "single", occSymbol: "not-a-valid-occ-symbol", dte: 10 }),
      ).not.toThrow();
      const cell = formatExpiryCell({ kind: "single", occSymbol: "not-a-valid-occ-symbol", dte: 10 });
      expect(cell.line1).toBe("—");
    });
  });

  describe("positions-box expiry/DTE cell + header (OVW-03)", () => {
    it("the column header reads 'Expiry / DTE'", () => {
      setPositions([POS]);
      render(<Overview />);
      expect(screen.getByText("Expiry / DTE")).toBeDefined();
      expect(screen.queryByText("DTE")).toBeNull();
    });

    it("a calendar row shows both leg expiries and the calendar width", () => {
      // CAL_FRONT expires Nov 20 2030, CAL_BACK Nov 30 2030 — a fixed 10-day-wide calendar.
      setPositions([CAL_FRONT, CAL_BACK]);
      render(<Overview />);
      expect(screen.getByText("Nov 20 → Nov 30")).toBeDefined();
      // Scoped to the desktop table (35-04: the mobile card's expiry line concatenates
      // line1/line2 as sibling text nodes in one div, whose full textContent also contains
      // "10d wide" and would otherwise double-match the regex).
      expect(within(screen.getByRole("table")).getByText(/10d wide/)).toBeDefined();
    });

    it("a single-leg row shows its one expiry and DTE, no calendar width", () => {
      // POS expires Aug 7 2026 — a single leg (no pair).
      setPositions([POS]);
      render(<Overview />);
      expect(screen.getByText("Aug 7")).toBeDefined();
      expect(screen.getByText(/^\d+d$/)).toBeDefined();
    });
  });
});

describe("GEX rail — near-term (≤45d) key levels", () => {
  beforeEach(stubDesktopMatchMedia);
  afterEach(() => {
    cleanup();
    Reflect.deleteProperty(window, "matchMedia");
    vi.clearAllMocks();
  });

  it("renders near-term rows from the fixture's nearTerm set", () => {
    setPositions([]);
    render(<Overview />);

    expect(screen.getByText("Call Wall 45d")).toBeDefined();
    expect(screen.getByText("7420")).toBeDefined();
    expect(screen.getByText("Put Wall 45d")).toBeDefined();
    expect(screen.getByText("7320")).toBeDefined();
    expect(screen.getByText("γ flip 45d")).toBeDefined();
  });
});

describe("Pill header — 0DTE γ pill", () => {
  beforeEach(stubDesktopMatchMedia);
  afterEach(() => {
    cleanup();
    Reflect.deleteProperty(window, "matchMedia");
    vi.clearAllMocks();
  });

  it("renders the 0DTE net gamma pill from byExpiry", () => {
    setPositions([]);
    render(<Overview />);

    // GEX_FIXTURE computedAt 2026-06-29 + byExpiry entry for that date. Scoped to the
    // full 10-chip row (35-03 duplicates this chip into the mobile secondary rail too —
    // both exist in jsdom regardless of viewport, so an unscoped getByText now matches twice).
    const fullRow = screen.getByTestId("pill-header-full");
    expect(within(fullRow).getByText("0DTE γ")).toBeDefined();
    expect(within(fullRow).getByText("−$9.8B")).toBeDefined();
  });
});

// ── 35.1-04 D-12: PillHeader is desktop-only — the Phase 35 mobile arms are deleted ──
describe("PillHeader — desktop-only full chip row (35.1-04 D-12)", () => {
  beforeEach(stubDesktopMatchMedia);
  afterEach(() => {
    cleanup();
    Reflect.deleteProperty(window, "matchMedia");
    vi.clearAllMocks();
  });

  it("renders ONLY the full row with all ten chips — no priority row, no secondary ChipRail", () => {
    setPositions([]);
    render(<Overview />);

    expect(screen.queryByTestId("pill-header-priority")).toBeNull();
    expect(screen.queryByRole("group", { name: "Additional market metrics" })).toBeNull();

    const full = screen.getByTestId("pill-header-full");
    for (const label of [
      "SPX",
      "net γ /1%",
      "0DTE γ",
      "γ flip",
      "VIX",
      "VVIX",
      "Fed funds",
      "10y−2y",
      "COT lev",
      "book",
    ]) {
      expect(within(full).getByText(label)).toBeDefined();
    }
  });

  it("the full row is a plain flex-wrap row and the wrapper is unconditionally sticky (no static/lg: split)", () => {
    setPositions([]);
    render(<Overview />);

    const full = screen.getByTestId("pill-header-full");
    expect(full.className).not.toContain("hidden");
    expect(full.className).not.toContain("lg:flex");
    expect(full.className).toContain("flex");

    const wrapper = screen.getByTestId("pill-header");
    expect(wrapper.className).toContain("sticky");
    expect(wrapper.className).not.toContain("lg:sticky");
    expect(wrapper.className).not.toMatch(/(?:^|\s)static(?:\s|$)/);
    expect(wrapper.className).toContain("backdrop-blur");
    expect(wrapper.className).not.toContain("lg:backdrop-blur");
  });
});

describe("Overview — held positions + exit rules panels (moved from Analyzer, 26-06-PLAN.md, EXIT-07/EXIT-09/EXIT-10)", () => {
  beforeEach(stubDesktopMatchMedia);
  afterEach(() => {
    cleanup();
    Reflect.deleteProperty(window, "matchMedia");
    vi.clearAllMocks();
  });

  it("lists every verdict (all unlinked here) + opens the exit rules ladder from the header dialog", () => {
    setPositions([]);
    setExitsReturn({ data: EXITS_FIXTURE });
    render(<Overview />);

    // With no broker positions, every verdict is unlinked → rendered in the fallback list.
    for (const row of EXITS_FIXTURE.positions) {
      expect(screen.getByTestId(`held-position-${row.calendarId}`)).toBeTruthy();
    }

    // Exit rules live behind the header dialog — closed until the trigger is clicked.
    expect(screen.queryByTestId("exit-rules-list")).toBeNull();
    fireEvent.click(screen.getByTestId("exit-rules-trigger"));

    const ruleRows = screen.getAllByTestId(/^exit-rule-/);
    expect(ruleRows.map((el) => el.getAttribute("data-testid"))).toEqual(
      EXITS_FIXTURE.ruleSet.map((r) => `exit-rule-${r.id}`),
    );
  });

  it("STOP escalates to the down-alert chip with the exact verdict label + rule/metric line", () => {
    setPositions([]);
    setExitsReturn({ data: EXITS_FIXTURE });
    render(<Overview />);

    const chip = screen.getByTestId("held-position-verdict-cal-stop");
    expect(chip.textContent).toContain("STOP −25%");
    expect(chip.className).toContain("bg-downd");
    expect(screen.getByTestId("held-position-rule-cal-stop").textContent).toBe("stop · pnlPct −26.1%");
  });

  it("EXIT — pre-event escalates to the filled-amber chip, a distinct hue from STOP's fill", () => {
    setPositions([]);
    setExitsReturn({ data: EXITS_FIXTURE });
    render(<Overview />);

    const chip = screen.getByTestId("held-position-verdict-cal-exit");
    expect(chip.textContent).toContain("EXIT — pre-event");
    expect(chip.className).toContain("bg-amber/15");
    expect(chip.className).not.toContain("bg-downd");
  });

  it("HOLD/TAKE/ROLL render on the plain (non-alert, unfilled) chip background", () => {
    setPositions([]);
    setExitsReturn({ data: EXITS_FIXTURE });
    render(<Overview />);

    for (const id of ["cal-hold", "cal-take", "cal-roll"]) {
      const chip = screen.getByTestId(`held-position-verdict-${id}`);
      expect(chip.className).toContain("bg-transparent");
      expect(chip.className).not.toContain("bg-downd");
      expect(chip.className).not.toContain("bg-amber/15");
    }
  });

  it("T-26-16: an indicative STOP is FORCED to the INDICATIVE treatment, never escalated STOP colors", () => {
    setPositions([]);
    setExitsReturn({ data: EXITS_FIXTURE });
    render(<Overview />);

    expect(screen.queryByText("STOP −50%")).toBeNull();
    const indicativeMark = screen.getByTestId("held-position-indicative-cal-indicative");
    // EXITS_FIXTURE.marketSession is "rth" — a session-agnostic indicative row (e.g. a stale
    // mark) reads "STALE — indicative", not "AH — indicative" (that string is reserved for an
    // after-hours-marketSession snapshot, exercised separately below).
    expect(indicativeMark.textContent).toBe("STALE — indicative");
    expect(indicativeMark.className).toContain("text-amber");
  });

  it("indicative marker reads 'AH — indicative' when the snapshot's marketSession is after-hours", () => {
    setPositions([]);
    setExitsReturn({ data: { ...EXITS_FIXTURE, marketSession: "after-hours" } });
    render(<Overview />);

    const indicativeMark = screen.getByTestId("held-position-indicative-cal-indicative");
    expect(indicativeMark.textContent).toBe("AH — indicative");
  });

  it("EXIT-09: a changed verdict shows the CHANGED marker in the verdict's own value color", () => {
    setPositions([]);
    setExitsReturn({ data: EXITS_FIXTURE });
    render(<Overview />);

    const marker = screen.getByTestId("held-position-changed-cal-take");
    expect(marker.textContent).toBe("CHANGED");
    expect(marker.className).toContain("text-up");
    expect(screen.queryByTestId("held-position-changed-cal-hold")).toBeNull();
  });

  it("renders the ROLL suggestion detail row only for the ROLL verdict", () => {
    setPositions([]);
    setExitsReturn({ data: EXITS_FIXTURE });
    render(<Overview />);

    const rollRow = screen.getByTestId("held-position-roll-cal-roll");
    expect(rollRow.textContent).toContain("2026-09-11");
    expect(rollRow.textContent).toContain("$410");
    // WR-03: labelled as the replacement-front SELL credit, not a net "est. debit".
    expect(rollRow.textContent).toContain("new front est. credit");
    expect(rollRow.textContent).not.toContain("est. debit");
    expect(screen.queryByTestId("held-position-roll-cal-hold")).toBeNull();
  });

  it("EXIT-10: the held-positions panel has no button/order affordance anywhere in its rows", () => {
    setPositions([]);
    setExitsReturn({ data: EXITS_FIXTURE });
    render(<Overview />);

    for (const row of EXITS_FIXTURE.positions) {
      const rowEl = screen.getByTestId(`held-position-${row.calendarId}`);
      expect(rowEl.querySelectorAll("button").length).toBe(0);
    }
  });

  it("cold-start: null data shows 'Exit advisor warming up'", () => {
    setPositions([]);
    setExitsReturn({ data: null, isPending: false, isError: false });
    render(<Overview />);

    const coldStart = screen.getByTestId("held-positions-cold-start");
    expect(coldStart.textContent).toContain("Exit advisor warming up");
    expect(coldStart.textContent).toContain(
      "First verdict pending — check back after the next chain snapshot.",
    );
  });

  it("empty: a settled snapshot with zero positions shows 'No open positions'", () => {
    setPositions([]);
    setExitsReturn({ data: { ...EXITS_FIXTURE, positions: [] }, isPending: false, isError: false });
    render(<Overview />);

    const empty = screen.getByTestId("held-positions-empty");
    expect(empty.textContent).toContain("No open positions");
    expect(empty.textContent).toContain(
      "Nothing to advise on — the exit advisor activates once you have an open calendar.",
    );
  });

  it("loading: shows 'Loading exit verdicts…'", () => {
    setPositions([]);
    setExitsReturn({ data: undefined, isPending: true, isError: false });
    render(<Overview />);

    expect(screen.getByTestId("held-positions-loading").textContent).toBe("Loading exit verdicts…");
  });

  it("error: shows \"Couldn't load exit verdicts.\" + a Retry button wired to refetch", () => {
    setPositions([]);
    const refetch = vi.fn();
    setExitsReturn({ data: undefined, isPending: false, isError: true, refetch });
    render(<Overview />);

    const errorBlock = screen.getByTestId("held-positions-error");
    expect(errorBlock.textContent).toContain("Couldn't load exit verdicts.");
    fireEvent.click(within(errorBlock).getByText("Retry"));
    expect(refetch).toHaveBeenCalledOnce();
  });
});

describe("Overview — verdict-in-row join (overview-layout-redesign.md §Join design)", () => {
  beforeEach(() => {
    stubDesktopMatchMedia();
    // Calendars must build so the 7425P row exists (buildRows is IV-independent, but keep
    // calibration deterministic to avoid non-convergent noise elsewhere on the surface).
    mockResolveLegIv.mockImplementation(() => ok(0.2));
  });
  afterEach(() => {
    cleanup();
    Reflect.deleteProperty(window, "matchMedia");
    vi.clearAllMocks();
  });

  it("joins a matching verdict into its positions-row VERDICT cell, not the unlinked list", () => {
    setPositions([CAL_FRONT, CAL_BACK]); // 7425P calendar → row label "7425P"
    setExitsReturn({ data: EXITS_FIXTURE }); // cal-hold is strike 7425, optionType "P"
    render(<Overview />);

    const row = screen.getByTestId(`position-row-${CAL_ROW_KEY}`);
    expect(within(row).getByTestId("held-position-verdict-cal-hold")).toBeDefined();
    // Matched → NOT duplicated in the unlinked fallback list.
    expect(screen.queryByTestId("held-position-cal-hold")).toBeNull();
  });

  it("routes every non-matching verdict to the 'Unlinked verdicts' list — never silently dropped", () => {
    setPositions([CAL_FRONT, CAL_BACK]);
    setExitsReturn({ data: EXITS_FIXTURE });
    render(<Overview />);

    expect(screen.getByText("Unlinked verdicts")).toBeDefined();
    for (const id of ["cal-take", "cal-stop", "cal-exit", "cal-indicative", "cal-roll"]) {
      expect(screen.getByTestId(`held-position-${id}`)).toBeDefined();
    }
    expect(screen.queryByTestId("held-position-cal-hold")).toBeNull();
  });

  it("the join key is option-type specific — a call verdict never matches a put row at the same strike", () => {
    setPositions([CAL_FRONT, CAL_BACK]); // 7425 P row
    const callAt7425: ExitsResponse = {
      ...EXITS_FIXTURE,
      positions: EXITS_FIXTURE.positions.map((p) =>
        p.calendarId === "cal-hold" ? { ...p, optionType: "C" as const } : p,
      ),
    };
    setExitsReturn({ data: callAt7425 });
    render(<Overview />);

    const row = screen.getByTestId(`position-row-${CAL_ROW_KEY}`);
    expect(within(row).queryByTestId("held-position-verdict-cal-hold")).toBeNull();
    // 7425C → no put row → unlinked list.
    expect(screen.getByTestId("held-position-cal-hold")).toBeDefined();
  });

  it("clicking a matched row expands its verdict detail (rule + metric line)", () => {
    setPositions([CAL_FRONT, CAL_BACK]);
    setExitsReturn({ data: EXITS_FIXTURE });
    render(<Overview />);

    expect(screen.queryByTestId(`position-verdict-detail-${CAL_ROW_KEY}`)).toBeNull();
    fireEvent.click(screen.getByTestId(`position-row-${CAL_ROW_KEY}`));

    const detail = screen.getByTestId(`position-verdict-detail-${CAL_ROW_KEY}`);
    expect(within(detail).getByTestId("held-position-rule-cal-hold").textContent).toBe("hold · pnlPct +2.0%");
  });

  it("shows the em-dash (no chip) in the VERDICT column while the advisor is cold-starting", () => {
    setPositions([CAL_FRONT, CAL_BACK]);
    setExitsReturn({ data: null });
    render(<Overview />);

    expect(screen.queryByTestId("held-position-verdict-cal-hold")).toBeNull();
    expect(screen.getByTestId("held-positions-cold-start")).toBeDefined();
  });
});

// ── 34-05: buildCalendarPosition — fractional DTE + per-leg carry wiring ──────
describe("buildCalendarPosition (34-05: fractional DTE + per-leg carry)", () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  const NOW = new Date("2026-07-11T14:00:00Z");
  // CAL_FRONT expires 2030-11-20, CAL_BACK 2030-11-30 (far future — plenty of
  // fractional headroom so frontDteExact/backDteExact never round to an integer).
  const CARRY_GEX: GexSnapshotResponse = {
    ...GEX_FIXTURE,
    impliedCarry: [
      { expiration: "2030-11-20", rate: 0.0512, divYield: 0.0141 },
      { expiration: "2030-11-30", rate: 0.049, divYield: 0.0138 },
    ],
  };

  it("wires fractional frontDteExact/backDteExact and per-leg carry from the GEX impliedCarry", () => {
    mockResolveLegIv.mockImplementation(() => ok(0.2));
    const { calendars } = pairPositionsIntoCalendars([CAL_FRONT, CAL_BACK], NOW);
    const cal = calendars[0];
    assertDefined(cal, "calendar present");

    const built = buildCalendarPosition(cal, 7400, new Map(), NOW, true, CARRY_GEX);

    expect(built.position.frontDteExact).not.toBe(cal.dteFront);
    expect(built.position.backDteExact).not.toBe(cal.dteBack);
    expect(built.position.frontDteExact).toBeCloseTo(cal.dteFront, 0);
    expect(built.position.backDteExact).toBeCloseTo(cal.dteBack, 0);
    expect(built.position.frontRate).toBe(0.0512);
    expect(built.position.frontDivYield).toBe(0.0141);
    expect(built.position.backRate).toBe(0.049);
    expect(built.position.backDivYield).toBe(0.0138);
  });

  it("falls back to DEFAULT_RATE/DEFAULT_DIV per leg when gex is undefined", () => {
    mockResolveLegIv.mockImplementation(() => ok(0.2));
    const { calendars } = pairPositionsIntoCalendars([CAL_FRONT, CAL_BACK], NOW);
    const cal = calendars[0];
    assertDefined(cal, "calendar present");

    const built = buildCalendarPosition(cal, 7400, new Map(), NOW, true, undefined);

    expect(built.position.frontRate).toBe(DEFAULT_RATE);
    expect(built.position.frontDivYield).toBe(DEFAULT_DIV);
    expect(built.position.backRate).toBe(DEFAULT_RATE);
    expect(built.position.backDivYield).toBe(DEFAULT_DIV);
  });
});

// ── 35-03: mobile grid stack order + full-bleed chart + view-only chrome hidden ──
describe("Overview — mobile stack order (35-03: order-*, full-bleed chart, view-only hidden)", () => {
  beforeEach(stubDesktopMatchMedia);
  afterEach(() => {
    cleanup();
    Reflect.deleteProperty(window, "matchMedia");
    vi.clearAllMocks();
  });

  it("threads order-* onto MarketRail / center column / GEX column so the hero paints above the collapsed rail below lg", () => {
    setPositions([]);
    render(<Overview />);

    const rail = screen.getByTestId("market-rail");
    expect(rail.className).toContain("order-2");
    expect(rail.className).toContain("lg:order-1");

    const center = screen.getByTestId("overview-center-column");
    expect(center.className).toContain("order-1");
    expect(center.className).toContain("lg:order-2");

    const gexCol = screen.getByTestId("overview-gex-column");
    expect(gexCol.className).toContain("order-3");
  });

  it("keeps MarketRail first in DOM order — only visual (paint) order changes via CSS order", () => {
    setPositions([]);
    render(<Overview />);

    const grid = screen.getByTestId("market-rail").parentElement;
    assertDefined(grid, "grid wrapper present");
    const children = Array.from(grid.children);
    const marketIdx = children.indexOf(screen.getByTestId("market-rail"));
    const centerIdx = children.indexOf(screen.getByTestId("overview-center-column"));
    expect(marketIdx).toBeLessThan(centerIdx);
  });

  it("the Phase 35 payoff-chart bleed wrapper is gone from the desktop tree (35.1-04 D-12)", () => {
    setPositions([]);
    render(<Overview />);

    expect(screen.queryByTestId("payoff-chart-bleed")).toBeNull();
  });

  it("hides the 'view-only · Analyzer →' chrome below lg (hidden lg:inline)", () => {
    setPositions([]);
    render(<Overview />);

    const viewOnly = screen.getByText("view-only · Analyzer →");
    expect(viewOnly.className).toContain("hidden");
    expect(viewOnly.className).toContain("lg:inline");
  });
});

// ── 35.1-04 D-12: the desktop table is the ONLY positions render — card-list twin deleted ──
describe("Overview — desktop positions render (35.1-04 D-12: plain table, no card-list twin)", () => {
  beforeEach(() => {
    stubDesktopMatchMedia();
    mockResolveLegIv.mockImplementation(() => ok(0.2));
  });
  afterEach(() => {
    cleanup();
    Reflect.deleteProperty(window, "matchMedia");
    vi.clearAllMocks();
  });

  it("the positions <table> renders un-gated — no hidden/lg:table display pairing", () => {
    setPositions([CAL_FRONT, CAL_BACK]);
    render(<Overview />);

    const table = screen.getByRole("table");
    expect(table.className).not.toContain("hidden");
    expect(table.className).not.toContain("lg:table");
    expect(screen.getByTestId(`position-row-${CAL_ROW_KEY}`)).toBeDefined();
  });

  it("no PositionCard list mounts in the desktop tree (mobile cards live in OverviewMobile only)", () => {
    setPositions([CAL_FRONT, CAL_BACK]);
    render(<Overview />);

    expect(screen.queryByTestId("positions-card-list")).toBeNull();
    expect(screen.queryAllByTestId(/^position-card-/)).toHaveLength(0);
  });
});

// ── 35-06: integration gate — no-horizontal-overflow smoke guard ────────────────
// jsdom reports a fixed window.innerWidth (1024 in this project's config) and never
// computes real layout (no wrap/clip/scroll geometry) — this assertion only catches a
// gross, unconditional wider-than-viewport element (e.g. a missing lg: revert on a
// fixed-width child). It is NOT proof of the mobile 390px no-h-scroll requirement;
// that proof is the manual chrome-devtools checklist recorded in 35-06-SUMMARY.md.
describe("Overview — no-horizontal-overflow smoke guard (35-06)", () => {
  beforeEach(stubDesktopMatchMedia);
  afterEach(() => {
    cleanup();
    Reflect.deleteProperty(window, "matchMedia");
    vi.clearAllMocks();
  });

  it("document does not report a wider scrollWidth than clientWidth after mount (jsdom-blind regression tripwire)", () => {
    setPositions([CAL_FRONT, CAL_BACK]);
    render(<Overview />);

    expect(document.documentElement.scrollWidth).toBeLessThanOrEqual(
      document.documentElement.clientWidth,
    );
  });
});

// ── 35.1: Overview root branch — mobile tree by default, desktop tree under the stub ──
describe("Overview branch — D-01/D-10 (35.1)", () => {
  beforeEach(() => {
    mockResolveLegIv.mockImplementation(() => ok(0.2));
  });
  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
    Reflect.deleteProperty(window, "matchMedia");
  });

  it("J1 (root): default jsdom (no matchMedia) renders the mobile tree root — desktop pill-header/table do not mount", () => {
    setPositions([POS]);
    render(<Overview />);

    expect(screen.getByTestId("overview-mobile-root")).toBeDefined();
    expect(screen.queryByTestId("pill-header")).toBeNull();
    expect(screen.queryByRole("table")).toBeNull();
    // 35.1-04: market-rail now mounts in the mobile tree too (inside the market section,
    // closed) — it is no longer a desktop-tree tell. Assert it is the CLOSED disclosure.
    expect(screen.getByTestId("market-rail").hasAttribute("open")).toBe(false);
  });

  it("J2 (byte-identity guard): the desktop matchMedia stub renders today's desktop tree with identical structure", () => {
    stubDesktopMatchMedia();
    setPositions([POS]);
    render(<Overview />);

    expect(screen.getByTestId("pill-header")).toBeDefined();
    expect(screen.queryByTestId("overview-mobile-root")).toBeNull();
    expect(screen.getByRole("table")).toBeDefined();
    expect(screen.getByTestId("overview-center-column")).toBeDefined();
    expect(screen.getByTestId("overview-gex-column")).toBeDefined();
    expect(screen.getByTestId("market-rail")).toBeDefined();
    // GexRail structural content still present.
    expect(screen.getByText("Key levels")).toBeDefined();
    expect(screen.getByText("Net book greeks")).toBeDefined();
  });

  it("J14 (Overview half): under the desktop stub the call site passes neither new chart prop", () => {
    stubDesktopMatchMedia();
    setPositions([CAL_FRONT, CAL_BACK]);
    render(<Overview />);

    const props = latestPayoffChartProps();
    expect(props.showBePills).toBeUndefined();
    expect(props.aspectRatio).toBeUndefined();
  });

  // ── 35.1-02: MobileHero + MobileRiskPanel composed into the mobile root ──────

  it("J1 (complete): the mobile hero renders by default; pill-header still absent", () => {
    setPositions([POS]);
    render(<Overview />);

    expect(screen.getByTestId("mobile-hero")).toBeDefined();
    expect(screen.queryByTestId("pill-header")).toBeNull();
  });

  it("J5 (hero→chart half): mobile-hero precedes mobile-payoff in DOM order", () => {
    setPositions([CAL_FRONT, CAL_BACK]);
    render(<Overview />);

    const hero = screen.getByTestId("mobile-hero");
    const payoff = screen.getByTestId("mobile-payoff");
    const follows =
      (hero.compareDocumentPosition(payoff) & Node.DOCUMENT_POSITION_FOLLOWING) !== 0;
    expect(follows).toBe(true);
  });

  it("hero wiring: mobile-hero-value is signedUsd(bookUnrealizedPnl(positions), 0) — no second P&L path (D-03)", () => {
    setPositions([CAL_FRONT, CAL_BACK]);
    render(<Overview />);

    const expected = signedUsd(bookUnrealizedPnl([CAL_FRONT, CAL_BACK]), 0);
    expect(screen.getByTestId("mobile-hero-value").textContent).toBe(expected);
  });

  it("J7 (shared-state proof): ⋯ → Fan flips the SAME toggles object the chart receives — no second store", () => {
    setPositions([CAL_FRONT, CAL_BACK]);
    render(<Overview />);
    expect(latestPayoffChartProps().toggles.showFan).toBe(false);

    fireEvent.click(screen.getByRole("button", { name: "More chart options" }));
    fireEvent.click(screen.getByRole("button", { name: "Fan" }));

    expect(latestPayoffChartProps().toggles.showFan).toBe(true);
  });

  it("J6 (integration): Next day advances the date pill to +1d and re-renders the chart off it", () => {
    setPositions([CAL_FRONT, CAL_BACK]);
    render(<Overview />);

    expect(screen.getByTestId("date-pill").textContent).toContain("· today");
    const callsBefore = mockPayoffChart.mock.calls.length;

    fireEvent.click(screen.getByRole("button", { name: "Next day" }));

    expect(screen.getByTestId("date-pill").textContent).toContain("+1d");
    expect(mockPayoffChart.mock.calls.length).toBeGreaterThan(callsBefore);
  });

  // ── 35.1-03: mobile positions section — heading, card list, footer, exit states ──

  it("positions heading row: SectionLabel + LiveStatusBadge + the Exit rules ▸ trigger when a snapshot is set", () => {
    setPositions([CAL_FRONT, CAL_BACK]);
    setExitsReturn({ data: EXITS_FIXTURE });
    render(<Overview />);

    expect(screen.getByText("Positions")).toBeDefined();
    expect(screen.getByText("QUIET")).toBeDefined();
    expect(screen.getByTestId("exit-rules-trigger").textContent).toBe("Exit rules ▸");
  });

  it("card list: one position-card per calendar row, no <table>; tap expands the greeks grid un-gated (no verdict), tap again collapses", () => {
    // Default useExits data is null → verdictByRowKey empty — the expand must NOT need a verdict.
    setExitsReturn({ data: null });
    setPositions([CAL_FRONT, CAL_BACK, CAL2_FRONT, CAL2_BACK]);
    render(<Overview />);

    expect(screen.getAllByTestId(/^position-card-/)).toHaveLength(2);
    expect(screen.queryByRole("table")).toBeNull();

    const card = screen.getByTestId(`position-card-${CAL_ROW_KEY}`);
    expect(within(card).queryByText("Δ")).toBeNull();
    fireEvent.click(within(card).getByRole("button", { name: /7425P/ }));
    expect(within(card).getByText("Δ")).toBeDefined();
    fireEvent.click(within(card).getByRole("button", { name: /7425P/ }));
    expect(within(card).queryByText("Δ")).toBeNull();
  });

  it("J11: unchecking a card's checkbox moves the footer to 1/2 included, dims the card, AND moves the chart's positionSetSignature — one lifted state", () => {
    setPositions([CAL_FRONT, CAL_BACK, CAL2_FRONT, CAL2_BACK]);
    render(<Overview />);

    expect(screen.getByTestId("mobile-positions-footer").textContent).toContain("2/2 included");
    expect(latestPayoffChartProps().positionSetSignature).toContain(`${CAL_ROW_KEY}:ok:ok:true`);

    fireEvent.click(
      screen.getByRole("checkbox", { name: "Include 7425P in risk profile & total" }),
    );

    expect(screen.getByTestId("mobile-positions-footer").textContent).toContain("1/2 included");
    expect(screen.getByTestId(`position-card-${CAL_ROW_KEY}`).className).toContain("opacity-40");
    expect(latestPayoffChartProps().positionSetSignature).toContain(`${CAL_ROW_KEY}:ok:ok:false`);
  });

  it("J11 (footer format): Net {usd} · {signed unreal} · n/m included — computed via resolveLivePositionRow over the included legs (D-11)", () => {
    setPositions([CAL_FRONT, CAL_BACK, CAL2_FRONT, CAL2_BACK]);
    render(<Overview />);

    const total = resolveLivePositionRow(
      [CAL_FRONT, CAL_BACK, CAL2_FRONT, CAL2_BACK],
      GEX_FIXTURE.spot,
      new Map(),
    );
    const unrealText = total.unreal === null ? "—" : signedUsd(total.unreal);
    expect(screen.getByTestId("mobile-positions-footer").textContent).toBe(
      `Net ${usd(total.netVal)} · ${unrealText} · 2/2 included`,
    );
  });

  it("empty state: the exact no-positions copy renders and the footer does not", () => {
    setPositions([]);
    render(<Overview />);

    expect(
      screen.getByText(
        "No open positions. Register a calendar via the API or paste a TOS order in the Analyzer.",
      ),
    ).toBeDefined();
    expect(screen.queryByTestId("mobile-positions-footer")).toBeNull();
  });

  it("exit error branch: Couldn't load exit verdicts. + Retry wired to refetch (mobile tree)", () => {
    setPositions([]);
    const refetch = vi.fn();
    setExitsReturn({ data: undefined, isPending: false, isError: true, refetch });
    render(<Overview />);

    const errorBlock = screen.getByTestId("held-positions-error");
    expect(errorBlock.textContent).toContain("Couldn't load exit verdicts.");
    fireEvent.click(within(errorBlock).getByText("Retry"));
    expect(refetch).toHaveBeenCalledOnce();
  });

  it("exit cold-start branch: Exit advisor warming up — and no Exit rules trigger without a snapshot", () => {
    setPositions([]);
    setExitsReturn({ data: null });
    render(<Overview />);

    expect(screen.getByTestId("held-positions-cold-start").textContent).toContain(
      "Exit advisor warming up",
    );
    expect(screen.queryByTestId("exit-rules-trigger")).toBeNull();
  });

  it("unlinked verdicts render under the mobile card list; a matched verdict joins its card instead", () => {
    setPositions([CAL_FRONT, CAL_BACK]);
    setExitsReturn({ data: EXITS_FIXTURE });
    render(<Overview />);

    expect(screen.getByText("Unlinked verdicts")).toBeDefined();
    // cal-hold matches the 7425P row → joined into the card (chip), not the unlinked list.
    expect(screen.queryByTestId("held-position-cal-hold")).toBeNull();
    expect(screen.getByTestId("held-position-cal-take")).toBeDefined();
    const card = screen.getByTestId(`position-card-${CAL_ROW_KEY}`);
    expect(within(card).getByTestId("held-position-verdict-cal-hold")).toBeDefined();
  });

  it("J5 extension: mobile-payoff precedes the first position card in DOM order", () => {
    setPositions([CAL_FRONT, CAL_BACK]);
    render(<Overview />);

    const payoff = screen.getByTestId("mobile-payoff");
    const card = screen.getByTestId(`position-card-${CAL_ROW_KEY}`);
    const follows =
      (payoff.compareDocumentPosition(card) & Node.DOCUMENT_POSITION_FOLLOWING) !== 0;
    expect(follows).toBe(true);
  });

  // ── 35.1-04: MobileMarketSection composed as the last section ──────────────

  it("J5 (complete): hero precedes chart precedes first card precedes the market section root", () => {
    setPositions([CAL_FRONT, CAL_BACK]);
    render(<Overview />);

    const hero = screen.getByTestId("mobile-hero");
    const payoff = screen.getByTestId("mobile-payoff");
    const card = screen.getByTestId(`position-card-${CAL_ROW_KEY}`);
    const market = screen.getByTestId("mobile-market");
    const precedes = (a: Element, b: Element): boolean =>
      (a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING) !== 0;
    expect(precedes(hero, payoff)).toBe(true);
    expect(precedes(payoff, card)).toBe(true);
    expect(precedes(card, market)).toBe(true);
  });
});
