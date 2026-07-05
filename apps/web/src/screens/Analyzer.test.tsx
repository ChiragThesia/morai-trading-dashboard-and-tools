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
 *   - ⊕ Combine sums the selected + combined calendars into one net payoff; toggling off reverts.
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
 *
 * 19-09-PLAN.md (Task 2, PICK-02 fixture→live swap): Analyzer now sources its data from
 * `usePicker()` instead of the synchronous `pickerSnapshotFixture` import. `usePicker` is
 * mocked so the fixture-driven suites above are unaffected (the default mock resolves
 * `pickerSnapshotFixture` as `data`, matching the frozen Phase-18 behavior byte-for-byte) —
 * new suites at the bottom of this file cover the D-18/D-19 loading/error/cold-start/
 * zero-filtered states the synchronous fixture never needed.
 */
import { describe, it, expect, afterEach, beforeEach, vi } from "vitest";
import { render, screen, cleanup, fireEvent, within } from "@testing-library/react";
import { assertDefined } from "@morai/shared";
import { pickerSnapshotFixture } from "@morai/contracts";
import type { UseQueryResult } from "@tanstack/react-query";
import type { PickerSnapshotResponse } from "@morai/contracts";

vi.mock("../components/charts/PayoffChart.tsx", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../components/charts/PayoffChart.tsx")>();
  return { ...actual, PayoffChart: vi.fn(actual.PayoffChart) };
});

const { mockUsePicker } = vi.hoisted(() => ({ mockUsePicker: vi.fn() }));
vi.mock("../hooks/usePicker.ts", () => ({ usePicker: mockUsePicker }));

/** Loose shape covering only the fields Analyzer.tsx actually reads off the query result. */
type MockPickerResult = Pick<
  UseQueryResult<PickerSnapshotResponse | null>,
  "data" | "isPending" | "isError" | "refetch"
>;

function mockUsePickerReturn(overrides: Partial<MockPickerResult>): void {
  mockUsePicker.mockReturnValue({
    data: pickerSnapshotFixture,
    isPending: false,
    isError: false,
    refetch: vi.fn(),
    ...overrides,
  });
}

import { Analyzer, CandidateRail } from "./Analyzer.tsx";
import { buildTosCalendarOrder } from "../lib/tos-order.ts";
import { PayoffChart } from "../components/charts/PayoffChart.tsx";
import type { PayoffChartProps } from "../components/charts/PayoffChart.tsx";
import { candidateToAnalyzerPosition } from "../lib/candidate-to-position.ts";
import { repriceScenario, buildScenarioStrip } from "../lib/scenario-engine.ts";
import type { ScenarioParams } from "../lib/scenario-engine.ts";
import { parseTosOrder } from "../lib/tos-parser.ts";
import { parsedCalendarToPickerCandidate } from "../lib/parsed-calendar-to-candidate.ts";

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

// Default usePicker() mock for every test in this file: a settled, populated fetch equal to
// the frozen Phase-18 fixture — every pre-existing fixture-driven suite below is unaffected.
// Individual tests in the "live-data states" suite override this per-test.
beforeEach(() => {
  mockUsePickerReturn({});
});

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

describe("Analyzer — per-candidate scoring checklist", () => {
  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it("renders a checklist row per rubric factor plus the theta constraint for the selected calendar", () => {
    const { container } = render(<Analyzer />);
    expect(container.querySelector('[data-testid="scoring-checklist"]')).not.toBeNull();
    for (const key of ["fwdEdge", "slope", "eventAdjustment", "gexFit", "beVsEm"]) {
      expect(container.querySelector(`[data-testid="checklist-${key}"]`)).not.toBeNull();
    }
    expect(container.querySelector('[data-testid="checklist-theta"]')).not.toBeNull();
  });

  it("changes per calendar — the guard candidate (fwdIv null) shows forward-vol edge as n/a", () => {
    render(<Analyzer />);
    fireEvent.click(screen.getByTestId(`candidate-card-${GUARD.id}`));
    expect(screen.getByTestId("checklist-fwdEdge").textContent).toContain("n/a");
  });

  it("renders the rail legend explaining the shorthand (θ / vega / event tags)", () => {
    render(<Analyzer />);
    const legend = screen.getByTestId("rail-legend");
    expect(legend.textContent).toContain("daily $ decay");
    expect(legend.textContent).toContain("event on front");
  });
});

describe("CandidateRail — zero-candidates-passed-filter empty state (Task 2, D-18)", () => {
  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it("renders the locked empty-state copy (with the live asOf) when given zero candidates", () => {
    render(
      <CandidateRail
        candidates={[]}
        pastedCandidate={null}
        pasteText=""
        pasteError={null}
        asOf="2026-07-02"
        observedAt="2026-07-02T14:32:00.000Z"
        source="schwab"
        gexContextStatus="ok"
        eventsContextStatus="ok"
        selectedId=""
        combinedIds={new Set()}
        copiedId={null}
        onSelect={() => {}}
        onToggleCombine={() => {}}
        onCopy={() => {}}
        onPasteTextChange={() => {}}
        onPasteAnalyze={() => {}}
        onPasteClear={() => {}}
      />,
    );

    expect(screen.getByTestId("picker-empty-filtered")).toBeTruthy();
    expect(screen.getByText("No candidates in this snapshot")).toBeTruthy();
    expect(
      screen.getByText("No put calendars meet net-θ>0 over the 2026-07-02 snapshot."),
    ).toBeTruthy();
  });

  it("renders no CandidateCard elements when the candidate list is empty", () => {
    const { container } = render(
      <CandidateRail
        candidates={[]}
        pastedCandidate={null}
        pasteText=""
        pasteError={null}
        asOf="2026-07-02"
        observedAt="2026-07-02T14:32:00.000Z"
        source="schwab"
        gexContextStatus="ok"
        eventsContextStatus="ok"
        selectedId=""
        combinedIds={new Set()}
        copiedId={null}
        onSelect={() => {}}
        onToggleCombine={() => {}}
        onCopy={() => {}}
        onPasteTextChange={() => {}}
        onPasteAnalyze={() => {}}
        onPasteClear={() => {}}
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

  it("⊕ Combine SUMS the selected + combined calendar into one net payoff curve", () => {
    render(<Analyzer />);

    const secondCard = screen.getByTestId(`candidate-card-${SECOND.id}`);
    fireEvent.click(within(secondCard).getByText("⊕ Combine"));

    // Combined book = [selected TOP, combined SECOND], summed by the one engine (Overview's path).
    const expected = repriceScenario(
      [candidateToAnalyzerPosition(TOP), candidateToAnalyzerPosition(SECOND)],
      PARAMS,
    );
    const props = latestPayoffChartProps();
    expect(props.todayCurve).toEqual(expected.payoffCurve);
    expect(props.expirationCurve).toEqual(expected.expirationCurve);
    // No single dashed overlay any more — the combine path sums instead.
    expect(props.compareCurve ?? null).toBeNull();
  });

  it("toggling ⊕ Combine off returns to the selected-only curve", () => {
    render(<Analyzer />);

    const secondCard = screen.getByTestId(`candidate-card-${SECOND.id}`);
    fireEvent.click(within(secondCard).getByText("⊕ Combine"));
    fireEvent.click(within(secondCard).getByText("✓ Combined"));

    const selectedOnly = repriceScenario([candidateToAnalyzerPosition(TOP)], PARAMS);
    expect(latestPayoffChartProps().todayCurve).toEqual(selectedOnly.payoffCurve);
  });

  it("shows the combined-book summary (debit = sum) once 2+ calendars are combined", () => {
    render(<Analyzer />);
    expect(screen.queryByTestId("combined-book-summary")).toBeNull();

    const secondCard = screen.getByTestId(`candidate-card-${SECOND.id}`);
    fireEvent.click(within(secondCard).getByText("⊕ Combine"));

    const summary = screen.getByTestId("combined-book-summary");
    expect(summary.textContent).toContain("+ 1 more");
    expect(summary.textContent).toContain(`$${(TOP.debit + SECOND.debit).toFixed(0)}`);
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

describe("Analyzer — pasted calendar (paste redesign)", () => {
  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  // Dates far in the future so this suite never goes stale relative to "today".
  const PASTE_EXAMPLE =
    "BUY +1 CALENDAR SPX 100 (Weeklys) 31 DEC 30/1 DEC 30 7450 PUT @45.85 LMT GTC";

  it("mounts the paste-to-analyze input at the top of the Suggested calendars panel (no separate top chart)", () => {
    render(<Analyzer />);
    const panel = screen.getByText("Suggested calendars").closest("div")?.parentElement;
    expect(panel).toBeTruthy();
    expect(within(assertDefined(panel, "panel")).getByTestId("picker-paste-input")).toBeTruthy();
    expect(within(assertDefined(panel, "panel")).getByTestId("picker-paste-analyze")).toBeTruthy();
    // Only one PayoffChart instance total — no separate ad-hoc chart above the grid.
    expect(mockPayoffChart.mock.calls.length).toBe(1);
  });

  it("Analyze on a valid paste pins a PASTED card at the top of the rail and auto-selects it", () => {
    render(<Analyzer />);

    fireEvent.change(screen.getByTestId("picker-paste-input"), { target: { value: PASTE_EXAMPLE } });
    fireEvent.click(screen.getByTestId("picker-paste-analyze"));

    const cards = screen.getAllByTestId(/^candidate-card-/);
    expect(cards[0]?.getAttribute("data-testid")).toBe("candidate-card-pasted");
    expect(screen.getByTestId("risk-profile-selected-name").textContent).toBe("7450P · pasted");
    within(screen.getByTestId("candidate-card-pasted")).getByText("PASTED");
  });

  it("the pasted candidate drives the shared center Risk-profile chart via the same candidate→position→repriceScenario path", () => {
    render(<Analyzer />);

    fireEvent.change(screen.getByTestId("picker-paste-input"), { target: { value: PASTE_EXAMPLE } });
    fireEvent.click(screen.getByTestId("picker-paste-analyze"));

    const parsed = parseTosOrder(PASTE_EXAMPLE, new Date(), pickerSnapshotFixture.spot, 0.045);
    if (parsed === null) throw new Error("expected PASTE_EXAMPLE to parse");
    const pastedCandidate = parsedCalendarToPickerCandidate(parsed);
    const expected = repriceScenario([candidateToAnalyzerPosition(pastedCandidate)], PARAMS);

    const props = latestPayoffChartProps();
    expect(props.todayCurve).toEqual(expected.payoffCurve);
    expect(props.expirationCurve).toEqual(expected.expirationCurve);
  });

  it("shows the parse-error copy when the pasted text doesn't parse", () => {
    render(<Analyzer />);

    fireEvent.change(screen.getByTestId("picker-paste-input"), { target: { value: "not an order" } });
    fireEvent.click(screen.getByTestId("picker-paste-analyze"));

    expect(screen.getByTestId("picker-paste-error")).toBeTruthy();
    expect(screen.queryByTestId("candidate-card-pasted")).toBeNull();
  });

  it("Clear removes the pasted card and re-selects the top-ranked scored candidate", () => {
    render(<Analyzer />);

    fireEvent.change(screen.getByTestId("picker-paste-input"), { target: { value: PASTE_EXAMPLE } });
    fireEvent.click(screen.getByTestId("picker-paste-analyze"));
    expect(screen.getByTestId("candidate-card-pasted")).toBeTruthy();

    fireEvent.click(screen.getByTestId("picker-paste-clear"));

    expect(screen.queryByTestId("candidate-card-pasted")).toBeNull();
    expect(screen.getByTestId("risk-profile-selected-name").textContent).toBe(TOP.name);
  });

  it("Why / Scoring checklist / Entry-exit show a 'not engine-scored' note when the pasted candidate is selected", () => {
    render(<Analyzer />);

    fireEvent.change(screen.getByTestId("picker-paste-input"), { target: { value: PASTE_EXAMPLE } });
    fireEvent.click(screen.getByTestId("picker-paste-analyze"));

    expect(screen.getAllByText("Pasted calendar — not engine-scored.").length).toBe(3);
    expect(screen.queryByTestId("scoring-checklist")).toBeNull();
    expect(screen.queryByTestId("entryexit-value-debit")).toBeNull();
    expect(screen.queryByTestId("whypanel-forward-edge-sentence")).toBeNull();
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

  it("a rail card's ⧉ Copy copies that specific candidate — not the selected one", () => {
    const writeText = vi.fn();
    Object.defineProperty(navigator, "clipboard", { value: { writeText }, configurable: true });

    render(<Analyzer />);
    // SECOND is not the default selection (TOP is), so this proves per-card wiring.
    fireEvent.click(screen.getByTestId(`copy-tos-${SECOND.id}`));

    expect(writeText).toHaveBeenCalledWith(buildTosCalendarOrder(SECOND, pickerSnapshotFixture.asOf));
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

describe("Analyzer — live-data states (Task 2, 19-09-PLAN.md, D-18/D-19)", () => {
  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it("loading: shows text-only 'Loading candidates…' when isPending && data === undefined", () => {
    mockUsePickerReturn({ data: undefined, isPending: true, isError: false });

    render(<Analyzer />);

    expect(screen.getByTestId("picker-loading").textContent).toBe("Loading candidates…");
    expect(screen.queryByTestId("picker-error")).toBeNull();
    expect(screen.queryByTestId("picker-empty-cold-start")).toBeNull();
    expect(screen.queryByTestId("picker-empty-filtered")).toBeNull();
    expect(screen.queryByText("Suggested calendars")).toBeTruthy();
    // No shadcn Skeleton pulse (D-19) — text-only.
    expect(document.querySelector(".animate-pulse")).toBeNull();
  });

  it("error: shows 'Couldn't load candidates.' + a Retry button that calls refetch()", () => {
    const refetch = vi.fn();
    mockUsePickerReturn({ data: undefined, isPending: false, isError: true, refetch });

    render(<Analyzer />);

    const errorBlock = screen.getByTestId("picker-error");
    expect(errorBlock.textContent).toContain("Couldn't load candidates.");
    expect(screen.queryByTestId("picker-loading")).toBeNull();

    fireEvent.click(screen.getByText("Retry"));
    expect(refetch).toHaveBeenCalledOnce();
  });

  it("cold-start: settled with no snapshot (404 -> null) shows 'Picker warming up'", () => {
    mockUsePickerReturn({ data: null, isPending: false, isError: false });

    render(<Analyzer />);

    const coldStart = screen.getByTestId("picker-empty-cold-start");
    expect(coldStart.textContent).toContain("Picker warming up");
    expect(coldStart.textContent).toContain(
      "First scoring run pending — check back after the next chain snapshot.",
    );
    expect(screen.queryByTestId("picker-empty-filtered")).toBeNull();
  });

  it("zero-candidates-passed-filter: settled with a snapshot whose candidates array is empty", () => {
    mockUsePickerReturn({ data: { ...pickerSnapshotFixture, candidates: [] }, isPending: false, isError: false });

    render(<Analyzer />);

    const emptyFiltered = screen.getByTestId("picker-empty-filtered");
    expect(emptyFiltered.textContent).toContain("No candidates in this snapshot");
    expect(emptyFiltered.textContent).toContain(
      `No put calendars meet net-θ>0 over the ${pickerSnapshotFixture.asOf} snapshot.`,
    );
    expect(screen.queryByTestId("picker-empty-cold-start")).toBeNull();
  });

  it("populated: renders the ranked rail from live data (no layout change from the fixture path)", () => {
    render(<Analyzer />);

    const cards = screen.getAllByTestId(/^candidate-card-/);
    expect(cards.length).toBe(pickerSnapshotFixture.candidates.length);
    expect(screen.queryByTestId("picker-loading")).toBeNull();
    expect(screen.queryByTestId("picker-error")).toBeNull();
    expect(screen.queryByTestId("picker-empty-cold-start")).toBeNull();
    expect(screen.queryByTestId("picker-empty-filtered")).toBeNull();
  });

  it("state precedence: loading wins over isError being simultaneously true", () => {
    // isPending && data===undefined is checked first — a query that is somehow both isPending
    // and isError (e.g. stale error state mid-refetch) must still show the loading text, not two
    // states at once.
    mockUsePickerReturn({ data: undefined, isPending: true, isError: true });

    render(<Analyzer />);

    expect(screen.getByTestId("picker-loading")).toBeTruthy();
    expect(screen.queryByTestId("picker-error")).toBeNull();
  });
});
