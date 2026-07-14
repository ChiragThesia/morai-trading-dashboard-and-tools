/**
 * selfHealJournal tests (Phase 40, Plan 06, HIST-03).
 *
 * Covers: only-open calendars touched, bounded-window (default 7 days + override honored),
 * per-calendar coverage aggregation, StorageError propagation from either port.
 */

import { describe, it, expect, vi } from "vitest";
import { ok, err } from "@morai/shared";
import { makeSelfHealJournalUseCase, SELF_HEAL_LOOKBACK_DAYS } from "./selfHealJournal.ts";
import type { SelfHealJournalDeps } from "./selfHealJournal.ts";
import type { Calendar } from "./ports.ts";

function makeCalendar(overrides: Partial<Calendar> = {}): Calendar {
  return {
    id: "cal-001",
    underlying: "SPX",
    strike: 5000000,
    optionType: "C",
    frontExpiry: "2026-07-18",
    backExpiry: "2026-09-19",
    qty: 2,
    openNetDebit: 5.0,
    status: "open",
    openedAt: new Date("2026-06-01T14:00:00Z"),
    closedAt: null,
    notes: null,
    ...overrides,
  };
}

const NOW = new Date("2026-07-14T14:00:00Z");
const DAY_MS = 24 * 60 * 60 * 1000;

function makeDeps(overrides: Partial<SelfHealJournalDeps> = {}): SelfHealJournalDeps {
  return {
    getOpenCalendars: async () => ok([]),
    rebuildCalendarHistory: async () => ok({ slotsConsidered: 0, rowsHealed: 0, honestGapSlots: 0, errorCount: 0 }),
    now: () => NOW,
    ...overrides,
  };
}

describe("makeSelfHealJournalUseCase", () => {
  it("only-open: calls rebuildCalendarHistory once per calendar returned by getOpenCalendars, never a closed one", async () => {
    const open = [makeCalendar({ id: "cal-open-1" }), makeCalendar({ id: "cal-open-2" })];
    const calledIds: string[] = [];
    const rebuildCalendarHistory: SelfHealJournalDeps["rebuildCalendarHistory"] = async (calendar) => {
      calledIds.push(calendar.id);
      return ok({ slotsConsidered: 0, rowsHealed: 0, honestGapSlots: 0, errorCount: 0 });
    };

    const useCase = makeSelfHealJournalUseCase(
      makeDeps({ getOpenCalendars: async () => ok(open), rebuildCalendarHistory }),
    );

    await useCase();

    expect(calledIds.sort()).toEqual(["cal-open-1", "cal-open-2"]);
  });

  it("bounded-window: default lookback is SELF_HEAL_LOOKBACK_DAYS (7) days back from now", async () => {
    const open = [makeCalendar()];
    const rebuildCalendarHistory = vi
      .fn()
      .mockResolvedValue(ok({ slotsConsidered: 0, rowsHealed: 0, honestGapSlots: 0, errorCount: 0 }));

    const useCase = makeSelfHealJournalUseCase(
      makeDeps({ getOpenCalendars: async () => ok(open), rebuildCalendarHistory }),
    );

    await useCase();

    expect(SELF_HEAL_LOOKBACK_DAYS).toBe(7);
    expect(rebuildCalendarHistory).toHaveBeenCalledWith(open[0], {
      from: new Date(NOW.getTime() - 7 * DAY_MS),
      to: NOW,
    });
  });

  it("bounded-window: an explicit lookbackDays override is honored", async () => {
    const open = [makeCalendar()];
    const rebuildCalendarHistory = vi
      .fn()
      .mockResolvedValue(ok({ slotsConsidered: 0, rowsHealed: 0, honestGapSlots: 0, errorCount: 0 }));

    const useCase = makeSelfHealJournalUseCase(
      makeDeps({ getOpenCalendars: async () => ok(open), rebuildCalendarHistory }),
    );

    await useCase({ lookbackDays: 2 });

    expect(rebuildCalendarHistory).toHaveBeenCalledWith(open[0], {
      from: new Date(NOW.getTime() - 2 * DAY_MS),
      to: NOW,
    });
  });

  it("aggregation: sums RebuildCoverage (including errorCount, WR-01) across multiple calendars", async () => {
    const open = [makeCalendar({ id: "cal-a" }), makeCalendar({ id: "cal-b" })];
    const rebuildCalendarHistory = vi
      .fn()
      .mockResolvedValueOnce(ok({ slotsConsidered: 3, rowsHealed: 2, honestGapSlots: 1, errorCount: 1 }))
      .mockResolvedValueOnce(ok({ slotsConsidered: 5, rowsHealed: 4, honestGapSlots: 1, errorCount: 0 }));

    const useCase = makeSelfHealJournalUseCase(
      makeDeps({ getOpenCalendars: async () => ok(open), rebuildCalendarHistory }),
    );

    const result = await useCase();

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value).toEqual({ slotsConsidered: 8, rowsHealed: 6, honestGapSlots: 2, errorCount: 1 });
    }
  });

  it("error-propagation: a StorageError from getOpenCalendars short-circuits before any rebuild call", async () => {
    const storageError = { kind: "storage-error" as const, message: "list failed" };
    const rebuildCalendarHistory = vi.fn();

    const useCase = makeSelfHealJournalUseCase(
      makeDeps({ getOpenCalendars: async () => err(storageError), rebuildCalendarHistory }),
    );

    const result = await useCase();

    expect(result).toEqual(err(storageError));
    expect(rebuildCalendarHistory).not.toHaveBeenCalled();
  });

  it("error-propagation: a StorageError from rebuildCalendarHistory short-circuits the remaining calendars", async () => {
    const open = [makeCalendar({ id: "cal-a" }), makeCalendar({ id: "cal-b" })];
    const storageError = { kind: "storage-error" as const, message: "rebuild failed" };
    const rebuildCalendarHistory = vi.fn().mockResolvedValueOnce(err(storageError));

    const useCase = makeSelfHealJournalUseCase(
      makeDeps({ getOpenCalendars: async () => ok(open), rebuildCalendarHistory }),
    );

    const result = await useCase();

    expect(result).toEqual(err(storageError));
    expect(rebuildCalendarHistory).toHaveBeenCalledTimes(1);
  });
});
