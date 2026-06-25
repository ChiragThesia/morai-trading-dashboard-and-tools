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
 *   - useJournal: mock hook (no real API calls)
 *   - useRebuildJournal: mock hook
 *   - usePositions: mock (for market-strip if any)
 *   - rpc.ts / supabase.ts: prevent real network calls
 */
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

// ─── Mock hooks + infra ──────────────────────────────────────────────────────
vi.mock("../hooks/useJournal.ts", () => ({
  useJournal: vi.fn(),
}));

vi.mock("../hooks/useRebuildJournal.ts", () => ({
  useRebuildJournal: vi.fn(() => ({
    mutate: vi.fn(),
    isPending: false,
    isError: false,
    isSuccess: false,
  })),
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
import { useJournal } from "../hooks/useJournal.ts";

const mockUseJournal = vi.mocked(useJournal);

// ─── Fixtures ─────────────────────────────────────────────────────────────────

function makeSnapshot(overrides?: {
  time?: string;
  pnlOpen?: string;
  spot?: string;
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
  };
}

// A pre-Jun-12 trade entry (no snapshots, opened/closed before chain start)
function makePreJun12Trade() {
  return {
    id: "trade-pre-jun12",
    calendarId: "550e8400-e29b-41d4-a716-446655440001",
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
    name: "7375P (Jun-12+)",
    openedAt: "2026-06-12T14:00:00.000Z",
    closedAt: "2026-06-15T20:00:00.000Z",
    realizedPnl: "-101.00",
    hasSnapshots: true,
  };
}

function renderJournal(trades?: ReadonlyArray<{
  id: string;
  calendarId: string;
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
  afterEach(() => {
    cleanup();
    vi.resetAllMocks();
  });

  it("renders the locked empty state when no trades exist", () => {
    // eslint-disable-next-line @typescript-eslint/consistent-type-assertions
    mockUseJournal.mockReturnValue({
      data: { snapshots: [] },
      isPending: false,
    } as unknown as ReturnType<typeof useJournal>);

    renderJournal([]);

    // UI-SPEC "Journal no data" empty state copy
    expect(
      screen.getByText(/No journal history yet/),
    ).toBeDefined();
  });

  it("renders entry/exit-only badge and 'no day-by-day (pre Jun-12)' stub for a pre-Jun-12 trade (JOURNAL-01)", () => {
    // eslint-disable-next-line @typescript-eslint/consistent-type-assertions
    mockUseJournal.mockReturnValue({
      data: { snapshots: [] },
      isPending: false,
    } as unknown as ReturnType<typeof useJournal>);

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

  it("renders the lifecycle chart region and snapshot table for a history-eligible trade", () => {
    const snapshots = [
      makeSnapshot({ time: "2026-06-12T15:00:00.000Z", pnlOpen: "0.00" }),
      makeSnapshot({ time: "2026-06-12T16:30:00.000Z", pnlOpen: "70.00" }),
      makeSnapshot({ time: "2026-06-15T14:00:00.000Z", pnlOpen: "-15.00" }),
    ];

    // eslint-disable-next-line @typescript-eslint/consistent-type-assertions
    mockUseJournal.mockReturnValue({
      data: { snapshots },
      isPending: false,
    } as unknown as ReturnType<typeof useJournal>);

    const trade = makeHistoryTrade();
    renderJournal([trade]);

    // "history" badge should appear for this trade
    expect(screen.getByText("history")).toBeDefined();

    // The lifecycle section heading (Lifecycle per snapshot)
    expect(screen.getByText("Lifecycle")).toBeDefined();

    // Snapshot table column headers
    expect(screen.getByText("Time")).toBeDefined();
    expect(screen.getByText("SPX")).toBeDefined();
    expect(screen.getByText("Net")).toBeDefined();
  });

  it("renders the RebuildButton in the journal screen", () => {
    // eslint-disable-next-line @typescript-eslint/consistent-type-assertions
    mockUseJournal.mockReturnValue({
      data: { snapshots: [] },
      isPending: false,
    } as unknown as ReturnType<typeof useJournal>);

    const trade = makeHistoryTrade();
    renderJournal([trade]);

    // The rebuild button trigger text
    expect(screen.getByText(/Rebuild journal/i)).toBeDefined();
  });
});
