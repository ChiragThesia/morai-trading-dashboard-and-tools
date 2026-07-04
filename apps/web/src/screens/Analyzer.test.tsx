/**
 * Analyzer.test.tsx — TDD suite for the ranked-cards calendar PICKER (Phase 18, D-04).
 *
 * This is a FULL REWRITE (18-04-PLAN.md) — the previous suite asserted retired
 * paste-positions/roll-simulator behavior that no longer exists on this screen.
 *
 * The picker is 100% fixture-driven (D-02b) — no usePositions/useGex/useLiveStream hooks,
 * no network, no broker positions. `pickerSnapshotFixture` (@morai/contracts, 18-01) is the
 * sole data source, so this suite needs none of the old hook mocks.
 *
 * Behaviors under test (Task 2 — skeleton + ranked rail + methodology + empty-state):
 *   - Ranked rail: one CandidateCard per fixture candidate, ordered score-descending.
 *   - Default selection: the top-ranked candidate.
 *   - Click-to-select: clicking a different card updates the selected candidate.
 *   - Scoring methodology: locked 3-item list renders verbatim.
 *   - Empty state: `CandidateRail` (exported for direct testing, same pattern as
 *     Overview.tsx's exported `formatExpiryCell`) renders the locked empty-state copy when
 *     given zero candidates — Analyzer itself is fixture-only and can't be handed an empty
 *     fixture without module-mocking gymnastics, so the empty-state branch is unit-tested on
 *     the extracted rail component directly.
 *
 * Task 3 (payoff center) behaviors under test:
 *   - Selecting a candidate feeds candidateToAnalyzerPosition -> repriceScenario into
 *     PayoffChart with the picker's curve colors (todayCurveColor blue, expirationCurveColor
 *     violet) and rollCurve={null} (single payoff path, D-02).
 *   - ⊕-compare loads a non-null amber compareCurve; toggling it off clears it to null.
 *   - expectedMoveBand is passed as { spot: fixtureSpot, em: selected.expectedMove }.
 *   - ScenarioStrip renders the buildScenarioStrip-derived key levels for the selected
 *     candidate (put wall / γ flip / spot / call wall / candidate strike, deduped).
 *
 * 17.1-03/Overview.test.tsx precedent: spy-wrap PayoffChart (importOriginal) so tests can
 * inspect the exact props Analyzer hands it — the real component still renders.
 *
 * Task 2 (18-05-PLAN.md) right-column behaviors under test:
 *   - Selecting a candidate renders WhyPanel/TermStructureChart/EntryExitPlan under the three
 *     locked right-column headings, wired to that candidate's own fixture data.
 *   - Selecting the guard candidate (fwdIv null) shows the guard sentence and the term
 *     structure's omitted-bracket + guard tag (T-18-10) — the right column is fully re-wired
 *     per selection, not stuck on the default candidate.
 */
import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, cleanup, fireEvent, within } from "@testing-library/react";
import { assertDefined } from "@morai/shared";
import { pickerSnapshotFixture } from "@morai/contracts";

vi.mock("../components/charts/PayoffChart.tsx", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../components/charts/PayoffChart.tsx")>();
  return { ...actual, PayoffChart: vi.fn(actual.PayoffChart) };
});

import { Analyzer, CandidateRail } from "./Analyzer.tsx";
import { buildTosCalendarOrder } from "../lib/tos-order.ts";
import { PayoffChart } from "../components/charts/PayoffChart.tsx";
import type { PayoffChartProps } from "../components/charts/PayoffChart.tsx";
import { candidateToAnalyzerPosition } from "../lib/candidate-to-position.ts";
import { repriceScenario, buildScenarioStrip } from "../lib/scenario-engine.ts";
import type { ScenarioParams } from "../lib/scenario-engine.ts";

const mockPayoffChart = vi.mocked(PayoffChart);

/** Props of the most recent PayoffChart render (throws if it never rendered). */
function latestPayoffChartProps(): PayoffChartProps {
  const call = mockPayoffChart.mock.calls.at(-1);
  assertDefined(call, "PayoffChart rendered at least once");
  return call[0];
}

/** Matches Analyzer.tsx's fixed scenario params (D-02: no scenario sliders on this
 * fixture-only, view-only screen — spot/rate/divYield are the frozen snapshot constants). */
const PARAMS: ScenarioParams = {
  spot: pickerSnapshotFixture.spot,
  daysForward: 0,
  ivShift: 0,
  rate: 0.045,
  divYield: 0.013,
};

const SORTED_CANDIDATES = [...pickerSnapshotFixture.candidates].sort((a, b) => b.score - a.score);
const TOP = SORTED_CANDIDATES[0];
const SECOND = SORTED_CANDIDATES[1];

if (TOP === undefined || SECOND === undefined) {
  throw new Error("pickerSnapshotFixture must carry at least 2 candidates for this suite");
}

const GUARD = pickerSnapshotFixture.candidates.find((c) => c.fwdIv === null);
if (GUARD === undefined) {
  throw new Error("pickerSnapshotFixture must carry a guard (fwdIv null) candidate for this suite");
}

describe("Analyzer — ranked candidate rail (Task 2)", () => {
  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it("renders one CandidateCard per fixture candidate, ordered score-descending", () => {
    render(<Analyzer />);

    const cards = screen.getAllByTestId(/^candidate-card-/);
    expect(cards.length).toBe(pickerSnapshotFixture.candidates.length);

    const renderedIds = cards.map((el) => el.getAttribute("data-testid"));
    const expectedIds = SORTED_CANDIDATES.map((c) => `candidate-card-${c.id}`);
    expect(renderedIds).toEqual(expectedIds);
  });

  it("defaults the selected candidate to the top-ranked one (Risk profile subtitle names it)", () => {
    render(<Analyzer />);
    expect(screen.getByTestId("risk-profile-selected-name").textContent).toBe(TOP.name);
  });

  it("clicking a different card updates the selected candidate", () => {
    render(<Analyzer />);

    fireEvent.click(screen.getByTestId(`candidate-card-${SECOND.id}`));

    // The Risk profile subtitle now names the newly-selected candidate.
    expect(screen.getByTestId("risk-profile-selected-name").textContent).toBe(SECOND.name);
  });

  it("Suggested calendars panel heading renders (locked copy)", () => {
    render(<Analyzer />);
    expect(screen.getByText("Suggested calendars")).toBeTruthy();
  });
});

describe("Analyzer — scoring methodology panel (Task 2, locked copy)", () => {
  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it("renders the locked summary label", () => {
    render(<Analyzer />);
    expect(screen.getByText("Scoring methodology — verified & refuted")).toBeTruthy();
  });

  it("renders the 3-item list verbatim (scored / deliberately-not-scored / needs-backtest)", () => {
    const { container } = render(<Analyzer />);
    expect(container.textContent).toContain("Scored");
    expect(container.textContent).toContain("Deliberately NOT scored");
    expect(container.textContent).toContain("Needs in-house backtest");
  });
});

describe("CandidateRail — empty state (Task 2)", () => {
  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it("renders the locked empty-state copy when given zero candidates", () => {
    render(
      <CandidateRail
        candidates={[]}
        selectedId=""
        compareId={null}
        onSelect={() => {}}
        onCompareToggle={() => {}}
      />,
    );

    expect(screen.getByText("No candidates in this snapshot")).toBeTruthy();
    expect(
      screen.getByText(
        "The picker found no calendars meeting the DTE and theta screen for today's chain. Check back after the next 30-minute snapshot.",
      ),
    ).toBeTruthy();
  });

  it("renders no CandidateCard elements when the candidate list is empty", () => {
    const { container } = render(
      <CandidateRail
        candidates={[]}
        selectedId=""
        compareId={null}
        onSelect={() => {}}
        onCompareToggle={() => {}}
      />,
    );
    expect(container.querySelectorAll('[data-testid^="candidate-card-"]').length).toBe(0);
  });
});

describe("Analyzer — payoff center (Task 3, ANLZ-02)", () => {
  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it("feeds candidateToAnalyzerPosition(selected) into repriceScenario and passes the picker curve colors", () => {
    render(<Analyzer />);

    const expected = repriceScenario([candidateToAnalyzerPosition(TOP)], PARAMS);
    const props = latestPayoffChartProps();

    expect(props.todayCurve).toEqual(expected.payoffCurve);
    expect(props.expirationCurve).toEqual(expected.expirationCurve);
    expect(props.todayCurveColor).toBe("#5b9cf6");
    expect(props.expirationCurveColor).toBe("#a78bfa");
    expect(props.rollCurve).toBeNull();
  });

  it("re-prices against the newly-selected candidate when a different card is clicked", () => {
    render(<Analyzer />);

    fireEvent.click(screen.getByTestId(`candidate-card-${SECOND.id}`));

    const expected = repriceScenario([candidateToAnalyzerPosition(SECOND)], PARAMS);
    const props = latestPayoffChartProps();
    expect(props.todayCurve).toEqual(expected.payoffCurve);
  });

  it("passes expectedMoveBand as { spot: fixtureSpot, em: selected.expectedMove }", () => {
    render(<Analyzer />);
    const props = latestPayoffChartProps();
    expect(props.expectedMoveBand).toEqual({ spot: pickerSnapshotFixture.spot, em: TOP.expectedMove });
  });

  it("compareCurve is null/absent before any ⊕-compare candidate is loaded", () => {
    render(<Analyzer />);
    expect(latestPayoffChartProps().compareCurve ?? null).toBeNull();
  });

  it("⊕-compare loads a non-null amber compareCurve (the compare candidate's expiration P&L)", () => {
    render(<Analyzer />);

    const secondCard = screen.getByTestId(`candidate-card-${SECOND.id}`);
    fireEvent.click(within(secondCard).getByText("⊕ Compare"));

    const expectedCompare = repriceScenario([candidateToAnalyzerPosition(SECOND)], PARAMS);
    const props = latestPayoffChartProps();
    expect(props.compareCurve).toEqual(expectedCompare.expirationCurve);
    expect(props.compareCurveColor).toBe("#f0b429");
  });

  it("toggling the same ⊕-compare candidate off clears compareCurve back to null", () => {
    render(<Analyzer />);

    const secondCard = screen.getByTestId(`candidate-card-${SECOND.id}`);
    fireEvent.click(within(secondCard).getByText("⊕ Compare"));
    fireEvent.click(within(secondCard).getByText("✕ Remove compare"));

    expect(latestPayoffChartProps().compareCurve ?? null).toBeNull();
  });

  it("shows the amber compare-title suffix 'vs {compareName} (dashed)' once a compare candidate is loaded", () => {
    render(<Analyzer />);

    const secondCard = screen.getByTestId(`candidate-card-${SECOND.id}`);
    fireEvent.click(within(secondCard).getByText("⊕ Compare"));

    expect(screen.getByText(`vs ${SECOND.name} (dashed)`)).toBeTruthy();
  });
});

describe("Analyzer — ScenarioStrip (Task 3, ANLZ-02/D-06)", () => {
  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it("renders exactly the buildScenarioStrip-derived key levels for the selected candidate", () => {
    render(<Analyzer />);

    const position = candidateToAnalyzerPosition(TOP);
    const levels = {
      putWall: pickerSnapshotFixture.gex.putWall,
      flip: pickerSnapshotFixture.gex.flip,
      callWall: pickerSnapshotFixture.gex.callWall,
    };
    const expectedStrip = buildScenarioStrip(levels, [position], pickerSnapshotFixture.spot);

    const strip = screen.getByTestId("scenario-strip");
    for (const lvl of expectedStrip.levels) {
      expect(within(strip).getByTestId(`scenario-strip-level-${lvl}`)).toBeTruthy();
    }
    expect(strip.querySelectorAll('[data-testid^="scenario-strip-level-"]').length).toBe(
      expectedStrip.levels.length,
    );
  });

  it("T+0/@exp cell values come from the SAME repriceScenario curves the payoff chart drew (no second pricing path)", () => {
    render(<Analyzer />);

    const position = candidateToAnalyzerPosition(TOP);
    const expected = repriceScenario([position], PARAMS);
    const levels = {
      putWall: pickerSnapshotFixture.gex.putWall,
      flip: pickerSnapshotFixture.gex.flip,
      callWall: pickerSnapshotFixture.gex.callWall,
    };
    const expectedStrip = buildScenarioStrip(levels, [position], pickerSnapshotFixture.spot);
    const firstLevel = expectedStrip.levels[0];
    if (firstLevel === undefined) throw new Error("expected at least one scenario-strip level");

    const nearestT0 = expected.payoffCurve.reduce((best, p) =>
      Math.abs(p.spot - firstLevel) < Math.abs(best.spot - firstLevel) ? p : best,
    );

    const cell = screen.getByTestId(`scenario-strip-t0-${firstLevel}`);
    const sign = nearestT0.pl >= 0 ? "+" : "−";
    expect(cell.textContent).toBe(`${sign}$${Math.abs(nearestT0.pl).toFixed(0)}`);
  });
});

describe("Analyzer — right column (Task 2, ANLZ-03/D-01b)", () => {
  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it("renders the three locked right-column headings", () => {
    render(<Analyzer />);
    expect(screen.getByText("Why this calendar")).toBeTruthy();
    expect(screen.getByText("Term structure + your legs")).toBeTruthy();
    expect(screen.getByText("Entry / exit plan")).toBeTruthy();
  });

  it("wires WhyPanel/TermStructureChart/EntryExitPlan to the default (top-ranked) candidate", () => {
    render(<Analyzer />);
    expect(screen.getByTestId("whypanel-forward-edge-sentence").textContent).toContain(
      `Front IV ${(TOP.frontLeg.iv * 100).toFixed(1)}%`,
    );
    expect(screen.getByTestId("term-structure-leg-dot-front")).toBeTruthy();
    expect(screen.getByTestId("entryexit-value-debit")).toBeTruthy();
  });

  it("re-wires the right column to the newly-selected candidate when a different card is clicked", () => {
    render(<Analyzer />);
    fireEvent.click(screen.getByTestId(`candidate-card-${SECOND.id}`));
    expect(screen.getByTestId("whypanel-forward-edge-sentence").textContent).toContain(
      `Front IV ${(SECOND.frontLeg.iv * 100).toFixed(1)}%`,
    );
  });

  it("selecting the guard candidate shows the guard sentence and the term-structure's omitted bracket + guard tag", () => {
    render(<Analyzer />);
    fireEvent.click(screen.getByTestId(`candidate-card-${GUARD.id}`));

    expect(screen.getByTestId("whypanel-forward-edge-sentence").textContent).toBe(
      "Forward IV is undefined here — the term structure between these two legs is inverted (back-leg variance implies a negative forward radicand). This candidate is ranked on slope, GEX fit, and event adjustment only; the forward-edge criterion contributes 0.",
    );
    expect(screen.queryByTestId("term-structure-fwd-bracket")).toBeNull();
    expect(screen.getByTestId("term-structure-guard-tag")).toBeTruthy();
  });
});

describe("Analyzer — copy TOS order (copy-out)", () => {
  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it("copies the selected candidate's TOS calendar order to the clipboard", () => {
    const writeText = vi.fn();
    Object.defineProperty(navigator, "clipboard", { value: { writeText }, configurable: true });

    render(<Analyzer />);
    fireEvent.click(screen.getByTestId("copy-tos-order"));

    expect(writeText).toHaveBeenCalledWith(buildTosCalendarOrder(TOP, pickerSnapshotFixture.asOf));
    expect(screen.getByTestId("copy-tos-order").textContent).toContain("Copied");
  });
});

describe("Analyzer — payoff controls (shared date projection + series toggles)", () => {
  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it("renders the shared date-projection picker", () => {
    render(<Analyzer />);
    expect(screen.getByTestId("date-picker-input")).not.toBeNull();
  });

  it("stepping the date forward moves the T+0 curve but leaves @exp fixed (D-01)", () => {
    render(<Analyzer />);
    const before = latestPayoffChartProps();

    fireEvent.click(screen.getByRole("button", { name: "Next day" }));

    const after = latestPayoffChartProps();
    expect(after.todayCurve).not.toEqual(before.todayCurve);
    expect(after.expirationCurve).toEqual(before.expirationCurve);
  });

  it("clicking the @ exp toggle flips PayoffChart toggles.showExpiration off (others unaffected)", () => {
    render(<Analyzer />);
    expect(latestPayoffChartProps().toggles.showExpiration).toBe(true);

    fireEvent.click(screen.getByTestId("toggle-showExpiration"));

    expect(latestPayoffChartProps().toggles.showExpiration).toBe(false);
    expect(latestPayoffChartProps().toggles.showWalls).toBe(true);
  });
});
