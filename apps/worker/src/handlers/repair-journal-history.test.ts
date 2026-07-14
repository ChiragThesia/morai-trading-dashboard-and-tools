/**
 * repair-journal-history handler tests (HIST-04).
 *
 * Mirrors register-open-calendars.test.ts / self-heal-journal.test.ts — on-demand-shaped thin
 * handler, no RTH gate, use-case error → handler throws. Payload adds an optional calendarId
 * (absent → "all", heal-only) and an optional trimOutsideWindow — trigger_job's own schema
 * (packages/contracts/src/jobs.ts triggerJobPayload) never carries trimOutsideWindow, so in
 * practice this handler only ever sees it via a direct pg-boss send, never via trigger_job
 * (T-40-15).
 */

import { describe, it, expect, vi } from "vitest";
import type { Job } from "pg-boss";
import { ok, err } from "@morai/shared";
import { makeRepairJournalHistoryHandler } from "./repair-journal-history.ts";

describe("makeRepairJournalHistoryHandler", () => {
  function makeJob(data: object = {}): Job<object> {
    return {
      id: "test-repair-journal-history-job",
      name: "repair-journal-history",
      data,
      expireInSeconds: 900,
      heartbeatSeconds: null,
      signal: new AbortController().signal,
    };
  }

  const emptyReport = ok([]);

  it("when job is undefined: handler no-ops (pg-boss v12 guard)", async () => {
    const repairJournalHistoryUseCase = vi.fn().mockResolvedValue(emptyReport);

    const handler = makeRepairJournalHistoryHandler({ repairJournalHistoryUseCase, now: () => new Date() });

    await handler([undefined]);
    expect(repairJournalHistoryUseCase).not.toHaveBeenCalled();
  });

  it("invalid payload (non-uuid calendarId) → handler throws naming the job", async () => {
    const repairJournalHistoryUseCase = vi.fn().mockResolvedValue(emptyReport);

    const handler = makeRepairJournalHistoryHandler({ repairJournalHistoryUseCase, now: () => new Date() });

    await expect(handler([makeJob({ calendarId: "not-a-uuid" })])).rejects.toThrow(
      "repair-journal-history",
    );
    expect(repairJournalHistoryUseCase).not.toHaveBeenCalled();
  });

  it("empty payload → use-case called with scope 'all' (heal-only, trim omitted)", async () => {
    const repairJournalHistoryUseCase = vi.fn().mockResolvedValue(emptyReport);

    const handler = makeRepairJournalHistoryHandler({ repairJournalHistoryUseCase, now: () => new Date() });

    await handler([makeJob({})]);
    expect(repairJournalHistoryUseCase).toHaveBeenCalledWith({ scope: "all" });
  });

  it("payload with a calendarId → use-case called with that scope (heal-only, trim omitted)", async () => {
    const calendarId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
    const repairJournalHistoryUseCase = vi.fn().mockResolvedValue(emptyReport);

    const handler = makeRepairJournalHistoryHandler({ repairJournalHistoryUseCase, now: () => new Date() });

    await handler([makeJob({ calendarId })]);
    expect(repairJournalHistoryUseCase).toHaveBeenCalledWith({ scope: calendarId });
  });

  it("a defensive trimOutsideWindow in the payload is forwarded (never reachable via trigger_job — T-40-15)", async () => {
    const repairJournalHistoryUseCase = vi.fn().mockResolvedValue(emptyReport);

    const handler = makeRepairJournalHistoryHandler({ repairJournalHistoryUseCase, now: () => new Date() });

    await handler([makeJob({ trimOutsideWindow: true })]);
    expect(repairJournalHistoryUseCase).toHaveBeenCalledWith({ scope: "all", trimOutsideWindow: true });
  });

  it("use-case returns err → handler throws (signals failure to pg-boss for retry)", async () => {
    const repairJournalHistoryUseCase = vi
      .fn()
      .mockResolvedValue(err({ kind: "storage-error" as const, message: "repair failed" }));

    const handler = makeRepairJournalHistoryHandler({ repairJournalHistoryUseCase, now: () => new Date() });

    await expect(handler([makeJob({})])).rejects.toThrow("repair failed");
  });

  it("logs one coverage line per successful run (observability)", async () => {
    const reports = ok([
      {
        calendarId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
        before: { rows: 10, nonGapRows: 4, days: 2 },
        after: { rows: 10, nonGapRows: 9, days: 2 },
        deleted: null,
        errorCount: 1,
      },
    ]);
    const repairJournalHistoryUseCase = vi.fn().mockResolvedValue(reports);
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const handler = makeRepairJournalHistoryHandler({ repairJournalHistoryUseCase, now: () => new Date() });

    await handler([makeJob({})]);

    // healed = Σ(after.nonGapRows − before.nonGapRows) = 9 − 4 = 5
    expect(warn).toHaveBeenCalledWith(
      expect.stringContaining("repair-journal-history: scope=all calendars=1 healed=5 errors=1"),
    );
    warn.mockRestore();
  });

  it("runs even outside RTH (no RTH gate — on-demand only)", async () => {
    const weekend = new Date("2026-08-16T14:00:00Z");
    const repairJournalHistoryUseCase = vi.fn().mockResolvedValue(emptyReport);

    const handler = makeRepairJournalHistoryHandler({ repairJournalHistoryUseCase, now: () => weekend });

    await handler([makeJob({})]);
    expect(repairJournalHistoryUseCase).toHaveBeenCalledOnce();
  });
});

describe("makeRepairJournalHistoryHandler — null job.data (prod regression class 2026-07-14)", () => {
  // Same null-payload class as sync-fills/self-heal-journal: a trigger path delivering
  // data:null must behave as the {} all-calendars heal-only payload, never throw.
  it("runs the use-case with all/heal-only defaults when job.data is null", async () => {
    const repairJournalHistoryUseCase = vi.fn().mockResolvedValue(ok([]));
    const handler = makeRepairJournalHistoryHandler({ repairJournalHistoryUseCase });

    const job: Job<unknown> = {
      id: "test-null-payload",
      name: "repair-journal-history",
      data: null,
      expireInSeconds: 900,
      heartbeatSeconds: null,
      signal: new AbortController().signal,
    };
    await handler([job]);
    expect(repairJournalHistoryUseCase).toHaveBeenCalledOnce();
  });
});
