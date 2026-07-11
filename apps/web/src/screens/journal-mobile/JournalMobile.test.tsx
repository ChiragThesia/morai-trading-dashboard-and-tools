/**
 * JournalMobile.test.tsx — J12 coverage for the dedicated mobile Journal tree (36).
 *
 * Renders `<Journal trades={…} />` with NO matchMedia stub, so useIsDesktop() reports
 * mobile under jsdom and the mobile tree mounts. The mock block mirrors Journal.test.tsx
 * (useLifecycle / useRuleTags / useRebuildJournal / rpc / supabase). The lifecycle block
 * and rail (J13–J15) land in Task 3, which extends this file.
 */
import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import { render, screen, cleanup, fireEvent, within } from "@testing-library/react";
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

// ─── Import screen + mocks (AFTER vi.mock hoisting) ──────────────────────────
import { Journal } from "../Journal.tsx";
import { useLifecycle } from "../../hooks/useLifecycle.ts";
import { useRuleTags } from "../../hooks/useRuleTags.ts";
import type { UseRuleTagsResult } from "../../hooks/useRuleTags.ts";
import type { EventWithRulesEntry } from "@morai/contracts";

const mockUseLifecycle = vi.mocked(useLifecycle);
const mockUseRuleTags = vi.mocked(useRuleTags);

// ─── Fixtures ─────────────────────────────────────────────────────────────────

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

// ─── Rule-tag fixtures ─────────────────────────────────────────────────────────

const OPEN_HASH = "1".repeat(64);

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

/** Settled lifecycle with no snapshots — the trades-section tests don't need chart data. */
function stubLifecycle(): void {
  mockUseLifecycle.mockReturnValue(
    // eslint-disable-next-line @typescript-eslint/consistent-type-assertions
    {
      data: { snapshots: [] },
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
