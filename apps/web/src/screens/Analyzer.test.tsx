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
import { render, screen, cleanup, fireEvent, within, act } from "@testing-library/react";
import { assertDefined } from "@morai/shared";
import { pickerSnapshotFixture } from "@morai/contracts";
import type { UseQueryResult } from "@tanstack/react-query";
import type { PickerSnapshotResponse, PickerCandidate } from "@morai/contracts";

vi.mock("../components/charts/PayoffChart.tsx", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../components/charts/PayoffChart.tsx")>();
  return { ...actual, PayoffChart: vi.fn(actual.PayoffChart) };
});

const { mockUsePicker } = vi.hoisted(() => ({ mockUsePicker: vi.fn() }));
vi.mock("../hooks/usePicker.ts", () => ({ usePicker: mockUsePicker }));

// useRepullChains needs a QueryClient; this suite renders Analyzer without a provider, so the
// mutation hook is mocked to an inert stub (its own behavior is covered in useRepullChains.test.ts).
const { mockRepull } = vi.hoisted(() => ({
  mockRepull: vi.fn(() => ({ mutate: vi.fn(), isPending: false, isSuccess: false, isError: false })),
}));
vi.mock("../hooks/useRepullChains.ts", () => ({ useRepullChains: mockRepull }));

// useAnalyzeCalendar (Phase 30-06, D-02) needs a QueryClient too — mocked to a controllable
// mutateAsync stub (its own request/response/error handling is covered in
// useAnalyzeCalendar.test.ts). Defaults to scored:false so every pre-existing paste test in
// this suite keeps exercising the unscored-fallback path unchanged; individual tests override
// via mockAnalyzeCalendarMutateAsync.mockResolvedValueOnce/.mockRejectedValueOnce.
const { mockAnalyzeCalendarMutateAsync } = vi.hoisted(() => ({
  mockAnalyzeCalendarMutateAsync: vi.fn(() =>
    Promise.resolve({ scored: false, candidate: null, reason: "mocked" }),
  ),
}));
vi.mock("../hooks/useAnalyzeCalendar.ts", () => ({
  useAnalyzeCalendar: () => ({ mutateAsync: mockAnalyzeCalendarMutateAsync }),
}));

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
import { repriceScenario } from "../lib/scenario-engine.ts";
import type { ScenarioParams } from "../lib/scenario-engine.ts";
import { computePayoffDomain } from "../lib/payoff-domain.ts";
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

// Default usePicker() mock for every test in this file: a settled, populated picker fetch
// equal to the frozen Phase-18 fixture. Individual tests override per-test.
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
        pastedCandidates={[]}
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
        onRemovePasted={() => {}}
        onClearAllPasted={() => {}}
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
        pastedCandidates={[]}
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
        onRemovePasted={() => {}}
        onClearAllPasted={() => {}}
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

    const positions = [candidateToAnalyzerPosition(TOP)];
    const domain = computePayoffDomain(positions, PARAMS.spot, PARAMS);
    const expected = repriceScenario(positions, PARAMS, domain);
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

    const positions = [candidateToAnalyzerPosition(SECOND)];
    const domain = computePayoffDomain(positions, PARAMS.spot, PARAMS);
    const expected = repriceScenario(positions, PARAMS, domain);
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
    const positions = [candidateToAnalyzerPosition(TOP), candidateToAnalyzerPosition(SECOND)];
    const domain = computePayoffDomain(positions, PARAMS.spot, PARAMS);
    const expected = repriceScenario(positions, PARAMS, domain);
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

    const onlyPositions = [candidateToAnalyzerPosition(TOP)];
    const onlyDomain = computePayoffDomain(onlyPositions, PARAMS.spot, PARAMS);
    const selectedOnly = repriceScenario(onlyPositions, PARAMS, onlyDomain);
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

describe("Analyzer — pasted calendars (multi-paste)", () => {
  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
    mockAnalyzeCalendarMutateAsync.mockImplementation(() =>
      Promise.resolve({ scored: false, candidate: null, reason: "mocked" }),
    );
  });

  // Dates far in the future so this suite never goes stale relative to "today". Distinct
  // strikes/debits so two pasted cards are distinguishable in combine assertions.
  const PASTE_EXAMPLE =
    "BUY +1 CALENDAR SPX 100 (Weeklys) 31 DEC 30/1 DEC 30 7450 PUT @45.85 LMT GTC";
  const PASTE_EXAMPLE_2 =
    "BUY +1 CALENDAR SPX 100 (Weeklys) 31 DEC 30/1 DEC 30 7500 PUT @52.10 LMT GTC";
  const PASTE_EXAMPLE_CALL =
    "BUY +1 CALENDAR SPX 100 (Weeklys) 31 DEC 30/1 DEC 30 7600 CALL @38.20 LMT GTC";

  // PUT pastes now route through useAnalyzeCalendar's async mutateAsync (mocked above) —
  // `await act(...)` flushes the resolved/rejected promise + the resulting state update.
  async function paste(text: string): Promise<void> {
    fireEvent.change(screen.getByTestId("picker-paste-input"), { target: { value: text } });
    await act(async () => {
      fireEvent.click(screen.getByTestId("picker-paste-analyze"));
      await Promise.resolve();
    });
  }

  it("mounts the paste-to-analyze input at the top of the Suggested calendars panel (no separate top chart)", () => {
    render(<Analyzer />);
    expect(screen.getByTestId("picker-paste-input")).toBeTruthy();
    expect(screen.getByTestId("picker-paste-analyze")).toBeTruthy();
    // No separate ad-hoc panel/chart above the grid — the old adhoc-* ids are gone.
    expect(screen.queryByTestId("adhoc-input")).toBeNull();
    expect(screen.queryByTestId("adhoc-analyze")).toBeNull();
  });

  it("Analyze on a valid paste ADDS a PASTED card at the top of the rail, auto-selects it, and clears the input", async () => {
    render(<Analyzer />);

    await paste(PASTE_EXAMPLE);

    const cards = screen.getAllByTestId(/^candidate-card-/);
    expect(cards[0]?.getAttribute("data-testid")).toBe("candidate-card-pasted-1");
    expect(screen.getByTestId("risk-profile-selected-name").textContent).toBe("7450P · pasted");
    within(screen.getByTestId("candidate-card-pasted-1")).getByText("PASTED");
    expect(screen.getByTestId("picker-paste-input")).toHaveProperty("value", "");
    expect(mockAnalyzeCalendarMutateAsync).toHaveBeenCalledWith(
      expect.objectContaining({ putCall: "P", strike: 7450 }),
    );
  });

  it("a second Analyze ADDS a second PASTED card (both coexist, pinned in paste order) and auto-selects the new one", async () => {
    render(<Analyzer />);

    await paste(PASTE_EXAMPLE);
    await paste(PASTE_EXAMPLE_2);

    const cards = screen.getAllByTestId(/^candidate-card-/);
    expect(cards[0]?.getAttribute("data-testid")).toBe("candidate-card-pasted-1");
    expect(cards[1]?.getAttribute("data-testid")).toBe("candidate-card-pasted-2");
    expect(screen.getByTestId("risk-profile-selected-name").textContent).toBe("7500P · pasted");
  });

  it("the pasted candidate drives the shared center Risk-profile chart via the same candidate→position→repriceScenario path", async () => {
    render(<Analyzer />);

    await paste(PASTE_EXAMPLE);

    const parsed = parseTosOrder(PASTE_EXAMPLE, new Date(), pickerSnapshotFixture.spot, 0.045);
    if (parsed === null) throw new Error("expected PASTE_EXAMPLE to parse");
    const pastedCandidate = parsedCalendarToPickerCandidate(parsed, "pasted-1");
    const pastedPositions = [candidateToAnalyzerPosition(pastedCandidate)];
    const pastedDomain = computePayoffDomain(pastedPositions, PARAMS.spot, PARAMS);
    const expected = repriceScenario(pastedPositions, PARAMS, pastedDomain);

    const props = latestPayoffChartProps();
    expect(props.todayCurve).toEqual(expected.payoffCurve);
    expect(props.expirationCurve).toEqual(expected.expirationCurve);
  });

  it("shows the parse-error copy when the pasted text doesn't parse, without disturbing existing pasted cards", async () => {
    render(<Analyzer />);

    await paste(PASTE_EXAMPLE);
    await paste("not an order");

    expect(screen.getByTestId("picker-paste-error")).toBeTruthy();
    // The earlier successful paste is untouched by the failed second attempt.
    expect(screen.getByTestId("candidate-card-pasted-1")).toBeTruthy();
    expect(screen.queryByTestId("candidate-card-pasted-2")).toBeNull();
  });

  it("each pasted card's × removes just that card, cleans its combine state, and re-selects the top-ranked scored candidate when it was selected", async () => {
    render(<Analyzer />);

    await paste(PASTE_EXAMPLE);
    await paste(PASTE_EXAMPLE_2);
    // pasted-2 is auto-selected; combine it too, then remove it.
    fireEvent.click(within(screen.getByTestId("candidate-card-pasted-2")).getByText("⊕ Combine"));

    fireEvent.click(screen.getByTestId("remove-pasted-pasted-2"));

    expect(screen.queryByTestId("candidate-card-pasted-2")).toBeNull();
    expect(screen.getByTestId("candidate-card-pasted-1")).toBeTruthy();
    // Selection fell back to the first rail candidate (pasted-1, still pinned atop scored ones).
    expect(screen.getByTestId("risk-profile-selected-name").textContent).toBe("7450P · pasted");
    // Combine state for the removed card is gone, so combining pasted-1 doesn't drag it back in.
    expect(screen.queryByTestId("combined-book-summary")).toBeNull();
  });

  it("removing a pasted card that is NOT selected leaves the current selection untouched", async () => {
    render(<Analyzer />);

    await paste(PASTE_EXAMPLE);
    await paste(PASTE_EXAMPLE_2);
    // Select pasted-1 explicitly (pasted-2 is auto-selected by the second paste).
    fireEvent.click(screen.getByTestId("candidate-card-pasted-1"));

    fireEvent.click(screen.getByTestId("remove-pasted-pasted-2"));

    expect(screen.getByTestId("risk-profile-selected-name").textContent).toBe("7450P · pasted");
  });

  it("⊕ Combine on two pasted calendars sums both debits into the combined-book summary", async () => {
    render(<Analyzer />);

    await paste(PASTE_EXAMPLE);
    await paste(PASTE_EXAMPLE_2);
    // pasted-2 is selected; combine pasted-1 into it.
    fireEvent.click(within(screen.getByTestId("candidate-card-pasted-1")).getByText("⊕ Combine"));

    const parsed1 = parseTosOrder(PASTE_EXAMPLE, new Date(), pickerSnapshotFixture.spot, 0.045);
    const parsed2 = parseTosOrder(PASTE_EXAMPLE_2, new Date(), pickerSnapshotFixture.spot, 0.045);
    if (parsed1 === null || parsed2 === null) throw new Error("expected both examples to parse");
    const debit1 = parsedCalendarToPickerCandidate(parsed1, "pasted-1").debit;
    const debit2 = parsedCalendarToPickerCandidate(parsed2, "pasted-2").debit;

    const summary = screen.getByTestId("combined-book-summary");
    expect(summary.textContent).toContain("+ 1 more");
    expect(summary.textContent).toContain(`$${(debit1 + debit2).toFixed(0)}`);
  });

  it("Clear all removes every pasted card and re-selects the top-ranked scored candidate", async () => {
    render(<Analyzer />);

    await paste(PASTE_EXAMPLE);
    await paste(PASTE_EXAMPLE_2);
    expect(screen.getByTestId("candidate-card-pasted-1")).toBeTruthy();
    expect(screen.getByTestId("candidate-card-pasted-2")).toBeTruthy();

    fireEvent.click(screen.getByTestId("picker-paste-clear-all"));

    expect(screen.queryByTestId("candidate-card-pasted-1")).toBeNull();
    expect(screen.queryByTestId("candidate-card-pasted-2")).toBeNull();
    expect(screen.getByTestId("risk-profile-selected-name").textContent).toBe(TOP.name);
  });

  it("the Clear all button only renders once at least one calendar has been pasted", async () => {
    render(<Analyzer />);
    expect(screen.queryByTestId("picker-paste-clear-all")).toBeNull();

    await paste(PASTE_EXAMPLE);
    expect(screen.getByTestId("picker-paste-clear-all")).toBeTruthy();
  });

  it("Why / Scoring checklist / Entry-exit show a 'not engine-scored' note when a scored:false pasted PUT is selected", async () => {
    render(<Analyzer />);

    await paste(PASTE_EXAMPLE);

    expect(screen.getAllByText("Pasted calendar — not engine-scored.").length).toBe(3);
    expect(screen.queryByTestId("scoring-checklist")).toBeNull();
    expect(screen.queryByTestId("entryexit-value-debit")).toBeNull();
    expect(screen.queryByTestId("whypanel-forward-edge-sentence")).toBeNull();
  });

  it("a pasted CALL never calls the endpoint — unscored fallback with the 'not engine-scored' note (D-03)", async () => {
    render(<Analyzer />);

    await paste(PASTE_EXAMPLE_CALL);

    expect(mockAnalyzeCalendarMutateAsync).not.toHaveBeenCalled();
    expect(screen.getByTestId("candidate-card-pasted-1")).toBeTruthy();
    expect(screen.getAllByText("Pasted calendar — not engine-scored.").length).toBe(3);
  });

  it("scored:true renders the real breakdown bars, θ GATE, WHY THIS CALENDAR, and ENTRY/EXIT PLAN — the placeholder disappears (D-02)", async () => {
    const scoredCandidate: PickerCandidate = {
      ...TOP,
      id: "adhoc-30D-7450-2030-12-01-2030-12-31",
      name: "7450P adhoc",
    };
    mockAnalyzeCalendarMutateAsync.mockImplementationOnce(() =>
      Promise.resolve({ scored: true, candidate: scoredCandidate, reason: null }),
    );

    render(<Analyzer />);
    await paste(PASTE_EXAMPLE);

    // Provenance kept (pasted-prefix id + PASTED badge) even though it's scored.
    expect(screen.getByTestId("candidate-card-pasted-1")).toBeTruthy();
    within(screen.getByTestId("candidate-card-pasted-1")).getByText("PASTED");
    // The "not engine-scored" placeholder is gone; real panels render.
    expect(screen.queryByText("Pasted calendar — not engine-scored.")).toBeNull();
    expect(screen.getByTestId("scoring-checklist")).toBeTruthy();
    expect(screen.getByTestId("whypanel-forward-edge-sentence")).toBeTruthy();
  });

  it("a network/HTTP error surfaces the paste-error copy, not a crash, and adds no card", async () => {
    mockAnalyzeCalendarMutateAsync.mockImplementationOnce(() =>
      Promise.reject(new Error("POST /api/picker/analyze failed: 500")),
    );

    render(<Analyzer />);
    await paste(PASTE_EXAMPLE);

    expect(screen.getByTestId("picker-paste-error")).toBeTruthy();
    expect(screen.queryByTestId("candidate-card-pasted-1")).toBeNull();
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

describe("Analyzer — rule-registry-driven checklist (rules.ts via snapshot.ruleSet)", () => {
  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  const RULESET = [
    { id: "net-theta-positive", label: "Net theta > 0", kind: "gate", weight: 0, status: "active", rationale: "carry" },
    { id: "liquidity", label: "Liquidity", kind: "gate", weight: 0, status: "active", rationale: "tradeable" },
    { id: "fwdEdge", label: "Forward-IV edge", kind: "score", weight: 35, status: "active", rationale: "fwd" },
    { id: "slope", label: "Term-structure slope", kind: "score", weight: 30, status: "active", rationale: "vrp" },
    { id: "gexFit", label: "GEX placement", kind: "score", weight: 15, status: "active", rationale: "walls" },
    { id: "eventAdjustment", label: "Front-leg event risk", kind: "score", weight: 10, status: "active", rationale: "events" },
    { id: "beVsEm", label: "Breakeven vs EM", kind: "score", weight: 10, status: "active", rationale: "zone" },
    { id: "vrp", label: "VRP", kind: "experimental", weight: 0, status: "experimental", rationale: "calibrating" },
  ] as const;

  function snapshotWithRegistry(): PickerSnapshotResponse {
    return {
      ...pickerSnapshotFixture,
      ruleSet: [...RULESET],
      gateDrops: { liquidity: 3, netTheta: 2 },
      candidates: pickerSnapshotFixture.candidates.map((c) => ({
        ...c,
        context: [
          { id: "vrp", label: "VRP (front IV − RV20)", value: 0.031, note: "calibrating (PICK-04)" },
          { id: "slopePercentile", label: "Slope percentile", value: 67, note: "calibrating (PICK-04)" },
          { id: "backEventBonus", label: "Event in back window", value: 1, note: "calibrating (PICK-05)" },
        ],
      })),
    };
  }

  it("renders engine weights from the snapshot ruleSet (w35 on fwdEdge, w30 on slope)", () => {
    mockUsePickerReturn({ data: snapshotWithRegistry() });
    render(<Analyzer />);

    expect(screen.getByTestId("checklist-fwdEdge-weight").textContent).toBe("w35");
    expect(screen.getByTestId("checklist-slope-weight").textContent).toBe("w30");
  });

  it("renders the gate-drop counts line (no silent caps)", () => {
    mockUsePickerReturn({ data: snapshotWithRegistry() });
    render(<Analyzer />);

    const drops = screen.getByTestId("checklist-gate-drops");
    expect(drops.textContent).toContain("3 illiquid quotes");
    expect(drops.textContent).toContain("2 negative-θ pairs");
  });

  it("renders the experimental context rows dim with their computed values", () => {
    mockUsePickerReturn({ data: snapshotWithRegistry() });
    render(<Analyzer />);

    const experimental = screen.getByTestId("checklist-experimental");
    expect(experimental.textContent).toContain("CALIBRATING");
    expect(experimental.textContent).toContain("0.031");
    expect(experimental.textContent).toContain("67");
  });

  it("the Re-pull chains button lives in the Suggested-calendars rail heading, not the scorecard strip", () => {
    mockUsePickerReturn({ data: snapshotWithRegistry() });
    render(<Analyzer />);

    const button = screen.getByTestId("repull-chains-button");
    const strip = screen.getByTestId("scoring-pills");
    expect(strip.contains(button)).toBe(false);
    // The button sits inside the rail panel, adjacent to its heading.
    const rail = screen.getByText("Suggested calendars").closest("section, div.rounded-lg, div");
    expect(rail).not.toBeNull();
  });

  it("scorecard chips render MetricChip-scale values (icon + contribution %) for the selected candidate", () => {
    mockUsePickerReturn({ data: snapshotWithRegistry() });
    render(<Analyzer />);

    const fwd = screen.getByTestId("checklist-fwdEdge");
    // Big-value chip: label carries the weight, the value line carries icon + percent.
    expect(fwd.textContent).toContain("w35");
    expect(fwd.textContent).toMatch(/[✓~✗].*%/u);
  });

  it("pre-registry snapshots (empty ruleSet) fall back to the legacy labels with no weights", () => {
    mockUsePickerReturn({ data: pickerSnapshotFixture });
    render(<Analyzer />);

    expect(screen.getByTestId("checklist-fwdEdge")).toBeTruthy();
    expect(screen.queryByTestId("checklist-fwdEdge-weight")).toBeNull();
  });

  it("shows an AH-marks warning chip when the snapshot's marketSession is after-hours", () => {
    mockUsePickerReturn({ data: { ...snapshotWithRegistry(), marketSession: "after-hours" } });
    render(<Analyzer />);
    const chip = screen.getByTestId("session-badge");
    expect(chip.textContent).toContain("AH");

    cleanup();
    mockUsePickerReturn({ data: snapshotWithRegistry() }); // fixture defaults to rth
    render(<Analyzer />);
    expect(screen.queryByTestId("session-badge")).toBeNull();
  });
});
