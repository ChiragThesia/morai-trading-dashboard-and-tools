/**
 * EventLegRibbon tests — the leg-and-events day timeline that replaced the term-structure
 * inset on the desktop Analyzer (2026-07-15: "we care about the days, not the graph").
 *
 * Layout function invariants:
 *   - window classification: dte ≤ front → "front", ≤ back → "back", else "later"
 *   - events past DTE_MAX are dropped; xPct is the linear day position (dte/DTE_MAX·100)
 *   - near-coincident labels stagger across two lanes so they never overprint
 * Render: leg markers keep the term-structure testids; each event tick is a tooltip chip.
 */
import { describe, it, expect, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import { ribbonLayout, EventLegRibbon } from "./EventLegRibbon.tsx";
import { DTE_MAX } from "./TermStructureChart.tsx";
import type { PickerEvent } from "@morai/contracts";

const ASOF = "2026-07-15";
const EVENTS: ReadonlyArray<PickerEvent> = [
  { date: "2026-07-29", name: "FOMC" }, // 14d — inside a 22d front leg
  { date: "2026-08-07", name: "NFP" }, // 23d — between 22d front and 37d back
  { date: "2026-08-12", name: "CPI" }, // 28d — between
  { date: "2026-09-04", name: "NFP" }, // 51d — after the back leg
  { date: "2026-12-01", name: "FOMC" }, // 139d — beyond DTE_MAX, dropped
];

describe("ribbonLayout", () => {
  it("classifies events by leg window and drops beyond-axis events", () => {
    const items = ribbonLayout(EVENTS, ASOF, 22, 37);
    expect(items.map((i) => `${i.name}:${i.window}`)).toEqual([
      "FOMC:front",
      "NFP:back",
      "CPI:back",
      "NFP:later",
    ]);
  });

  it("positions each event at its linear day fraction of the axis", () => {
    const items = ribbonLayout(EVENTS, ASOF, 22, 37);
    const fomc = items[0];
    expect(fomc).toBeDefined();
    expect(fomc?.xPct).toBeCloseTo((14 / DTE_MAX) * 100, 6);
  });

  it("staggers near-coincident labels across two lanes", () => {
    const crowded: ReadonlyArray<PickerEvent> = [
      { date: "2026-07-29", name: "FOMC" }, // 14d
      { date: "2026-07-31", name: "CPI" }, // 16d — within collision distance
    ];
    const items = ribbonLayout(crowded, ASOF, 22, 37);
    expect(items[0]?.lane).toBe(0);
    expect(items[1]?.lane).toBe(1);
  });
});

describe("EventLegRibbon render", () => {
  afterEach(cleanup);

  const CANDIDATE_LEGS = { frontDte: 22, backDte: 37 };

  it("renders the ribbon with leg markers on the term-structure testids and derived date labels", () => {
    render(<EventLegRibbon events={EVENTS} asOf={ASOF} {...CANDIDATE_LEGS} />);
    expect(screen.getByTestId("event-leg-ribbon")).toBeTruthy();
    expect(screen.getByTestId("term-structure-leg-dot-front")).toBeTruthy();
    expect(screen.getByTestId("term-structure-leg-dot-back")).toBeTruthy();
    // asOf 2026-07-15 + 22d/37d → Aug 6 / Aug 21 (legs carry only DTE, dates are derived).
    expect(screen.getByText("front Aug 6 · 22d")).toBeTruthy();
    expect(screen.getByText("back Aug 21 · 37d")).toBeTruthy();
  });

  it("renders one tooltip chip per in-axis event", () => {
    render(<EventLegRibbon events={EVENTS} asOf={ASOF} {...CANDIDATE_LEGS} />);
    expect(screen.getByTestId("term-structure-chip-2026-07-29-FOMC")).toBeTruthy();
    expect(screen.getByTestId("term-structure-chip-2026-08-07-NFP")).toBeTruthy();
    expect(screen.getByTestId("term-structure-chip-2026-09-04-NFP")).toBeTruthy();
    expect(screen.queryByTestId("term-structure-chip-2026-12-01-FOMC")).toBeNull();
  });
});
