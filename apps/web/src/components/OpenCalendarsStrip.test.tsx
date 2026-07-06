/**
 * OpenCalendarsStrip tests — the Overview open-book glance strip.
 *   1. One row per OPEN calendar; closed calendars excluded.
 *   2. Clicking a row deep-links with that calendar's id.
 *   3. Current P&L = the last non-gap pnlOpen from the lifecycle series.
 *   4. Renders nothing when there are no open calendars.
 */
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";

vi.mock("../hooks/useCalendars.ts", () => ({ useCalendars: vi.fn() }));
vi.mock("../hooks/useLifecycle.ts", () => ({ useLifecycle: vi.fn() }));

import { OpenCalendarsStrip } from "./OpenCalendarsStrip.tsx";
import { useCalendars } from "../hooks/useCalendars.ts";
import { useLifecycle } from "../hooks/useLifecycle.ts";

const mockUseCalendars = vi.mocked(useCalendars);
const mockUseLifecycle = vi.mocked(useLifecycle);

function cal(overrides: {
  id: string;
  strike: number;
  optionType?: "C" | "P";
  status?: "open" | "closed";
}) {
  return {
    id: overrides.id,
    underlying: "SPX",
    strike: overrides.strike,
    optionType: overrides.optionType ?? "P",
    frontExpiry: "2026-07-18",
    backExpiry: "2026-09-19",
    qty: 1,
    openNetDebit: 5,
    status: overrides.status ?? "open",
    openedAt: "2026-06-20T14:00:00.000Z",
    closedAt: overrides.status === "closed" ? "2026-07-01T20:00:00.000Z" : null,
    notes: null,
  };
}

function snap(pnlOpen: string, isGap = false) {
  return { isGap, pnlOpen };
}

function setCalendars(calendars: ReadonlyArray<ReturnType<typeof cal>>) {
  // eslint-disable-next-line @typescript-eslint/consistent-type-assertions
  mockUseCalendars.mockReturnValue({ data: { calendars } } as unknown as ReturnType<
    typeof useCalendars
  >);
}

function setLifecycle(snapshots: ReadonlyArray<ReturnType<typeof snap>>) {
  // eslint-disable-next-line @typescript-eslint/consistent-type-assertions
  mockUseLifecycle.mockReturnValue({ data: { snapshots } } as unknown as ReturnType<
    typeof useLifecycle
  >);
}

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
    setLifecycle([snap("0"), snap("120")]);

    render(<OpenCalendarsStrip onOpenJournal={vi.fn()} />);

    expect(screen.getAllByTestId("open-calendar-row").length).toBe(2);
    expect(screen.getByText("7400P")).toBeDefined();
    expect(screen.getByText("7650C")).toBeDefined();
  });

  it("deep-links with the clicked calendar's id", () => {
    setCalendars([cal({ id: "cal-xyz", strike: 7400000 })]);
    setLifecycle([snap("0"), snap("210")]);
    const onOpen = vi.fn();

    render(<OpenCalendarsStrip onOpenJournal={onOpen} />);
    fireEvent.click(screen.getByTestId("open-calendar-row"));

    expect(onOpen).toHaveBeenCalledWith("cal-xyz");
  });

  it("shows the last non-gap pnlOpen as the current P&L", () => {
    setCalendars([cal({ id: "a", strike: 7400000 })]);
    // last real point is +210; the trailing gap row must be ignored.
    setLifecycle([snap("0"), snap("210"), snap("999", true)]);

    render(<OpenCalendarsStrip onOpenJournal={vi.fn()} />);

    expect(screen.getByText("+$210")).toBeDefined();
  });

  it("renders nothing when there are no open calendars", () => {
    setCalendars([cal({ id: "c", strike: 7300000, status: "closed" })]);
    const { container } = render(<OpenCalendarsStrip onOpenJournal={vi.fn()} />);
    expect(container.firstChild).toBeNull();
  });
});
