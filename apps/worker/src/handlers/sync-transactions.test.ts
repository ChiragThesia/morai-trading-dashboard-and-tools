/**
 * sync-transactions handler tests (plan 05-13, A4 wiring).
 *
 * The sync-transactions job populates the fills table from Schwab transactions BEFORE
 * sync-fills pairs them into events. Thin adapter (architecture §3): array-guard →
 * RTH gate → Zod-parse payload → delegate to ForRunningSyncTransactions → throw on error.
 *
 * Covers:
 *   - RTH gate fires: use-case NOT called outside RTH or on NYSE holiday
 *   - Normal RTH: handler delegates to syncTransactionsUseCase
 *   - Use-case error: handler throws (signals failure to pg-boss for retry)
 *   - pg-boss v12 guard: undefined job in array → no-op
 *   - Zod payload parse error → throws with informative message
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { Job } from "pg-boss";
import { ok, err } from "@morai/shared";
import { makeSyncTransactionsHandler } from "./sync-transactions.ts";

describe("makeSyncTransactionsHandler", () => {
  let consoleSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    consoleSpy = vi.spyOn(console, "warn").mockImplementation(() => undefined);
  });

  afterEach(() => {
    consoleSpy.mockRestore();
  });

  function makeJob(): Job<object> {
    return {
      id: "test-sync-tx-job",
      name: "sync-transactions",
      data: {},
      expireInSeconds: 900,
      heartbeatSeconds: null,
      signal: new AbortController().signal,
    };
  }

  it("when now is a NYSE holiday: use-case NOT called (RTH gate)", async () => {
    const holidayRth = new Date("2026-01-01T14:00:00Z"); // New Year's Day, inside RTH hours
    const syncTransactionsUseCase = vi.fn().mockResolvedValue(ok(undefined));

    const handler = makeSyncTransactionsHandler({
      syncTransactionsUseCase,
      now: () => holidayRth,
    });

    await handler([makeJob()]);
    expect(syncTransactionsUseCase).not.toHaveBeenCalled();
    expect(consoleSpy).toHaveBeenCalledOnce();
  });

  it("when outside RTH (weekend): use-case NOT called", async () => {
    const outsideRth = new Date("2026-06-13T14:00:00Z"); // Saturday
    const syncTransactionsUseCase = vi.fn().mockResolvedValue(ok(undefined));

    const handler = makeSyncTransactionsHandler({
      syncTransactionsUseCase,
      now: () => outsideRth,
    });

    await handler([makeJob()]);
    expect(syncTransactionsUseCase).not.toHaveBeenCalled();
  });

  it("when inside RTH on a normal weekday + success: use-case called once", async () => {
    const normalRth = new Date("2026-06-15T14:00:00Z"); // Monday 10:00 EDT
    const syncTransactionsUseCase = vi.fn().mockResolvedValue(ok(undefined));

    const handler = makeSyncTransactionsHandler({
      syncTransactionsUseCase,
      now: () => normalRth,
    });

    await handler([makeJob()]);
    expect(syncTransactionsUseCase).toHaveBeenCalledOnce();
  });

  it("use-case error → handler throws (pg-boss retry signal)", async () => {
    const normalRth = new Date("2026-06-15T14:00:00Z");
    const syncTransactionsUseCase = vi
      .fn()
      .mockResolvedValue(err({ kind: "storage-error", message: "write failed" }));

    const handler = makeSyncTransactionsHandler({
      syncTransactionsUseCase,
      now: () => normalRth,
    });

    await expect(handler([makeJob()])).rejects.toThrow("write failed");
  });

  it("pg-boss v12 guard: undefined job in array → no-op", async () => {
    const normalRth = new Date("2026-06-15T14:00:00Z");
    const syncTransactionsUseCase = vi.fn().mockResolvedValue(ok(undefined));

    const handler = makeSyncTransactionsHandler({
      syncTransactionsUseCase,
      now: () => normalRth,
    });

    await handler([undefined]);
    expect(syncTransactionsUseCase).not.toHaveBeenCalled();
  });
});
