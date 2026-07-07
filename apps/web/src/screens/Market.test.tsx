import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import React from "react";

/**
 * Market screen tests — TDD RED.
 *
 * Mocks:
 *   - useGex: returns controlled snapshot data or undefined
 *   - visx chart packages: no SVG rendering needed in jsdom
 *   - echarts-for-react: canvas stub (see GexBars.test.tsx pattern)
 *   - uplot-related: only if pulled in transitively
 *
 * Asserts:
 *   1. "Net dealer gamma profile" heading renders from live snapshot
 *   2. Regime strip renders (SPX spot / net γ / γ flip / AMPLIFY or DAMPEN)
 *   3. GEX bars region renders (at least the ToggleGroup or GEX heading)
 *   4. Charm/Vanna ComingSoon stub renders with "○ next" badge
 *   5. Intraday flow ComingSoon stub renders with "○ needs denser snapshots" badge
 *   6. "GEX data unavailable" error state renders when useGex returns no data
 */

// ─── Mocks ───────────────────────────────────────────────────────────────────

// Mock useGex — we control the return value per test
vi.mock("../hooks/useGex.ts", () => ({
  useGex: vi.fn(),
}));

// Mock echarts-for-react (canvas fails under jsdom)
vi.mock("echarts-for-react", () => ({
  default: ({ style }: { style?: React.CSSProperties }): React.ReactElement => (
    <div data-testid="echarts-stub" style={style} />
  ),
}));

// Mock visx AreaClosed/LinePath/LinearGradient (SVG rendering is irrelevant in jsdom)
vi.mock("@visx/shape", () => ({
  AreaClosed: (): React.ReactElement => <g data-testid="visx-area" />,
  LinePath: (): React.ReactElement => <g data-testid="visx-line" />,
}));

vi.mock("@visx/gradient", () => ({
  LinearGradient: (): React.ReactElement => <defs />,
}));

vi.mock("@visx/group", () => ({
  Group: ({ children }: { children?: React.ReactNode }): React.ReactElement => (
    <g data-testid="visx-group">{children}</g>
  ),
}));

// Mock @visx/scale (not needed for component tests)
vi.mock("@visx/scale", () => ({
  scaleLinear: () => (v: number) => v,
}));

// ─── Imports AFTER mocks ──────────────────────────────────────────────────────

import { Market } from "./Market.tsx";
import { useGex } from "../hooks/useGex.ts";
import type { GexSnapshotEntry } from "@morai/contracts";

// ─── Fixtures ─────────────────────────────────────────────────────────────────

/** Sample GEX snapshot — net < 0 → AMPLIFY regime. All gamma values in $Bn/1%
 *  units (the domain's dollarGamma scale), matching what prod actually stores. */
const SAMPLE_SNAPSHOT: GexSnapshotEntry = {
  spot: 7381.12,
  flip: null,
  callWall: 7600,
  putWall: 7400,
  netGammaAtSpot: -57.0,
  computedAt: "2026-06-23T14:00:24.000Z",
  profile: [
    { spot: 7000, gamma: -0.8 },
    { spot: 7381, gamma: -57.0 },
    { spot: 7600, gamma: 0.2 },
  ],
  strikes: [
    { k: 7400, gex: -5.97, coi: 17071, poi: 52786, vol: 8406 },
    { k: 7600, gex: 1.23, coi: 69015, poi: 39475, vol: 2228 },
  ],
  byExpiry: [
    { date: "2026-06-27", gex: -10.0 },
    { date: "2026-07-18", gex: -47.0 },
  ],
  nearTerm: null,
};

// ─── Helpers ──────────────────────────────────────────────────────────────────

// eslint-disable-next-line @typescript-eslint/consistent-type-assertions
const mockUseGex = useGex as ReturnType<typeof vi.fn>;

function mockGexWith(data: GexSnapshotEntry | undefined): void {
  mockUseGex.mockReturnValue({
    data,
    isLoading: false,
    isError: false,
    error: null,
  });
}

// ─── Tests ───────────────────────────────────────────────────────────────────

describe("Market", () => {
  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it("renders the three by-strike charts (GEX / OI wall / Volume)", () => {
    mockGexWith(SAMPLE_SNAPSHOT);
    render(<Market />);

    // All three are now separate locked charts (no tab picker)
    expect(screen.getByText("GEX by strike")).toBeTruthy();
    expect(screen.getByText("OI wall by strike")).toBeTruthy();
    expect(screen.getByText("Volume by strike")).toBeTruthy();
  });

  it("renders the regime strip with AMPLIFY for negative net gamma", () => {
    mockGexWith(SAMPLE_SNAPSHOT);
    render(<Market />);

    // The regime strip should show AMPLIFY (netGammaAtSpot < 0)
    const amplifyEl = screen.getByText(/AMPLIFY/i);
    expect(amplifyEl).toBeTruthy();
  });

  it("renders the GEX by strike section", () => {
    mockGexWith(SAMPLE_SNAPSHOT);
    render(<Market />);

    // GEX by strike heading from UI-SPEC
    expect(screen.getByText("GEX by strike")).toBeTruthy();
  });

  it("renders the GEX freshness badge from computedAt", () => {
    mockGexWith(SAMPLE_SNAPSHOT);
    render(<Market />);

    expect(screen.getByTestId("gex-freshness")).toBeTruthy();
    expect(screen.getByText("GEX as of")).toBeTruthy();
  });

  it("renders the locked GEX unavailable copy when useGex returns no data", () => {
    mockGexWith(undefined);
    render(<Market />);

    // Locked empty state copy from UI-SPEC
    expect(screen.getByText("GEX data unavailable — run fetch-chain to populate.")).toBeTruthy();
  });
});

describe("Market — near-term (≤45d) key levels", () => {
  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it("renders near-term wall/flip pills when nearTerm is present", () => {
    mockGexWith({
      ...SAMPLE_SNAPSHOT,
      nearTerm: { callWall: 7550, putWall: 7420, flip: 7480 },
    });
    render(<Market />);

    expect(screen.getByText("Call Wall 45d")).toBeTruthy();
    expect(screen.getByText("7550")).toBeTruthy();
    expect(screen.getByText("Put Wall 45d")).toBeTruthy();
    expect(screen.getByText("7420")).toBeTruthy();
    expect(screen.getByText("γ flip 45d")).toBeTruthy();
  });

  it("renders NO near-term pills when nearTerm is null (pre-0019 snapshot)", () => {
    mockGexWith(SAMPLE_SNAPSHOT); // nearTerm: null
    render(<Market />);

    expect(screen.queryByText("Call Wall 45d")).toBeNull();
    expect(screen.queryByText("Put Wall 45d")).toBeNull();
    expect(screen.queryByText("γ flip 45d")).toBeNull();
  });
});

describe("Market — net γ 0DTE chip", () => {
  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it("renders the 0DTE net gamma from byExpiry when today's expiry is present", () => {
    // SAMPLE computedAt = 2026-06-23T14:00Z → ET date 2026-06-23
    mockGexWith({
      ...SAMPLE_SNAPSHOT,
      byExpiry: [
        { date: "2026-06-23", gex: -9.8 },
        { date: "2026-06-27", gex: 2.1 },
      ],
    });
    render(<Market />);

    expect(screen.getByText("net γ 0DTE")).toBeTruthy();
    expect(screen.getByText("−$9.8B")).toBeTruthy();
  });

  it("renders — when the 0DTE expiry has rolled off the snapshot", () => {
    mockGexWith(SAMPLE_SNAPSHOT); // byExpiry: 06-27 + 07-18 only
    render(<Market />);

    expect(screen.getByText("net γ 0DTE")).toBeTruthy();
    // The em-dash is shared with other empty chips (flip is null in SAMPLE), so
    // assert the ABSENCE of a formatted 0DTE value instead of counting dashes.
    expect(screen.queryByText("−$9.8B")).toBeNull();
    expect(screen.getAllByText("—").length).toBeGreaterThan(0);
  });
});

describe("Market — net γ chip units ($Bn/1% domain scale)", () => {
  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it("formats netGammaAtSpot as $Bn directly (domain emits $Bn units, not raw dollars)", () => {
    mockGexWith({ ...SAMPLE_SNAPSHOT, netGammaAtSpot: -47.43 });
    render(<Market />);

    expect(screen.getByText("−$47.4B /1%")).toBeTruthy();
  });
});
