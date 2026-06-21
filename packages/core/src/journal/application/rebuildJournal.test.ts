/**
 * rebuildJournal use-case tests — Wave 0 RED stubs.
 *
 * Covers:
 *   - delete-then-reinsert: deleteCalendarEvents called before syncFillsForCalendar
 *   - resetCalendarAmounts called before syncFillsForCalendar
 *   - deleteCalendarEvents error propagates immediately (no syncFills called)
 *   - SC5 reconciliation: calendarId scoped rebuild
 *
 * These tests fail on ASSERTIONS, not import errors.
 * They will go GREEN when plan 05-08 implements makeRebuildJournalUseCase.
 */

import { describe, it, expect, vi } from "vitest";
import { ok, err } from "@morai/shared";
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
    const syncFillsForCalendar = async (id: string) => {
      syncedCalendarId = id;
      return ok<void, StorageError>(undefined);
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
});
