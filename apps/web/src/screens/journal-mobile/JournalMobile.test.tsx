/**
 * JournalMobile.test.tsx — J12–J15 coverage for the dedicated mobile Journal tree (36).
 *
 * Renders `<Journal trades={…} />` with NO matchMedia stub, so useIsDesktop() reports
 * mobile under jsdom and the mobile tree mounts. The mock block mirrors Journal.test.tsx
 * (useLifecycle / useRuleTags / useRebuildJournal / rpc / supabase) and additionally
 * spy-wraps LifecycleChart + PnlBridgeCard (the real components still render — Overview
 * PayoffChart precedent) so J15 can prove the crosshair→bridge wiring.
 */
import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import { render, screen, cleanup, fireEvent, within, act } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

// ─── Mock hooks + infra ──────────────────────────────────────────────────────
vi.mock("../../hooks/useLifecycle.ts", () => ({
  useLifecycle: vi.fn(),
}));

vi.mock("../../hooks/useRebuildJournal.ts", () => ({
  useRebuildJournal: vi.fn(() => ({
    mutate: vi.fn(),
    isPending: false,
    isError: false,
    isSuccess: false,
  })),
}));

vi.mock("../../hooks/useRuleTags.ts", () => ({
  useRuleTags: vi.fn(),
}));

vi.mock("../../lib/rpc.ts", () => ({
  setAuthToken: vi.fn(),
  apiFetch: vi.fn(),
  rpc: {},
}));

vi.mock("../../lib/supabase.ts", () => ({
  supabase: {
    auth: {
      getSession: vi.fn().mockResolvedValue({ data: { session: null }, error: null }),
      onAuthStateChange: vi.fn(() => ({
        data: { subscription: { unsubscribe: vi.fn() } },
      })),
    },
  },
}));

// Spy-wrap the hero chart + the bridge so J15 can read the exact props each receives.
// The real components still render (importOriginal) — this only records calls, so the
// LifecycleChart svg / PnlBridgeCard panel stay in the DOM for J13/J15b.
vi.mock("../../components/LifecycleChart.tsx", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../components/LifecycleChart.tsx")>();
  return { ...actual, LifecycleChart: vi.fn(actual.LifecycleChart) };
});
vi.mock("../../components/PnlBridgeCard.tsx", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../components/PnlBridgeCard.tsx")>();
  return { ...actual, PnlBridgeCard: vi.fn(actual.PnlBridgeCard) };
});

// ─── Import screen + mocks (AFTER vi.mock hoisting) ──────────────────────────
import { Journal } from "../Journal.tsx";
import { useLifecycle } from "../../hooks/useLifecycle.ts";
import { useRuleTags } from "../../hooks/useRuleTags.ts";
import type { UseRuleTagsResult } from "../../hooks/useRuleTags.ts";
import { LifecycleChart } from "../../components/LifecycleChart.tsx";
import { PnlBridgeCard } from "../../components/PnlBridgeCard.tsx";
import type { EventWithRulesEntry } from "@morai/contracts";

const mockUseLifecycle = vi.mocked(useLifecycle);
const mockUseRuleTags = vi.mocked(useRuleTags);
const mockLifecycleChart = vi.mocked(LifecycleChart);
const mockPnlBridgeCard = vi.mocked(PnlBridgeCard);

// ─── Fixtures ─────────────────────────────────────────────────────────────────

function makeSnapshot(overrides?: {
  time?: string;
  pnlOpen?: string;
  trigger?: "scheduled" | "event-move";
}) {
  return {
    time: overrides?.time ?? "2026-06-12T15:00:00.000Z",
    calendarId: "550e8400-e29b-41d4-a716-446655440000",
    spot: "7393.00",
    netMark: "5.25",
    frontMark: "2.10",
    backMark: "7.35",
    frontIv: "0.145",
    backIv: "0.162",
    frontIvRaw: "0.143",
    backIvRaw: "0.160",
    netDelta: "-0.05",
    netGamma: "0.001",
    netTheta: "-8.50",
    netVega: "287.00",
    termSlope: "0.017",
    dteFront: 26,
    dteBack: 49,
    pnlOpen: overrides?.pnlOpen ?? "0.00",
    source: "cboe" as const,
    isGap: false,
    forwardVol: 15.0,
    forwardVolGuard: "ok" as const,
    cumTheta: 10,
    cumVega: 5,
    cumDeltaGamma: -2,
    cumResidual: 0.5,
    ...(overrides?.trigger !== undefined ? { trigger: overrides.trigger } : {}),
  };
}

function makeOpenTrade() {
  return {
    id: "t-open",
    calendarId: "cal-open",
    strike: 7400,
    name: "SPXW 7400P open",
    openedAt: "2026-06-20T14:00:00.000Z",
    closedAt: null,
    realizedPnl: "",
    hasSnapshots: true,
  };
}

function makeClosedA() {
  return {
    id: "t-closedA",
    calendarId: "cal-a",
    strike: 7350,
    name: "SPXW 7350P A",
    openedAt: "2026-06-12T14:00:00.000Z",
    closedAt: "2026-06-27T20:00:00.000Z",
    realizedPnl: "395.00",
    hasSnapshots: true,
  };
}

function makeClosedB() {
  return {
    id: "t-closedB",
    calendarId: "cal-b",
    strike: 7325,
    name: "SPXW 7325P B",
    openedAt: "2026-06-13T14:00:00.000Z",
    closedAt: "2026-06-28T20:00:00.000Z",
    realizedPnl: "-50.00",
    hasSnapshots: true,
  };
}

// A history-eligible trade (has snapshots on/after Jun-12) — for the lifecycle block.
function makeHistoryTrade() {
  return {
    id: "t-history",
    calendarId: "550e8400-e29b-41d4-a716-446655440002",
    strike: 7375,
    name: "SPXW 7375P hist",
    openedAt: "2026-06-12T14:00:00.000Z",
    closedAt: "2026-06-15T20:00:00.000Z",
    realizedPnl: "-101.00",
    hasSnapshots: true,
  };
}

// A pre-Jun-12 trade — entry/exit only, no snapshots.
function makePreJun12Trade() {
  return {
    id: "t-pre",
    calendarId: "cal-pre",
    strike: 7375,
    name: "SPXW 7375P pre",
    openedAt: "2026-05-01T14:00:00.000Z",
    closedAt: "2026-06-01T20:00:00.000Z",
    realizedPnl: "-101.00",
    hasSnapshots: false,
  };
}

// ─── Rule-tag fixtures ─────────────────────────────────────────────────────────

const OPEN_HASH = "1".repeat(64);
const CLOSE_HASH = "2".repeat(64);
const ROLL_HASH = "3".repeat(64);

function makeRuleEvent(overrides: {
  eventType: "OPEN" | "CLOSE" | "ROLL";
  fillIdsHash: string;
  eventedAt?: string;
  tags?: ReadonlyArray<string>;
  otherNote?: string | null;
}): EventWithRulesEntry {
  return {
    id: "550e8400-e29b-41d4-a716-446655440099",
    eventType: overrides.eventType,
    eventedAt: overrides.eventedAt ?? "2026-06-12T14:00:00.000Z",
    fillIdsHash: overrides.fillIdsHash,
    legOccSymbol: "SPXW  260712P07375000",
    tags: overrides.tags !== undefined ? [...overrides.tags] : [],
    otherNote: overrides.otherNote ?? null,
  };
}

function emptyRuleTagsResult(): UseRuleTagsResult {
  return {
    events: [],
    isPending: false,
    errors: {},
    save: vi.fn<UseRuleTagsResult["save"]>(),
    retry: vi.fn<UseRuleTagsResult["retry"]>(),
  };
}

type Trade = ReturnType<typeof makeOpenTrade>;

function renderJournal(trades: ReadonlyArray<Trade>) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <Journal trades={trades} />
    </QueryClientProvider>,
  );
}

/** Settled lifecycle with the given snapshots (default none). */
function stubLifecycle(snapshots: ReadonlyArray<ReturnType<typeof makeSnapshot>> = []): void {
  mockUseLifecycle.mockReturnValue(
    // eslint-disable-next-line @typescript-eslint/consistent-type-assertions
    {
      data: { snapshots },
      isPending: false,
      isError: false,
      refetch: vi.fn(),
    } as unknown as ReturnType<typeof useLifecycle>,
  );
}

// ─── J12: trades section — cards, History fold, tags pill ────────────────────

describe("JournalMobile — trades section (J12, 36 D-11/D-15)", () => {
  beforeEach(() => {
    stubLifecycle();
    mockUseRuleTags.mockReturnValue(emptyRuleTagsResult());
  });

  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it("J12a: Trades label + pill; open card above a collapsed History toggle, closed cards hidden until toggled", () => {
    renderJournal([makeOpenTrade(), makeClosedA(), makeClosedB()]);

    expect(screen.getByText("Trades")).toBeDefined();
    expect(screen.getByText("SPXW put calendars")).toBeDefined();

    const openCard = screen.getByTestId("trade-card-t-open");
    const toggle = screen.getByTestId("history-toggle");
    // Open card renders ABOVE the History toggle.
    expect(openCard.compareDocumentPosition(toggle) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();

    // Two closed trades → "History (2)", collapsed by default.
    expect(screen.getByText("History (2)")).toBeDefined();
    expect(toggle.getAttribute("aria-expanded")).toBe("false");
    expect(screen.queryByTestId("trade-card-t-closedA")).toBeNull();
    expect(screen.queryByTestId("trade-card-t-closedB")).toBeNull();

    fireEvent.click(toggle);

    expect(toggle.getAttribute("aria-expanded")).toBe("true");
    expect(screen.getByTestId("trade-card-t-closedA")).toBeDefined();
    expect(screen.getByTestId("trade-card-t-closedB")).toBeDefined();
  });

  it("J12b: History auto-opens (aria-expanded true) when there are no open trades", () => {
    renderJournal([makeClosedA(), makeClosedB()]);

    const toggle = screen.getByTestId("history-toggle");
    expect(toggle.getAttribute("aria-expanded")).toBe("true");
    expect(screen.getByTestId("trade-card-t-closedA")).toBeDefined();
    expect(screen.getByTestId("trade-card-t-closedB")).toBeDefined();
  });

  it("J12c: clicking a closed card selects it (ring-violet); rule-tags-pill shows on the selected card only", () => {
    mockUseRuleTags.mockReturnValue({
      ...emptyRuleTagsResult(),
      events: [makeRuleEvent({ eventType: "OPEN", fillIdsHash: OPEN_HASH, tags: ["iv-skew-favorable"] })],
    });

    renderJournal([makeClosedA(), makeClosedB()]);

    // Auto-selected first closed trade carries the pill.
    const cardA = screen.getByTestId("trade-card-t-closedA");
    expect(within(cardA).getByTestId("rule-tags-pill")).toBeDefined();
    expect(screen.getAllByTestId("rule-tags-pill").length).toBe(1);

    // Select the second closed card — selection + pill both move to it, exactly once.
    fireEvent.click(screen.getByTestId("trade-card-t-closedB"));

    expect(screen.getByTestId("trade-card-t-closedB").className).toContain("ring-violet");
    expect(within(screen.getByTestId("trade-card-t-closedB")).getByTestId("rule-tags-pill")).toBeDefined();
    expect(screen.getAllByTestId("rule-tags-pill").length).toBe(1);
    expect(within(screen.getByTestId("trade-card-t-closedA")).queryByTestId("rule-tags-pill")).toBeNull();
  });

  it("empty journal → the two verbatim lines and no trades section", () => {
    renderJournal([]);

    expect(screen.getByText("No journal history yet.")).toBeDefined();
    expect(screen.getByText("Trades before Jun 12 have entry/exit only.")).toBeDefined();
    expect(screen.queryByText("Trades")).toBeNull();
    expect(screen.queryByTestId("history-toggle")).toBeNull();
  });
});

// ─── J13/J14: MobileLifecycle — pan mount, ⋯ Rebuild, states, chart notes ────

describe("JournalMobile — lifecycle block (J13/J14, 36 D-12/D-13/D-14)", () => {
  beforeEach(() => {
    mockUseRuleTags.mockReturnValue(emptyRuleTagsResult());
  });

  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it("J13a: chart mounts at 840px inside an overflow-x-auto pan container", () => {
    stubLifecycle([
      makeSnapshot({ time: "2026-06-12T15:00:00.000Z", pnlOpen: "0.00" }),
      makeSnapshot({ time: "2026-06-12T16:30:00.000Z", pnlOpen: "70.00" }),
    ]);

    renderJournal([makeHistoryTrade()]);

    const pan = screen.getByTestId("lifecycle-pan");
    expect(pan.className).toContain("overflow-x-auto");
    const inner = pan.firstElementChild;
    expect(inner?.className).toContain("w-[840px]");
    // The real LifecycleChart still renders its svg inside the pan.
    expect(pan.querySelector("svg")).not.toBeNull();
    expect(mockLifecycleChart).toHaveBeenCalled();
  });

  it("J14a: honest states render bare (no Panel) — loading / error+Retry / pre-history / building", () => {
    // loading
    // eslint-disable-next-line @typescript-eslint/consistent-type-assertions
    mockUseLifecycle.mockReturnValue({
      data: undefined,
      isPending: true,
      isError: false,
      refetch: vi.fn(),
    } as unknown as ReturnType<typeof useLifecycle>);
    const { unmount: unmountLoading } = renderJournal([makeHistoryTrade()]);
    const skeleton = screen.getByLabelText("Loading lifecycle");
    expect(skeleton.className).toContain("bg-line");
    expect(skeleton.closest('[class*="from-panel"]')).toBeNull();
    unmountLoading();
    cleanup();

    // error + Retry wired to refetch
    const refetch = vi.fn();
    // eslint-disable-next-line @typescript-eslint/consistent-type-assertions
    mockUseLifecycle.mockReturnValue({
      data: undefined,
      isPending: false,
      isError: true,
      refetch,
    } as unknown as ReturnType<typeof useLifecycle>);
    const { unmount: unmountError } = renderJournal([makeHistoryTrade()]);
    const errCopy = screen.getByText("Couldn't load this calendar's lifecycle.");
    expect(errCopy.closest('[class*="from-panel"]')).toBeNull();
    fireEvent.click(screen.getByText("Retry"));
    expect(refetch).toHaveBeenCalled();
    unmountError();
    cleanup();

    // pre-Jun-12 (entry/exit only) → PreHistoryStub, no Panel
    stubLifecycle([]);
    const { unmount: unmountPre } = renderJournal([makePreJun12Trade()]);
    const stub = screen.getByText("no day-by-day (pre Jun-12)");
    expect(stub.closest('[class*="from-panel"]')).toBeNull();
    unmountPre();
    cleanup();

    // history trade with a single snapshot → BuildingLifecycleStub
    stubLifecycle([makeSnapshot({ time: "2026-06-12T15:00:00.000Z" })]);
    renderJournal([makeHistoryTrade()]);
    expect(screen.getByText("Building the lifecycle.")).toBeDefined();
  });

  it("J14b: Rebuild is demoted behind ⋯ — absent until the Journal dialog opens, confirm copy intact", () => {
    stubLifecycle([
      makeSnapshot({ time: "2026-06-12T15:00:00.000Z", pnlOpen: "0.00" }),
      makeSnapshot({ time: "2026-06-12T16:30:00.000Z", pnlOpen: "70.00" }),
    ]);
    const trade = makeHistoryTrade();
    renderJournal([trade]);

    // No Rebuild button anywhere in the top-level flow.
    expect(screen.queryByLabelText(`Rebuild journal for ${trade.calendarId}`)).toBeNull();

    // Open the ⋯ overflow → the Journal dialog contains the Rebuild button.
    fireEvent.click(screen.getByLabelText("More journal actions"));
    expect(screen.getByText("Journal")).toBeDefined();
    const rebuild = screen.getByLabelText(`Rebuild journal for ${trade.calendarId}`);
    expect(rebuild).toBeDefined();

    // Its nested confirm keeps the verbatim destructive copy.
    fireEvent.click(rebuild);
    expect(screen.getByText("This overwrites all snapshot history.")).toBeDefined();
  });

  it("J14c: pan hint + closed Chart notes disclosure with both verbatim lines (history-with-chart only)", () => {
    stubLifecycle([
      makeSnapshot({ time: "2026-06-12T15:00:00.000Z", pnlOpen: "0.00" }),
      makeSnapshot({ time: "2026-06-12T16:30:00.000Z", pnlOpen: "70.00" }),
    ]);
    const { unmount } = renderJournal([makeHistoryTrade()]);

    expect(screen.getByText("‹ swipe for earlier days")).toBeDefined();

    const notes = screen.getByTestId("chart-notes");
    expect(notes.tagName).toBe("DETAILS");
    expect(notes.hasAttribute("open")).toBe(false);
    expect(within(notes).getByText("Chart notes")).toBeDefined();
    expect(
      within(notes).getByText(/Attribution is a 2nd-order approximation/),
    ).toBeDefined();
    expect(within(notes).getByText(/Line breaks are real feed gaps/)).toBeDefined();

    unmount();
    cleanup();

    // Pre-Jun-12 trade → no chart, no pan hint, no chart notes.
    stubLifecycle([]);
    renderJournal([makePreJun12Trade()]);
    expect(screen.queryByText("‹ swipe for earlier days")).toBeNull();
    expect(screen.queryByTestId("chart-notes")).toBeNull();
  });

  it("J14d: kind caption reads '30-min snapshots' (history) or 'entry/exit only' (pre-Jun-12)", () => {
    stubLifecycle([
      makeSnapshot({ time: "2026-06-12T15:00:00.000Z", pnlOpen: "0.00" }),
      makeSnapshot({ time: "2026-06-12T16:30:00.000Z", pnlOpen: "70.00" }),
    ]);
    const { unmount } = renderJournal([makeHistoryTrade()]);
    expect(screen.getByText("30-min snapshots")).toBeDefined();
    unmount();
    cleanup();

    stubLifecycle([]);
    renderJournal([makePreJun12Trade()]);
    expect(screen.getByText("entry/exit only")).toBeDefined();
  });
});

// ─── J15: rail stack + crosshair→bridge sync ─────────────────────────────────

describe("JournalMobile — rail + crosshair sync (J15, 36 D-15)", () => {
  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it("J15a: LifecycleChart.onCrosshairChange feeds PnlBridgeCard.hoveredIndex", () => {
    mockUseRuleTags.mockReturnValue(emptyRuleTagsResult());
    stubLifecycle([
      makeSnapshot({ time: "2026-06-12T15:00:00.000Z", pnlOpen: "0.00" }),
      makeSnapshot({ time: "2026-06-12T16:30:00.000Z", pnlOpen: "70.00" }),
    ]);

    renderJournal([makeHistoryTrade()]);

    // Bridge starts unhovered.
    expect(mockPnlBridgeCard.mock.calls.at(-1)?.[0].hoveredIndex).toBeNull();

    // Fire the crosshair callback the chart was handed → the bridge re-renders hovered.
    const lastChartCall = mockLifecycleChart.mock.calls.at(-1);
    expect(lastChartCall).toBeDefined();
    const onCrosshair = lastChartCall?.[0].onCrosshairChange;
    expect(onCrosshair).toBeDefined();
    act(() => {
      onCrosshair?.(1);
    });

    expect(mockPnlBridgeCard.mock.calls.at(-1)?.[0].hoveredIndex).toBe(1);
  });

  it("J15b: rail cards mount in order (bridge → edge → greeks → beats → notes) with rule-tag blocks", () => {
    mockUseRuleTags.mockReturnValue({
      ...emptyRuleTagsResult(),
      events: [makeRuleEvent({ eventType: "OPEN", fillIdsHash: OPEN_HASH })],
    });
    stubLifecycle([
      makeSnapshot({ time: "2026-06-12T15:00:00.000Z", pnlOpen: "0.00" }),
      makeSnapshot({ time: "2026-06-12T16:30:00.000Z", pnlOpen: "70.00" }),
    ]);

    renderJournal([makeHistoryTrade()]);

    const bridge = screen.getByText("P&L bridge · entry → now");
    const edge = screen.getByText("The edge");
    const greeks = screen.getByText("Greeks · now");
    const beats = screen.getByText("The beats");
    const notes = screen.getByText("Notes");

    const order = (a: HTMLElement, b: HTMLElement): boolean =>
      Boolean(a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING);
    expect(order(bridge, edge)).toBe(true);
    expect(order(edge, greeks)).toBe(true);
    expect(order(greeks, beats)).toBe(true);
    expect(order(beats, notes)).toBe(true);

    // Notes rule-tag blocks: ENTER present, EXIT prompts "Available at close." (no CLOSE),
    // no ROLL section, plus the untouched free-text textarea.
    expect(screen.getByText("ENTER")).toBeDefined();
    expect(screen.getByText("EXIT")).toBeDefined();
    expect(screen.getByText("Available at close.")).toBeDefined();
    expect(screen.queryByText("ROLL")).toBeNull();
    expect(screen.getByPlaceholderText(/Entry thesis, management, post-mortem/)).toBeDefined();
  });

  it("J15b: ROLL blocks render per ROLL event", () => {
    mockUseRuleTags.mockReturnValue({
      ...emptyRuleTagsResult(),
      events: [
        makeRuleEvent({ eventType: "OPEN", fillIdsHash: OPEN_HASH }),
        makeRuleEvent({ eventType: "CLOSE", fillIdsHash: CLOSE_HASH }),
        makeRuleEvent({ eventType: "ROLL", fillIdsHash: ROLL_HASH }),
      ],
    });
    stubLifecycle([
      makeSnapshot({ time: "2026-06-12T15:00:00.000Z", pnlOpen: "0.00" }),
      makeSnapshot({ time: "2026-06-12T16:30:00.000Z", pnlOpen: "70.00" }),
    ]);

    renderJournal([makeHistoryTrade()]);

    expect(screen.getByText("ROLL")).toBeDefined();
    expect(screen.queryByText("Available at close.")).toBeNull();
  });
});
