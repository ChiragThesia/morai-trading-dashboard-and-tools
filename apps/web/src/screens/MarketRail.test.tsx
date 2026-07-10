/**
 * MarketRail.test.tsx — the left context rail composes existing pieces (RegimeBoard dense,
 * CotCard, system health) into one collapsible-on-mobile column. The regime board's own
 * behaviors (banding, tooltips, GATE BLIND independence) stay covered by RegimeBoard.test.tsx;
 * this file only asserts the composition + the dense 2×2 regime grid.
 */
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
});
