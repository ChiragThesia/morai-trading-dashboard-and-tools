/**
 * PositionCard.test.tsx — mobile positions-list card, D-07 re-hierarchy (35.1-03).
 * Row 1: label + IV-n/a badge + VerdictChip left, focal unreal P&L right (16px mono
 * bold, sign-colored). Row 2: one muted meta line (expiry · DTE · net val). Expand:
 * greeks grid always (catch #23 — never gated on verdict) + VerdictDetailBody when a
 * verdict exists. Fed the SAME Row the desktop table renders; reuses
 * expandedRowKey/onSelectRow and excluded/onToggleExcluded (via onSelect/
 * onToggleIncluded here) — no second expand or exclusion mechanism.
 */
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import type { HeldPositionVerdict, StreamLiveGreekEvent } from "@morai/contracts";
import { PositionCard } from "./PositionCard.tsx";
import { resolveLivePositionRow } from "../lib/live-position-greeks.ts";
import { usd, signedUsd, signClass } from "../lib/position-format.ts";
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

/** Same row with no cost basis anywhere — resolveLivePositionRow yields unreal: null. */
const ROW_NO_BASIS: Row = {
  ...ROW,
  legs: ROW.legs.map((l) => ({ ...l, averagePrice: null })),
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
    ivNa: false,
    verdict: null,
    marketSession: "rth",
    expanded: false,
    onSelect: vi.fn(),
    included: true,
    onToggleIncluded: vi.fn(),
    verdictObservedAt: null,
  };
}

describe("PositionCard", () => {
  afterEach(() => {
    cleanup();
  });

  // ── J10a: row 1 — focal unreal P&L, old Stat labels gone ──────────────────────

  it("J10a: renders the unreal value as the 16px mono bold sign-colored focal number", () => {
    const { unreal } = resolveLivePositionRow(ROW.legs, 5800, EMPTY_LIVE_GREEKS);
    expect(unreal).not.toBeNull();
    if (unreal === null) return;

    render(<PositionCard {...baseProps()} />);

    const focal = screen.getByText(signedUsd(unreal));
    expect(focal.className).toContain("font-mono");
    expect(focal.className).toContain("text-base");
    expect(focal.className).toContain("font-bold");
    expect(focal.className).toContain("tabular-nums");
    expect(focal.className).toContain(signClass(unreal));
  });

  it("J10a: renders — with text-dim when unreal is null (no cost basis)", () => {
    render(<PositionCard {...baseProps()} row={ROW_NO_BASIS} />);

    const focal = screen.getByText("—");
    expect(focal.className).toContain("text-dim");
    expect(focal.className).toContain("font-mono");
    expect(focal.className).toContain("text-base");
  });

  it("J10a: the old two-Stat 'Net val'/'Unreal' labels are gone", () => {
    render(<PositionCard {...baseProps()} />);

    expect(screen.queryByText("Net val")).toBeNull();
    expect(screen.queryByText("Unreal")).toBeNull();
  });

  // ── J10b: row 2 — one muted meta line ─────────────────────────────────────────

  it("J10b: renders one meta line — expiry line1 · line2 · usd(netVal) — with the muted mono classes", () => {
    const { netVal } = resolveLivePositionRow(ROW.legs, 5800, EMPTY_LIVE_GREEKS);

    render(<PositionCard {...baseProps()} />);

    const meta = screen.getByText(
      `${ROW.expiry.line1} · ${ROW.expiry.line2} · ${usd(netVal)}`,
    );
    expect(meta.className).toContain("font-mono");
    expect(meta.className).toContain("text-[10px]");
    expect(meta.className).toContain("text-dim");
    expect(meta.className).toContain("truncate");
  });

  // ── J10c: card surface ─────────────────────────────────────────────────────────

  it("J10c: card surface carries bg-raise/30 + ring-1 ring-line (card-not-table-row cue)", () => {
    render(<PositionCard {...baseProps()} />);

    const card = screen.getByTestId("position-card-$SPX|7425|P");
    expect(card.className).toContain("bg-raise/30");
    expect(card.className).toContain("ring-1");
    expect(card.className).toContain("ring-line");
  });

  it("J10c: dims the card (opacity-40) when not included", () => {
    render(<PositionCard {...baseProps()} included={false} />);
    const card = screen.getByTestId("position-card-$SPX|7425|P");
    expect(card.className).toContain("opacity-40");
  });

  // ── J10d: expand — greeks grid always, VerdictDetailBody when verdict exists ──

  it("J10d: expanded with a verdict renders the greeks grid AND the VerdictDetailBody rule/metric line", () => {
    render(
      <PositionCard
        {...baseProps()}
        expanded
        verdict={VERDICT}
        verdictObservedAt="2026-07-11T14:30:00Z"
      />,
    );

    expect(screen.getByText("Δ")).toBeDefined();
    expect(screen.getByText("Vega")).toBeDefined();
    const rule = screen.getByTestId("held-position-rule-cal-hold");
    expect(rule.textContent).toBe("hold · pnlPct +2.0%");
  });

  it("J10d: expanded with verdict null renders the greeks grid only (expand un-gated, catch #23)", () => {
    render(<PositionCard {...baseProps()} expanded verdict={null} />);

    expect(screen.getByText("Δ")).toBeDefined();
    expect(screen.getByText("Γ")).toBeDefined();
    expect(screen.getByText("Θ/d")).toBeDefined();
    expect(screen.getByText("Vega")).toBeDefined();
    expect(screen.queryByTestId("held-position-rule-cal-hold")).toBeNull();
  });

  it("collapsed: no greeks grid, no verdict detail", () => {
    render(<PositionCard {...baseProps()} verdict={VERDICT} />);

    expect(screen.queryByText("Δ")).toBeNull();
    expect(screen.queryByText("Vega")).toBeNull();
    expect(screen.queryByTestId("held-position-rule-cal-hold")).toBeNull();
  });

  // ── J10e: unchanged behaviors re-asserted ─────────────────────────────────────

  it("shows the IV n/a badge only when ivNa is true", () => {
    const { rerender } = render(<PositionCard {...baseProps()} ivNa={false} />);
    expect(screen.queryByText("IV n/a")).toBeNull();

    rerender(<PositionCard {...baseProps()} ivNa />);
    expect(screen.getByText("IV n/a")).toBeDefined();
  });

  it("renders the verdict chip in row 1 only when verdict is not null", () => {
    const { rerender } = render(<PositionCard {...baseProps()} verdict={null} />);
    expect(screen.queryByTestId("held-position-verdict-cal-hold")).toBeNull();

    rerender(<PositionCard {...baseProps()} verdict={VERDICT} />);
    expect(screen.getByTestId("held-position-verdict-cal-hold")).toBeDefined();
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
});
