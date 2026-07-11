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
import { render, screen, cleanup, fireEvent, act } from "@testing-library/react";
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
    for (const overrides of [
      { data: undefined, isPending: true },
      { data: undefined, isError: true },
      { data: null },
      { data: { ...pickerSnapshotFixture, candidates: [] } },
    ] as ReadonlyArray<Partial<MockPickerResult>>) {
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
