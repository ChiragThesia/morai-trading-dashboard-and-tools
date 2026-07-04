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
import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import { ok, err, assertDefined } from "@morai/shared";
import type { StreamLiveGreekEvent } from "@morai/contracts";
import { toDateInputValue } from "../lib/date-projection.ts";

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

import { Overview, formatExpiryCell } from "./Overview.tsx";
import { usePositions } from "../hooks/usePositions.ts";
import { useLiveStream } from "../hooks/useLiveStream.ts";
import { resolveLegIv } from "../lib/iv-calibration.ts";
import { PayoffChart } from "../components/charts/PayoffChart.tsx";

const mockUsePositions = vi.mocked(usePositions);
const mockUseLiveStream = vi.mocked(useLiveStream);
const mockResolveLegIv = vi.mocked(resolveLegIv);
const mockPayoffChart = vi.mocked(PayoffChart);

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
      expect(screen.getByText("IV n/a")).toBeDefined();
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

    it("the scenario-strip @exp column header names the front expiry date (D-07)", () => {
      setPositions([CAL_FRONT, CAL_BACK]);
      render(<Overview />);
      expect(screen.getByText(/@ exp \(/)).toBeDefined();
    });
  });

  // ── 17.1-03 (OVW-06): lifted calendar inclusion drives BOTH chart curves ────

  describe("OVW-06: unified calendar inclusion (single lifted source of truth)", () => {
    beforeEach(() => {
      mockResolveLegIv.mockImplementation(() => ok(0.2));
    });

    it("unchecking a calendar row removes its contribution from BOTH payoff curves and moves positionSetSignature", () => {
      setPositions([CAL_FRONT, CAL_BACK, CAL2_FRONT, CAL2_BACK]);
      render(<Overview />);

      const before = latestPayoffChartProps();
      const beforeSignature = before.positionSetSignature;
      const beforeTodayCurve = before.todayCurve;
      const beforeExpirationCurve = before.expirationCurve;

      const checkbox = screen.getByRole("checkbox", { name: "Include 7425P in risk profile & total" });
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
      expect(screen.getByRole("checkbox", { name: "Include 7425P in risk profile & total" })).toBeDefined();
    });

    it("one checkbox click updates BOTH the Net included/total count AND the chart curve props from a single interaction", () => {
      setPositions([CAL_FRONT, CAL_BACK, CAL2_FRONT, CAL2_BACK]);
      render(<Overview />);

      // Net · 2/2 before any toggle
      expect(screen.getByText(/2\/2/)).toBeDefined();
      const beforeCurve = latestPayoffChartProps().todayCurve;

      fireEvent.click(screen.getByRole("checkbox", { name: "Include 7425P in risk profile & total" }));

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
      expect(screen.getByText(/10d wide/)).toBeDefined();
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
