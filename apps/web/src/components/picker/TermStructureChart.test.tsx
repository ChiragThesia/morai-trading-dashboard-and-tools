/**
 * TermStructureChart.test.tsx — re-expressed against the Recharts DOM (33-04). Covers the
 * UI-SPEC contract: term-structure Line, amber event ReferenceLines, front/back leg
 * ReferenceDots, the forward-IV bracket (ReferenceLine segment, present for a normal
 * candidate), and the guard-case bracket omission + `guard` tag (T-18-10: no throw/NaN/
 * fabricated bracket). Coordinate-exact leg-dot assertions (33-03-era xScale/yScale) are
 * re-expressed to color + relative-position intent — Recharts owns the scale math now.
 */
import { describe, it, expect, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import { mockResponsiveContainer } from "../test/recharts-test-utils.tsx";

mockResponsiveContainer();

import { pickerSnapshotFixture } from "@morai/contracts";
import type { PickerCandidate } from "@morai/contracts";
import { TermStructureChart } from "./TermStructureChart.tsx";

const { termStructure, events } = pickerSnapshotFixture;
const ASOF = pickerSnapshotFixture.asOf; // "2026-07-02" — reference date the DTE fields are relative to
const CANDIDATES = pickerSnapshotFixture.candidates;

function findCandidate(id: string): PickerCandidate {
  const found = CANDIDATES.find((c) => c.id === id);
  if (found === undefined) throw new Error(`fixture candidate not found: ${id}`);
  return found;
}

const NORMAL = findCandidate("7500-260723-260814");
const GUARD = findCandidate("7450-guard-inverted");

describe("TermStructureChart — term line + event markers + leg dots", () => {
  afterEach(cleanup);

  it("renders the term-structure polyline", () => {
    render(<TermStructureChart termStructure={termStructure} events={events} asOf={ASOF} candidate={NORMAL} />);
    expect(screen.getByTestId("term-structure-line")).toBeTruthy();
  });

  it("renders one amber marker per fixture event (all fall within the fixed 0-82 DTE axis)", () => {
    render(<TermStructureChart termStructure={termStructure} events={events} asOf={ASOF} candidate={NORMAL} />);
    const markers = screen.getAllByTestId(/^term-structure-event-/);
    expect(markers.length).toBe(events.length);
  });

  it("renders a dated event legend, tagged by leg (front ◂f / back ◂b)", () => {
    render(<TermStructureChart termStructure={termStructure} events={events} asOf={ASOF} candidate={NORMAL} />);
    const legend = screen.getByTestId("term-structure-legend");
    // Each event shows its calendar date + name (e.g. "Jul 3 NFP").
    expect(legend.textContent).toMatch(/[A-Z][a-z]{2} \d+ (NFP|CPI|FOMC)/);
    // NORMAL's front leg (21 DTE) spans early events, back leg (43 DTE) spans mid events.
    expect(legend.textContent).toContain("◂f");
    expect(legend.textContent).toContain("◂b");
  });

  it("renders the front leg dot coral, left of the back leg dot (front DTE < back DTE)", () => {
    render(<TermStructureChart termStructure={termStructure} events={events} asOf={ASOF} candidate={NORMAL} />);
    const front = screen.getByTestId("term-structure-leg-dot-front");
    const back = screen.getByTestId("term-structure-leg-dot-back");
    expect(front.getAttribute("fill")).toBe("#ef5350");
    expect(Number(front.getAttribute("cx"))).toBeLessThan(Number(back.getAttribute("cx")));
  });

  it("renders the back leg dot teal, higher than the front leg dot (back IV > front IV)", () => {
    render(<TermStructureChart termStructure={termStructure} events={events} asOf={ASOF} candidate={NORMAL} />);
    const front = screen.getByTestId("term-structure-leg-dot-front");
    const back = screen.getByTestId("term-structure-leg-dot-back");
    expect(back.getAttribute("fill")).toBe("#26a69a");
    // Higher IV sits higher on the chart, i.e. a smaller pixel y.
    expect(Number(back.getAttribute("cy"))).toBeLessThan(Number(front.getAttribute("cy")));
  });
});

describe("TermStructureChart — event placement is driven by asOf (WR-03)", () => {
  afterEach(cleanup);

  it("places the same event at a different x for a later asOf (not a hardcoded reference date)", () => {
    const ev = [{ date: "2026-07-22", name: "TEST" }];

    render(<TermStructureChart termStructure={termStructure} events={ev} asOf="2026-07-02" candidate={NORMAL} />);
    const earlyLine = screen.getByTestId("term-structure-event-2026-07-22-TEST");
    const earlyX = Number(earlyLine.getAttribute("x1"));
    cleanup();

    render(<TermStructureChart termStructure={termStructure} events={ev} asOf="2026-07-12" candidate={NORMAL} />);
    const lateLine = screen.getByTestId("term-structure-event-2026-07-22-TEST");
    const lateX = Number(lateLine.getAttribute("x1"));

    // A later snapshot date → smaller DTE for the same absolute event → smaller x.
    // Only holds if placement is driven by the passed asOf, not a module constant.
    expect(lateX).toBeLessThan(earlyX);
  });
});

describe("TermStructureChart — forward-IV bracket (normal candidate)", () => {
  afterEach(cleanup);

  it("renders a forward-IV bracket between the two leg x-positions", () => {
    render(<TermStructureChart termStructure={termStructure} events={events} asOf={ASOF} candidate={NORMAL} />);
    const bracket = screen.getByTestId("term-structure-fwd-bracket");
    expect(bracket.getAttribute("stroke")).toBe("#5b9cf6");
    expect(screen.queryByTestId("term-structure-guard-tag")).toBeNull();
  });
});

describe("TermStructureChart — guard case (fwdIv null, T-18-10)", () => {
  afterEach(cleanup);

  it("omits the forward-IV bracket and renders the guard tag instead — no throw, no NaN", () => {
    const { container } = render(
      <TermStructureChart termStructure={termStructure} events={events} asOf={ASOF} candidate={GUARD} />,
    );
    expect(screen.queryByTestId("term-structure-fwd-bracket")).toBeNull();
    expect(screen.getByTestId("term-structure-guard-tag")).toBeTruthy();
    expect(container.innerHTML).not.toContain("NaN");
  });

  it("still renders the leg dots and term line for the guard candidate", () => {
    render(<TermStructureChart termStructure={termStructure} events={events} asOf={ASOF} candidate={GUARD} />);
    expect(screen.getByTestId("term-structure-leg-dot-front")).toBeTruthy();
    expect(screen.getByTestId("term-structure-leg-dot-back")).toBeTruthy();
    expect(screen.getByTestId("term-structure-line")).toBeTruthy();
  });

  it("renders the guard tag ON-canvas (not clipped above the viewport) — WR-02", () => {
    // GUARD's front IV (0.155) sits at the very top of the fixed IV axis, so the naive
    // placement (min(frontY, backY) - 22px) would push the tag above the plot area — the
    // guard branch clamps it back on-canvas, the one cue this branch exists to show.
    const { container } = render(
      <TermStructureChart termStructure={termStructure} events={events} asOf={ASOF} candidate={GUARD} />,
    );
    const svg = container.querySelector(".recharts-surface");
    const chartHeight = Number(svg?.getAttribute("height"));
    const tag = screen.getByTestId("term-structure-guard-tag");
    const rect = tag.querySelector("rect");
    const text = tag.querySelector("text");
    expect(rect).not.toBeNull();
    expect(text).not.toBeNull();
    const rectY = Number(rect?.getAttribute("y"));
    const rectH = Number(rect?.getAttribute("height"));
    const textY = Number(text?.getAttribute("y"));
    expect(rectY).toBeGreaterThanOrEqual(0);
    expect(rectY + rectH).toBeLessThanOrEqual(chartHeight);
    expect(textY).toBeGreaterThanOrEqual(0);
    expect(textY).toBeLessThanOrEqual(chartHeight);
  });
});
