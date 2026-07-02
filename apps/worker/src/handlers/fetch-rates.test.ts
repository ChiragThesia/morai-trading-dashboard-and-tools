/**
 * fetch-rates handler tests (14-05 Task 1 — MAC-01 macro fetch wiring).
 *
 * Covers:
 *   - Normal weekday: both fetchRateUseCase AND fetchMacroSeriesUseCase are called.
 *   - fetchMacroSeriesUseCase err → handler throws (pg-boss marks job failed, D-07).
 *   - fetchRateUseCase err → handler throws (regression — unchanged rate path, D-02).
 *   - NYSE holiday → BOTH use-cases skipped, handler returns without throwing.
 *   - pg-boss v12 undefined array element → no-op (array-guard, T-02-18).
 *
 * Test doubles are plain stubs injected via deps — no real network/DB.
 */

import { describe, it, expect } from "vitest";
import type { Job } from "pg-boss";
import { makeFetchRatesHandler } from "./fetch-rates.ts";

// Helper: create a minimal pg-boss Job
function makeJob(): Job<object> {
  return {
    id: "test-job-id",
    name: "fetch-rates",
    data: {},
    expireInSeconds: 900,
    heartbeatSeconds: null,
    signal: new AbortController().signal,
  };
}

const NORMAL_WEEKDAY = () => new Date("2026-06-15T14:00:00Z"); // Monday, not a NYSE holiday
const NYSE_HOLIDAY = () => new Date("2026-01-01T14:00:00Z"); // New Year's Day

describe("makeFetchRatesHandler", () => {
  it("calls BOTH fetchRateUseCase and fetchMacroSeriesUseCase on a normal weekday", async () => {
    let rateCalled = false;
    let macroCalled = false;
    const fetchRateUseCase = async () => {
      rateCalled = true;
      return { ok: true as const };
    };
    const fetchMacroSeriesUseCase = async () => {
      macroCalled = true;
      return { ok: true as const };
    };

    const handler = makeFetchRatesHandler({
      fetchRateUseCase,
      fetchMacroSeriesUseCase,
      now: NORMAL_WEEKDAY,
    });

    await expect(handler([makeJob()])).resolves.toBeUndefined();
    expect(rateCalled).toBe(true);
    expect(macroCalled).toBe(true);
  });

  it("throws when fetchMacroSeriesUseCase returns err (pg-boss marks job failed, D-07)", async () => {
    const fetchRateUseCase = async () => ({ ok: true as const });
    const fetchMacroSeriesUseCase = async () => ({
      ok: false as const,
      error: { message: "macro fetch failed for: DFF, VVIX" },
    });

    const handler = makeFetchRatesHandler({
      fetchRateUseCase,
      fetchMacroSeriesUseCase,
      now: NORMAL_WEEKDAY,
    });

    await expect(handler([makeJob()])).rejects.toThrow(
      "macro fetch failed for: DFF, VVIX",
    );
  });

  it("throws when fetchRateUseCase returns err — regression, unchanged rate path (D-02)", async () => {
    const fetchRateUseCase = async () => ({
      ok: false as const,
      error: { message: "FRED unavailable" },
    });
    let macroCalled = false;
    const fetchMacroSeriesUseCase = async () => {
      macroCalled = true;
      return { ok: true as const };
    };

    const handler = makeFetchRatesHandler({
      fetchRateUseCase,
      fetchMacroSeriesUseCase,
      now: NORMAL_WEEKDAY,
    });

    await expect(handler([makeJob()])).rejects.toThrow("FRED unavailable");
    // Existing behavior unchanged: a rate error throws before the macro call runs.
    expect(macroCalled).toBe(false);
  });

  it("skips BOTH use-cases on an NYSE holiday (holiday gate preserved)", async () => {
    let rateCalled = false;
    let macroCalled = false;
    const fetchRateUseCase = async () => {
      rateCalled = true;
      return { ok: true as const };
    };
    const fetchMacroSeriesUseCase = async () => {
      macroCalled = true;
      return { ok: true as const };
    };

    const handler = makeFetchRatesHandler({
      fetchRateUseCase,
      fetchMacroSeriesUseCase,
      now: NYSE_HOLIDAY,
    });

    await expect(handler([makeJob()])).resolves.toBeUndefined();
    expect(rateCalled).toBe(false);
    expect(macroCalled).toBe(false);
  });

  it("no-ops when the pg-boss array element is undefined (array-guard, T-02-18)", async () => {
    let rateCalled = false;
    let macroCalled = false;
    const fetchRateUseCase = async () => {
      rateCalled = true;
      return { ok: true as const };
    };
    const fetchMacroSeriesUseCase = async () => {
      macroCalled = true;
      return { ok: true as const };
    };

    const handler = makeFetchRatesHandler({
      fetchRateUseCase,
      fetchMacroSeriesUseCase,
      now: NORMAL_WEEKDAY,
    });

    await expect(handler([undefined])).resolves.toBeUndefined();
    expect(rateCalled).toBe(false);
    expect(macroCalled).toBe(false);
  });
});
