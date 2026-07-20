/**
 * usePayoffDateControl.test.ts — TDD RED→GREEN for the shared date-projection state hook.
 *
 * Extracts the forward date glue Overview owned inline (OVW-05) so Analyzer reuses it verbatim.
 * Wraps date-projection.ts: whole-day stepping clamped to [0, maxDaysForward], a raw setDate,
 * and reset-to-today. daysForward is derived (never stored) so it can never drift from the input.
 */
import { describe, it, expect } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { usePayoffDateControl } from "./usePayoffDateControl.ts";

const TODAY = new Date(2026, 6, 4); // local 2026-07-04 (never new Date("...") — UTC-drift class)
const MAX = 21;

describe("usePayoffDateControl", () => {
  it("starts at today with display daysForward 0", () => {
    const { result } = renderHook(() => usePayoffDateControl(TODAY, MAX));
    expect(result.current.dateInputValue).toBe("2026-07-04");
    expect(result.current.daysForward).toBe(0);
  });

  // TOS date-line parity (2026-07-20, oracle-corrected): TOS's date slice prices at the
  // START of the selected date — decay runs from now to the picked date's local midnight,
  // fractionally. Verified against a single-calendar TOS reading (7/29 line = $785):
  // start-of-date ≈ $764-785, close-of-date $869, the briefly-shipped +1 whole day $1,031
  // (the user-reported $1,063 bug). "Today" clamps to 0 — priced at now, tracking theta
  // through the session exactly like TOS's live today-line.
  it("engineDaysForward = fractional days from now to the picked date's midnight", () => {
    const { result } = renderHook(() => usePayoffDateControl(TODAY, MAX));
    expect(result.current.engineDaysForward).toBe(0); // today's midnight is in the past

    act(() => { result.current.stepDate(1); });
    expect(result.current.engineDaysForward).toBe(1); // TODAY fixture is midnight-exact

    act(() => { result.current.stepDate(999); }); // date clamps at max
    expect(result.current.daysForward).toBe(MAX);
    expect(result.current.engineDaysForward).toBe(MAX);
  });

  it("engineDaysForward is fractional when `today` has a time of day", () => {
    const midAfternoon = new Date(2026, 6, 4, 15, 45); // 3:45 PM local
    const { result } = renderHook(() => usePayoffDateControl(midAfternoon, MAX));
    expect(result.current.engineDaysForward).toBe(0); // today → clamp 0

    act(() => { result.current.stepDate(1); }); // 7/5 → midnight is 8h15m away
    expect(result.current.engineDaysForward).toBeCloseTo(8.25 / 24, 10);
  });

  it("engineDaysForward is 0 when maxDaysForward is 0 (no calendars)", () => {
    const { result } = renderHook(() => usePayoffDateControl(TODAY, 0));
    expect(result.current.engineDaysForward).toBe(0);
  });

  it("steps by whole days, clamped to [0, max]", () => {
    const { result } = renderHook(() => usePayoffDateControl(TODAY, MAX));
    act(() => { result.current.stepDate(1); });
    expect(result.current.daysForward).toBe(1);
    expect(result.current.dateInputValue).toBe("2026-07-05");

    act(() => { result.current.stepDate(-5); }); // from 1 → clamp at 0
    expect(result.current.daysForward).toBe(0);

    act(() => { result.current.stepDate(999); }); // clamp at max
    expect(result.current.daysForward).toBe(MAX);
    expect(result.current.dateInputValue).toBe("2026-07-25");
  });

  it("setDate resolves the picked date and clamps daysForward to max", () => {
    const { result } = renderHook(() => usePayoffDateControl(TODAY, MAX));
    act(() => { result.current.setDate("2026-07-10"); });
    expect(result.current.daysForward).toBe(6);
    expect(result.current.engineDaysForward).toBe(6); // TODAY fixture is midnight-exact

    act(() => { result.current.setDate("2026-12-31"); }); // far past front expiry → clamp
    expect(result.current.daysForward).toBe(MAX);
  });

  it("resetDate returns to today", () => {
    const { result } = renderHook(() => usePayoffDateControl(TODAY, MAX));
    act(() => { result.current.stepDate(3); });
    act(() => { result.current.resetDate(); });
    expect(result.current.daysForward).toBe(0);
    expect(result.current.dateInputValue).toBe("2026-07-04");
  });
});
