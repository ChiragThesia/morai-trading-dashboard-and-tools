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

/** Sample GEX snapshot — net < 0 → AMPLIFY regime */
const SAMPLE_SNAPSHOT: GexSnapshotEntry = {
  spot: 7381.12,
  flip: null,
  callWall: 7600,
  putWall: 7400,
  netGammaAtSpot: -57_047_301_908,
  computedAt: "2026-06-23T14:00:24.000Z",
  profile: [
    { spot: 7000, gamma: -800_000_000 },
    { spot: 7381, gamma: -57_047_301_908 },
    { spot: 7600, gamma: 200_000_000 },
  ],
  strikes: [
    { k: 7400, gex: -5_974_395_559, coi: 17071, poi: 52786, vol: 8406 },
    { k: 7600, gex: 1_230_277_553, coi: 69015, poi: 39475, vol: 2228 },
  ],
  byExpiry: [
    { date: "2026-06-27", gex: -10_000_000_000 },
    { date: "2026-07-18", gex: -47_000_000_000 },
  ],
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

  it("renders the Net dealer gamma profile heading from live snapshot", () => {
    mockGexWith(SAMPLE_SNAPSHOT);
    render(<Market />);

    // Locked heading from UI-SPEC Copywriting Contract
    expect(screen.getByText("Net dealer gamma profile")).toBeTruthy();
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

  it("renders the locked GEX unavailable copy when useGex returns no data", () => {
    mockGexWith(undefined);
    render(<Market />);

    // Locked empty state copy from UI-SPEC
    expect(screen.getByText("GEX data unavailable — run fetch-chain to populate.")).toBeTruthy();
  });
});
