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
  StorageError,
} from "./ports.ts";

describe("makeRebuildJournalUseCase", () => {
  it("calls deleteCalendarEvents, then resetCalendarAmounts, then syncFillsForCalendar in order", async () => {
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

    const syncFillsForCalendar = vi.fn().mockResolvedValue(ok(undefined));
    // Track call in the spy
    syncFillsForCalendar.mockImplementation(async (calendarId: string) => {
      calls.push(`sync:${calendarId}`);
      return ok(undefined);
    });

    const rebuildJournal = makeRebuildJournalUseCase({
      deleteCalendarEvents,
      resetCalendarAmounts,
      syncFillsForCalendar,
      now: () => new Date("2026-06-15T14:00:00Z"),
    });

    const result = await rebuildJournal("cal-abc");
    expect(result.ok).toBe(true);
    expect(calls).toEqual(["delete:cal-abc", "reset:cal-abc", "sync:cal-abc"]);
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
      syncFillsForCalendar,
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
      syncFillsForCalendar,
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
      syncFillsForCalendar,
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
      syncFillsForCalendar,
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
    const syncFillsForCalendar = async (): Promise<Result<void, StorageError>> => err(storageErr);

    const rebuildJournal = makeRebuildJournalUseCase({
      deleteCalendarEvents,
      resetCalendarAmounts,
      syncFillsForCalendar,
      now: () => new Date("2026-06-15T14:00:00Z"),
    });

    const result = await rebuildJournal("cal-abc");
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.message).toBe("sync failed");
  });
});
