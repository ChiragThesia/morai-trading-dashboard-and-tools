/**
 * recompute-snapshot-pnl handler tests (JRNL-01 pnl-unit-mismatch fix).
 *
 * Mirrors rebuild-journal.test.ts exactly — on-demand job, no RTH gate, Zod-parsed
 * { calendarId: string } payload, use-case error → handler throws.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { Job } from "pg-boss";
import { ok, err } from "@morai/shared";
import { makeRecomputeSnapshotPnlHandler } from "./recompute-snapshot-pnl.ts";

describe("makeRecomputeSnapshotPnlHandler", () => {
  let consoleSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    consoleSpy = vi.spyOn(console, "warn").mockImplementation(() => undefined);
  });

  afterEach(() => {
    consoleSpy.mockRestore();
  });

  function makeJob(data: object = {}): Job<object> {
    return {
      id: "test-recompute-snapshot-pnl-job",
      name: "recompute-snapshot-pnl",
      data,
      expireInSeconds: 900,
      heartbeatSeconds: null,
      signal: new AbortController().signal,
    };
  }

  it("valid calendarId payload → use-case called with the calendarId", async () => {
    const calendarId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
    const recomputeSnapshotPnlUseCase = vi.fn().mockResolvedValue(ok({ rowsUpdated: 12 }));

    const handler = makeRecomputeSnapshotPnlHandler({
      recomputeSnapshotPnlUseCase,
      now: () => new Date("2026-06-15T14:00:00Z"),
    });

    await handler([makeJob({ calendarId })]);
    expect(recomputeSnapshotPnlUseCase).toHaveBeenCalledWith(calendarId);
  });

  it("missing calendarId → throws Zod validation error", async () => {
    const recomputeSnapshotPnlUseCase = vi.fn().mockResolvedValue(ok({ rowsUpdated: 0 }));

    const handler = makeRecomputeSnapshotPnlHandler({
      recomputeSnapshotPnlUseCase,
      now: () => new Date("2026-06-15T14:00:00Z"),
    });

    await expect(handler([makeJob({})])).rejects.toThrow();
    expect(recomputeSnapshotPnlUseCase).not.toHaveBeenCalled();
  });

  it("invalid calendarId (not UUID) → throws Zod validation error", async () => {
    const recomputeSnapshotPnlUseCase = vi.fn().mockResolvedValue(ok({ rowsUpdated: 0 }));

    const handler = makeRecomputeSnapshotPnlHandler({
      recomputeSnapshotPnlUseCase,
      now: () => new Date("2026-06-15T14:00:00Z"),
    });

    await expect(handler([makeJob({ calendarId: "not-a-uuid" })])).rejects.toThrow();
    expect(recomputeSnapshotPnlUseCase).not.toHaveBeenCalled();
  });

  it("use-case returns err (storage) → handler throws (signals failure to pg-boss)", async () => {
    const calendarId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
    const recomputeSnapshotPnlUseCase = vi.fn().mockResolvedValue(
      err({ kind: "storage-error" as const, message: "update failed" }),
    );

    const handler = makeRecomputeSnapshotPnlHandler({
      recomputeSnapshotPnlUseCase,
      now: () => new Date("2026-06-15T14:00:00Z"),
    });

    await expect(handler([makeJob({ calendarId })])).rejects.toThrow("update failed");
  });

  it("use-case returns err (not-found) → handler throws with a clear message", async () => {
    const calendarId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
    const recomputeSnapshotPnlUseCase = vi.fn().mockResolvedValue(
      err({ kind: "not-found" as const }),
    );

    const handler = makeRecomputeSnapshotPnlHandler({
      recomputeSnapshotPnlUseCase,
      now: () => new Date("2026-06-15T14:00:00Z"),
    });

    await expect(handler([makeJob({ calendarId })])).rejects.toThrow(/not.found/i);
  });

  it("when job is undefined: handler no-ops (pg-boss v12 guard)", async () => {
    const recomputeSnapshotPnlUseCase = vi.fn().mockResolvedValue(ok({ rowsUpdated: 0 }));

    const handler = makeRecomputeSnapshotPnlHandler({
      recomputeSnapshotPnlUseCase,
      now: () => new Date("2026-06-15T14:00:00Z"),
    });

    await handler([undefined]);
    expect(recomputeSnapshotPnlUseCase).not.toHaveBeenCalled();
  });

  it("runs even outside RTH (on-demand — no RTH gate)", async () => {
    const weekend = new Date("2026-06-13T14:00:00Z");
    const calendarId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
    const recomputeSnapshotPnlUseCase = vi.fn().mockResolvedValue(ok({ rowsUpdated: 3 }));

    const handler = makeRecomputeSnapshotPnlHandler({
      recomputeSnapshotPnlUseCase,
      now: () => weekend,
    });

    await handler([makeJob({ calendarId })]);
    expect(recomputeSnapshotPnlUseCase).toHaveBeenCalledOnce();
  });

  void consoleSpy; // suppress unused warning
});
