/// <reference types="bun" />
/**
 * MarketRail.test.tsx — the left context rail composes existing pieces (RegimeBoard dense,
 * CotCard, system health) into one collapsible-on-mobile column. The regime board's own
 * behaviors (banding, tooltips, GATE BLIND independence) stay covered by RegimeBoard.test.tsx;
 * this file only asserts the composition + the dense 2×2 regime grid.
 *
 * apps/web's tsconfig sets `types: []` (keeps Node/Bun globals out of browser code); this
 * file alone needs `node:fs` for the source-grep guard below, so it opts in locally.
 */
import { readFileSync } from "node:fs";
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";

const { mockUseRegimeBoard } = vi.hoisted(() => ({ mockUseRegimeBoard: vi.fn() }));
vi.mock("../hooks/useRegimeBoard.ts", () => ({ useRegimeBoard: mockUseRegimeBoard }));

const { mockUsePicker } = vi.hoisted(() => ({ mockUsePicker: vi.fn(() => ({ data: null, isPending: false, isError: false })) }));
vi.mock("../hooks/usePicker.ts", () => ({ usePicker: mockUsePicker }));

const { mockUseMacro } = vi.hoisted(() => ({ mockUseMacro: vi.fn(() => ({ data: undefined, isPending: false })) }));
vi.mock("../hooks/useMacro.ts", () => ({ useMacro: mockUseMacro }));

const { mockUseCot } = vi.hoisted(() => ({ mockUseCot: vi.fn(() => ({ data: undefined })) }));
vi.mock("../hooks/useCot.ts", () => ({ useCot: mockUseCot }));
vi.mock("../hooks/useNews.ts", () => ({ useNews: vi.fn(() => ({ data: undefined })) }));

const { mockUseStatus } = vi.hoisted(() => ({ mockUseStatus: vi.fn(() => ({ data: undefined })) }));
vi.mock("../hooks/useStatus.ts", () => ({ useStatus: mockUseStatus }));

import { MarketRail } from "./MarketRail.tsx";

const INDICATORS = [
  {
    id: "vvix",
    label: "VVIX",
    value: 89.0,
    band: "calm" as const,
    bandWarn: 100,
    bandCrisis: 115,
    asOf: "2026-07-08",
    source: "SpotGamma",
    rationale: "100 warn.",
  },
  {
    id: "hy-oas",
    label: "HY OAS",
    value: 3.4,
    band: "warning" as const,
    bandWarn: 3.0,
    bandCrisis: 5.0,
    asOf: "2026-07-07",
    source: "eco3min.fr",
    rationale: "Synthesized.",
  },
];

describe("MarketRail", () => {
  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it("composes the regime board, COT card, and system-health list into one rail", () => {
    mockUseRegimeBoard.mockReturnValue({ data: INDICATORS, isPending: false, isError: false });
    render(<MarketRail />);

    expect(screen.getByTestId("market-rail")).toBeDefined();
    expect(screen.getByText("Market regime")).toBeDefined();
    expect(screen.getByTestId("regime-chip-vvix")).toBeDefined();
    // COT empty-state still renders the card shell (data undefined in this file).
    expect(screen.getByTestId("cot-empty")).toBeDefined();
    // System health (status undefined -> loading copy).
    expect(screen.getByText("System status loading…")).toBeDefined();
  });

  it("renders the regime indicators as a stacked compact-row list (not a card grid) in the narrow rail", () => {
    mockUseRegimeBoard.mockReturnValue({ data: INDICATORS, isPending: false, isError: false });
    const { container } = render(<MarketRail />);
    const board = container.querySelector('[data-testid="regime-board"]');
    expect(board).not.toBeNull();
    for (const ind of INDICATORS) {
      expect(screen.getByTestId(`regime-chip-${ind.id}`)).toBeDefined();
    }
    // No 4-across desktop card grid inside the narrow rail — rows, scanned top-to-bottom.
    expect(board?.innerHTML).not.toContain("md:grid-cols-4");
  });

  it("J12a (35.1 D-14): the summary reads 'Regime · COT · health' — the rail sits inside a section already headed MARKET", () => {
    mockUseRegimeBoard.mockReturnValue({ data: INDICATORS, isPending: false, isError: false });
    render(<MarketRail />);

    expect(screen.getByText("Regime · COT · health")).toBeDefined();
  });

  it("defaults closed — no hardcoded open attribute (Pitfall 1 regression guard)", () => {
    mockUseRegimeBoard.mockReturnValue({ data: INDICATORS, isPending: false, isError: false });
    render(<MarketRail />);

    expect(screen.getByTestId("market-rail").hasAttribute("open")).toBe(false);
  });

  it("merges a passed className onto the details element", () => {
    mockUseRegimeBoard.mockReturnValue({ data: INDICATORS, isPending: false, isError: false });
    render(<MarketRail className="order-2 lg:order-1" />);

    expect(screen.getByTestId("market-rail").className).toContain("order-2");
  });
});

describe("MarketRail — desktop force-open via matchMedia (live-UAT catch 2026-07-11)", () => {
  // A closed <details> hides its content in the UA's internal slot — CSS display
  // overrides on children (`lg:[&>div]:!block`) CANNOT reveal it in a real browser,
  // so at ≥1024px the whole left rail rendered EMPTY (jsdom class assertions were
  // structurally blind to this). The rail must set the `open` attribute itself when
  // the desktop media query matches.
  afterEach(() => {
    cleanup();
    // each test that stubs matchMedia restores it
    Reflect.deleteProperty(window, "matchMedia");
  });

  it("sets the open attribute when (min-width: 1024px) matches", () => {
    const listeners: Array<() => void> = [];
    Object.defineProperty(window, "matchMedia", {
      configurable: true,
      writable: true,
      value: (query: string) => ({
        matches: query === "(min-width: 1024px)",
        media: query,
        addEventListener: (_: string, cb: () => void) => listeners.push(cb),
        removeEventListener: () => undefined,
      }),
    });
    mockUseRegimeBoard.mockReturnValue({ data: INDICATORS, isPending: false, isError: false });
    render(<MarketRail />);
    expect(screen.getByTestId("market-rail").hasAttribute("open")).toBe(true);
  });

  it("stays closed by default when matchMedia reports non-desktop", () => {
    Object.defineProperty(window, "matchMedia", {
      configurable: true,
      writable: true,
      value: (query: string) => ({
        matches: false,
        media: query,
        addEventListener: () => undefined,
        removeEventListener: () => undefined,
      }),
    });
    mockUseRegimeBoard.mockReturnValue({ data: INDICATORS, isPending: false, isError: false });
    render(<MarketRail />);
    expect(screen.getByTestId("market-rail").hasAttribute("open")).toBe(false);
  });
});

describe("MarketRail — liveIndices/liveStatus forwarding (Phase 38-06, LIVE-05, D-06)", () => {
  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  const LIVE_INDICES = { vix: 18.5, vvix: 92.1, vix9d: 19.2, vix3m: 19.8, ts: "2026-07-13T14:00:00Z" };

  it("forwards liveIndices/liveStatus to RegimeBoard — the live regime value reaches the rail", () => {
    mockUseRegimeBoard.mockReturnValue({ data: INDICATORS, isPending: false, isError: false });
    render(<MarketRail liveIndices={LIVE_INDICES} liveStatus="live" />);

    // vvix EOD fixture is 89.00/calm; live 92.1 is a distinct, non-round value (catch #20)
    // proving the live number flows through MarketRail into RegimeBoard.
    expect(screen.getByTestId("regime-value-vvix").textContent).toBe("92.10");
  });

  it("never calls useLiveStream itself — receives liveIndices/liveStatus as props only (D-06 one-hook-per-surface)", () => {
    const source = readFileSync("apps/web/src/screens/MarketRail.tsx", "utf-8");
    expect(source).not.toContain("useLiveStream(");
  });

  it("RegimeBoard is memoized — an unchanged liveIndices/liveStatus reference on parent re-render does not re-run it (RESEARCH Pitfall 4)", () => {
    mockUseRegimeBoard.mockReturnValue({ data: INDICATORS, isPending: false, isError: false });
    const { rerender } = render(<MarketRail liveIndices={LIVE_INDICES} liveStatus="live" />);
    const callsAfterMount = mockUseRegimeBoard.mock.calls.length;

    // Simulates a 1/sec spot tick elsewhere on the Overview tree re-rendering the parent —
    // same liveIndices object reference, same liveStatus string — RegimeBoard must not re-run.
    rerender(<MarketRail liveIndices={LIVE_INDICES} liveStatus="live" />);
    expect(mockUseRegimeBoard.mock.calls.length).toBe(callsAfterMount);
  });
});
