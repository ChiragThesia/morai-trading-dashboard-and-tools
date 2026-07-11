/**
 * AnalyzerMobile.test.tsx — the dedicated mobile Analyzer tree (Phase 36, D-06/D-07/D-18).
 *
 * Harness mirrors Analyzer.test.tsx: vi.hoisted mocks for usePicker / useRepullChains /
 * useAnalyzeCalendar, and a spy-wrapped PayoffChart (importOriginal) for the Task-3 chart
 * assertions. NO matchMedia stub — jsdom's default makes useIsDesktop() report mobile, so
 * `<Analyzer />` mounts the mobile tree (D-16).
 *
 * J5 candidates fold · J6 bare rail states · D-18 iOS-zoom paste input.
 */
import { describe, it, expect, afterEach, beforeEach, vi } from "vitest";
import { render, screen, cleanup, fireEvent, act, within } from "@testing-library/react";
import { assertDefined } from "@morai/shared";
import { pickerSnapshotFixture } from "@morai/contracts";
import type { UseQueryResult } from "@tanstack/react-query";
import type { PickerSnapshotResponse } from "@morai/contracts";

// Spy-wrap PayoffChart so the Task-3 chart-prop assertions can inspect the exact props the
// mobile chart block hands it — the real component still renders.
vi.mock("../../components/charts/PayoffChart.tsx", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../components/charts/PayoffChart.tsx")>();
  return { ...actual, PayoffChart: vi.fn(actual.PayoffChart) };
});

const { mockUsePicker } = vi.hoisted(() => ({ mockUsePicker: vi.fn() }));
vi.mock("../../hooks/usePicker.ts", () => ({ usePicker: mockUsePicker }));

const { mockRepull } = vi.hoisted(() => ({
  mockRepull: vi.fn(() => ({ mutate: vi.fn(), isPending: false, isSuccess: false, isError: false })),
}));
vi.mock("../../hooks/useRepullChains.ts", () => ({ useRepullChains: mockRepull }));

const { mockAnalyzeCalendarMutateAsync } = vi.hoisted(() => ({
  mockAnalyzeCalendarMutateAsync: vi.fn(() =>
    Promise.resolve({ scored: false, candidate: null, reason: "mocked" }),
  ),
}));
vi.mock("../../hooks/useAnalyzeCalendar.ts", () => ({
  useAnalyzeCalendar: () => ({ mutateAsync: mockAnalyzeCalendarMutateAsync }),
}));

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

import { Analyzer } from "../Analyzer.tsx";
import { PayoffChart } from "../../components/charts/PayoffChart.tsx";
import type { PayoffChartProps } from "../../components/charts/PayoffChart.tsx";

const mockPayoffChart = vi.mocked(PayoffChart);

/** Props of the most recent PayoffChart render (throws if it never rendered). */
function latestPayoffChartProps(): PayoffChartProps {
  const call = mockPayoffChart.mock.calls.at(-1);
  assertDefined(call, "PayoffChart rendered at least once");
  return call[0];
}

const SORTED = [...pickerSnapshotFixture.candidates].sort((a, b) => b.score - a.score);
const TOP = SORTED[0];
if (TOP === undefined) throw new Error("fixture must carry at least one candidate");

/** Toggle a native <details> by clicking its summary (jsdom flips `open` + fires toggle). */
function toggleDisclosure(label: string): void {
  const summary = screen.getByText(label).closest("summary");
  assertDefined(summary, `summary for ${label}`);
  fireEvent.click(summary);
}

// Far-future dates so this suite never goes stale relative to "today".
const PASTE_EXAMPLE =
  "BUY +1 CALENDAR SPX 100 (Weeklys) 31 DEC 30/1 DEC 30 7450 PUT @45.85 LMT GTC";
const PASTE_ERROR_COPY =
  "Couldn't read that. Paste a TOS calendar order, e.g. BUY +1 CALENDAR SPX 100 18 SEP 26 [AM]/14 AUG 26 7425 PUT @48.75 LMT GTC";

async function paste(text: string): Promise<void> {
  fireEvent.change(screen.getByTestId("picker-paste-input"), { target: { value: text } });
  await act(async () => {
    fireEvent.click(screen.getByTestId("picker-paste-analyze"));
    await Promise.resolve();
  });
}

beforeEach(() => {
  mockUsePickerReturn({});
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  mockAnalyzeCalendarMutateAsync.mockImplementation(() =>
    Promise.resolve({ scored: false, candidate: null, reason: "mocked" }),
  );
});

describe("AnalyzerMobile — J6 rail states (bare prompts, no hollow shells)", () => {
  it("J6a loading: picker-loading text-only, no Panel gradient, no scorecard/disclosures", () => {
    mockUsePickerReturn({ data: undefined, isPending: true, isError: false });
    const { container } = render(<Analyzer />);

    const loading = screen.getByTestId("picker-loading");
    expect(loading.textContent).toContain("Loading candidates…");
    // Bare prompt — no boxed Panel gradient anywhere up its ancestor chain.
    expect(loading.closest(".bg-gradient-to-b")).toBeNull();
    expect(container.querySelector('[data-testid="mobile-score"]')).toBeNull();
    expect(container.querySelector("details")).toBeNull();
  });

  it("J6b error: picker-error + Retry wired to refetch", () => {
    const refetch = vi.fn();
    mockUsePickerReturn({ data: undefined, isPending: false, isError: true, refetch });
    render(<Analyzer />);

    expect(screen.getByTestId("picker-error").textContent).toContain("Couldn't load candidates.");
    fireEvent.click(screen.getByText("Retry"));
    expect(refetch).toHaveBeenCalledOnce();
  });

  it("J6c cold-start: picker-empty-cold-start with the two-line copy", () => {
    mockUsePickerReturn({ data: null, isPending: false, isError: false });
    render(<Analyzer />);

    const cold = screen.getByTestId("picker-empty-cold-start");
    expect(cold.textContent).toContain("Picker warming up");
    expect(cold.textContent).toContain(
      "First scoring run pending — check back after the next chain snapshot.",
    );
  });

  it("J6d zero-filtered: picker-empty-filtered names the asOf snapshot", () => {
    mockUsePickerReturn({ data: { ...pickerSnapshotFixture, candidates: [] } });
    render(<Analyzer />);

    const empty = screen.getByTestId("picker-empty-filtered");
    expect(empty.textContent).toContain("No candidates in this snapshot");
    expect(empty.textContent).toContain(
      `No put calendars meet net-θ>0 over the ${pickerSnapshotFixture.asOf} snapshot.`,
    );
  });

  it("J6e no hollow shells: mobile-score / caption / disclosures absent in every non-selected state", () => {
    const states: ReadonlyArray<Partial<MockPickerResult>> = [
      { data: undefined, isPending: true },
      { data: undefined, isError: true },
      { data: null },
      { data: { ...pickerSnapshotFixture, candidates: [] } },
    ];
    for (const overrides of states) {
      mockUsePickerReturn(overrides);
      const { container } = render(<Analyzer />);
      expect(container.querySelector('[data-testid="mobile-score"]')).toBeNull();
      expect(container.querySelector('[data-testid="analyzer-mobile-caption"]')).toBeNull();
      expect(screen.queryByText("Term structure + your legs")).toBeNull();
      expect(screen.queryByText("Why this calendar")).toBeNull();
      expect(screen.queryByText("Entry / exit plan")).toBeNull();
      cleanup();
    }
  });
});

describe("AnalyzerMobile — J5 candidates fold", () => {
  it("J5a: 9 scored → top 3 + an aria-expanded 'All candidates (6)' toggle that reveals the rest", () => {
    render(<Analyzer />);

    expect(screen.getAllByTestId(/^candidate-card-/).length).toBe(3);
    const toggle = screen.getByTestId("all-candidates-toggle");
    expect(toggle.textContent).toContain("▸");
    expect(toggle.textContent).toContain("All candidates (6)");
    expect(toggle.getAttribute("aria-expanded")).toBe("false");

    fireEvent.click(toggle);
    expect(toggle.getAttribute("aria-expanded")).toBe("true");
    expect(toggle.textContent).toContain("▾");
    expect(screen.getAllByTestId(/^candidate-card-/).length).toBe(9);

    fireEvent.click(toggle);
    expect(toggle.getAttribute("aria-expanded")).toBe("false");
    expect(screen.getAllByTestId(/^candidate-card-/).length).toBe(3);
  });

  it("J5b: ≤3 scored → no fold toggle", () => {
    mockUsePickerReturn({ data: { ...pickerSnapshotFixture, candidates: pickerSnapshotFixture.candidates.slice(0, 3) } });
    render(<Analyzer />);

    expect(screen.getAllByTestId(/^candidate-card-/).length).toBe(3);
    expect(screen.queryByTestId("all-candidates-toggle")).toBeNull();
  });

  it("J5c: a pasted card pins on top, auto-selects, and reveals Clear all", async () => {
    render(<Analyzer />);

    await paste(PASTE_EXAMPLE);

    const cards = screen.getAllByTestId(/^candidate-card-/);
    expect(cards[0]?.getAttribute("data-testid")).toBe("candidate-card-pasted-1");
    // Auto-selected pasted card drives the scorecard (not-scored note) and shows the violet ring.
    expect(screen.getByText("Pasted calendar — not engine-scored.")).toBeTruthy();
    expect(screen.getByTestId("candidate-card-pasted-1").className).toContain("border-violet");
    expect(screen.getByTestId("picker-paste-clear-all")).toBeTruthy();
  });
});

describe("AnalyzerMobile — paste block (D-18) + rail legend", () => {
  it("the paste input renders at text-base (16px, iOS zoom guard) with a 44px min height", () => {
    render(<Analyzer />);
    const input = screen.getByTestId("picker-paste-input");
    expect(input.className).toContain("text-base");
    expect(input.className).toContain("min-h-11");
    expect(input.getAttribute("placeholder")).toBe("Paste a TOS calendar order…");
  });

  it("a parse failure surfaces the verbatim paste-error copy and adds no card", async () => {
    render(<Analyzer />);
    await paste("not an order");
    expect(screen.getByTestId("picker-paste-error").textContent).toBe(PASTE_ERROR_COPY);
    expect(screen.queryByTestId("candidate-card-pasted-1")).toBeNull();
  });

  it("WR-01 (catch #26): pasting during snapshot cold-start renders NO chart block — spot would be the 0 fallback", async () => {
    mockUsePickerReturn({ data: null, isPending: false, isError: false });
    render(<Analyzer />);

    await paste(PASTE_EXAMPLE);

    // Whatever the paste path yields without a snapshot, the chart block must NOT
    // price the book at the spot=0 fallback or fabricate `schwab ·` provenance.
    expect(mockPayoffChart).not.toHaveBeenCalled();
    expect(screen.queryByTestId("analyzer-mobile-caption")).toBeNull();
  });

  it("the rail legend renders below the cards when candidates are present", () => {
    render(<Analyzer />);
    const legend = screen.getByTestId("rail-legend");
    expect(legend.textContent).toContain("daily $ decay");
    expect(legend.textContent).toContain("event on front / back leg");
  });

  it("Clear all is absent until at least one calendar is pasted", async () => {
    render(<Analyzer />);
    expect(screen.queryByTestId("picker-paste-clear-all")).toBeNull();
    await paste(PASTE_EXAMPLE);
    expect(screen.getByTestId("picker-paste-clear-all")).toBeTruthy();
  });
});

describe("AnalyzerMobile — J9 chart props + J8 controls + caption (D-09)", () => {
  it("J9: PayoffChart receives the picker colors, EM band, and the three 35.1 mobile props", () => {
    render(<Analyzer />);
    const props = latestPayoffChartProps();
    expect(props.todayCurveColor).toBe("#5b9cf6");
    expect(props.expirationCurveColor).toBe("#a78bfa");
    expect(props.expectedMoveBand).toEqual({ spot: pickerSnapshotFixture.spot, em: TOP.expectedMove });
    expect(props.showBePills).toBe(false);
    expect(props.aspectRatio).toBe(1.3);
    expect(props.highlightedPositionId).toBeNull();
  });

  it("J8: date-pill + Projection dialog (slider max from Analyzer's own bounds) + › advances the pill", () => {
    render(<Analyzer />);
    const pill = screen.getByTestId("date-pill");
    expect(pill.textContent).toContain("today");

    // › steps the projected date — asserted BEFORE opening the modal (an open dialog inerts
    // the control row behind it, so the stepper is unreachable while it's open).
    fireEvent.click(screen.getByRole("button", { name: "Next day" }));
    expect(screen.getByTestId("date-pill").textContent).toContain("+1d");

    // The pill opens the Projection dialog; the slider is bounded by Analyzer's own maxDays.
    fireEvent.click(screen.getByTestId("date-pill"));
    const slider = screen.getByTestId<HTMLInputElement>("date-slider");
    expect(Number(slider.max)).toBeGreaterThan(0);
    expect(screen.getByTestId("date-picker-input")).toBeTruthy();
  });

  it("caption: worst-of dot + '{source} · {asOf}', bg-up when both contexts ok and rth", () => {
    render(<Analyzer />);
    const caption = screen.getByTestId("analyzer-mobile-caption");
    expect(caption.textContent).toContain(`${pickerSnapshotFixture.source} · ${pickerSnapshotFixture.asOf}`);
    expect(caption.querySelector(".bg-up")).not.toBeNull();
    expect(caption.textContent).not.toContain("AH — indicative");
  });

  it("caption: after-hours appends ' · AH — indicative' with an amber dot", () => {
    mockUsePickerReturn({ data: { ...pickerSnapshotFixture, marketSession: "after-hours" } });
    render(<Analyzer />);
    const caption = screen.getByTestId("analyzer-mobile-caption");
    expect(caption.textContent).toContain("AH — indicative");
    expect(caption.querySelector(".bg-amber")).not.toBeNull();
  });
});

describe("AnalyzerMobile — J10 disclosures (D-10, catches #23/#24)", () => {
  it("J10a: exactly three closed <details> with the verbatim summaries", () => {
    render(<Analyzer />);
    const details = document.querySelectorAll("details");
    expect(details.length).toBe(3);
    for (const d of details) expect(d.hasAttribute("open")).toBe(false);
    expect(screen.getByText("Term structure + your legs")).toBeTruthy();
    expect(screen.getByText("Why this calendar")).toBeTruthy();
    expect(screen.getByText("Entry / exit plan")).toBeTruthy();
  });

  it("J10b: opening each details mounts TermStructureChart / WhyPanel / EntryExitPlan (closed → absent)", () => {
    render(<Analyzer />);
    expect(screen.queryByTestId("term-structure-line")).toBeNull();
    expect(screen.queryByTestId("whypanel-forward-edge-sentence")).toBeNull();
    expect(screen.queryByTestId("entryexit-value-debit")).toBeNull();

    toggleDisclosure("Term structure + your legs");
    expect(screen.getByTestId("term-structure-line")).toBeTruthy();

    toggleDisclosure("Why this calendar");
    expect(screen.getByTestId("whypanel-forward-edge-sentence")).toBeTruthy();

    toggleDisclosure("Entry / exit plan");
    expect(screen.getByTestId("entryexit-value-debit")).toBeTruthy();
  });

  it("J10c: a not-scored pasted candidate shows the not-scored note inside each opened details", async () => {
    render(<Analyzer />);
    await paste(PASTE_EXAMPLE);

    toggleDisclosure("Term structure + your legs");
    toggleDisclosure("Why this calendar");
    toggleDisclosure("Entry / exit plan");
    // Each of the three opened disclosures shows the not-scored note in place of its component.
    const details = document.querySelectorAll("details");
    expect(details.length).toBe(3);
    for (const d of details) {
      expect(within(d).getByText("Pasted calendar — not engine-scored.")).toBeTruthy();
    }
    expect(screen.queryByTestId("term-structure-line")).toBeNull();
  });
});

describe("AnalyzerMobile — J4 DOM order + null-candidate guard", () => {
  it("J4: paste input precedes card list precedes mobile-score precedes date-pill precedes first <details>", () => {
    render(<Analyzer />);
    const input = screen.getByTestId("picker-paste-input");
    const firstCard = screen.getAllByTestId(/^candidate-card-/)[0];
    const score = screen.getByTestId("mobile-score");
    const pill = screen.getByTestId("date-pill");
    const firstDetails = document.querySelector("details");
    assertDefined(firstCard, "a candidate card renders");
    assertDefined(firstDetails, "a details renders");

    const FOLLOWING = Node.DOCUMENT_POSITION_FOLLOWING;
    expect(input.compareDocumentPosition(firstCard) & FOLLOWING).toBeTruthy();
    expect(firstCard.compareDocumentPosition(score) & FOLLOWING).toBeTruthy();
    expect(score.compareDocumentPosition(pill) & FOLLOWING).toBeTruthy();
    expect(pill.compareDocumentPosition(firstDetails) & FOLLOWING).toBeTruthy();
  });

  it("no candidate selected (zero-filtered, no paste): no chart row, no caption, no <details>", () => {
    mockUsePickerReturn({ data: { ...pickerSnapshotFixture, candidates: [] } });
    const { container } = render(<Analyzer />);
    expect(screen.queryByTestId("date-pill")).toBeNull();
    expect(screen.queryByTestId("analyzer-mobile-caption")).toBeNull();
    expect(container.querySelector("details")).toBeNull();
  });
});
