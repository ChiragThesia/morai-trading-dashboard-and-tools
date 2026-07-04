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
  it("starts at today with daysForward 0", () => {
    const { result } = renderHook(() => usePayoffDateControl(TODAY, MAX));
    expect(result.current.dateInputValue).toBe("2026-07-04");
    expect(result.current.daysForward).toBe(0);
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
