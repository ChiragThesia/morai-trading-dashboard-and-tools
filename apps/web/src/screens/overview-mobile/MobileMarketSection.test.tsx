/**
 * MobileMarketSection tests (35.1-04, D-08 / J13) — the mobile MARKET section replaces
 * the desktop's shrunken Dealer-γ/GEX-by-strike charts with headline stat grids:
 * key levels (the EXACT desktop rows), gamma, net book greeks, macro — then the
 * MarketRail reused verbatim as a closed disclosure (D-09).
 *
 * MarketRail's own hooks are mocked (the MarketRail.test.tsx vi.hoisted pattern) so
 * the section renders standalone; the rail's internals stay covered by its own file.
 */
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, cleanup, within } from "@testing-library/react";
import type { GexSnapshotEntry } from "@morai/contracts";
import { signed, signedUsd } from "../../lib/position-format.ts";
import { fmtGammaCompact } from "./useOverviewModel.ts";
import type { NetGreeks } from "./useOverviewModel.ts";

const { mockUseRegimeBoard } = vi.hoisted(() => ({ mockUseRegimeBoard: vi.fn(() => ({ data: undefined, isPending: false, isError: false })) }));
vi.mock("../../hooks/useRegimeBoard.ts", () => ({ useRegimeBoard: mockUseRegimeBoard }));

const { mockUsePicker } = vi.hoisted(() => ({ mockUsePicker: vi.fn(() => ({ data: null, isPending: false, isError: false })) }));
vi.mock("../../hooks/usePicker.ts", () => ({ usePicker: mockUsePicker }));

const { mockUseMacro } = vi.hoisted(() => ({ mockUseMacro: vi.fn(() => ({ data: undefined, isPending: false })) }));
vi.mock("../../hooks/useMacro.ts", () => ({ useMacro: mockUseMacro }));

const { mockUseCot } = vi.hoisted(() => ({ mockUseCot: vi.fn(() => ({ data: undefined })) }));
vi.mock("../../hooks/useCot.ts", () => ({ useCot: mockUseCot }));

const { mockUseStatus } = vi.hoisted(() => ({ mockUseStatus: vi.fn(() => ({ data: undefined })) }));
vi.mock("../../hooks/useStatus.ts", () => ({ useStatus: mockUseStatus }));

import { MobileMarketSection } from "./MobileMarketSection.tsx";

// Full GexSnapshotEntry fixture (the Overview.test.tsx GEX_FIXTURE shape).
const GEX_FIXTURE: GexSnapshotEntry = {
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
  impliedCarry: null,
  computedAt: "2026-06-29T14:00:00.000Z",
};

const RAIL_GREEKS: NetGreeks = { delta: 12.3, gamma: -0.5, theta: -45.6, vega: 210.4 };

function renderSection(overrides?: Partial<Parameters<typeof MobileMarketSection>[0]>): ReturnType<typeof render> {
  return render(
    <MobileMarketSection
      gex={GEX_FIXTURE}
      railGreeks={RAIL_GREEKS}
      zeroDte={-3.2}
      regime="DAMPEN"
      vvix={89.5}
      dff={4.33}
      curveSlope={-0.12}
      cotLev={-50000}
      spot={GEX_FIXTURE.spot}
      {...overrides}
    />,
  );
}

describe("MobileMarketSection (D-08 / J13)", () => {
  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it("J13a: renders the Market label + the exact desktop key-level rows off keyLevelsFor", () => {
    renderSection();

    const section = screen.getByTestId("mobile-market");
    expect(within(section).getByText("Market")).toBeDefined();
    expect(within(section).getByText("Key levels")).toBeDefined();
    // keyLevelsFor(GEX_FIXTURE) rows — label + toFixed(0) value, all-expiry + near-term.
    expect(within(section).getByText("Call Wall")).toBeDefined();
    expect(within(section).getByText("7450")).toBeDefined();
    expect(within(section).getByText("γ flip")).toBeDefined();
    expect(within(section).getByText("7350")).toBeDefined();
    expect(within(section).getByText("Spot")).toBeDefined();
    expect(within(section).getByText("7381")).toBeDefined();
    expect(within(section).getByText("Put Wall")).toBeDefined();
    expect(within(section).getByText("7300")).toBeDefined();
    expect(within(section).getByText("Call Wall 45d")).toBeDefined();
    expect(within(section).getByText("7420")).toBeDefined();
  });

  it("J13a: Gamma grid — net γ /1% = fmtGammaCompact(netGammaAtSpot) colored by regime, 0DTE γ sign-colored", () => {
    renderSection();

    const section = screen.getByTestId("mobile-market");
    expect(within(section).getByText("Gamma")).toBeDefined();
    const netGamma = within(section).getByText(fmtGammaCompact(GEX_FIXTURE.netGammaAtSpot));
    // regime DAMPEN → text-up (text-down only when AMPLIFY).
    expect(netGamma.className).toContain("text-up");
    expect(within(section).getByText("net γ /1%")).toBeDefined();
    expect(within(section).getByText("0DTE γ")).toBeDefined();
    const zeroDteValue = within(section).getByText(fmtGammaCompact(-3.2));
    expect(zeroDteValue.className).toContain("text-down");
  });

  it("J13a: net γ /1% carries text-down when regime is AMPLIFY", () => {
    renderSection({ regime: "AMPLIFY" });

    const netGamma = screen.getByText(fmtGammaCompact(GEX_FIXTURE.netGammaAtSpot));
    expect(netGamma.className).toContain("text-down");
  });

  it("J13a: Net book greeks 2x2 renders the railGreeks fixture with the GexRail labels/formatting", () => {
    renderSection();

    const section = screen.getByTestId("mobile-market");
    expect(within(section).getByText("Net book greeks")).toBeDefined();
    expect(within(section).getByText("Net Δ")).toBeDefined();
    expect(within(section).getByText(signed(RAIL_GREEKS.delta))).toBeDefined();
    expect(within(section).getByText("Net Γ")).toBeDefined();
    expect(within(section).getByText(signed(RAIL_GREEKS.gamma))).toBeDefined();
    expect(within(section).getByText("Net Θ/d")).toBeDefined();
    expect(within(section).getByText(signedUsd(RAIL_GREEKS.theta))).toBeDefined();
    expect(within(section).getByText("Net Vega")).toBeDefined();
    expect(within(section).getByText(signedUsd(RAIL_GREEKS.vega))).toBeDefined();
  });

  it("J13a: Macro grid — VVIX / Fed funds / 10y−2y / COT lev with the chip formatting", () => {
    renderSection();

    const section = screen.getByTestId("mobile-market");
    expect(within(section).getByText("Macro")).toBeDefined();
    expect(within(section).getByText("VVIX")).toBeDefined();
    expect(within(section).getByText("89.5")).toBeDefined();
    expect(within(section).getByText("Fed funds")).toBeDefined();
    expect(within(section).getByText("4.33%")).toBeDefined();
    expect(within(section).getByText("10y−2y")).toBeDefined();
    expect(within(section).getByText("-0.12")).toBeDefined();
    expect(within(section).getByText("COT lev")).toBeDefined();
    expect(within(section).getByText(signed(-50000))).toBeDefined();
  });

  it("J13a: Macro grid renders — for every null value", () => {
    renderSection({ vvix: null, dff: null, curveSlope: null, cotLev: null, zeroDte: null });

    const section = screen.getByTestId("mobile-market");
    // 4 macro nulls + the null 0DTE γ.
    expect(within(section).getAllByText("—").length).toBeGreaterThanOrEqual(5);
  });

  it("J13b: NO desktop chart leakage — no Dealer γ profile, no GEX by strike, no strike-chart mode tab", () => {
    renderSection();

    expect(screen.queryByText("Dealer γ profile")).toBeNull();
    expect(screen.queryByText("GEX by strike")).toBeNull();
    expect(screen.queryByTestId("toggle-gex")).toBeNull();
  });

  it("J13c: gex === undefined renders the exact unavailable copy instead of the key-levels + gamma blocks", () => {
    renderSection({ gex: undefined });

    const section = screen.getByTestId("mobile-market");
    expect(
      within(section).getByText("GEX data unavailable — run fetch-chain to populate."),
    ).toBeDefined();
    expect(within(section).queryByText("Key levels")).toBeNull();
    expect(within(section).queryByText("net γ /1%")).toBeNull();
    // Net book greeks are priced at gex.spot — without gex they'd show
    // fallback-spot values (WR-01), so the grid hides like desktop GexRail.
    expect(within(section).queryByText("Net book greeks")).toBeNull();
    // Macro grid doesn't depend on gex — still renders.
    expect(within(section).getByText("Macro")).toBeDefined();
  });

  it("J13e: a passed spot override makes the 'Spot' key-level row live-aware, not the raw gex.spot (LIVE-04, catch #20)", () => {
    // Distinct from GEX_FIXTURE.spot (7381.12) and the 5800 engine fallback.
    renderSection({ spot: 7402.875 });

    const section = screen.getByTestId("mobile-market");
    expect(within(section).getByText("7403")).toBeDefined();
    expect(within(section).queryByText("7381")).toBeNull();
  });

  it("J13d: the MarketRail details renders inside the section, closed (no open attribute), summary reads Regime · COT · health", () => {
    renderSection();

    const section = screen.getByTestId("mobile-market");
    const rail = within(section).getByTestId("market-rail");
    expect(rail.hasAttribute("open")).toBe(false);
    expect(within(rail).getByText("Regime · COT · health")).toBeDefined();
  });
});

// ─── Macro-tile trend deltas (2026-07-16: mobile parity with the regime rail chips) ──────
describe("MobileMarketSection — macro delta chips", () => {
  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  const MACRO_HISTORY = {
    VVIX: [
      { time: "2026-07-14", value: 93.5 },
      { time: "2026-07-15", value: 94.3 },
    ],
    DFF: [
      { time: "2026-07-14", value: 4.33 },
      { time: "2026-07-15", value: 4.31 },
    ],
    T10Y2Y: [
      { time: "2026-07-14", value: 0.4 },
      { time: "2026-07-15", value: 0.42 },
    ],
  };

  it("renders direction-colored deltas on the VVIX / Fed funds / 10y−2y / COT lev tiles", () => {
    renderSection({ macro: MACRO_HISTORY, cotLevPrev: -374_000, cotLev: -361_875 });

    expect(screen.getByTestId("mobile-delta-vvix").textContent).toBe("▲0.9%");
    expect(screen.getByTestId("mobile-delta-dff").textContent).toBe("▼2bp");
    expect(screen.getByTestId("mobile-delta-curve").textContent).toBe("▲2bp");
    // −374K → −361.875K = ▲ 12K, 3.2% of |prev|
    expect(screen.getByTestId("mobile-delta-cotlev").textContent).toBe("▲ 12K · 3.2%");
    expect(screen.getByTestId("mobile-delta-vvix").className).toContain("text-up");
    expect(screen.getByTestId("mobile-delta-dff").className).toContain("text-down");
  });

  it("renders NO delta chips when history is missing (never fabricated)", () => {
    renderSection({ macro: undefined, cotLevPrev: null });

    expect(screen.queryByTestId("mobile-delta-vvix")).toBeNull();
    expect(screen.queryByTestId("mobile-delta-dff")).toBeNull();
    expect(screen.queryByTestId("mobile-delta-curve")).toBeNull();
    expect(screen.queryByTestId("mobile-delta-cotlev")).toBeNull();
  });
});
