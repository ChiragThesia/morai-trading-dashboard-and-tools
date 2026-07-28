/**
 * persist-calendar-ranking handler tests (0031 — the calendar engine's ranking history).
 *
 * Covers:
 *   - Off-hours instant (weekend): use-case IS called — 24/7 compute, no RTH gate
 *   - Use-case ok → no throw, nothing logged
 *   - Use-case err → handler throws (pg-boss marks job failed for retry/alerting)
 *   - pg-boss v12 undefined array element → no-op (array-guard, T-02-18)
 *   - A truncated write (rowsWritten < expiryPairs) → console.warn, because a silent top-N is
 *     the one thing a percentile-scored engine cannot be validated against
 *   - An empty cycle (0 rows, 0 pairs) → NOT a truncation, nothing logged
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { Job } from "pg-boss";
import { ok, err } from "@morai/shared";
import { makePersistCalendarRankingHandler } from "./persist-calendar-ranking.ts";

describe("makePersistCalendarRankingHandler", () => {
  let consoleSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    consoleSpy = vi.spyOn(console, "warn").mockImplementation(() => undefined);
  });

  afterEach(() => {
    consoleSpy.mockRestore();
  });

  function makeJob(): Job<object> {
    return {
      id: "test-job-id",
      name: "persist-calendar-ranking",
      data: {},
      expireInSeconds: 900,
      heartbeatSeconds: null,
      signal: new AbortController().signal,
    };
  }

  it("runs the use-case regardless of clock (24/7 compute — no RTH/holiday gate)", async () => {
    const recordCalendarRankingUseCase = vi
      .fn()
      .mockResolvedValue(ok({ rowsWritten: 96, expiryPairs: 96 }));

    await makePersistCalendarRankingHandler({ recordCalendarRankingUseCase })([makeJob()]);

    expect(recordCalendarRankingUseCase).toHaveBeenCalledOnce();
    expect(consoleSpy).not.toHaveBeenCalled();
  });

  it("throws when the use-case fails, so pg-boss retries the cycle", async () => {
    const recordCalendarRankingUseCase = vi
      .fn()
      .mockResolvedValue(err({ kind: "storage-error", message: "chain read failed" }));

    await expect(
      makePersistCalendarRankingHandler({ recordCalendarRankingUseCase })([makeJob()]),
    ).rejects.toThrow("chain read failed");
  });

  it("is a no-op on pg-boss v12's undefined array element (T-02-18)", async () => {
    const recordCalendarRankingUseCase = vi
      .fn()
      .mockResolvedValue(ok({ rowsWritten: 96, expiryPairs: 96 }));

    await makePersistCalendarRankingHandler({ recordCalendarRankingUseCase })([undefined]);

    expect(recordCalendarRankingUseCase).not.toHaveBeenCalled();
  });

  it("warns when the write was TRUNCATED — a silent top-N would poison the backtest", async () => {
    const recordCalendarRankingUseCase = vi
      .fn()
      .mockResolvedValue(ok({ rowsWritten: 200, expiryPairs: 250 }));

    await makePersistCalendarRankingHandler({ recordCalendarRankingUseCase })([makeJob()]);

    expect(consoleSpy).toHaveBeenCalledOnce();
    const logged = String(consoleSpy.mock.calls[0]?.[0] ?? "");
    expect(logged).toContain("200");
    expect(logged).toContain("250");
  });

  it("does NOT warn on a cycle that had nothing to rank", async () => {
    // 0 of 0 is an empty cohort, not a truncation.
    const recordCalendarRankingUseCase = vi
      .fn()
      .mockResolvedValue(ok({ rowsWritten: 0, expiryPairs: 0 }));

    await makePersistCalendarRankingHandler({ recordCalendarRankingUseCase })([makeJob()]);

    expect(consoleSpy).not.toHaveBeenCalled();
  });
});
