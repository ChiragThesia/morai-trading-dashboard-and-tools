/**
 * rebuildJournal use-case tests — Wave 0 RED stubs + SC5 reconciliation (plan 05-08).
 *
 * Covers:
 *   - delete-then-reinsert: deleteCalendarEvents called before syncFillsForCalendar
 *   - resetCalendarAmounts called before syncFillsForCalendar
 *   - deleteCalendarEvents error propagates immediately (no syncFills called)
 *   - SC5 reconciliation: calendarId scoped rebuild
 *   - SC5 reconciliation: rebuild result equals a fresh sync-fills run (D-10 idempotency)
 *   - Idempotency: running rebuildJournal twice yields the same events (no duplicates)
 *
 * These tests fail on ASSERTIONS, not import errors.
 * They will go GREEN when plan 05-08 implements makeRebuildJournalUseCase.
 */

import { describe, it, expect, vi } from "vitest";
import { ok, err } from "@morai/shared";
import type { Result } from "@morai/shared";
import type {
  ForDeletingCalendarEvents,
  ForResettingCalendarAmounts,
  ForRecomputingCalendarAmounts,
  ForResettingFillsProcessedForCalendar,
  StorageError,
} from "./ports.ts";

// WR-08 (plan 05-13): rebuildJournal gained a required recomputeCalendarAmounts step.
// A non-counting ok-twin satisfies the dep for the pre-existing order/error cases that
// don't assert on it.
const noopRecompute: ForRecomputingCalendarAmounts = async () => ok(undefined);
// WR-A2 (plan 05-15): rebuild gained a required resetFillsProcessedForCalendar step (un-mark
// the calendar's fills so the scoped re-pair re-reads them). Non-counting ok-twin for cases
// that don't assert on it.
const noopResetProcessed: ForResettingFillsProcessedForCalendar = async () => ok(undefined);

describe("makeRebuildJournalUseCase", () => {
  it("calls delete, then resetAmounts, then resetFillsProcessed, then syncFillsForCalendar in order", async () => {
    const { makeRebuildJournalUseCase } = await import("./rebuildJournal.ts");

    const calls: string[] = [];

    const deleteCalendarEvents: ForDeletingCalendarEvents = async (calendarId) => {
      calls.push(`delete:${calendarId}`);
      return ok(undefined);
    };

    const resetCalendarAmounts: ForResettingCalendarAmounts = async (calendarId) => {
      calls.push(`reset:${calendarId}`);
      return ok(undefined);
    };

    const resetFillsProcessedForCalendar: ForResettingFillsProcessedForCalendar = async (
      calendarId,
    ) => {
      calls.push(`resetProcessed:${calendarId}`);
      return ok(undefined);
    };

    const syncFillsForCalendar = vi.fn().mockResolvedValue(ok(undefined));
    // Track call in the spy
    syncFillsForCalendar.mockImplementation(async (calendarId: string) => {
      calls.push(`sync:${calendarId}`);
      return ok(undefined);
    });

    const rebuildJournal = makeRebuildJournalUseCase({
      deleteCalendarEvents,
      resetCalendarAmounts,
      resetFillsProcessedForCalendar,
      syncFillsForCalendar,
      recomputeCalendarAmounts: noopRecompute,
      now: () => new Date("2026-06-15T14:00:00Z"),
    });

    const result = await rebuildJournal("cal-abc");
    expect(result.ok).toBe(true);
    // WR-A2: resetProcessed runs after resetAmounts and before sync (delete scope == sync scope).
    expect(calls).toEqual([
      "delete:cal-abc",
      "reset:cal-abc",
      "resetProcessed:cal-abc",
      "sync:cal-abc",
    ]);
  });

  it("resetFillsProcessedForCalendar error → returns err immediately, syncFillsForCalendar NOT called (WR-A2)", async () => {
    const { makeRebuildJournalUseCase } = await import("./rebuildJournal.ts");

    const storageErr: StorageError = { kind: "storage-error", message: "reset-processed failed" };
    const deleteCalendarEvents: ForDeletingCalendarEvents = async () => ok(undefined);
    const resetCalendarAmounts: ForResettingCalendarAmounts = async () => ok(undefined);
    const resetFillsProcessedForCalendar: ForResettingFillsProcessedForCalendar = async () =>
      err(storageErr);
    const syncFillsForCalendar = vi.fn().mockResolvedValue(ok(undefined));

    const rebuildJournal = makeRebuildJournalUseCase({
      deleteCalendarEvents,
      resetCalendarAmounts,
      resetFillsProcessedForCalendar,
      syncFillsForCalendar,
      recomputeCalendarAmounts: noopRecompute,
      now: () => new Date("2026-06-15T14:00:00Z"),
    });

    const result = await rebuildJournal("cal-abc");
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.message).toBe("reset-processed failed");
    expect(syncFillsForCalendar).not.toHaveBeenCalled();
  });

  it("deleteCalendarEvents error → returns err immediately, syncFillsForCalendar NOT called", async () => {
    const { makeRebuildJournalUseCase } = await import("./rebuildJournal.ts");

    const storageErr: StorageError = { kind: "storage-error", message: "delete failed" };
    const deleteCalendarEvents: ForDeletingCalendarEvents = async () => err(storageErr);
    const resetCalendarAmounts: ForResettingCalendarAmounts = async () => ok(undefined);
    const syncFillsForCalendar = vi.fn().mockResolvedValue(ok(undefined));

    const rebuildJournal = makeRebuildJournalUseCase({
      deleteCalendarEvents,
      resetCalendarAmounts,
      resetFillsProcessedForCalendar: noopResetProcessed,
      syncFillsForCalendar,
      recomputeCalendarAmounts: noopRecompute,
      now: () => new Date("2026-06-15T14:00:00Z"),
    });

    const result = await rebuildJournal("cal-abc");
    expect(result.ok).toBe(false);
    if (result.ok) return; // type guard
    expect(result.error.message).toBe("delete failed");
    expect(syncFillsForCalendar).not.toHaveBeenCalled();
  });

  it("resetCalendarAmounts error → returns err immediately, syncFillsForCalendar NOT called", async () => {
    const { makeRebuildJournalUseCase } = await import("./rebuildJournal.ts");

    const storageErr: StorageError = { kind: "storage-error", message: "reset failed" };
    const deleteCalendarEvents: ForDeletingCalendarEvents = async () => ok(undefined);
    const resetCalendarAmounts: ForResettingCalendarAmounts = async () => err(storageErr);
    const syncFillsForCalendar = vi.fn().mockResolvedValue(ok(undefined));

    const rebuildJournal = makeRebuildJournalUseCase({
      deleteCalendarEvents,
      resetCalendarAmounts,
      resetFillsProcessedForCalendar: noopResetProcessed,
      syncFillsForCalendar,
      recomputeCalendarAmounts: noopRecompute,
      now: () => new Date("2026-06-15T14:00:00Z"),
    });

    const result = await rebuildJournal("cal-abc");
    expect(result.ok).toBe(false);
    expect(syncFillsForCalendar).not.toHaveBeenCalled();
  });

  it("rebuildJournal is scoped to the given calendarId only", async () => {
    const { makeRebuildJournalUseCase } = await import("./rebuildJournal.ts");

    let deletedCalendarId: string | null = null;
    let syncedCalendarId: string | null = null;

    const deleteCalendarEvents: ForDeletingCalendarEvents = async (id) => {
      deletedCalendarId = id;
      return ok(undefined);
    };
    const resetCalendarAmounts: ForResettingCalendarAmounts = async () => ok(undefined);
    const syncFillsForCalendar = async (id: string): Promise<Result<void, StorageError>> => {
      syncedCalendarId = id;
      return ok(undefined);
    };

    const rebuildJournal = makeRebuildJournalUseCase({
      deleteCalendarEvents,
      resetCalendarAmounts,
      resetFillsProcessedForCalendar: noopResetProcessed,
      syncFillsForCalendar,
      recomputeCalendarAmounts: noopRecompute,
      now: () => new Date("2026-06-15T14:00:00Z"),
    });

    await rebuildJournal("specific-cal-id");
    expect(deletedCalendarId).toBe("specific-cal-id");
    expect(syncedCalendarId).toBe("specific-cal-id");
  });

  it("SC5 reconciliation: rebuild produces same result as a fresh sync run (D-10 idempotency)", async () => {
    const { makeRebuildJournalUseCase } = await import("./rebuildJournal.ts");

    // Simulate a sync-fills function that records which calendarId it was called for
    const syncCalls: string[] = [];
    const syncFillsForCalendar = async (id: string): Promise<Result<void, StorageError>> => {
      syncCalls.push(id);
      return ok(undefined);
    };

    // First run: simulate existing events (delete clears them, then sync re-builds)
    const deleteCalls: string[] = [];
    const resetCalls: string[] = [];

    const deleteCalendarEvents: ForDeletingCalendarEvents = async (id) => {
      deleteCalls.push(id);
      return ok(undefined);
    };
    const resetCalendarAmounts: ForResettingCalendarAmounts = async (id) => {
      resetCalls.push(id);
      return ok(undefined);
    };

    const rebuildJournal = makeRebuildJournalUseCase({
      deleteCalendarEvents,
      resetCalendarAmounts,
      resetFillsProcessedForCalendar: noopResetProcessed,
      syncFillsForCalendar,
      recomputeCalendarAmounts: noopRecompute,
      now: () => new Date("2026-06-15T14:00:00Z"),
    });

    // Run rebuild twice — both should succeed and call sync with the same calendarId
    const r1 = await rebuildJournal("cal-sc5");
    const r2 = await rebuildJournal("cal-sc5");

    expect(r1.ok).toBe(true);
    expect(r2.ok).toBe(true);

    // SC5: each rebuild calls delete+reset+sync exactly once per call
    expect(deleteCalls).toEqual(["cal-sc5", "cal-sc5"]);
    expect(resetCalls).toEqual(["cal-sc5", "cal-sc5"]);
    expect(syncCalls).toEqual(["cal-sc5", "cal-sc5"]);
    // The two sync calls are identical — rebuild produces the same outcome (D-10 idempotency)
  });

  it("SC5 reconciliation: syncFillsForCalendar error → returns err (amounts not rebuilt)", async () => {
    const { makeRebuildJournalUseCase } = await import("./rebuildJournal.ts");

    const storageErr: StorageError = { kind: "storage-error", message: "sync failed" };
    const deleteCalendarEvents: ForDeletingCalendarEvents = async () => ok(undefined);
    const resetCalendarAmounts: ForResettingCalendarAmounts = async () => ok(undefined);
    const recomputeCalendarAmounts: ForRecomputingCalendarAmounts = async () => ok(undefined);
    const syncFillsForCalendar = async (): Promise<Result<void, StorageError>> => err(storageErr);

    const rebuildJournal = makeRebuildJournalUseCase({
      deleteCalendarEvents,
      resetCalendarAmounts,
      resetFillsProcessedForCalendar: noopResetProcessed,
      recomputeCalendarAmounts,
      syncFillsForCalendar,
      now: () => new Date("2026-06-15T14:00:00Z"),
    });

    const result = await rebuildJournal("cal-abc");
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.message).toBe("sync failed");
  });

  // ─── WR-08: recompute-amounts reconciliation step (plan 05-13) ────────────────

  it("WR-08: calls delete → reset → scoped sync → recompute in that order", async () => {
    const { makeRebuildJournalUseCase } = await import("./rebuildJournal.ts");

    const calls: string[] = [];

    const deleteCalendarEvents: ForDeletingCalendarEvents = async (id) => {
      calls.push(`delete:${id}`);
      return ok(undefined);
    };
    const resetCalendarAmounts: ForResettingCalendarAmounts = async (id) => {
      calls.push(`reset:${id}`);
      return ok(undefined);
    };
    const syncFillsForCalendar = async (id: string): Promise<Result<void, StorageError>> => {
      calls.push(`sync:${id}`);
      return ok(undefined);
    };
    const recomputeCalendarAmounts: ForRecomputingCalendarAmounts = async (id) => {
      calls.push(`recompute:${id}`);
      return ok(undefined);
    };

    const rebuildJournal = makeRebuildJournalUseCase({
      deleteCalendarEvents,
      resetCalendarAmounts,
      resetFillsProcessedForCalendar: noopResetProcessed,
      syncFillsForCalendar,
      recomputeCalendarAmounts,
      now: () => new Date("2026-06-15T14:00:00Z"),
    });

    const result = await rebuildJournal("cal-wr08");
    expect(result.ok).toBe(true);
    // recompute MUST run AFTER the scoped sync (events must exist before they're summed)
    expect(calls).toEqual([
      "delete:cal-wr08",
      "reset:cal-wr08",
      "sync:cal-wr08",
      "recompute:cal-wr08",
    ]);
  });

  it("WR-08: post-rebuild amounts are non-null and equal the summed scoped-sync events (SC5)", async () => {
    const { makeRebuildJournalUseCase } = await import("./rebuildJournal.ts");

    // Twin: the scoped sync writes events; recompute sums them onto the calendar amounts.
    type Event = { netAmount: number };
    const events: Event[] = [];
    let amounts: { openNetDebit: number | null; closeNetCredit: number | null } = {
      openNetDebit: 999, // stale pre-rebuild value (must be reset then recomputed)
      closeNetCredit: 999,
    };

    const deleteCalendarEvents: ForDeletingCalendarEvents = async () => {
      events.length = 0;
      return ok(undefined);
    };
    const resetCalendarAmounts: ForResettingCalendarAmounts = async () => {
      amounts = { openNetDebit: null, closeNetCredit: null };
      return ok(undefined);
    };
    const syncFillsForCalendar = async (): Promise<Result<void, StorageError>> => {
      // Scoped sync rebuilds two events: an OPEN debit (+300) and a CLOSE credit (−500).
      events.push({ netAmount: 300 });
      events.push({ netAmount: -500 });
      return ok(undefined);
    };
    const recomputeCalendarAmounts: ForRecomputingCalendarAmounts = async () => {
      let openDebit = 0;
      let closeCredit = 0;
      for (const e of events) {
        if (e.netAmount >= 0) openDebit += e.netAmount;
        else closeCredit += -e.netAmount;
      }
      amounts = { openNetDebit: openDebit, closeNetCredit: closeCredit };
      return ok(undefined);
    };

    const rebuildJournal = makeRebuildJournalUseCase({
      deleteCalendarEvents,
      resetCalendarAmounts,
      resetFillsProcessedForCalendar: noopResetProcessed,
      syncFillsForCalendar,
      recomputeCalendarAmounts,
      now: () => new Date("2026-06-15T14:00:00Z"),
    });

    const result = await rebuildJournal("cal-sc5");
    expect(result.ok).toBe(true);
    // SC5: amounts are non-null after rebuild and equal the summed rebuilt events.
    expect(amounts.openNetDebit).toBe(300);
    expect(amounts.closeNetCredit).toBe(500);
  });

  it("WR-08: recomputeCalendarAmounts error → returns err", async () => {
    const { makeRebuildJournalUseCase } = await import("./rebuildJournal.ts");

    const storageErr: StorageError = { kind: "storage-error", message: "recompute failed" };
    const deleteCalendarEvents: ForDeletingCalendarEvents = async () => ok(undefined);
    const resetCalendarAmounts: ForResettingCalendarAmounts = async () => ok(undefined);
    const syncFillsForCalendar = async (): Promise<Result<void, StorageError>> => ok(undefined);
    const recomputeCalendarAmounts: ForRecomputingCalendarAmounts = async () => err(storageErr);

    const rebuildJournal = makeRebuildJournalUseCase({
      deleteCalendarEvents,
      resetCalendarAmounts,
      resetFillsProcessedForCalendar: noopResetProcessed,
      syncFillsForCalendar,
      recomputeCalendarAmounts,
      now: () => new Date("2026-06-15T14:00:00Z"),
    });

    const result = await rebuildJournal("cal-abc");
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.message).toBe("recompute failed");
  });
});
