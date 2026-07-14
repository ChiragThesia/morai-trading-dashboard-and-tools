/**
 * self-heal-journal handler tests (HIST-03).
 *
 * Mirrors register-open-calendars.test.ts / wipe-derived-fills.test.ts — on-demand-shaped
 * thin handler, no RTH gate, use-case error → handler throws. Payload adds an optional
 * lookbackDays override (Zod-parsed at the handler boundary, JOB-01).
 */

import { describe, it, expect, vi } from "vitest";
import type { Job } from "pg-boss";
import { ok, err } from "@morai/shared";
import { makeSelfHealJournalHandler } from "./self-heal-journal.ts";

describe("makeSelfHealJournalHandler", () => {
  function makeJob(data: object = {}): Job<object> {
    return {
      id: "test-self-heal-journal-job",
      name: "self-heal-journal",
      data,
      expireInSeconds: 900,
      heartbeatSeconds: null,
      signal: new AbortController().signal,
    };
  }

  it("when job is undefined: handler no-ops (pg-boss v12 guard)", async () => {
    const selfHealJournalUseCase = vi
      .fn()
      .mockResolvedValue(ok({ slotsConsidered: 0, rowsHealed: 0, honestGapSlots: 0, errorCount: 0 }));

    const handler = makeSelfHealJournalHandler({ selfHealJournalUseCase, now: () => new Date() });

    await handler([undefined]);
    expect(selfHealJournalUseCase).not.toHaveBeenCalled();
  });

  it("invalid payload (non-numeric lookbackDays) → handler throws naming the job", async () => {
    const selfHealJournalUseCase = vi
      .fn()
      .mockResolvedValue(ok({ slotsConsidered: 0, rowsHealed: 0, honestGapSlots: 0, errorCount: 0 }));

    const handler = makeSelfHealJournalHandler({ selfHealJournalUseCase, now: () => new Date() });

    await expect(handler([makeJob({ lookbackDays: "not-a-number" })])).rejects.toThrow(
      "self-heal-journal",
    );
    expect(selfHealJournalUseCase).not.toHaveBeenCalled();
  });

  it("empty payload → use-case called with an empty object (default lookback)", async () => {
    const selfHealJournalUseCase = vi
      .fn()
      .mockResolvedValue(ok({ slotsConsidered: 0, rowsHealed: 0, honestGapSlots: 0, errorCount: 0 }));

    const handler = makeSelfHealJournalHandler({ selfHealJournalUseCase, now: () => new Date() });

    await handler([makeJob({})]);
    expect(selfHealJournalUseCase).toHaveBeenCalledWith({});
  });

  it("payload with a numeric lookbackDays override → passed through to the use-case", async () => {
    const selfHealJournalUseCase = vi
      .fn()
      .mockResolvedValue(ok({ slotsConsidered: 0, rowsHealed: 0, honestGapSlots: 0, errorCount: 0 }));

    const handler = makeSelfHealJournalHandler({ selfHealJournalUseCase, now: () => new Date() });

    await handler([makeJob({ lookbackDays: 3 })]);
    expect(selfHealJournalUseCase).toHaveBeenCalledWith({ lookbackDays: 3 });
  });

  it("use-case returns err → handler throws (signals failure to pg-boss for retry)", async () => {
    const selfHealJournalUseCase = vi
      .fn()
      .mockResolvedValue(err({ kind: "storage-error" as const, message: "heal failed" }));

    const handler = makeSelfHealJournalHandler({ selfHealJournalUseCase, now: () => new Date() });

    await expect(handler([makeJob({})])).rejects.toThrow("heal failed");
  });

  it("logs one coverage line per successful run (observability — prod is otherwise blind)", async () => {
    const now = new Date("2026-07-14T16:00:30.000Z");
    const selfHealJournalUseCase = vi
      .fn()
      .mockResolvedValue(ok({ slotsConsidered: 92, rowsHealed: 3, honestGapSlots: 69, errorCount: 0 }));
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const handler = makeSelfHealJournalHandler({ selfHealJournalUseCase, now: () => now });

    await handler([makeJob({})]);

    // Distinguishes "ran, healed 0" / "ran, honest-gap N" / "ran, errored N" — the states prod
    // could not tell apart when the handler was silent.
    expect(warn).toHaveBeenCalledWith(
      expect.stringContaining(
        "self-heal-journal: slots=92 healed=3 honestGaps=69 errors=0 window=",
      ),
    );
    // window ends at `now`
    expect(warn).toHaveBeenCalledWith(expect.stringContaining("2026-07-14T16:00:30.000Z"));
    warn.mockRestore();
  });

  it("runs even outside RTH (no RTH gate — repairs past slots, not time-of-day sensitive)", async () => {
    const weekend = new Date("2026-08-16T14:00:00Z");
    const selfHealJournalUseCase = vi
      .fn()
      .mockResolvedValue(ok({ slotsConsidered: 0, rowsHealed: 0, honestGapSlots: 0, errorCount: 0 }));

    const handler = makeSelfHealJournalHandler({ selfHealJournalUseCase, now: () => weekend });

    await handler([makeJob({})]);
    expect(selfHealJournalUseCase).toHaveBeenCalledOnce();
  });
});

describe("makeSelfHealJournalHandler — null job.data (prod regression 2026-07-14)", () => {
  // pg-boss scheduled fires deliver data:null (schedule.ts passes null); Zod's object schema
  // rejects null with "expected object, received null" — the handler threw on EVERY hourly
  // cron fire, so self-heal never ran in prod (same class as sync-fills 2026-07-09/10).
  it("runs the use-case with defaults when job.data is null instead of throwing", async () => {
    const selfHealJournalUseCase = vi
      .fn()
      .mockResolvedValue(ok({ slotsConsidered: 0, rowsHealed: 0, honestGapSlots: 0, errorCount: 0 }));
    const handler = makeSelfHealJournalHandler({ selfHealJournalUseCase, now: () => new Date() });

    const job: Job<unknown> = {
      id: "test-null-payload",
      name: "self-heal-journal",
      data: null,
      expireInSeconds: 900,
      heartbeatSeconds: null,
      signal: new AbortController().signal,
    };
    await handler([job]);
    expect(selfHealJournalUseCase).toHaveBeenCalledWith({});
  });
});
