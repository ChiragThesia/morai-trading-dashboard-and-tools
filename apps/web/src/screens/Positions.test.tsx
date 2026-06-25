/**
 * Positions.test.tsx — TDD suite for the Positions screen (Plan 06 Task 3)
 *
 * Behavior under test (per UI-SPEC and plan behavior block):
 *   1. Empty positions → locked "No open positions…" copy (D-04)
 *   2. With one position:
 *      a. Attribution waterfall "Why it's moving" renders (5-item set)
 *      b. Position KPI labels render: Mark · Debit · Unreal · DTE
 *      c. Per-leg greeks table columns render
 *   3. Loading state → no crash, no empty-state copy
 *
 * Mocks:
 *   - usePositions: mock hook (no real API calls)
 *   - useGex: mock hook (GEX data for level bar / strike structure)
 *   - uplot-react: passthrough mock (same pattern as GreekStrips.test.tsx)
 *   - uPlot CSS: no-op
 *   - rpc.ts / supabase.ts: prevent real network calls
 */

import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

// ─── Mock uplot-react + CSS before any import loads uPlot CJS ────────────────
vi.mock("uplot-react", () => ({
  default: () => <div data-testid="uplot-mock" />,
}));

vi.mock("uplot/dist/uPlot.min.css", () => ({}));

// ─── Mock hooks + infra ──────────────────────────────────────────────────────
vi.mock("../hooks/usePositions.ts", () => ({
  usePositions: vi.fn(),
}));

vi.mock("../hooks/useGex.ts", () => ({
  useGex: vi.fn(),
}));

vi.mock("../lib/rpc.ts", () => ({
  setAuthToken: vi.fn(),
  apiFetch: vi.fn(),
  rpc: {},
}));

vi.mock("../lib/supabase.ts", () => ({
  supabase: {
    auth: {
      getSession: vi.fn().mockResolvedValue({ data: { session: null }, error: null }),
      onAuthStateChange: vi.fn(() => ({
        data: { subscription: { unsubscribe: vi.fn() } },
      })),
    },
  },
}));

// ─── Import screen + mocks (AFTER vi.mock hoisting) ──────────────────────────
import { Positions } from "./Positions.tsx";
import { usePositions } from "../hooks/usePositions.ts";
import { useGex } from "../hooks/useGex.ts";

const mockUsePositions = vi.mocked(usePositions);
const mockUseGex = vi.mocked(useGex);

// ─── Fixtures ─────────────────────────────────────────────────────────────────

function makePosition() {
  return {
    occSymbol: "SPX   260612P07400000",
    putCall: "P" as const,
    longQty: 1,
    shortQty: 0,
    averagePrice: 12.5,
    marketValue: 14.2,
    underlyingSymbol: "SPX",
  };
}

function makeGexData() {
  return {
    cycleTime: "2026-06-12T14:30:00Z",
    spot: 5800,
    flip: 5750,
    callWall: 6000,
    putWall: 5500,
    netGammaAtSpot: -57,
    profile: [],
    strikes: [],
    byExpiry: [],
  };
}

function renderPositions() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <Positions />
    </QueryClientProvider>,
  );
}

// ─── Default GEX mock ─────────────────────────────────────────────────────────

function setDefaultGexMock() {
  // eslint-disable-next-line @typescript-eslint/consistent-type-assertions
  mockUseGex.mockReturnValue({
    data: makeGexData(),
    isPending: false,
  } as unknown as ReturnType<typeof useGex>);
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("Positions screen", () => {
  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it("renders locked empty-state copy when usePositions returns an empty array", () => {
    setDefaultGexMock();
    // eslint-disable-next-line @typescript-eslint/consistent-type-assertions
    mockUsePositions.mockReturnValue({
      data: { positions: [] },
      isPending: false,
    } as unknown as ReturnType<typeof usePositions>);

    renderPositions();

    expect(
      screen.getByText(
        /No open positions\. Register a calendar via the API or paste a TOS order to analyze a scenario\./,
      ),
    ).toBeDefined();
  });

  it("does not render empty-state copy when a position exists", () => {
    setDefaultGexMock();
    // eslint-disable-next-line @typescript-eslint/consistent-type-assertions
    mockUsePositions.mockReturnValue({
      data: { positions: [makePosition()] },
      isPending: false,
    } as unknown as ReturnType<typeof usePositions>);

    renderPositions();

    expect(
      screen.queryByText(/No open positions\./),
    ).toBeNull();
  });

  it("renders the 'Why it's moving' heading when a position is selected", () => {
    setDefaultGexMock();
    // eslint-disable-next-line @typescript-eslint/consistent-type-assertions
    mockUsePositions.mockReturnValue({
      data: { positions: [makePosition()] },
      isPending: false,
    } as unknown as ReturnType<typeof usePositions>);

    renderPositions();

    expect(screen.getByText("Why it's moving")).toBeDefined();
  });

  it("renders the Position KPI label 'Mark' when a position is selected", () => {
    setDefaultGexMock();
    // eslint-disable-next-line @typescript-eslint/consistent-type-assertions
    mockUsePositions.mockReturnValue({
      data: { positions: [makePosition()] },
      isPending: false,
    } as unknown as ReturnType<typeof usePositions>);

    renderPositions();

    // "Mark" appears in both the KPI grid and per-leg table — use getAllByText
    const markEls = screen.getAllByText("Mark");
    expect(markEls.length).toBeGreaterThan(0);
  });

  it("renders the Position KPI label 'Debit' when a position is selected", () => {
    setDefaultGexMock();
    // eslint-disable-next-line @typescript-eslint/consistent-type-assertions
    mockUsePositions.mockReturnValue({
      data: { positions: [makePosition()] },
      isPending: false,
    } as unknown as ReturnType<typeof usePositions>);

    renderPositions();

    expect(screen.getByText("Debit")).toBeDefined();
  });

  it("renders the Position KPI label 'Unreal' when a position is selected", () => {
    setDefaultGexMock();
    // eslint-disable-next-line @typescript-eslint/consistent-type-assertions
    mockUsePositions.mockReturnValue({
      data: { positions: [makePosition()] },
      isPending: false,
    } as unknown as ReturnType<typeof usePositions>);

    renderPositions();

    expect(screen.getByText("Unreal")).toBeDefined();
  });

  it("renders the Position KPI label 'DTE' when a position is selected", () => {
    setDefaultGexMock();
    // eslint-disable-next-line @typescript-eslint/consistent-type-assertions
    mockUsePositions.mockReturnValue({
      data: { positions: [makePosition()] },
      isPending: false,
    } as unknown as ReturnType<typeof usePositions>);

    renderPositions();

    expect(screen.getByText("DTE")).toBeDefined();
  });

  it("renders per-leg greeks table column header 'Δ' when a position is selected", () => {
    setDefaultGexMock();
    // eslint-disable-next-line @typescript-eslint/consistent-type-assertions
    mockUsePositions.mockReturnValue({
      data: { positions: [makePosition()] },
      isPending: false,
    } as unknown as ReturnType<typeof usePositions>);

    renderPositions();

    expect(screen.getByText("Δ")).toBeDefined();
  });

  it("does not crash during loading state (isPending=true)", () => {
    setDefaultGexMock();
    // eslint-disable-next-line @typescript-eslint/consistent-type-assertions
    mockUsePositions.mockReturnValue({
      data: undefined,
      isPending: true,
    } as unknown as ReturnType<typeof usePositions>);

    expect(() => {
      renderPositions();
    }).not.toThrow();

    expect(screen.queryByText(/No open positions\./)).toBeNull();
  });

  it("renders the 'Open' heading (UI-SPEC locked copy for positions list)", () => {
    setDefaultGexMock();
    // eslint-disable-next-line @typescript-eslint/consistent-type-assertions
    mockUsePositions.mockReturnValue({
      data: { positions: [] },
      isPending: false,
    } as unknown as ReturnType<typeof usePositions>);

    renderPositions();

    expect(screen.getByText("Open")).toBeDefined();
  });
});
