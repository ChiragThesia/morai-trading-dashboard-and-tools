/**
 * PositionCard.test.tsx — mobile positions-list card (35-04 Task 2). Fed the SAME Row the
 * desktop table renders; reuses expandedRowKey/onSelectRow and excluded/onToggleExcluded
 * (via onSelect/onToggleIncluded here) — no second expand or exclusion mechanism.
 */
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import type { HeldPositionVerdict, StreamLiveGreekEvent } from "@morai/contracts";
import { PositionCard } from "./PositionCard.tsx";
import type { Row } from "../lib/position-format.ts";

const ROW: Row = {
  key: "$SPX|7425|P",
  label: "7425P",
  expiry: { line1: "Aug 8 → Aug 30", line2: "12d/34d · 22d wide" },
  legs: [
    {
      occSymbol: "SPXW  260807P07425000",
      putCall: "P",
      longQty: 0,
      shortQty: 1,
      averagePrice: 50,
      marketValue: -5000,
      underlyingSymbol: "$SPX",
    },
    {
      occSymbol: "SPXW  260830P07425000",
      putCall: "P",
      longQty: 1,
      shortQty: 0,
      averagePrice: 60,
      marketValue: 6000,
      underlyingSymbol: "$SPX",
    },
  ],
};

const VERDICT: HeldPositionVerdict = {
  calendarId: "cal-hold",
  name: "SPX 30AUG/07AUG 7425P",
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
};

const EMPTY_LIVE_GREEKS: ReadonlyMap<string, StreamLiveGreekEvent> = new Map();

function baseProps(): React.ComponentProps<typeof PositionCard> {
  return {
    row: ROW,
    spot: 5800,
    liveGreeks: EMPTY_LIVE_GREEKS,
    liveStatus: "quiet",
    ivNa: false,
    verdict: null,
    marketSession: "rth",
    expanded: false,
    onSelect: vi.fn(),
    included: true,
    onToggleIncluded: vi.fn(),
  };
}

describe("PositionCard", () => {
  afterEach(() => {
    cleanup();
  });

  it("collapsed: renders label, expiry lines, Net val, Unreal — no greeks grid", () => {
    const { container } = render(<PositionCard {...baseProps()} />);

    expect(screen.getByText("7425P")).toBeDefined();
    expect(container.textContent).toContain("Aug 8 → Aug 30");
    expect(container.textContent).toContain("12d/34d · 22d wide");
    expect(screen.getByText("Net val")).toBeDefined();
    expect(screen.getByText("Unreal")).toBeDefined();
    expect(screen.queryByText("Δ")).toBeNull();
    expect(screen.queryByText("Vega")).toBeNull();
  });

  it("shows the IV n/a badge only when ivNa is true", () => {
    const { rerender } = render(<PositionCard {...baseProps()} ivNa={false} />);
    expect(screen.queryByText("IV n/a")).toBeNull();

    rerender(<PositionCard {...baseProps()} ivNa />);
    expect(screen.getByText("IV n/a")).toBeDefined();
  });

  it("renders the verdict chip only when verdict is not null", () => {
    const { rerender } = render(<PositionCard {...baseProps()} verdict={null} />);
    expect(screen.queryByTestId("held-position-verdict-cal-hold")).toBeNull();

    rerender(<PositionCard {...baseProps()} verdict={VERDICT} />);
    expect(screen.getByTestId("held-position-verdict-cal-hold")).toBeDefined();
  });

  it("expanded: reveals the Δ/Γ/Θ/Vega grid", () => {
    render(<PositionCard {...baseProps()} expanded />);

    expect(screen.getByText("Δ")).toBeDefined();
    expect(screen.getByText("Γ")).toBeDefined();
    expect(screen.getByText("Θ/d")).toBeDefined();
    expect(screen.getByText("Vega")).toBeDefined();
  });

  it("clicking the expand button fires onSelect(row.key) and reflects aria-expanded", () => {
    const onSelect = vi.fn();
    const { rerender } = render(<PositionCard {...baseProps()} onSelect={onSelect} expanded={false} />);

    const button = screen.getByRole("button", { name: /7425P/ });
    expect(button.getAttribute("aria-expanded")).toBe("false");
    fireEvent.click(button);
    expect(onSelect).toHaveBeenCalledWith("$SPX|7425|P");

    rerender(<PositionCard {...baseProps()} onSelect={onSelect} expanded />);
    expect(screen.getByRole("button", { name: /7425P/ }).getAttribute("aria-expanded")).toBe("true");
  });

  it("toggling the checkbox fires onToggleIncluded(row.key) and does NOT fire onSelect", () => {
    const onSelect = vi.fn();
    const onToggleIncluded = vi.fn();
    render(<PositionCard {...baseProps()} onSelect={onSelect} onToggleIncluded={onToggleIncluded} />);

    const checkbox = screen.getByLabelText("Include 7425P in risk profile & total");
    fireEvent.click(checkbox);

    expect(onToggleIncluded).toHaveBeenCalledWith("$SPX|7425|P");
    expect(onSelect).not.toHaveBeenCalled();
  });

  it("dims the card (opacity-40) when not included", () => {
    render(<PositionCard {...baseProps()} included={false} />);
    const card = screen.getByTestId("position-card-$SPX|7425|P");
    expect(card.className).toContain("opacity-40");
  });
});
