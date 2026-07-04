/**
 * TermStructureChart.test.tsx — TDD RED for the picker's "Term structure + your legs" mini-chart
 * (ANLZ-03, D-01b). Covers the UI-SPEC contract: term-structure polyline, amber event markers,
 * front/back leg dots, the forward-IV bracket (present for a normal candidate), and the
 * guard-case bracket omission + `guard` tag (T-18-10: no throw/NaN/fabricated bracket).
 */
import { describe, it, expect, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import { pickerSnapshotFixture } from "@morai/contracts";
import type { PickerCandidate } from "@morai/contracts";
import { TermStructureChart, xScale, yScale } from "./TermStructureChart.tsx";

const { termStructure, events } = pickerSnapshotFixture;
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
    render(<TermStructureChart termStructure={termStructure} events={events} candidate={NORMAL} />);
    expect(screen.getByTestId("term-structure-line")).toBeTruthy();
  });

  it("renders one amber marker per fixture event (all fall within the fixed 0-82 DTE axis)", () => {
    render(<TermStructureChart termStructure={termStructure} events={events} candidate={NORMAL} />);
    const markers = screen.getAllByTestId(/^term-structure-event-/);
    expect(markers.length).toBe(events.length);
  });

  it("renders the front leg dot at the correct x/y (coral, DTE/IV-scaled)", () => {
    render(<TermStructureChart termStructure={termStructure} events={events} candidate={NORMAL} />);
    const dot = screen.getByTestId("term-structure-leg-dot-front");
    expect(Number(dot.getAttribute("cx"))).toBeCloseTo(xScale(NORMAL.frontLeg.dte), 5);
    expect(Number(dot.getAttribute("cy"))).toBeCloseTo(yScale(NORMAL.frontLeg.iv), 5);
    expect(dot.getAttribute("fill")).toBe("#ef5350");
  });

  it("renders the back leg dot at the correct x/y (teal, DTE/IV-scaled)", () => {
    render(<TermStructureChart termStructure={termStructure} events={events} candidate={NORMAL} />);
    const dot = screen.getByTestId("term-structure-leg-dot-back");
    expect(Number(dot.getAttribute("cx"))).toBeCloseTo(xScale(NORMAL.backLeg.dte), 5);
    expect(Number(dot.getAttribute("cy"))).toBeCloseTo(yScale(NORMAL.backLeg.iv), 5);
    expect(dot.getAttribute("fill")).toBe("#26a69a");
  });
});

describe("TermStructureChart — forward-IV bracket (normal candidate)", () => {
  afterEach(cleanup);

  it("renders a forward-IV bracket between the two leg x-positions", () => {
    render(<TermStructureChart termStructure={termStructure} events={events} candidate={NORMAL} />);
    const bracket = screen.getByTestId("term-structure-fwd-bracket");
    expect(bracket).toBeTruthy();
    expect(screen.queryByTestId("term-structure-guard-tag")).toBeNull();
  });
});

describe("TermStructureChart — guard case (fwdIv null, T-18-10)", () => {
  afterEach(cleanup);

  it("omits the forward-IV bracket and renders the guard tag instead — no throw, no NaN", () => {
    const { container } = render(
      <TermStructureChart termStructure={termStructure} events={events} candidate={GUARD} />,
    );
    expect(screen.queryByTestId("term-structure-fwd-bracket")).toBeNull();
    expect(screen.getByTestId("term-structure-guard-tag")).toBeTruthy();
    expect(container.innerHTML).not.toContain("NaN");
  });

  it("still renders the leg dots and term line for the guard candidate", () => {
    render(<TermStructureChart termStructure={termStructure} events={events} candidate={GUARD} />);
    expect(screen.getByTestId("term-structure-leg-dot-front")).toBeTruthy();
    expect(screen.getByTestId("term-structure-leg-dot-back")).toBeTruthy();
    expect(screen.getByTestId("term-structure-line")).toBeTruthy();
  });

  it("renders the guard tag ON-canvas (not clipped above the viewport) — WR-02", () => {
    // The guard candidate's front IV (0.155) sits at the very top of the IV axis, so
    // Math.min(frontY, backY) - 18 pushes the tag above y=0 and the SVG viewport clips
    // it — the one cue the guard branch exists to show. The tag must stay in [0, H].
    const H = 150;
    render(<TermStructureChart termStructure={termStructure} events={events} candidate={GUARD} />);
    const tag = screen.getByTestId("term-structure-guard-tag");
    const rect = tag.querySelector("rect");
    const text = tag.querySelector("text");
    expect(rect).not.toBeNull();
    expect(text).not.toBeNull();
    const rectY = Number(rect?.getAttribute("y"));
    const rectH = Number(rect?.getAttribute("height"));
    const textY = Number(text?.getAttribute("y"));
    expect(rectY).toBeGreaterThanOrEqual(0);
    expect(rectY + rectH).toBeLessThanOrEqual(H);
    expect(textY).toBeGreaterThanOrEqual(0);
    expect(textY).toBeLessThanOrEqual(H);
  });
});
