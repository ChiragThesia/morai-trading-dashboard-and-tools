/**
 * Journal.test.tsx — TDD suite for the Journal screen (Plan 07 Task 3)
 *
 * Behavior under test (per UI-SPEC and plan behavior block):
 *   1. Pre-Jun-12 trade → entry/exit-only badge + "no day-by-day (pre Jun-12)" stub renders.
 *      NEVER throws an error, NEVER renders a blank screen (JOURNAL-01).
 *   2. History-eligible trade (has snapshots) → lifecycle chart region + snapshot table render.
 *   3. Empty journal → locked "No journal history yet…" copy (UI-SPEC empty state).
 *   4. RebuildButton is present in the Journal screen.
 *
 * Mocks:
 *   - useLifecycle: mock hook (no real API calls)
 *   - useRebuildJournal: mock hook
 *   - usePositions: mock (for market-strip if any)
 *   - rpc.ts / supabase.ts: prevent real network calls
 */
import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

// ─── Mock hooks + infra ──────────────────────────────────────────────────────
vi.mock("../hooks/useLifecycle.ts", () => ({
  useLifecycle: vi.fn(),
}));

vi.mock("../hooks/useRebuildJournal.ts", () => ({
  useRebuildJournal: vi.fn(() => ({
    mutate: vi.fn(),
    isPending: false,
    isError: false,
    isSuccess: false,
  })),
}));

vi.mock("../hooks/useRuleTags.ts", () => ({
  useRuleTags: vi.fn(),
}));

vi.mock("../lib/rpc.ts", () => ({
  setAuthToken: vi.fn(),
  apiFetch: vi.fn(),
  rpc: {},
}));

vi.mock("../lib/supabase.ts", () => ({
  supabase: {
    auth: {
      getSession: vi.fn().mockResolvedValue({ data: { session: null }, error: null }),
      onAuthStateChange: vi.fn(() => ({
        data: { subscription: { unsubscribe: vi.fn() } },
      })),
    },
  },
}));

// ─── Import screen + mocks (AFTER vi.mock hoisting) ──────────────────────────
import { Journal } from "./Journal.tsx";
import { useLifecycle } from "../hooks/useLifecycle.ts";
import { useRuleTags } from "../hooks/useRuleTags.ts";
import type { UseRuleTagsResult } from "../hooks/useRuleTags.ts";
import { fireEvent } from "@testing-library/react";
import type { EventWithRulesEntry } from "@morai/contracts";

const mockUseLifecycle = vi.mocked(useLifecycle);
const mockUseRuleTags = vi.mocked(useRuleTags);

// ─── Fixtures ─────────────────────────────────────────────────────────────────

/** Enriched lifecycle snapshot fixture (JRNL-01: isGap + forward vol + attribution buckets). */
function makeSnapshot(overrides?: {
  time?: string;
  pnlOpen?: string;
  spot?: string;
  isGap?: boolean;
  cumTheta?: number | null;
  cumVega?: number | null;
  cumDeltaGamma?: number | null;
  cumResidual?: number | null;
  forwardVol?: number | null;
  forwardVolGuard?: "ok" | "inverted";
  trigger?: "scheduled" | "event-move";
}) {
  return {
    time: overrides?.time ?? "2026-06-12T15:00:00.000Z",
    calendarId: "550e8400-e29b-41d4-a716-446655440000",
    spot: overrides?.spot ?? "7393.00",
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
    isGap: overrides?.isGap ?? false,
    forwardVol: overrides?.forwardVol ?? 15.0,
    forwardVolGuard: overrides?.forwardVolGuard ?? ("ok" as const),
    cumTheta: overrides?.cumTheta ?? 10,
    cumVega: overrides?.cumVega ?? 5,
    cumDeltaGamma: overrides?.cumDeltaGamma ?? -2,
    cumResidual: overrides?.cumResidual ?? 0.5,
    ...(overrides?.trigger !== undefined ? { trigger: overrides.trigger } : {}),
  };
}

// A pre-Jun-12 trade entry (no snapshots, opened/closed before chain start)
function makePreJun12Trade() {
  return {
    id: "trade-pre-jun12",
    calendarId: "550e8400-e29b-41d4-a716-446655440001",
    strike: 7375,
    name: "7375P (pre-Jun-12)",
    openedAt: "2026-05-01T14:00:00.000Z",
    closedAt: "2026-06-01T20:00:00.000Z",
    realizedPnl: "-101.00",
    hasSnapshots: false,
  };
}

// A history-eligible trade (has snapshots on/after Jun-12)
function makeHistoryTrade() {
  return {
    id: "trade-history",
    calendarId: "550e8400-e29b-41d4-a716-446655440002",
    strike: 7375,
    name: "7375P (Jun-12+)",
    openedAt: "2026-06-12T14:00:00.000Z",
    closedAt: "2026-06-15T20:00:00.000Z",
    realizedPnl: "-101.00",
    hasSnapshots: true,
  };
}

// An open trade (closedAt === null) — the "what's going on right now" case.
function makeOpenTrade() {
  return {
    id: "trade-open",
    calendarId: "550e8400-e29b-41d4-a716-446655440003",
    strike: 7400,
    name: "7400P (open)",
    openedAt: "2026-06-20T14:00:00.000Z",
    closedAt: null,
    realizedPnl: "",
    hasSnapshots: true,
  };
}

// ─── RULE-01 fixtures ────────────────────────────────────────────────────────

const OPEN_HASH = "1".repeat(64);
const CLOSE_HASH = "2".repeat(64);
const ROLL_HASH_1 = "3".repeat(64);
const ROLL_HASH_2 = "4".repeat(64);

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

function renderJournal(trades?: ReadonlyArray<{
  id: string;
  calendarId: string;
  strike: number;
  name: string;
  openedAt: string;
  closedAt: string | null;
  realizedPnl: string;
  hasSnapshots: boolean;
}>) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <Journal trades={trades ?? []} />
    </QueryClientProvider>,
  );
}

describe("Journal screen", () => {
  beforeEach(() => {
    mockUseRuleTags.mockReturnValue(emptyRuleTagsResult());
  });

  afterEach(() => {
    cleanup();
    vi.resetAllMocks();
  });

  it("renders the locked empty state when no trades exist", () => {
    // eslint-disable-next-line @typescript-eslint/consistent-type-assertions
    mockUseLifecycle.mockReturnValue({
      data: { snapshots: [] },
      isPending: false,
      isError: false,
      refetch: vi.fn(),
    } as unknown as ReturnType<typeof useLifecycle>);

    renderJournal([]);

    // UI-SPEC "Journal no data" empty state copy
    expect(
      screen.getByText(/No journal history yet/),
    ).toBeDefined();
  });

  it("renders entry/exit-only badge and 'no day-by-day (pre Jun-12)' stub for a pre-Jun-12 trade (JOURNAL-01)", () => {
    // eslint-disable-next-line @typescript-eslint/consistent-type-assertions
    mockUseLifecycle.mockReturnValue({
      data: { snapshots: [] },
      isPending: false,
      isError: false,
      refetch: vi.fn(),
    } as unknown as ReturnType<typeof useLifecycle>);

    const trade = makePreJun12Trade();
    renderJournal([trade]);

    // Trade name appears in the screen (may appear in list and header — use getAllByText)
    expect(screen.getAllByText(/7375P/).length).toBeGreaterThan(0);

    // Select the pre-Jun-12 trade (it should be auto-selected as first trade)
    // The graceful stub text should appear (JOURNAL-01 — never an error)
    expect(screen.getByText(/no day-by-day \(pre Jun-12\)/)).toBeDefined();

    // The entry/exit badge should appear
    expect(screen.getByText("entry/exit")).toBeDefined();

    // No error message
    expect(screen.queryByText(/error/i)).toBeNull();
  });

  it("renders the lifecycle masthead + chart + reactive rail for a history-eligible trade", () => {
    const snapshots = [
      makeSnapshot({ time: "2026-06-12T15:00:00.000Z", pnlOpen: "0.00" }),
      makeSnapshot({ time: "2026-06-12T16:30:00.000Z", pnlOpen: "70.00" }),
      makeSnapshot({ time: "2026-06-15T14:00:00.000Z", pnlOpen: "-15.00" }),
    ];

    // eslint-disable-next-line @typescript-eslint/consistent-type-assertions
    mockUseLifecycle.mockReturnValue({
      data: { snapshots },
      isPending: false,
      isError: false,
      refetch: vi.fn(),
    } as unknown as ReturnType<typeof useLifecycle>);

    const trade = makeHistoryTrade();
    renderJournal([trade]);

    // "history" badge should appear for this trade
    expect(screen.getByText("history")).toBeDefined();

    // The masthead's net-P&L stat label
    expect(screen.getByText("Net P&L")).toBeDefined();

    // The reactive rail cards (JRNL-01)
    expect(screen.getByText("P&L bridge · entry → now")).toBeDefined();
    expect(screen.getByText("The edge")).toBeDefined();
    expect(screen.getByText("Greeks · now")).toBeDefined();
    expect(screen.getByText("The beats")).toBeDefined();

    // The calendar strike is wired through to the chart's price-panel reference line (D-08)
    expect(screen.getByTestId("price-line-strike")).toBeDefined();

    // The honest-caveats footer is always visible; the mockup SKETCH tag never ships
    expect(screen.getByText(/Attribution is a 2nd-order approximation/)).toBeDefined();
    expect(screen.queryByText(/SKETCH/)).toBeNull();
  });

  it("renders the RebuildButton in the journal screen", () => {
    // eslint-disable-next-line @typescript-eslint/consistent-type-assertions
    mockUseLifecycle.mockReturnValue({
      data: { snapshots: [] },
      isPending: false,
      isError: false,
      refetch: vi.fn(),
    } as unknown as ReturnType<typeof useLifecycle>);

    const trade = makeHistoryTrade();
    renderJournal([trade]);

    // The rebuild button trigger text
    expect(screen.getByText(/Rebuild journal/i)).toBeDefined();
  });

  it("folds closed trades into a collapsed History section; open trades always show", () => {
    // eslint-disable-next-line @typescript-eslint/consistent-type-assertions
    mockUseLifecycle.mockReturnValue({
      data: { snapshots: [] },
      isPending: false,
      isError: false,
      refetch: vi.fn(),
    } as unknown as ReturnType<typeof useLifecycle>);

    renderJournal([makeOpenTrade(), makeHistoryTrade(), makePreJun12Trade()]);

    // Open trade is always visible in the rail.
    expect(screen.getAllByText("7400P (open)").length).toBeGreaterThan(0);

    // A "History (2)" toggle summarizes the two closed trades.
    expect(screen.getByText("History (2)")).toBeDefined();

    // Closed trades are hidden by default (folded behind the collapsed History section).
    expect(screen.queryByText("7375P (Jun-12+)")).toBeNull();
    expect(screen.queryByText("7375P (pre-Jun-12)")).toBeNull();
  });

  it("clicking the History toggle reveals the closed trades", () => {
    // eslint-disable-next-line @typescript-eslint/consistent-type-assertions
    mockUseLifecycle.mockReturnValue({
      data: { snapshots: [] },
      isPending: false,
      isError: false,
      refetch: vi.fn(),
    } as unknown as ReturnType<typeof useLifecycle>);

    renderJournal([makeOpenTrade(), makeHistoryTrade()]);

    expect(screen.queryByText("7375P (Jun-12+)")).toBeNull();

    fireEvent.click(screen.getByTestId("history-toggle"));

    expect(screen.getAllByText("7375P (Jun-12+)").length).toBeGreaterThan(0);
  });

  it("expands the History section by default when there are no open trades", () => {
    // eslint-disable-next-line @typescript-eslint/consistent-type-assertions
    mockUseLifecycle.mockReturnValue({
      data: { snapshots: [] },
      isPending: false,
      isError: false,
      refetch: vi.fn(),
    } as unknown as ReturnType<typeof useLifecycle>);

    renderJournal([makeHistoryTrade(), makePreJun12Trade()]);

    // No open trades → the closed list is shown expanded (nothing else to see).
    expect(screen.getAllByText("7375P (Jun-12+)").length).toBeGreaterThan(0);
    expect(screen.getAllByText("7375P (pre-Jun-12)").length).toBeGreaterThan(0);
  });

  it("shows the error state with a working Retry button when the lifecycle fetch fails", () => {
    const mockRefetch = vi.fn();
    // eslint-disable-next-line @typescript-eslint/consistent-type-assertions
    mockUseLifecycle.mockReturnValue({
      data: undefined,
      isPending: false,
      isError: true,
      refetch: mockRefetch,
    } as unknown as ReturnType<typeof useLifecycle>);

    const trade = makeHistoryTrade();
    renderJournal([trade]);

    expect(screen.getByText("Couldn't load this calendar's lifecycle.")).toBeDefined();

    fireEvent.click(screen.getByText("Retry"));
    expect(mockRefetch).toHaveBeenCalled();
  });
});

describe("Journal screen — rule-tag control (RULE-01)", () => {
  beforeEach(() => {
    mockUseLifecycle.mockReturnValue(
      // eslint-disable-next-line @typescript-eslint/consistent-type-assertions
      {
        data: { snapshots: [] },
        isPending: false,
        isError: false,
        refetch: vi.fn(),
      } as unknown as ReturnType<typeof useLifecycle>,
    );
  });

  afterEach(() => {
    cleanup();
    vi.resetAllMocks();
  });

  it("ENTER always renders; EXIT shows 'Available at close.' before a CLOSE event; no ROLL section without a ROLL event", () => {
    mockUseRuleTags.mockReturnValue({
      ...emptyRuleTagsResult(),
      events: [makeRuleEvent({ eventType: "OPEN", fillIdsHash: OPEN_HASH })],
    });

    renderJournal([makeHistoryTrade()]);

    expect(screen.getByText("ENTER")).toBeDefined();
    expect(screen.getByText("IV skew favorable")).toBeDefined();
    expect(screen.getByText("EXIT")).toBeDefined();
    expect(screen.getByText("Available at close.")).toBeDefined();
    expect(screen.queryByText("ROLL")).toBeNull();
    // the untouched free-text textarea is still present
    expect(screen.getByPlaceholderText(/Entry thesis, management, post-mortem/)).toBeDefined();
  });

  it("EXIT chip row renders once the trade has a CLOSE event", () => {
    mockUseRuleTags.mockReturnValue({
      ...emptyRuleTagsResult(),
      events: [
        makeRuleEvent({ eventType: "OPEN", fillIdsHash: OPEN_HASH }),
        makeRuleEvent({ eventType: "CLOSE", fillIdsHash: CLOSE_HASH }),
      ],
    });

    renderJournal([makeHistoryTrade()]);

    expect(screen.getByText("Profit target")).toBeDefined();
    expect(screen.queryByText("Available at close.")).toBeNull();
  });

  it("renders one ROLL section per ROLL event, each with its own timestamp label", () => {
    mockUseRuleTags.mockReturnValue({
      ...emptyRuleTagsResult(),
      events: [
        makeRuleEvent({ eventType: "OPEN", fillIdsHash: OPEN_HASH }),
        makeRuleEvent({
          eventType: "ROLL",
          fillIdsHash: ROLL_HASH_1,
          eventedAt: "2026-06-13T15:00:00.000Z",
        }),
        makeRuleEvent({
          eventType: "ROLL",
          fillIdsHash: ROLL_HASH_2,
          eventedAt: "2026-06-14T15:00:00.000Z",
        }),
      ],
    });

    renderJournal([makeHistoryTrade()]);

    expect(screen.getAllByText("ROLL").length).toBe(2);
    expect(screen.getAllByText("Defend tested side").length).toBe(2);
  });

  it("clicking a non-OTHER chip saves immediately with the toggled tag set", () => {
    const mockSave = vi.fn<UseRuleTagsResult["save"]>();
    mockUseRuleTags.mockReturnValue({
      ...emptyRuleTagsResult(),
      events: [makeRuleEvent({ eventType: "OPEN", fillIdsHash: OPEN_HASH })],
      save: mockSave,
    });

    renderJournal([makeHistoryTrade()]);

    fireEvent.click(screen.getByText("IV skew favorable"));

    expect(mockSave).toHaveBeenCalledWith(OPEN_HASH, ["iv-skew-favorable"], undefined);
  });

  it("OTHER requires a note before it can save — blocks with validation copy, saves once a note is typed", () => {
    const mockSave = vi.fn<UseRuleTagsResult["save"]>();
    mockUseRuleTags.mockReturnValue({
      ...emptyRuleTagsResult(),
      events: [makeRuleEvent({ eventType: "OPEN", fillIdsHash: OPEN_HASH })],
      save: mockSave,
    });

    renderJournal([makeHistoryTrade()]);

    fireEvent.click(screen.getByText("Other"));

    const noteInput = screen.getByPlaceholderText('Note for "Other"…');
    expect(noteInput).toBeDefined();

    // blur with an empty note — blocked, validation copy shown, no save
    fireEvent.blur(noteInput);
    expect(screen.getByText('Add a short note for "Other."')).toBeDefined();
    expect(mockSave).not.toHaveBeenCalled();

    fireEvent.change(noteInput, { target: { value: "Skew was unusually rich" } });
    fireEvent.blur(noteInput);

    expect(mockSave).toHaveBeenCalledWith(OPEN_HASH, ["other"], "Skew was unusually rich");
    expect(screen.queryByText('Add a short note for "Other."')).toBeNull();
  });

  it("chip active state reflects only server-confirmed tags; save error renders inline with a working Retry", () => {
    const mockRetry = vi.fn<UseRuleTagsResult["retry"]>();
    mockUseRuleTags.mockReturnValue({
      ...emptyRuleTagsResult(),
      events: [
        makeRuleEvent({ eventType: "OPEN", fillIdsHash: OPEN_HASH, tags: ["iv-skew-favorable"] }),
      ],
      errors: { [OPEN_HASH]: "Couldn't save rule tags." },
      retry: mockRetry,
    });

    renderJournal([makeHistoryTrade()]);

    expect(screen.getByText("Couldn't save rule tags.")).toBeDefined();

    fireEvent.click(screen.getByText("Retry"));
    expect(mockRetry).toHaveBeenCalledWith(OPEN_HASH);
  });

  it("read-view pill shows only when the trade has >=1 recorded tag, neutral-toned (not violet)", () => {
    mockUseRuleTags.mockReturnValue({
      ...emptyRuleTagsResult(),
      events: [
        makeRuleEvent({ eventType: "OPEN", fillIdsHash: OPEN_HASH, tags: ["iv-skew-favorable"] }),
      ],
    });

    renderJournal([makeHistoryTrade()]);

    const pill = screen.getByTestId("rule-tags-pill");
    expect(pill.textContent).toContain("IV skew favorable");
    expect(pill.className).toContain("text-dim");
    expect(pill.className).not.toContain("text-violet");
  });

  it("read-view pill is absent when the trade has no recorded tags", () => {
    mockUseRuleTags.mockReturnValue({
      ...emptyRuleTagsResult(),
      events: [makeRuleEvent({ eventType: "OPEN", fillIdsHash: OPEN_HASH })],
    });

    renderJournal([makeHistoryTrade()]);

    expect(screen.queryByTestId("rule-tags-pill")).toBeNull();
  });
});

// ── 35-05: mobile stack order (flex-col lg:grid port, un-clip below lg) ──
describe("Journal — mobile stack order (35-05: flex-col lg:grid, un-clip below lg)", () => {
  beforeEach(() => {
    mockUseRuleTags.mockReturnValue(emptyRuleTagsResult());
  });

  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it("starts flex flex-col and gates grid/h-full/overflow-hidden behind lg: (not unconditional)", () => {
    // eslint-disable-next-line @typescript-eslint/consistent-type-assertions
    mockUseLifecycle.mockReturnValue({
      data: { snapshots: [] },
      isPending: false,
      isError: false,
      refetch: vi.fn(),
    } as unknown as ReturnType<typeof useLifecycle>);

    renderJournal([makeHistoryTrade()]);

    const positions = screen.getByTestId("journal-positions");
    expect(positions.className).toContain("flex");
    expect(positions.className).toContain("flex-col");
    expect(positions.className).not.toMatch(/(?<!lg:)\boverflow-hidden\b/u);
    expect(positions.className).toContain("lg:overflow-hidden");
    expect(positions.className).toContain("lg:grid");
    expect(positions.className).toContain("lg:h-full");
    expect(positions.className).toContain("lg:grid-cols-[250px_minmax(0,1fr)_290px]");
  });

  it("gates each column's overflow-y-auto/min-h-0 behind lg: (normal document flow below lg)", () => {
    // eslint-disable-next-line @typescript-eslint/consistent-type-assertions
    mockUseLifecycle.mockReturnValue({
      data: { snapshots: [] },
      isPending: false,
      isError: false,
      refetch: vi.fn(),
    } as unknown as ReturnType<typeof useLifecycle>);

    renderJournal([makeHistoryTrade()]);

    const trades = screen.getByTestId("journal-trades-column");
    expect(trades.className).toContain("lg:overflow-y-auto");
    expect(trades.className).toContain("lg:min-h-0");
    expect(trades.className).not.toMatch(/(?<!lg:)\boverflow-y-auto\b/u);

    const lifecycle = screen.getByTestId("journal-lifecycle-column");
    expect(lifecycle.className).toContain("lg:overflow-y-auto");
    expect(lifecycle.className).toContain("lg:min-h-0");

    const rail = screen.getByTestId("journal-rail-column");
    expect(rail.className).toContain("lg:overflow-y-auto");
    expect(rail.className).toContain("lg:min-h-0");
  });

  it("keeps the three columns in the same DOM order (Trades -> Lifecycle -> reactive rail)", () => {
    // eslint-disable-next-line @typescript-eslint/consistent-type-assertions
    mockUseLifecycle.mockReturnValue({
      data: { snapshots: [] },
      isPending: false,
      isError: false,
      refetch: vi.fn(),
    } as unknown as ReturnType<typeof useLifecycle>);

    renderJournal([makeHistoryTrade()]);

    const positions = screen.getByTestId("journal-positions");
    const children = Array.from(positions.children);
    const tradesIdx = children.indexOf(screen.getByTestId("journal-trades-column"));
    const lifecycleIdx = children.indexOf(screen.getByTestId("journal-lifecycle-column"));
    const railIdx = children.indexOf(screen.getByTestId("journal-rail-column"));
    expect(tradesIdx).toBeLessThan(lifecycleIdx);
    expect(lifecycleIdx).toBeLessThan(railIdx);
  });
});
