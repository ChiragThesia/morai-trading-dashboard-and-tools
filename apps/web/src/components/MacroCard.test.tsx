/**
 * MacroCard.test.tsx — TDD suite for the FRED macro card (Phase 14 FE wiring, D-12).
 *
 * Behaviors under test:
 *   1. Loading state while useMacro is pending (no throw).
 *   2. Empty state ({} map) → "run the job to populate" (never an error, never omitted).
 *   3. Populated: primary series (DFF, SOFR, T10Y2Y, VIXCLS, VVIX) show latest value;
 *      secondary series (DGS1MO, DGS3MO, T10Y3M) also present.
 */

import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";

const { mockUseMacro } = vi.hoisted(() => ({ mockUseMacro: vi.fn() }));
vi.mock("../hooks/useMacro.ts", () => ({ useMacro: mockUseMacro }));

import { MacroCard } from "./MacroCard.tsx";

const MACRO_DATA = {
  DFF: [{ time: "2026-06-29", value: 4.33 }, { time: "2026-06-30", value: 4.33 }],
  SOFR: [{ time: "2026-06-30", value: 4.35 }],
  T10Y2Y: [{ time: "2026-06-30", value: 0.52 }],
  T10Y3M: [{ time: "2026-06-30", value: -0.18 }],
  VIXCLS: [{ time: "2026-06-30", value: 18.9 }],
  VVIX: [{ time: "2026-06-30", value: 89.0 }],
  DGS1MO: [{ time: "2026-06-30", value: 5.28 }],
  DGS3MO: [{ time: "2026-06-30", value: 5.1 }],
};

function setMacro(data: unknown, isPending = false): void {
  mockUseMacro.mockReturnValue({ data, isPending });
}

describe("MacroCard", () => {
  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it("renders a loading state while useMacro is pending", () => {
    setMacro(undefined, true);
    render(<MacroCard />);
    expect(screen.getByTestId("macro-loading")).toBeDefined();
  });

  it("renders the empty 'run the job to populate' state when the map is {}", () => {
    setMacro({}, false);
    render(<MacroCard />);
    expect(screen.getByTestId("macro-empty")).toBeDefined();
    expect(screen.getByText(/run the job to populate/i)).toBeDefined();
  });

  it("renders the primary series with their latest value", () => {
    setMacro(MACRO_DATA, false);
    render(<MacroCard />);
    expect(screen.getByTestId("macro-card")).toBeDefined();
    expect(screen.getByTestId("macro-value-DFF").textContent).toContain("4.33");
    expect(screen.getByTestId("macro-value-SOFR").textContent).toContain("4.35");
    expect(screen.getByTestId("macro-value-T10Y2Y").textContent).toContain("0.52");
    expect(screen.getByTestId("macro-value-VIXCLS").textContent).toContain("18.9");
    expect(screen.getByTestId("macro-value-VVIX").textContent).toContain("89.0");
  });

  it("renders the secondary series alongside the primary set", () => {
    setMacro(MACRO_DATA, false);
    render(<MacroCard />);
    expect(screen.getByTestId("macro-value-DGS1MO").textContent).toContain("5.28");
    expect(screen.getByTestId("macro-value-DGS3MO").textContent).toContain("5.10");
    expect(screen.getByTestId("macro-value-T10Y3M").textContent).toContain("-0.18");
  });
});
