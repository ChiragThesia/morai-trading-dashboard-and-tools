/**
 * OpenCalendarsStrip tests — the Overview open-book glance strip.
 *   1. One row per OPEN calendar; closed calendars excluded.
 *   2. Clicking a row deep-links with that calendar's id.
 *   3. Current P&L = live unrealized P&L from broker marks (netUnreal), shown even when the
 *      journal snapshot history is empty (the sparkline is what needs the snapshot series).
 *   4. No matching live position → "—".
 *   5. Renders nothing when there are no open calendars.
 */
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";

vi.mock("../hooks/useCalendars.ts", () => ({ useCalendars: vi.fn() }));
vi.mock("../hooks/useLifecycle.ts", () => ({ useLifecycle: vi.fn(() => ({ data: { snapshots: [] } })) }));
vi.mock("../hooks/usePositions.ts", () => ({ usePositions: vi.fn() }));

import { OpenCalendarsStrip } from "./OpenCalendarsStrip.tsx";
import { useCalendars } from "../hooks/useCalendars.ts";
import { usePositions } from "../hooks/usePositions.ts";

const mockUseCalendars = vi.mocked(useCalendars);
const mockUsePositions = vi.mocked(usePositions);

function cal(overrides: {
  id: string;
  strike: number;
  optionType?: "C" | "P";
  status?: "open" | "closed";
}) {
  return {
    id: overrides.id,
    underlying: "SPXW",
    strike: overrides.strike,
    optionType: overrides.optionType ?? "P",
    frontExpiry: "2026-08-04",
    backExpiry: "2026-08-31",
    qty: 1,
    openNetDebit: 5,
    status: overrides.status ?? "open",
    openedAt: "2026-06-20T14:00:00.000Z",
    closedAt: overrides.status === "closed" ? "2026-07-01T20:00:00.000Z" : null,
    notes: null,
  };
}

function leg(occSymbol: string, longQty: number, shortQty: number, averagePrice: number, marketValue: number) {
  return { occSymbol, putCall: "P", longQty, shortQty, averagePrice, marketValue, underlyingSymbol: "$SPX" };
}

function setCalendars(calendars: ReadonlyArray<ReturnType<typeof cal>>) {
  // eslint-disable-next-line @typescript-eslint/consistent-type-assertions
  mockUseCalendars.mockReturnValue({ data: { calendars } } as unknown as ReturnType<
    typeof useCalendars
  >);
}

function setPositions(positions: ReadonlyArray<ReturnType<typeof leg>>) {
  // eslint-disable-next-line @typescript-eslint/consistent-type-assertions
  mockUsePositions.mockReturnValue({ data: { positions } } as unknown as ReturnType<
    typeof usePositions
  >);
}

// A 7400P calendar's two legs. Front short: legUnreal = -800 - 10*(0-1)*100 = +200.
// Back long: legUnreal = 1300 - 12*(1-0)*100 = +100. netUnreal = +300.
const CAL_7400P_LEGS = [
  leg("SPXW  260804P07400000", 0, 1, 10, -800),
  leg("SPXW  260831P07400000", 1, 0, 12, 1300),
];

describe("OpenCalendarsStrip", () => {
  afterEach(() => {
    cleanup();
    vi.resetAllMocks();
  });

  it("renders one row per OPEN calendar and excludes closed ones", () => {
    setCalendars([
      cal({ id: "a", strike: 7400000 }),
      cal({ id: "b", strike: 7650000, optionType: "C" }),
      cal({ id: "c", strike: 7300000, status: "closed" }),
    ]);
    setPositions([]);

    render(<OpenCalendarsStrip onOpenJournal={vi.fn()} />);

    expect(screen.getAllByTestId("open-calendar-row").length).toBe(2);
    expect(screen.getByText("7400P")).toBeDefined();
    expect(screen.getByText("7650C")).toBeDefined();
  });

  it("deep-links with the clicked calendar's id", () => {
    setCalendars([cal({ id: "cal-xyz", strike: 7400000 })]);
    setPositions(CAL_7400P_LEGS);
    const onOpen = vi.fn();

    render(<OpenCalendarsStrip onOpenJournal={onOpen} />);
    fireEvent.click(screen.getByTestId("open-calendar-row"));

    expect(onOpen).toHaveBeenCalledWith("cal-xyz");
  });

  it("shows live unrealized P&L from broker marks even when snapshot history is empty", () => {
    setCalendars([cal({ id: "a", strike: 7400000 })]);
    setPositions(CAL_7400P_LEGS); // netUnreal = +300

    render(<OpenCalendarsStrip onOpenJournal={vi.fn()} />);

    expect(screen.getByText("+$300")).toBeDefined();
  });

  it("shows an em dash when no live position matches the calendar", () => {
    setCalendars([cal({ id: "a", strike: 7400000 })]);
    setPositions([]); // no marks

    render(<OpenCalendarsStrip onOpenJournal={vi.fn()} />);

    expect(screen.getByText("—")).toBeDefined();
  });

  it("renders nothing when there are no open calendars", () => {
    setCalendars([cal({ id: "c", strike: 7300000, status: "closed" })]);
    setPositions([]);
    const { container } = render(<OpenCalendarsStrip onOpenJournal={vi.fn()} />);
    expect(container.firstChild).toBeNull();
  });
});
