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
 * Task 3 (payoff center) test cases are appended below Task 2's.
 */
import { describe, it, expect, afterEach } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import { pickerSnapshotFixture } from "@morai/contracts";
import { Analyzer, CandidateRail } from "./Analyzer.tsx";

const SORTED_CANDIDATES = [...pickerSnapshotFixture.candidates].sort((a, b) => b.score - a.score);
const TOP = SORTED_CANDIDATES[0];
const SECOND = SORTED_CANDIDATES[1];

if (TOP === undefined || SECOND === undefined) {
  throw new Error("pickerSnapshotFixture must carry at least 2 candidates for this suite");
}

describe("Analyzer — ranked candidate rail (Task 2)", () => {
  afterEach(() => {
    cleanup();
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
