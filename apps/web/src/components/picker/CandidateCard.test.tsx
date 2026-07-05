/**
 * CandidateCard.test.tsx — TDD RED→GREEN for the picker's ranked-card component (ANLZ-01, D-05).
 *
 * Behaviors under test (18-04-PLAN.md Task 1):
 *   - Data-driven breakdown bars: 4 bars, looked up BY criterion name — never a hard-coded
 *     array index (proven via a shuffled-order breakdown array).
 *   - The 5th `beVsEm` breakdown entry is present in the data but NEVER rendered as a card bar.
 *   - Guard case (fwdIv === null): the fwd-edge bar renders zero-width + caption "n/a", never NaN.
 *   - Click delegation: whole-card click fires onSelect; ⊕ click fires onToggleCombine only
 *     (stopPropagation — onSelect must NOT also fire).
 */
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import type { PickerCandidate, BreakdownEntry } from "@morai/contracts";
import { CandidateCard } from "./CandidateCard.tsx";

function leg(strike: number, iv: number, dte: number): PickerCandidate["frontLeg"] {
  return { strike, putCall: "P", dte, iv };
}

/** Snapshot-level fields (D-15/D-16/D-17) — identical across every card in a fetch. */
const SNAPSHOT_PROPS = {
  asOf: "2026-07-02",
  source: "schwab" as const,
  gexContextStatus: "ok" as const,
  eventsContextStatus: "ok" as const,
};

function makeCandidate(overrides: {
  id: string;
  breakdown: BreakdownEntry[];
  fwdIv: number | null;
  fwdIvGuard: "ok" | "inverted";
}): PickerCandidate {
  return {
    id: overrides.id,
    name: "7500P Jul 23 / Aug 14",
    score: 47,
    breakdown: overrides.breakdown,
    debit: 4627.55,
    theta: 45.9,
    vega: 305.3,
    delta: 1.2,
    fwdIv: overrides.fwdIv,
    fwdIvGuard: overrides.fwdIvGuard,
    slope: 0.253841,
    fwdEdge: -0.028487,
    expectedMove: 224.657,
    frontEvents: ["NFP", "CPI"],
    backEvents: ["FOMC"],
    frontLeg: leg(7500, 0.1249, 21),
    backLeg: leg(7500, 0.1402, 43),
    exitPlan: {
      profitTargetPct: 0.25,
      stopPct: 0.175,
      manageShortDte: 21,
      closeByExpiry: "2026-07-23",
    },
  };
}

// Shuffled order (not slope→fwdEdge→gexFit→eventAdjustment→beVsEm) — proves the component
// looks entries up BY criterion name, never a hard-coded array index.
const SHUFFLED_BREAKDOWN: BreakdownEntry[] = [
  { criterion: "eventAdjustment", weight: 10, rawValue: 0.5, contribution: 50 },
  { criterion: "beVsEm", weight: 10, rawValue: 0.5329, contribution: 53.29 },
  { criterion: "gexFit", weight: 15, rawValue: 1, contribution: 100 },
  { criterion: "slope", weight: 40, rawValue: 0.253841, contribution: 42.31 },
  { criterion: "fwdEdge", weight: 25, rawValue: 0.1, contribution: 30 },
];

const GUARD_BREAKDOWN: BreakdownEntry[] = [
  { criterion: "slope", weight: 40, rawValue: -0.760417, contribution: 0 },
  { criterion: "fwdEdge", weight: 25, rawValue: 0, contribution: 0 },
  { criterion: "gexFit", weight: 15, rawValue: 0.6, contribution: 60 },
  { criterion: "eventAdjustment", weight: 10, rawValue: 0.5, contribution: 50 },
  { criterion: "beVsEm", weight: 10, rawValue: 0, contribution: 0 },
];

describe("CandidateCard — data-driven breakdown bars (D-05)", () => {
  afterEach(() => {
    cleanup();
  });

  it("maps each of the 4 bars to its criterion by name, independent of the breakdown array's order", () => {
    const candidate = makeCandidate({
      id: "shuffled-1",
      breakdown: SHUFFLED_BREAKDOWN,
      fwdIv: 0.153,
      fwdIvGuard: "ok",
    });

    render(
      <CandidateCard
        candidate={candidate}
        selected={false}
        combined={false}
        {...SNAPSHOT_PROPS}
        onSelect={() => {}}
        onToggleCombine={() => {}}
        copied={false}
        onCopy={() => {}}
      />,
    );

    expect(screen.getByTestId("breakdown-bar-fill-slope").style.width).toBe("42.31%");
    expect(screen.getByTestId("breakdown-bar-fill-fwdEdge").style.width).toBe("30%");
    expect(screen.getByTestId("breakdown-bar-fill-gexFit").style.width).toBe("100%");
    expect(screen.getByTestId("breakdown-bar-fill-eventAdjustment").style.width).toBe("50%");
  });

  it("never renders a 5th bar for the beVsEm breakdown entry, even though it's present in the data", () => {
    const candidate = makeCandidate({
      id: "shuffled-2",
      breakdown: SHUFFLED_BREAKDOWN,
      fwdIv: 0.153,
      fwdIvGuard: "ok",
    });

    const { container } = render(
      <CandidateCard
        candidate={candidate}
        selected={false}
        combined={false}
        {...SNAPSHOT_PROPS}
        onSelect={() => {}}
        onToggleCombine={() => {}}
        copied={false}
        onCopy={() => {}}
      />,
    );

    expect(screen.queryByTestId("breakdown-bar-fill-beVsEm")).toBeNull();
    expect(container.querySelectorAll('[data-testid^="breakdown-bar-fill-"]').length).toBe(4);
  });

  it("guard case (fwdIv null): fwd-edge bar renders zero-width + caption n/a, never NaN or a throw", () => {
    const candidate = makeCandidate({
      id: "guard-1",
      breakdown: GUARD_BREAKDOWN,
      fwdIv: null,
      fwdIvGuard: "inverted",
    });

    let container: HTMLElement | undefined;
    expect(() => {
      ({ container } = render(
        <CandidateCard
          candidate={candidate}
          selected={false}
          combined={false}
        {...SNAPSHOT_PROPS}
          onSelect={() => {}}
          onToggleCombine={() => {}}
          copied={false}
          onCopy={() => {}}
        />,
      ));
    }).not.toThrow();

    const fwdEdgeBar = screen.getByTestId("breakdown-bar-fill-fwdEdge");
    expect(fwdEdgeBar.style.width).toBe("0%");
    expect(screen.getByText("n/a")).toBeTruthy();
    expect(container?.innerHTML.includes("NaN")).toBe(false);
  });
});

describe("CandidateCard — click delegation", () => {
  afterEach(() => {
    cleanup();
  });

  it("whole-card click fires onSelect(candidate)", () => {
    const candidate = makeCandidate({
      id: "click-1",
      breakdown: SHUFFLED_BREAKDOWN,
      fwdIv: 0.153,
      fwdIvGuard: "ok",
    });
    const onSelect = vi.fn();
    const onToggleCombine = vi.fn();

    render(
      <CandidateCard
        candidate={candidate}
        selected={false}
        combined={false}
        {...SNAPSHOT_PROPS}
        onSelect={onSelect}
        onToggleCombine={onToggleCombine}
        copied={false}
        onCopy={() => {}}
      />,
    );

    fireEvent.click(screen.getByTestId("candidate-card-click-1"));

    expect(onSelect).toHaveBeenCalledExactlyOnceWith(candidate);
    expect(onToggleCombine).not.toHaveBeenCalled();
  });

  it("⊕ click fires onToggleCombine(candidate) only — does NOT also fire onSelect", () => {
    const candidate = makeCandidate({
      id: "click-2",
      breakdown: SHUFFLED_BREAKDOWN,
      fwdIv: 0.153,
      fwdIvGuard: "ok",
    });
    const onSelect = vi.fn();
    const onToggleCombine = vi.fn();

    render(
      <CandidateCard
        candidate={candidate}
        selected={false}
        combined={false}
        {...SNAPSHOT_PROPS}
        onSelect={onSelect}
        onToggleCombine={onToggleCombine}
        copied={false}
        onCopy={() => {}}
      />,
    );

    fireEvent.click(screen.getByText("⊕ Combine"));

    expect(onToggleCombine).toHaveBeenCalledExactlyOnceWith(candidate);
    expect(onSelect).not.toHaveBeenCalled();
  });

  it("⧉ Copy click fires onCopy(candidate) only — does NOT also fire onSelect", () => {
    const candidate = makeCandidate({
      id: "copy-1",
      breakdown: SHUFFLED_BREAKDOWN,
      fwdIv: 0.153,
      fwdIvGuard: "ok",
    });
    const onSelect = vi.fn();
    const onCopy = vi.fn();

    render(
      <CandidateCard
        candidate={candidate}
        selected={false}
        combined={false}
        {...SNAPSHOT_PROPS}
        onSelect={onSelect}
        onToggleCombine={() => {}}
        copied={false}
        onCopy={onCopy}
      />,
    );

    fireEvent.click(screen.getByTestId("copy-tos-copy-1"));

    expect(onCopy).toHaveBeenCalledExactlyOnceWith(candidate);
    expect(onSelect).not.toHaveBeenCalled();
  });

  it("shows 'Copied ✓' when copied=true", () => {
    const candidate = makeCandidate({
      id: "copy-2",
      breakdown: SHUFFLED_BREAKDOWN,
      fwdIv: 0.153,
      fwdIvGuard: "ok",
    });

    render(
      <CandidateCard
        candidate={candidate}
        selected={false}
        combined={false}
        {...SNAPSHOT_PROPS}
        onSelect={() => {}}
        onToggleCombine={() => {}}
        copied
        onCopy={() => {}}
      />,
    );

    expect(screen.getByTestId("copy-tos-copy-2").textContent).toContain("Copied");
  });

  it("shows '✓ Combined' when combined=true", () => {
    const candidate = makeCandidate({
      id: "click-3",
      breakdown: SHUFFLED_BREAKDOWN,
      fwdIv: 0.153,
      fwdIvGuard: "ok",
    });

    render(
      <CandidateCard
        candidate={candidate}
        selected={false}
        combined
        {...SNAPSHOT_PROPS}
        onSelect={() => {}}
        onToggleCombine={() => {}}
        copied={false}
        onCopy={() => {}}
      />,
    );

    expect(screen.getByText("✓ Combined")).toBeTruthy();
  });
});

describe("CandidateCard — staleness+source tag (19-09-PLAN.md Task 3, D-15/D-16)", () => {
  afterEach(() => {
    cleanup();
  });

  it("renders 'as of {HH:MM} · {source}' with a fresh (bg-up) dot for a just-computed snapshot", () => {
    const nowIso = new Date().toISOString();
    const candidate = makeCandidate({
      id: "fresh-1",
      breakdown: SHUFFLED_BREAKDOWN,
      fwdIv: 0.153,
      fwdIvGuard: "ok",
    });

    const { container } = render(
      <CandidateCard
        candidate={candidate}
        selected={false}
        combined={false}
        asOf={nowIso}
        source="cboe"
        gexContextStatus="ok"
        eventsContextStatus="ok"
        onSelect={() => {}}
        onToggleCombine={() => {}}
        copied={false}
        onCopy={() => {}}
      />,
    );

    const expectedHhmm = new Date(nowIso).toLocaleTimeString([], {
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    });
    expect(screen.getByText(`as of ${expectedHhmm} · cboe`)).toBeTruthy();
    expect(container.querySelector(".bg-up")).not.toBeNull();
  });

  it("renders an amber (bg-amber) dot when the snapshot is older than the freshness window", () => {
    const staleIso = new Date(Date.now() - 90 * 60 * 1000).toISOString();
    const candidate = makeCandidate({
      id: "stale-1",
      breakdown: SHUFFLED_BREAKDOWN,
      fwdIv: 0.153,
      fwdIvGuard: "ok",
    });

    render(
      <CandidateCard
        candidate={candidate}
        selected={false}
        combined={false}
        asOf={staleIso}
        source="schwab"
        gexContextStatus="ok"
        eventsContextStatus="ok"
        onSelect={() => {}}
        onToggleCombine={() => {}}
        copied={false}
        onCopy={() => {}}
      />,
    );

    const expectedHhmm = new Date(staleIso).toLocaleTimeString([], {
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    });
    const tag = screen.getByText(`as of ${expectedHhmm} · schwab`);
    expect(tag.parentElement?.querySelector(".bg-amber")).not.toBeNull();
  });

  it("renders 'as of —' (em-dash), never 'Invalid Date', when asOf fails to parse", () => {
    const candidate = makeCandidate({
      id: "bad-asof-1",
      breakdown: SHUFFLED_BREAKDOWN,
      fwdIv: 0.153,
      fwdIvGuard: "ok",
    });

    const { container } = render(
      <CandidateCard
        candidate={candidate}
        selected={false}
        combined={false}
        asOf="not-a-real-date"
        source="schwab"
        gexContextStatus="ok"
        eventsContextStatus="ok"
        onSelect={() => {}}
        onToggleCombine={() => {}}
        copied={false}
        onCopy={() => {}}
      />,
    );

    expect(screen.getByText("as of — · schwab")).toBeTruthy();
    expect(container.innerHTML.includes("Invalid Date")).toBe(false);
  });

  it("shows a 'GEX unavailable' tag and zeroes the gexFit bar when gexContextStatus !== 'ok'", () => {
    const candidate = makeCandidate({
      id: "gex-unavailable-1",
      breakdown: SHUFFLED_BREAKDOWN,
      fwdIv: 0.153,
      fwdIvGuard: "ok",
    });

    render(
      <CandidateCard
        candidate={candidate}
        selected={false}
        combined={false}
        asOf="2026-07-02T14:32:00.000Z"
        source="schwab"
        gexContextStatus="stale"
        eventsContextStatus="ok"
        onSelect={() => {}}
        onToggleCombine={() => {}}
        copied={false}
        onCopy={() => {}}
      />,
    );

    expect(screen.getByText("GEX unavailable")).toBeTruthy();
    expect(screen.queryByText("events unavailable")).toBeNull();
    const gexBar = screen.getByTestId("breakdown-bar-fill-gexFit");
    expect(gexBar.style.width).toBe("0%");
  });

  it("shows an 'events unavailable' tag and zeroes the eventAdjustment bar when eventsContextStatus !== 'ok'", () => {
    const candidate = makeCandidate({
      id: "events-unavailable-1",
      breakdown: SHUFFLED_BREAKDOWN,
      fwdIv: 0.153,
      fwdIvGuard: "ok",
    });

    render(
      <CandidateCard
        candidate={candidate}
        selected={false}
        combined={false}
        asOf="2026-07-02T14:32:00.000Z"
        source="schwab"
        gexContextStatus="ok"
        eventsContextStatus="missing"
        onSelect={() => {}}
        onToggleCombine={() => {}}
        copied={false}
        onCopy={() => {}}
      />,
    );

    expect(screen.getByText("events unavailable")).toBeTruthy();
    expect(screen.queryByText("GEX unavailable")).toBeNull();
    const eventBar = screen.getByTestId("breakdown-bar-fill-eventAdjustment");
    expect(eventBar.style.width).toBe("0%");
  });

  it("shows both context tags simultaneously when both statuses are degraded", () => {
    const candidate = makeCandidate({
      id: "both-unavailable-1",
      breakdown: SHUFFLED_BREAKDOWN,
      fwdIv: 0.153,
      fwdIvGuard: "ok",
    });

    render(
      <CandidateCard
        candidate={candidate}
        selected={false}
        combined={false}
        asOf="2026-07-02T14:32:00.000Z"
        source="schwab"
        gexContextStatus="missing"
        eventsContextStatus="stale"
        onSelect={() => {}}
        onToggleCombine={() => {}}
        copied={false}
        onCopy={() => {}}
      />,
    );

    expect(screen.getByText("GEX unavailable")).toBeTruthy();
    expect(screen.getByText("events unavailable")).toBeTruthy();
  });

  it("WR-02: shows the warning caption for a high-penalty (evtPenalty >= 1) eventAdjustment, not 'ok'", () => {
    const highPenaltyBreakdown: BreakdownEntry[] = [
      { criterion: "slope", weight: 40, rawValue: 0.253841, contribution: 42.31 },
      { criterion: "fwdEdge", weight: 25, rawValue: 0.1, contribution: 30 },
      { criterion: "gexFit", weight: 15, rawValue: 1, contribution: 100 },
      { criterion: "eventAdjustment", weight: 10, rawValue: 1, contribution: 0 }, // worst case: FOMC + CPI
      { criterion: "beVsEm", weight: 10, rawValue: 0.5329, contribution: 53.29 },
    ];
    const candidate = makeCandidate({
      id: "high-penalty-1",
      breakdown: highPenaltyBreakdown,
      fwdIv: 0.153,
      fwdIvGuard: "ok",
    });

    render(
      <CandidateCard
        candidate={candidate}
        selected={false}
        combined={false}
        {...SNAPSHOT_PROPS}
        onSelect={() => {}}
        onToggleCombine={() => {}}
        copied={false}
        onCopy={() => {}}
      />,
    );

    const caption = screen.getByTestId("breakdown-bar-fill-eventAdjustment").parentElement
      ?.nextElementSibling;
    expect(caption?.textContent).toBe("−");
  });

  it("WR-02: shows the clean caption for a zero-penalty (evtPenalty === 0) eventAdjustment, not '−'", () => {
    const cleanBreakdown: BreakdownEntry[] = [
      { criterion: "slope", weight: 40, rawValue: 0.253841, contribution: 42.31 },
      { criterion: "fwdEdge", weight: 25, rawValue: 0.1, contribution: 30 },
      { criterion: "gexFit", weight: 15, rawValue: 1, contribution: 100 },
      { criterion: "eventAdjustment", weight: 10, rawValue: 0, contribution: 100 }, // clean: no front events
      { criterion: "beVsEm", weight: 10, rawValue: 0.5329, contribution: 53.29 },
    ];
    const candidate = makeCandidate({
      id: "clean-1",
      breakdown: cleanBreakdown,
      fwdIv: 0.153,
      fwdIvGuard: "ok",
    });

    render(
      <CandidateCard
        candidate={candidate}
        selected={false}
        combined={false}
        {...SNAPSHOT_PROPS}
        onSelect={() => {}}
        onToggleCombine={() => {}}
        copied={false}
        onCopy={() => {}}
      />,
    );

    const caption = screen.getByTestId("breakdown-bar-fill-eventAdjustment").parentElement
      ?.nextElementSibling;
    expect(caption?.textContent).toBe("ok");
  });
});
