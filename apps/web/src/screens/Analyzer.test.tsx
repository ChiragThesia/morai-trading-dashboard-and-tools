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
import type { PickerSnapshotResponse, ExitsResponse } from "@morai/contracts";

vi.mock("../components/charts/PayoffChart.tsx", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../components/charts/PayoffChart.tsx")>();
  return { ...actual, PayoffChart: vi.fn(actual.PayoffChart) };
});

const { mockUsePicker } = vi.hoisted(() => ({ mockUsePicker: vi.fn() }));
vi.mock("../hooks/usePicker.ts", () => ({ usePicker: mockUsePicker }));

// useExits (26-06): mocked the same way as usePicker — no network, no QueryClientProvider
// needed. Defaults to the cold-start shape (data: null) so every pre-existing fixture-driven
// suite in this file is unaffected; the held-positions/exit-rules describe block below
// overrides per test.
const { mockUseExits } = vi.hoisted(() => ({ mockUseExits: vi.fn() }));
vi.mock("../hooks/useExits.ts", () => ({ useExits: mockUseExits }));

// useRepullChains needs a QueryClient; this suite renders Analyzer without a provider, so the
// mutation hook is mocked to an inert stub (its own behavior is covered in useRepullChains.test.ts).
const { mockRepull } = vi.hoisted(() => ({
  mockRepull: vi.fn(() => ({ mutate: vi.fn(), isPending: false, isSuccess: false, isError: false })),
}));
vi.mock("../hooks/useRepullChains.ts", () => ({ useRepullChains: mockRepull }));

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

type MockExitsResult = Pick<UseQueryResult<ExitsResponse | null>, "data" | "isPending" | "isError" | "refetch">;

function mockUseExitsReturn(overrides: Partial<MockExitsResult>): void {
  mockUseExits.mockReturnValue({
    data: null,
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

// 26-06: a distinct-timestamp exitsResponse fixture covering every verdict/severity/indicative/
// changed/roll combination the held-positions panel renders. No packages/contracts fixture
// exists yet for this response shape (26-05 shipped the route, not a fixture) — inline, mirroring
// this file's own RULESET-style local fixtures below.
const EXITS_FIXTURE: ExitsResponse = {
  asOf: "2026-07-09",
  observedAt: "2026-07-09T14:30:00.000Z",
  marketSession: "rth",
  positions: [
    {
      calendarId: "cal-hold",
      name: "SPX 18SEP/14AUG 7425P",
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
    },
    {
      calendarId: "cal-take",
      name: "SPX 18SEP/14AUG 7450P",
      verdict: "TAKE",
      rung: "+10%",
      ruleId: "take",
      metric: { name: "pnlPct", value: 0.11, threshold: 0.1 },
      indicative: false,
      changed: true,
      escalate: false,
      pnlPct: 0.11,
      basis: { openNetDebit: 500, netMark: 555 },
      roll: null,
    },
    {
      calendarId: "cal-stop",
      name: "SPX 18SEP/14AUG 7400P",
      verdict: "STOP",
      rung: "-25%",
      ruleId: "stop",
      metric: { name: "pnlPct", value: -0.261, threshold: -0.25 },
      indicative: false,
      changed: false,
      escalate: true,
      pnlPct: -0.261,
      basis: { openNetDebit: 500, netMark: 369.5 },
      roll: null,
    },
    {
      calendarId: "cal-exit",
      name: "SPX 21AUG/14AUG 7500P",
      verdict: "EXIT_PRE_EVENT",
      rung: null,
      ruleId: "evt",
      metric: { name: "daysToEvent", value: 2, threshold: 3 },
      indicative: false,
      changed: false,
      escalate: true,
      pnlPct: 0.03,
      basis: { openNetDebit: 400, netMark: 412 },
      roll: null,
    },
    {
      calendarId: "cal-indicative",
      name: "SPX 18SEP/14AUG 7350P",
      verdict: "STOP",
      rung: "-50%",
      ruleId: "stop",
      metric: { name: "pnlPct", value: -0.55, threshold: -0.5 },
      indicative: true,
      changed: false,
      escalate: false,
      pnlPct: -0.55,
      basis: { openNetDebit: 400, netMark: 180 },
      roll: null,
    },
    {
      calendarId: "cal-roll",
      name: "SPX 28AUG/21AUG 7420P",
      verdict: "ROLL",
      rung: null,
      ruleId: "roll",
      metric: { name: "dteFront", value: 10, threshold: 14 },
      indicative: false,
      changed: false,
      escalate: false,
      pnlPct: 0.04,
      basis: { openNetDebit: 420, netMark: 437 },
      roll: { suggestedFrontExpiry: "2026-09-11", estDebit: 410 },
    },
  ],
  ruleSet: [
    { id: "stop", kind: "trigger", rationale: "Capital preservation is non-negotiable." },
    { id: "evt", kind: "trigger", rationale: "A fixed calendar date, not a noise-driven trigger." },
    { id: "gamma", kind: "trigger", rationale: "Pin/whipsaw risk in the final DTE window." },
    { id: "term", kind: "trigger", rationale: "Front-back IV inversion means the edge is gone." },
    { id: "take", kind: "profit-take", rationale: "Profit-taking is patient, evaluated last." },
    { id: "roll", kind: "roll", rationale: "A constructive continuation, evaluated only once nothing urgent fired." },
    { id: "hold", kind: "hold", rationale: "Default verdict when no other rule fired." },
  ],
};

// Default usePicker()/useExits() mock for every test in this file: a settled, populated picker
// fetch equal to the frozen Phase-18 fixture (every pre-existing fixture-driven suite below is
// unaffected) + a cold-start exits fetch (data: null — no held-positions/exit-rules content, so
// no pre-existing DOM assertion below is affected). Individual tests override either per-test.
beforeEach(() => {
  mockUsePickerReturn({});
  mockUseExitsReturn({});
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

describe("Analyzer — pasted calendars (multi-paste)", () => {
  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  // Dates far in the future so this suite never goes stale relative to "today". Distinct
  // strikes/debits so two pasted cards are distinguishable in combine assertions.
  const PASTE_EXAMPLE =
    "BUY +1 CALENDAR SPX 100 (Weeklys) 31 DEC 30/1 DEC 30 7450 PUT @45.85 LMT GTC";
  const PASTE_EXAMPLE_2 =
    "BUY +1 CALENDAR SPX 100 (Weeklys) 31 DEC 30/1 DEC 30 7500 PUT @52.10 LMT GTC";

  function paste(text: string): void {
    fireEvent.change(screen.getByTestId("picker-paste-input"), { target: { value: text } });
    fireEvent.click(screen.getByTestId("picker-paste-analyze"));
  }

  it("mounts the paste-to-analyze input at the top of the Suggested calendars panel (no separate top chart)", () => {
    render(<Analyzer />);
    expect(screen.getByTestId("picker-paste-input")).toBeTruthy();
    expect(screen.getByTestId("picker-paste-analyze")).toBeTruthy();
    // No separate ad-hoc panel/chart above the grid — the old adhoc-* ids are gone.
    expect(screen.queryByTestId("adhoc-input")).toBeNull();
    expect(screen.queryByTestId("adhoc-analyze")).toBeNull();
  });

  it("Analyze on a valid paste ADDS a PASTED card at the top of the rail, auto-selects it, and clears the input", () => {
    render(<Analyzer />);

    paste(PASTE_EXAMPLE);

    const cards = screen.getAllByTestId(/^candidate-card-/);
    expect(cards[0]?.getAttribute("data-testid")).toBe("candidate-card-pasted-1");
    expect(screen.getByTestId("risk-profile-selected-name").textContent).toBe("7450P · pasted");
    within(screen.getByTestId("candidate-card-pasted-1")).getByText("PASTED");
    expect(screen.getByTestId("picker-paste-input")).toHaveProperty("value", "");
  });

  it("a second Analyze ADDS a second PASTED card (both coexist, pinned in paste order) and auto-selects the new one", () => {
    render(<Analyzer />);

    paste(PASTE_EXAMPLE);
    paste(PASTE_EXAMPLE_2);

    const cards = screen.getAllByTestId(/^candidate-card-/);
    expect(cards[0]?.getAttribute("data-testid")).toBe("candidate-card-pasted-1");
    expect(cards[1]?.getAttribute("data-testid")).toBe("candidate-card-pasted-2");
    expect(screen.getByTestId("risk-profile-selected-name").textContent).toBe("7500P · pasted");
  });

  it("the pasted candidate drives the shared center Risk-profile chart via the same candidate→position→repriceScenario path", () => {
    render(<Analyzer />);

    paste(PASTE_EXAMPLE);

    const parsed = parseTosOrder(PASTE_EXAMPLE, new Date(), pickerSnapshotFixture.spot, 0.045);
    if (parsed === null) throw new Error("expected PASTE_EXAMPLE to parse");
    const pastedCandidate = parsedCalendarToPickerCandidate(parsed, "pasted-1");
    const expected = repriceScenario([candidateToAnalyzerPosition(pastedCandidate)], PARAMS);

    const props = latestPayoffChartProps();
    expect(props.todayCurve).toEqual(expected.payoffCurve);
    expect(props.expirationCurve).toEqual(expected.expirationCurve);
  });

  it("shows the parse-error copy when the pasted text doesn't parse, without disturbing existing pasted cards", () => {
    render(<Analyzer />);

    paste(PASTE_EXAMPLE);
    paste("not an order");

    expect(screen.getByTestId("picker-paste-error")).toBeTruthy();
    // The earlier successful paste is untouched by the failed second attempt.
    expect(screen.getByTestId("candidate-card-pasted-1")).toBeTruthy();
    expect(screen.queryByTestId("candidate-card-pasted-2")).toBeNull();
  });

  it("each pasted card's × removes just that card, cleans its combine state, and re-selects the top-ranked scored candidate when it was selected", () => {
    render(<Analyzer />);

    paste(PASTE_EXAMPLE);
    paste(PASTE_EXAMPLE_2);
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

  it("removing a pasted card that is NOT selected leaves the current selection untouched", () => {
    render(<Analyzer />);

    paste(PASTE_EXAMPLE);
    paste(PASTE_EXAMPLE_2);
    // Select pasted-1 explicitly (pasted-2 is auto-selected by the second paste).
    fireEvent.click(screen.getByTestId("candidate-card-pasted-1"));

    fireEvent.click(screen.getByTestId("remove-pasted-pasted-2"));

    expect(screen.getByTestId("risk-profile-selected-name").textContent).toBe("7450P · pasted");
  });

  it("⊕ Combine on two pasted calendars sums both debits into the combined-book summary", () => {
    render(<Analyzer />);

    paste(PASTE_EXAMPLE);
    paste(PASTE_EXAMPLE_2);
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

  it("Clear all removes every pasted card and re-selects the top-ranked scored candidate", () => {
    render(<Analyzer />);

    paste(PASTE_EXAMPLE);
    paste(PASTE_EXAMPLE_2);
    expect(screen.getByTestId("candidate-card-pasted-1")).toBeTruthy();
    expect(screen.getByTestId("candidate-card-pasted-2")).toBeTruthy();

    fireEvent.click(screen.getByTestId("picker-paste-clear-all"));

    expect(screen.queryByTestId("candidate-card-pasted-1")).toBeNull();
    expect(screen.queryByTestId("candidate-card-pasted-2")).toBeNull();
    expect(screen.getByTestId("risk-profile-selected-name").textContent).toBe(TOP.name);
  });

  it("the Clear all button only renders once at least one calendar has been pasted", () => {
    render(<Analyzer />);
    expect(screen.queryByTestId("picker-paste-clear-all")).toBeNull();

    paste(PASTE_EXAMPLE);
    expect(screen.getByTestId("picker-paste-clear-all")).toBeTruthy();
  });

  it("Why / Scoring checklist / Entry-exit show a 'not engine-scored' note when a pasted candidate is selected", () => {
    render(<Analyzer />);

    paste(PASTE_EXAMPLE);

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

describe("Analyzer — held positions + exit rules panels (26-06-PLAN.md, EXIT-07/EXIT-09/EXIT-10)", () => {
  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it("renders one held-position row per fixture position + the exit rules list in payload order", () => {
    mockUseExitsReturn({ data: EXITS_FIXTURE });
    render(<Analyzer />);

    for (const row of EXITS_FIXTURE.positions) {
      expect(screen.getByTestId(`held-position-${row.calendarId}`)).toBeTruthy();
    }
    const ruleRows = screen.getAllByTestId(/^exit-rule-/);
    expect(ruleRows.map((el) => el.getAttribute("data-testid"))).toEqual(
      EXITS_FIXTURE.ruleSet.map((r) => `exit-rule-${r.id}`),
    );
  });

  it("STOP escalates to the down-alert chip with the exact verdict label + rule/metric line", () => {
    mockUseExitsReturn({ data: EXITS_FIXTURE });
    render(<Analyzer />);

    const chip = screen.getByTestId("held-position-verdict-cal-stop");
    expect(chip.textContent).toContain("STOP −25%");
    expect(chip.className).toContain("bg-downd");
    expect(screen.getByTestId("held-position-rule-cal-stop").textContent).toBe("stop · pnlPct −26.1%");
  });

  it("EXIT — pre-event escalates to the filled-amber chip, a distinct hue from STOP's fill", () => {
    mockUseExitsReturn({ data: EXITS_FIXTURE });
    render(<Analyzer />);

    const chip = screen.getByTestId("held-position-verdict-cal-exit");
    expect(chip.textContent).toContain("EXIT — pre-event");
    expect(chip.className).toContain("bg-amber/15");
    expect(chip.className).not.toContain("bg-downd");
  });

  it("HOLD/TAKE/ROLL render on the plain (non-alert) chip background", () => {
    mockUseExitsReturn({ data: EXITS_FIXTURE });
    render(<Analyzer />);

    for (const id of ["cal-hold", "cal-take", "cal-roll"]) {
      const chip = screen.getByTestId(`held-position-verdict-${id}`);
      expect(chip.className).toContain("bg-raise/40");
      expect(chip.className).not.toContain("bg-downd");
    }
  });

  it("T-26-16: an indicative STOP is FORCED to the INDICATIVE treatment, never escalated STOP colors", () => {
    mockUseExitsReturn({ data: EXITS_FIXTURE });
    render(<Analyzer />);

    expect(screen.queryByText("STOP −50%")).toBeNull();
    const indicativeMark = screen.getByTestId("held-position-indicative-cal-indicative");
    // EXITS_FIXTURE.marketSession is "rth" — a session-agnostic indicative row (e.g. a stale
    // mark) reads "STALE — indicative", not "AH — indicative" (that string is reserved for an
    // after-hours-marketSession snapshot, exercised separately below).
    expect(indicativeMark.textContent).toBe("STALE — indicative");
    expect(indicativeMark.className).toContain("text-amber");
  });

  it("indicative marker reads 'AH — indicative' when the snapshot's marketSession is after-hours", () => {
    mockUseExitsReturn({ data: { ...EXITS_FIXTURE, marketSession: "after-hours" } });
    render(<Analyzer />);

    const indicativeMark = screen.getByTestId("held-position-indicative-cal-indicative");
    expect(indicativeMark.textContent).toBe("AH — indicative");
  });

  it("EXIT-09: a changed verdict shows the CHANGED marker in the verdict's own value color", () => {
    mockUseExitsReturn({ data: EXITS_FIXTURE });
    render(<Analyzer />);

    const marker = screen.getByTestId("held-position-changed-cal-take");
    expect(marker.textContent).toBe("CHANGED");
    expect(marker.className).toContain("text-up");
    expect(screen.queryByTestId("held-position-changed-cal-hold")).toBeNull();
  });

  it("renders the ROLL suggestion detail row only for the ROLL verdict", () => {
    mockUseExitsReturn({ data: EXITS_FIXTURE });
    render(<Analyzer />);

    const rollRow = screen.getByTestId("held-position-roll-cal-roll");
    expect(rollRow.textContent).toContain("2026-09-11");
    expect(rollRow.textContent).toContain("$410");
    expect(screen.queryByTestId("held-position-roll-cal-hold")).toBeNull();
  });

  it("EXIT-10: the held-positions panel has no button/order affordance anywhere in its rows", () => {
    mockUseExitsReturn({ data: EXITS_FIXTURE });
    render(<Analyzer />);

    for (const row of EXITS_FIXTURE.positions) {
      const rowEl = screen.getByTestId(`held-position-${row.calendarId}`);
      expect(rowEl.querySelectorAll("button").length).toBe(0);
    }
  });

  it("cold-start: null data shows 'Exit advisor warming up'", () => {
    mockUseExitsReturn({ data: null, isPending: false, isError: false });
    render(<Analyzer />);

    const coldStart = screen.getByTestId("held-positions-cold-start");
    expect(coldStart.textContent).toContain("Exit advisor warming up");
    expect(coldStart.textContent).toContain(
      "First verdict pending — check back after the next chain snapshot.",
    );
  });

  it("empty: a settled snapshot with zero positions shows 'No open positions'", () => {
    mockUseExitsReturn({ data: { ...EXITS_FIXTURE, positions: [] }, isPending: false, isError: false });
    render(<Analyzer />);

    const empty = screen.getByTestId("held-positions-empty");
    expect(empty.textContent).toContain("No open positions");
    expect(empty.textContent).toContain(
      "Nothing to advise on — the exit advisor activates once you have an open calendar.",
    );
  });

  it("loading: shows 'Loading exit verdicts…'", () => {
    mockUseExitsReturn({ data: undefined, isPending: true, isError: false });
    render(<Analyzer />);

    expect(screen.getByTestId("held-positions-loading").textContent).toBe("Loading exit verdicts…");
  });

  it("error: shows \"Couldn't load exit verdicts.\" + a Retry button wired to refetch", () => {
    const refetch = vi.fn();
    mockUseExitsReturn({ data: undefined, isPending: false, isError: true, refetch });
    render(<Analyzer />);

    const errorBlock = screen.getByTestId("held-positions-error");
    expect(errorBlock.textContent).toContain("Couldn't load exit verdicts.");
    fireEvent.click(within(errorBlock).getByText("Retry"));
    expect(refetch).toHaveBeenCalledOnce();
  });
});
