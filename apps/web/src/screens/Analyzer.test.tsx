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
import type { PickerSnapshotResponse, PickerCandidate, AnalyzeAdHocCalendarResponse } from "@morai/contracts";
import type { UseLiveStreamResult } from "../hooks/useLiveStream.ts";

vi.mock("../components/charts/PayoffChart.tsx", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../components/charts/PayoffChart.tsx")>();
  return { ...actual, PayoffChart: vi.fn(actual.PayoffChart) };
});

// Phase 41 AUI-07: useAnalyzerModel now calls useLiveStream — without this mock every test
// that renders an Analyzer tree would open a real EventSource (green-suite protection).
const { mockUseLiveStream } = vi.hoisted(() => ({
  mockUseLiveStream: vi.fn((): UseLiveStreamResult => ({
    greeks: new Map(),
    status: "quiet",
    lastTickAt: null,
    isRth: null,
    hasReceivedFirstTick: false,
    isReconnecting: false,
    liveSpot: null,
    liveIndices: null,
    reconnectNow: vi.fn(),
    subscribeAdHoc: vi.fn().mockResolvedValue(undefined),
  })),
}));
vi.mock("../hooks/useLiveStream.ts", () => ({
  useLiveStream: mockUseLiveStream,
  // LiveStatusBadge.tsx imports this const directly (module-load time) — must be mocked
  // alongside the hook or the Analyzer tree crashes as soon as it mounts the badge.
  STALL_THRESHOLD_MS: 20_000,
}));

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
  mockAnalyzeCalendarMutateAsync: vi.fn(
    (): Promise<AnalyzeAdHocCalendarResponse> =>
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

import { Analyzer, CandidateRail, DEFAULT_CANDIDATE_SORT, compactCalendarName } from "./Analyzer.tsx";
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

/**
 * D-16 desktop matchMedia stub (the Overview.test.tsx pattern) — jsdom has no matchMedia, so
 * useIsDesktop() reports mobile by default and Analyzer mounts the mobile tree. Every
 * pre-existing desktop-tree describe installs this in beforeEach to keep exercising
 * AnalyzerDesktop byte-identically; each deletes it in afterEach via
 * `Reflect.deleteProperty(window, "matchMedia")`.
 */
function stubDesktopMatchMedia(): void {
  Object.defineProperty(window, "matchMedia", {
    configurable: true,
    writable: true,
    value: (query: string) => ({
      matches: query === "(min-width: 1024px)",
      media: query,
      addEventListener: () => undefined,
      removeEventListener: () => undefined,
    }),
  });
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

describe("Analyzer — ranked candidate table (Phase 41, AUI-01/AUI-03)", () => {
  beforeEach(stubDesktopMatchMedia);
  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
    Reflect.deleteProperty(window, "matchMedia");
  });

  it("renders one row per fixture candidate, ordered score-descending by default", () => {
    render(<Analyzer />);

    const rows = screen.getAllByTestId(/^candidate-row-/);
    expect(rows.length).toBe(pickerSnapshotFixture.candidates.length);

    const renderedIds = rows.map((el) => el.getAttribute("data-testid"));
    const expectedIds = SORTED_CANDIDATES.map((c) => `candidate-row-${c.id}`);
    expect(renderedIds).toEqual(expectedIds);
  });

  it("defaults the selected candidate to the top-ranked one (Risk profile subtitle names it)", () => {
    render(<Analyzer />);
    expect(screen.getByTestId("risk-profile-selected-name").textContent).toBe(TOP.name);
  });

  it("clicking a different row updates the selected candidate", () => {
    render(<Analyzer />);

    fireEvent.click(screen.getByTestId(`candidate-row-${SECOND.id}`));

    // The Risk profile subtitle now names the newly-selected candidate.
    expect(screen.getByTestId("risk-profile-selected-name").textContent).toBe(SECOND.name);
  });

  it("rounds debit to whole dollars and vega to 2dp in the subline (AUI-04) — no long-decimal render", () => {
    render(<Analyzer />);
    const subline = screen.getByTestId("risk-profile-selected-name").parentElement?.textContent ?? "";
    expect(subline).toContain(`debit $${Math.round(TOP.debit)}`);
    expect(subline).toContain(`vega +${TOP.vega.toFixed(2)}`);
    expect(subline).not.toContain(String(TOP.debit));
    expect(subline).not.toContain(String(TOP.vega));
  });

  it("clicking the Debit header sorts rows by debit descending and sets aria-sort on that column only", () => {
    render(<Analyzer />);

    fireEvent.click(screen.getByTestId("rail-sort-debit"));

    const expectedIds = [...SORTED_CANDIDATES]
      .sort((a, b) => b.debit - a.debit)
      .map((c) => `candidate-row-${c.id}`);
    const rows = screen.getAllByTestId(/^candidate-row-/);
    expect(rows.map((el) => el.getAttribute("data-testid"))).toEqual(expectedIds);
    expect(screen.getByTestId("rail-sort-debit").getAttribute("aria-sort")).toBe("descending");
    expect(screen.getByTestId("rail-sort-score").getAttribute("aria-sort")).toBe("none");
  });

  it("clicking the same header again flips the direction (desc -> asc)", () => {
    render(<Analyzer />);

    fireEvent.click(screen.getByTestId("rail-sort-debit"));
    fireEvent.click(screen.getByTestId("rail-sort-debit"));

    const expectedIds = [...SORTED_CANDIDATES]
      .sort((a, b) => a.debit - b.debit)
      .map((c) => `candidate-row-${c.id}`);
    const rows = screen.getAllByTestId(/^candidate-row-/);
    expect(rows.map((el) => el.getAttribute("data-testid"))).toEqual(expectedIds);
    expect(screen.getByTestId("rail-sort-debit").getAttribute("aria-sort")).toBe("ascending");
  });

  it("the ⊕ cell toggles Combine without changing the current row selection (stopPropagation)", () => {
    render(<Analyzer />);

    fireEvent.click(screen.getByTestId(`combine-${SECOND.id}`));

    expect(screen.getByTestId("risk-profile-selected-name").textContent).toBe(TOP.name);
    expect(screen.getByTestId("combined-book-summary").textContent).toContain("+ 1 more");
  });

  it("the detail-pane Combine button toggles the selected candidate into the combined book", () => {
    render(<Analyzer />);
    const button = screen.getByTestId("detail-combine");
    expect(button.textContent).toBe("⊕ Combine");

    fireEvent.click(button);
    expect(button.textContent).toBe("✓ Combined");

    // Selecting a different row now surfaces the combined book (TOP stays combined-in as "extra").
    fireEvent.click(screen.getByTestId(`candidate-row-${SECOND.id}`));
    expect(screen.getByTestId("combined-book-summary").textContent).toContain("+ 1 more");
  });

  it("Suggested calendars panel heading renders (locked copy)", () => {
    render(<Analyzer />);
    expect(screen.getByText("Suggested calendars")).toBeTruthy();
  });

  it("table rows render calendar names with short dates so rows stay one line (no ISO wrap)", () => {
    // Live engine names carry ISO dates (fixture names are already short-form).
    expect(compactCalendarName("7525P 2026-08-06 / 2026-08-10")).toBe("7525P Aug 6 / Aug 10");
    // Non-date text passes through untouched.
    expect(compactCalendarName("7525P pasted calendar")).toBe("7525P pasted calendar");

    render(<Analyzer />);
    const row = screen.getByTestId(`candidate-row-${TOP.id}`);
    expect(row.textContent).toContain(compactCalendarName(TOP.name));
  });
});

describe("Analyzer — verdict hero (Phase 41, AUI-02/D-02)", () => {
  beforeEach(stubDesktopMatchMedia);
  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
    Reflect.deleteProperty(window, "matchMedia");
  });

  it("renders the headline (verdict word + score + Θ) and a checklist row per rubric factor for the selected calendar", () => {
    const { container } = render(<Analyzer />);
    expect(screen.getByTestId("verdict-word").textContent).toContain("CAUTION");
    expect(screen.getByTestId("verdict-score").textContent).toBe(`score ${Math.round(TOP.score)}/100`);
    expect(screen.getByTestId("verdict-theta").textContent).toBe(
      `Θ ${TOP.theta >= 0 ? "+" : ""}${TOP.theta.toFixed(1)}/d`,
    );
    for (const key of ["fwdEdge", "slope", "eventAdjustment", "gexFit", "beVsEm"]) {
      expect(container.querySelector(`[data-testid="checklist-${key}"]`)).not.toBeNull();
    }
    // θ GATE is retired as a separate chip — its info is the headline Θ above, never duplicated.
    expect(container.querySelector('[data-testid="checklist-theta"]')).toBeNull();
  });

  it("groups the checklist rows under EDGE/RISK/FIT per the LOCKED mapping (shared GROUP_OF)", () => {
    render(<Analyzer />);
    within(screen.getByTestId("verdict-group-EDGE")).getByTestId("checklist-fwdEdge");
    within(screen.getByTestId("verdict-group-EDGE")).getByTestId("checklist-slope");
    within(screen.getByTestId("verdict-group-RISK")).getByTestId("checklist-eventAdjustment");
    within(screen.getByTestId("verdict-group-RISK")).getByTestId("checklist-beVsEm");
    within(screen.getByTestId("verdict-group-FIT")).getByTestId("checklist-gexFit");
  });

  it("changes per calendar — the guard candidate (fwdIv null) shows forward-vol edge as n/a", () => {
    render(<Analyzer />);
    fireEvent.click(screen.getByTestId(`candidate-row-${GUARD.id}`));
    expect(screen.getByTestId("checklist-fwdEdge").textContent).toContain("n/a");
  });

  it("renders the rail legend explaining the shorthand (θ / vega / event tags)", () => {
    render(<Analyzer />);
    const legend = screen.getByTestId("rail-legend");
    expect(legend.textContent).toContain("daily $ decay");
    expect(legend.textContent).toContain("event on front");
  });

  it("renders the as-of + source provenance in the quiet footer (AUI-07)", () => {
    render(<Analyzer />);
    const footer = screen.getByTestId("verdict-hero-footer");
    expect(footer.textContent).toContain("as of");
    expect(footer.textContent).toContain(pickerSnapshotFixture.source);
  });
});

describe("CandidateRail — direct-render states (Phase 41, D-18)", () => {
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
        selectedId=""
        combinedIds={new Set()}
        sort={DEFAULT_CANDIDATE_SORT}
        onSortChange={() => {}}
        onSelect={() => {}}
        onToggleCombine={() => {}}
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

  it("renders no candidate-row elements when the candidate list is empty", () => {
    const { container } = render(
      <CandidateRail
        candidates={[]}
        pastedCandidates={[]}
        pasteText=""
        pasteError={null}
        asOf="2026-07-02"
        selectedId=""
        combinedIds={new Set()}
        sort={DEFAULT_CANDIDATE_SORT}
        onSortChange={() => {}}
        onSelect={() => {}}
        onToggleCombine={() => {}}
        onPasteTextChange={() => {}}
        onPasteAnalyze={() => {}}
        onRemovePasted={() => {}}
        onClearAllPasted={() => {}}
      />,
    );
    expect(container.querySelectorAll('[data-testid^="candidate-row-"]').length).toBe(0);
  });

  it("a pasted, unscored candidate shows the PASTED pill and — for the Debit/Θ cells", () => {
    const raw = pickerSnapshotFixture.candidates[0];
    if (raw === undefined) throw new Error("expected at least one fixture candidate");
    const pastedUnscored: PickerCandidate = {
      ...raw,
      id: "pasted-1",
      name: "7450P · pasted",
      breakdown: [],
      frontEvents: ["CPI"],
      backEvents: [],
    };

    render(
      <CandidateRail
        candidates={[]}
        pastedCandidates={[pastedUnscored]}
        pasteText=""
        pasteError={null}
        asOf="2026-07-02"
        selectedId=""
        combinedIds={new Set()}
        sort={DEFAULT_CANDIDATE_SORT}
        onSortChange={() => {}}
        onSelect={() => {}}
        onToggleCombine={() => {}}
        onPasteTextChange={() => {}}
        onPasteAnalyze={() => {}}
        onRemovePasted={() => {}}
        onClearAllPasted={() => {}}
      />,
    );

    const row = screen.getByTestId("candidate-row-pasted-1");
    within(row).getByText("PASTED");
    expect(within(row).getAllByText("—").length).toBe(2);
    expect(within(row).getByTestId("remove-pasted-pasted-1")).toBeTruthy();
  });
});

describe("Analyzer — payoff center (Task 3, ANLZ-02)", () => {
  beforeEach(stubDesktopMatchMedia);
  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
    Reflect.deleteProperty(window, "matchMedia");
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

  it("re-prices against the newly-selected candidate when a different row is clicked", () => {
    render(<Analyzer />);

    fireEvent.click(screen.getByTestId(`candidate-row-${SECOND.id}`));

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

    fireEvent.click(screen.getByTestId(`combine-${SECOND.id}`));

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

    const combineButton = screen.getByTestId(`combine-${SECOND.id}`);
    fireEvent.click(combineButton);
    fireEvent.click(combineButton);

    const onlyPositions = [candidateToAnalyzerPosition(TOP)];
    const onlyDomain = computePayoffDomain(onlyPositions, PARAMS.spot, PARAMS);
    const selectedOnly = repriceScenario(onlyPositions, PARAMS, onlyDomain);
    expect(latestPayoffChartProps().todayCurve).toEqual(selectedOnly.payoffCurve);
  });

  it("shows the combined-book summary (debit = sum) once 2+ calendars are combined", () => {
    render(<Analyzer />);
    expect(screen.queryByTestId("combined-book-summary")).toBeNull();

    fireEvent.click(screen.getByTestId(`combine-${SECOND.id}`));

    const summary = screen.getByTestId("combined-book-summary");
    expect(summary.textContent).toContain("+ 1 more");
    expect(summary.textContent).toContain(`$${Math.round(TOP.debit + SECOND.debit)}`);
  });
});

describe("Analyzer — right column (Task 2, ANLZ-03/D-01b)", () => {
  beforeEach(stubDesktopMatchMedia);
  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
    Reflect.deleteProperty(window, "matchMedia");
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

  it("re-wires the right column to the newly-selected candidate when a different row is clicked", () => {
    render(<Analyzer />);
    fireEvent.click(screen.getByTestId(`candidate-row-${SECOND.id}`));
    expect(screen.getByTestId("whypanel-forward-edge-sentence").textContent).toContain(
      `Front IV ${(SECOND.frontLeg.iv * 100).toFixed(1)}%`,
    );
  });

  it("selecting the guard candidate shows the guard sentence and the term-structure's omitted bracket + guard tag", () => {
    render(<Analyzer />);
    fireEvent.click(screen.getByTestId(`candidate-row-${GUARD.id}`));

    expect(screen.getByTestId("whypanel-forward-edge-sentence").textContent).toBe(
      "Forward IV is undefined here — the term structure between these two legs is inverted (back-leg variance implies a negative forward radicand). This candidate is ranked on slope, GEX fit, and event adjustment only; the forward-edge criterion contributes 0.",
    );
    expect(screen.queryByTestId("term-structure-fwd-bracket")).toBeNull();
    expect(screen.getByTestId("term-structure-guard-tag")).toBeTruthy();
  });
});

describe("Analyzer — pasted calendars (multi-paste)", () => {
  beforeEach(stubDesktopMatchMedia);
  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
    Reflect.deleteProperty(window, "matchMedia");
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

    const rows = screen.getAllByTestId(/^candidate-row-/);
    expect(rows[0]?.getAttribute("data-testid")).toBe("candidate-row-pasted-1");
    expect(screen.getByTestId("risk-profile-selected-name").textContent).toBe("7450P · pasted");
    within(screen.getByTestId("candidate-row-pasted-1")).getByText("PASTED");
    expect(screen.getByTestId("picker-paste-input")).toHaveProperty("value", "");
    expect(mockAnalyzeCalendarMutateAsync).toHaveBeenCalledWith(
      expect.objectContaining({ putCall: "P", strike: 7450 }),
    );
  });

  it("a second Analyze ADDS a second PASTED card (both coexist, pinned in paste order) and auto-selects the new one", async () => {
    render(<Analyzer />);

    await paste(PASTE_EXAMPLE);
    await paste(PASTE_EXAMPLE_2);

    const rows = screen.getAllByTestId(/^candidate-row-/);
    expect(rows[0]?.getAttribute("data-testid")).toBe("candidate-row-pasted-1");
    expect(rows[1]?.getAttribute("data-testid")).toBe("candidate-row-pasted-2");
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
    expect(screen.getByTestId("candidate-row-pasted-1")).toBeTruthy();
    expect(screen.queryByTestId("candidate-row-pasted-2")).toBeNull();
  });

  it("each pasted card's × removes just that card, cleans its combine state, and re-selects the top-ranked scored candidate when it was selected", async () => {
    render(<Analyzer />);

    await paste(PASTE_EXAMPLE);
    await paste(PASTE_EXAMPLE_2);
    // pasted-2 is auto-selected; combine it too, then remove it.
    fireEvent.click(screen.getByTestId("combine-pasted-2"));

    fireEvent.click(screen.getByTestId("remove-pasted-pasted-2"));

    expect(screen.queryByTestId("candidate-row-pasted-2")).toBeNull();
    expect(screen.getByTestId("candidate-row-pasted-1")).toBeTruthy();
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
    fireEvent.click(screen.getByTestId("candidate-row-pasted-1"));

    fireEvent.click(screen.getByTestId("remove-pasted-pasted-2"));

    expect(screen.getByTestId("risk-profile-selected-name").textContent).toBe("7450P · pasted");
  });

  it("⊕ Combine on two pasted calendars sums both debits into the combined-book summary", async () => {
    render(<Analyzer />);

    await paste(PASTE_EXAMPLE);
    await paste(PASTE_EXAMPLE_2);
    // pasted-2 is selected; combine pasted-1 into it.
    fireEvent.click(screen.getByTestId("combine-pasted-1"));

    const parsed1 = parseTosOrder(PASTE_EXAMPLE, new Date(), pickerSnapshotFixture.spot, 0.045);
    const parsed2 = parseTosOrder(PASTE_EXAMPLE_2, new Date(), pickerSnapshotFixture.spot, 0.045);
    if (parsed1 === null || parsed2 === null) throw new Error("expected both examples to parse");
    const debit1 = parsedCalendarToPickerCandidate(parsed1, "pasted-1").debit;
    const debit2 = parsedCalendarToPickerCandidate(parsed2, "pasted-2").debit;

    const summary = screen.getByTestId("combined-book-summary");
    expect(summary.textContent).toContain("+ 1 more");
    expect(summary.textContent).toContain(`$${Math.round(debit1 + debit2)}`);
  });

  it("Clear all removes every pasted card and re-selects the top-ranked scored candidate", async () => {
    render(<Analyzer />);

    await paste(PASTE_EXAMPLE);
    await paste(PASTE_EXAMPLE_2);
    expect(screen.getByTestId("candidate-row-pasted-1")).toBeTruthy();
    expect(screen.getByTestId("candidate-row-pasted-2")).toBeTruthy();

    fireEvent.click(screen.getByTestId("picker-paste-clear-all"));

    expect(screen.queryByTestId("candidate-row-pasted-1")).toBeNull();
    expect(screen.queryByTestId("candidate-row-pasted-2")).toBeNull();
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
    expect(screen.queryByTestId("verdict-word")).toBeNull();
    expect(screen.queryByTestId("entryexit-value-debit")).toBeNull();
    expect(screen.queryByTestId("whypanel-forward-edge-sentence")).toBeNull();
  });

  it("a pasted CALL never calls the endpoint — unscored fallback with the 'not engine-scored' note (D-03)", async () => {
    render(<Analyzer />);

    await paste(PASTE_EXAMPLE_CALL);

    expect(mockAnalyzeCalendarMutateAsync).not.toHaveBeenCalled();
    expect(screen.getByTestId("candidate-row-pasted-1")).toBeTruthy();
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
    expect(screen.getByTestId("candidate-row-pasted-1")).toBeTruthy();
    within(screen.getByTestId("candidate-row-pasted-1")).getByText("PASTED");
    // The "not engine-scored" placeholder is gone; real panels render.
    expect(screen.queryByText("Pasted calendar — not engine-scored.")).toBeNull();
    expect(screen.getByTestId("verdict-word")).toBeTruthy();
    expect(screen.getByTestId("whypanel-forward-edge-sentence")).toBeTruthy();
  });

  it("a network/HTTP error surfaces the paste-error copy, not a crash, and adds no card", async () => {
    mockAnalyzeCalendarMutateAsync.mockImplementationOnce(() =>
      Promise.reject(new Error("POST /api/picker/analyze failed: 500")),
    );

    render(<Analyzer />);
    await paste(PASTE_EXAMPLE);

    expect(screen.getByTestId("picker-paste-error")).toBeTruthy();
    expect(screen.queryByTestId("candidate-row-pasted-1")).toBeNull();
  });
});

describe("Analyzer — copy TOS order (copy-out)", () => {
  beforeEach(stubDesktopMatchMedia);
  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
    Reflect.deleteProperty(window, "matchMedia");
  });

  it("copies the selected candidate's TOS calendar order to the clipboard", () => {
    const writeText = vi.fn();
    Object.defineProperty(navigator, "clipboard", { value: { writeText }, configurable: true });

    render(<Analyzer />);
    fireEvent.click(screen.getByTestId("copy-tos-order"));

    expect(writeText).toHaveBeenCalledWith(buildTosCalendarOrder(TOP, pickerSnapshotFixture.asOf));
    expect(screen.getByTestId("copy-tos-order").textContent).toContain("Copied");
  });

  it("selecting a different row and Copy TOS order copies that candidate — not the previous selection", () => {
    // Phase 41: per-row Copy is gone (Copy lives only in the detail-pane header now) — this
    // proves per-candidate copy wiring still holds once that candidate becomes selected via a
    // table row click (SECOND is not the default selection, TOP is).
    const writeText = vi.fn();
    Object.defineProperty(navigator, "clipboard", { value: { writeText }, configurable: true });

    render(<Analyzer />);
    fireEvent.click(screen.getByTestId(`candidate-row-${SECOND.id}`));
    fireEvent.click(screen.getByTestId("copy-tos-order"));

    expect(writeText).toHaveBeenCalledWith(buildTosCalendarOrder(SECOND, pickerSnapshotFixture.asOf));
  });
});

describe("Analyzer — payoff controls (shared date projection + series toggles)", () => {
  beforeEach(stubDesktopMatchMedia);
  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
    Reflect.deleteProperty(window, "matchMedia");
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
  beforeEach(stubDesktopMatchMedia);
  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
    Reflect.deleteProperty(window, "matchMedia");
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

    const rows = screen.getAllByTestId(/^candidate-row-/);
    expect(rows.length).toBe(pickerSnapshotFixture.candidates.length);
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
  beforeEach(stubDesktopMatchMedia);
  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
    Reflect.deleteProperty(window, "matchMedia");
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
      gateDrops: { liquidity: 3, netTheta: 2, termInverted: 0, eventBlackout: 0 },
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

  it("renders engine labels from the snapshot ruleSet in the correct group (fwdEdge/slope under EDGE)", () => {
    mockUsePickerReturn({ data: snapshotWithRegistry() });
    render(<Analyzer />);

    within(screen.getByTestId("verdict-group-EDGE")).getByTestId("checklist-fwdEdge");
    within(screen.getByTestId("verdict-group-EDGE")).getByTestId("checklist-slope");
  });

  it("renders the gate-drop counts in the quiet footer (no silent caps)", () => {
    mockUsePickerReturn({ data: snapshotWithRegistry() });
    render(<Analyzer />);

    const footer = screen.getByTestId("verdict-hero-footer");
    expect(footer.textContent).toContain("3 illiquid quotes");
    expect(footer.textContent).toContain("2 negative-θ pairs");
  });

  it("renders the experimental context values dim in the quiet footer", () => {
    mockUsePickerReturn({ data: snapshotWithRegistry() });
    render(<Analyzer />);

    const footer = screen.getByTestId("verdict-hero-footer");
    expect(footer.textContent).toContain("CALIBRATING");
    expect(footer.textContent).toContain("0.031");
    expect(footer.textContent).toContain("67");
  });

  it("the Re-pull chains button lives in the Suggested-calendars rail heading, not the scorecard hero", () => {
    mockUsePickerReturn({ data: snapshotWithRegistry() });
    render(<Analyzer />);

    const button = screen.getByTestId("repull-chains-button");
    const wrapper = screen.getByTestId("analyzer-scorecard-wrapper");
    expect(wrapper.contains(button)).toBe(false);
    // The button sits inside the rail panel, adjacent to its heading.
    const rail = screen.getByText("Suggested calendars").closest("section, div.rounded-lg, div");
    expect(rail).not.toBeNull();
  });

  it("factor rows render icon + contribution % for the selected candidate", () => {
    mockUsePickerReturn({ data: snapshotWithRegistry() });
    render(<Analyzer />);

    const fwd = screen.getByTestId("checklist-fwdEdge");
    expect(fwd.textContent).toMatch(/[✓~✗].*%/u);
  });

  it("pre-registry snapshots (empty ruleSet) fall back to the legacy labels", () => {
    mockUsePickerReturn({ data: pickerSnapshotFixture });
    render(<Analyzer />);

    expect(screen.getByTestId("checklist-fwdEdge")).toBeTruthy();
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

// ── 36 D-17: desktop grid post-cleanup (reflow arms removed — this tree only mounts ≥1024px) ──
describe("Analyzer — desktop grid post-cleanup (36 D-17)", () => {
  beforeEach(stubDesktopMatchMedia);
  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
    Reflect.deleteProperty(window, "matchMedia");
  });

  it("puts analyzer-inner-grid on a plain grid — no display:contents, no lg:-gated variants", () => {
    render(<Analyzer />);

    const innerGrid = screen.getByTestId("analyzer-inner-grid");
    const classes = innerGrid.className.split(/\s+/u);
    expect(classes).toContain("grid");
    expect(classes).toContain("grid-cols-[300px_minmax(0,1fr)_330px]");
    expect(classes).toContain("gap-4");
    // The reflow arm is gone: no display:contents, no lg:-prefixed grid variants, no inline style.
    expect(innerGrid.className).not.toContain("contents");
    expect(innerGrid.className).not.toContain("lg:");
    expect(innerGrid.getAttribute("style")).toBeNull();
  });

  it("carries no CSS order utilities on the scorecard / rail / center / right wrappers", () => {
    render(<Analyzer />);

    for (const testId of [
      "analyzer-scorecard-wrapper",
      "analyzer-rail-wrapper",
      "analyzer-center-column",
      "analyzer-right-wrapper",
    ]) {
      const wrapper = screen.getByTestId(testId);
      expect(wrapper.className).not.toContain("order-");
      expect(wrapper.className).not.toContain("lg:");
    }
  });

  it("keeps DOM order scorecard -> rail -> center -> right unchanged", () => {
    render(<Analyzer />);

    const outer = screen.getByTestId("analyzer-scorecard-wrapper").parentElement;
    assertDefined(outer, "outer flex column present");
    const innerGrid = screen.getByTestId("analyzer-inner-grid");
    const outerChildren = Array.from(outer.children);
    expect(outerChildren.indexOf(screen.getByTestId("analyzer-scorecard-wrapper"))).toBeLessThan(
      outerChildren.indexOf(innerGrid),
    );

    const innerChildren = Array.from(innerGrid.children);
    const railIdx = innerChildren.indexOf(screen.getByTestId("analyzer-rail-wrapper"));
    const centerIdx = innerChildren.indexOf(screen.getByTestId("analyzer-center-column"));
    const rightIdx = innerChildren.indexOf(screen.getByTestId("analyzer-right-wrapper"));
    expect(railIdx).toBeLessThan(centerIdx);
    expect(centerIdx).toBeLessThan(rightIdx);
  });

  it("drops the full-bleed chart wrapper — no negative-margin bleed remains in the payoff center", () => {
    const { container } = render(<Analyzer />);

    // The 35-05 mobile-bleed wrapper is gone (PayoffChart renders directly in its Panel).
    expect(screen.queryByTestId("analyzer-payoff-chart-bleed")).toBeNull();
    expect(container.querySelector('[class*="-mx-3"]')).toBeNull();
  });
});

// ── 36: useIsDesktop switch + jsdom-defaults-mobile (D-01/D-16) ──
describe("Analyzer branch — D-01/D-16 (36)", () => {
  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
    Reflect.deleteProperty(window, "matchMedia");
  });

  it("J1: default jsdom render mounts the MOBILE tree — no desktop grid / chips / rail", () => {
    render(<Analyzer />);

    expect(screen.getByTestId("analyzer-mobile-root")).toBeTruthy();
    expect(screen.queryByTestId("analyzer-inner-grid")).toBeNull();
    expect(screen.queryByTestId("verdict-headline")).toBeNull();
    expect(screen.queryByText("Suggested calendars")).toBeNull();
  });

  it("J2: matchMedia-stubbed desktop renders today's tree (byte-identity guard)", () => {
    stubDesktopMatchMedia();
    render(<Analyzer />);

    expect(screen.getByTestId("analyzer-inner-grid")).toBeTruthy();
    expect(screen.queryByTestId("analyzer-mobile-root")).toBeNull();
    // Desktop structural content: rail heading, verdict hero, copy button, right column.
    expect(screen.getByText("Suggested calendars")).toBeTruthy();
    expect(screen.getByTestId("verdict-headline")).toBeTruthy();
    expect(screen.getByTestId("copy-tos-order")).toBeTruthy();
    expect(screen.getByText("Why this calendar")).toBeTruthy();
    expect(screen.getByText("Term structure + your legs")).toBeTruthy();
    expect(screen.getByText("Entry / exit plan")).toBeTruthy();
  });

  it("J9 (desktop half): the desktop PayoffChart call site passes neither mobile chart prop", () => {
    stubDesktopMatchMedia();
    render(<Analyzer />);

    const props = latestPayoffChartProps();
    expect(props.showBePills).toBeUndefined();
    expect(props.aspectRatio).toBeUndefined();
  });
});

// Phase 41 Task 2 (AUI-07): LiveStatusBadge mounted in the desktop Risk-profile header,
// reflecting the mocked stream status.
function setLiveStream(status: "live" | "quiet" | "stalled"): void {
  mockUseLiveStream.mockReturnValue({
    greeks: new Map(),
    status,
    lastTickAt: null,
    isRth: null,
    hasReceivedFirstTick: false,
    isReconnecting: false,
    liveSpot: null,
    liveIndices: null,
    reconnectNow: vi.fn(),
    subscribeAdHoc: vi.fn().mockResolvedValue(undefined),
  });
}

describe("Analyzer — desktop LiveStatusBadge (Phase 41, AUI-07)", () => {
  beforeEach(stubDesktopMatchMedia);
  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
    Reflect.deleteProperty(window, "matchMedia");
  });

  it("renders LIVE in the Risk profile header when the stream is live", () => {
    setLiveStream("live");
    render(<Analyzer />);

    expect(screen.getByText("Risk profile")).toBeTruthy();
    expect(screen.getByText("LIVE")).toBeTruthy();
  });

  it("renders STALLED in the Risk profile header when the stream is stalled", () => {
    setLiveStream("stalled");
    render(<Analyzer />);

    expect(screen.getByText("STALLED")).toBeTruthy();
  });

  it("renders the badge even with no candidate selected (not gated on `selected`)", () => {
    setLiveStream("live");
    mockUsePickerReturn({ data: null });

    render(<Analyzer />);

    expect(screen.getByText("LIVE")).toBeTruthy();
    expect(screen.queryByTestId("copy-tos-order")).toBeNull();
  });
});
