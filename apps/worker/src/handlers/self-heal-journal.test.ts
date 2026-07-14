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
