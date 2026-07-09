/**
 * RegimeBoard.test.tsx — TDD suite for the Regime & Breadth board (Phase 24, BOARD-01/02).
 *
 * Behaviors under test:
 *   1. Loading / empty / error states use the exact 24-UI-SPEC.md copy.
 *   2. All 4 indicators present → one regime-chip-{id} per indicator, each with a
 *      band-colored value + dot and an "as of {date}" stamp.
 *   3. Partial data (2 of 4) → exactly 2 chips, no placeholder/dash chip for the missing 2.
 *   4. Provenance: the regime-why-{id} ⓘ trigger's tooltip shows the payload's own
 *      source + rationale verbatim — not a hardcoded per-indicator lookup.
 */
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { assertDefined } from "@morai/shared";
import type { RegimeResponse } from "@morai/contracts";

const { mockUseRegimeBoard } = vi.hoisted(() => ({ mockUseRegimeBoard: vi.fn() }));
vi.mock("../hooks/useRegimeBoard.ts", () => ({ useRegimeBoard: mockUseRegimeBoard }));

import { RegimeBoard } from "./RegimeBoard.tsx";

const INDICATORS: RegimeResponse = [
  {
    id: "vix-term-structure",
    label: "VIX/VIX3M Term Structure",
    value: 0.92,
    band: "warning",
    asOf: "2026-07-08",
    source: "eco3min.fr, systemtrader.co",
    rationale: "0.90 warn / 0.95 crisis, confirmed by independent sources.",
  },
  {
    id: "vvix",
    label: "VVIX",
    value: 89.0,
    band: "calm",
    asOf: "2026-07-08",
    source: "SpotGamma, TOS Indicators",
    rationale: "100 warn confirmed directly by 4 independent sources.",
  },
  {
    id: "vix9d-vix",
    label: "VIX9D/VIX",
    value: 1.15,
    band: "crisis",
    asOf: "2026-07-08",
    source: "topstep.com, macroption.com, cboe.com",
    rationale: "[ASSUMED] structural analogy to the VIX/VIX3M ratio.",
  },
  {
    id: "hy-oas",
    label: "HY OAS (Credit Spread)",
    value: 3.4,
    band: "warning",
    asOf: "2026-07-07",
    source: "eco3min.fr, macroradar.io, convextrade.com",
    rationale: "Synthesized from 3 practitioner sources.",
  },
];

function setRegimeBoard(data: unknown, opts: { isPending?: boolean; isError?: boolean } = {}): void {
  mockUseRegimeBoard.mockReturnValue({
    data,
    isPending: opts.isPending ?? false,
    isError: opts.isError ?? false,
  });
}

describe("RegimeBoard", () => {
  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it("renders the loading copy while useRegimeBoard is pending", () => {
    setRegimeBoard(undefined, { isPending: true });
    render(<RegimeBoard />);
    expect(screen.getByText("Loading regime board…")).toBeDefined();
  });

  it("renders the empty-state copy when the array is []", () => {
    setRegimeBoard([]);
    render(<RegimeBoard />);
    expect(
      screen.getByText("Regime data unavailable — run fetch-rates to populate."),
    ).toBeDefined();
  });

  it("renders the error-state copy when the query errors", () => {
    setRegimeBoard(undefined, { isError: true });
    render(<RegimeBoard />);
    expect(
      screen.getByText("Regime board unavailable — check the FRED/CBOE fetch job."),
    ).toBeDefined();
  });

  it("renders one chip per present indicator, with band-colored value + dot and an as-of date", () => {
    setRegimeBoard(INDICATORS);
    render(<RegimeBoard />);

    for (const ind of INDICATORS) {
      expect(screen.getByTestId(`regime-chip-${ind.id}`)).toBeDefined();
      const value = screen.getByTestId(`regime-value-${ind.id}`);
      expect(value.textContent).toContain(ind.value.toFixed(2));
      expect(screen.getByTestId(`regime-asof-${ind.id}`).textContent).toBe(`as of ${ind.asOf}`);
    }

    // calm → up token, warning → amber token, crisis → down token (dot + value).
    expect(screen.getByTestId("regime-band-vvix").className).toContain("bg-up");
    expect(screen.getByTestId("regime-value-vvix").className).toContain("text-up");
    expect(screen.getByTestId("regime-band-vix-term-structure").className).toContain("bg-amber");
    expect(screen.getByTestId("regime-value-vix-term-structure").className).toContain("text-amber");
    expect(screen.getByTestId("regime-band-vix9d-vix").className).toContain("bg-down");
    expect(screen.getByTestId("regime-value-vix9d-vix").className).toContain("text-down");
  });

  it("renders exactly 2 chips for 2-of-4 present indicators — no placeholder/dash chip", () => {
    setRegimeBoard(INDICATORS.slice(0, 2));
    render(<RegimeBoard />);

    expect(screen.getByTestId("regime-chip-vix-term-structure")).toBeDefined();
    expect(screen.getByTestId("regime-chip-vvix")).toBeDefined();
    expect(screen.queryByTestId("regime-chip-vix9d-vix")).toBeNull();
    expect(screen.queryByTestId("regime-chip-hy-oas")).toBeNull();
    expect(screen.queryByText("—")).toBeNull();
  });

  it("the ⓘ trigger's tooltip renders the indicator's own source + rationale verbatim", async () => {
    const user = userEvent.setup();
    setRegimeBoard(INDICATORS);
    render(<RegimeBoard />);

    await user.hover(screen.getByTestId("regime-why-hy-oas"));

    const hyOas = INDICATORS.find((ind) => ind.id === "hy-oas");
    assertDefined(hyOas, "hy-oas fixture present");
    expect(await screen.findByText(hyOas.source)).toBeDefined();
    expect(await screen.findByText(hyOas.rationale)).toBeDefined();
  });
});
