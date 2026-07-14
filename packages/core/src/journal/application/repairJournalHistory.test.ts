/**
 * repairJournalHistory tests (Phase 40, Plan 07, HIST-04).
 *
 * Covers: single-scope vs "all"-scope target selection, heal-only-by-default (trim never
 * called unless requested), opt-in trim reporting the deleted count, before/after coverage
 * (rows/nonGapRows/days via isGapRow), idempotent re-run, StorageError propagation from every
 * composed port.
 */

import { describe, it, expect, vi } from "vitest";
import { ok, err } from "@morai/shared";
import { makeRepairJournalHistoryUseCase } from "./repairJournalHistory.ts";
import type { RepairJournalHistoryDeps } from "./repairJournalHistory.ts";
import type { Calendar, SnapshotRow } from "./ports.ts";

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

function makeRow(overrides: Partial<SnapshotRow> = {}): SnapshotRow {
  return {
    time: new Date("2026-06-01T14:30:00Z"),
    calendarId: "cal-001",
    spot: "5000",
    netMark: "1",
    frontMark: "2",
    backMark: "3",
    frontIv: "0.2",
    backIv: "0.25",
    frontIvRaw: "0.2",
    backIvRaw: "0.25",
    netDelta: "0.1",
    netGamma: "0.01",
    netTheta: "-0.5",
    netVega: "0.3",
    termSlope: "0.05",
    dteFront: 10,
    dteBack: 60,
    pnlOpen: "10",
    source: "cboe",
    ...overrides,
  };
}

function gapRow(overrides: Partial<SnapshotRow> = {}): SnapshotRow {
  return makeRow({ spot: "0", ...overrides });
}

const NOW = new Date("2026-07-14T14:00:00Z");

function makeDeps(overrides: Partial<RepairJournalHistoryDeps> = {}): RepairJournalHistoryDeps {
  return {
    listCalendars: async () => ok([]),
    readJournal: async () => ok([]),
    rebuildCalendarHistory: async () => ok({ slotsConsidered: 0, rowsHealed: 0, honestGapSlots: 0, errorCount: 0 }),
    deleteSnapshotsOutsideWindow: async () => ok({ deletedCount: 0 }),
    now: () => NOW,
    ...overrides,
  };
}

describe("makeRepairJournalHistoryUseCase", () => {
  it("single scope: repairs exactly the matching calendar, ignoring others in the list", async () => {
    const target = makeCalendar({ id: "cal-target" });
    const other = makeCalendar({ id: "cal-other" });
    const rebuildCalendarHistory = vi
      .fn()
      .mockResolvedValue(ok({ slotsConsidered: 0, rowsHealed: 0, honestGapSlots: 0, errorCount: 0 }));

    const useCase = makeRepairJournalHistoryUseCase(
      makeDeps({ listCalendars: async () => ok([target, other]), rebuildCalendarHistory }),
    );

    const result = await useCase({ scope: "cal-target" });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value).toHaveLength(1);
      expect(result.value[0]?.calendarId).toBe("cal-target");
    }
    expect(rebuildCalendarHistory).toHaveBeenCalledTimes(1);
    expect(rebuildCalendarHistory).toHaveBeenCalledWith(target, { from: target.openedAt, to: NOW });
  });

  it('all scope: repairs every calendar (open + closed) returned by listCalendars(undefined)', async () => {
    const a = makeCalendar({ id: "cal-a", status: "open", closedAt: null });
    const b = makeCalendar({ id: "cal-b", status: "closed", closedAt: new Date("2026-07-01T14:00:00Z") });
    const listCalendars = vi.fn().mockResolvedValue(ok([a, b]));
    const rebuildCalendarHistory = vi
      .fn()
      .mockResolvedValue(ok({ slotsConsidered: 0, rowsHealed: 0, honestGapSlots: 0, errorCount: 0 }));

    const useCase = makeRepairJournalHistoryUseCase(makeDeps({ listCalendars, rebuildCalendarHistory }));

    const result = await useCase({ scope: "all" });

    expect(listCalendars).toHaveBeenCalledWith(undefined);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.map((r) => r.calendarId).sort()).toEqual(["cal-a", "cal-b"]);
    }
    expect(rebuildCalendarHistory).toHaveBeenCalledWith(b, { from: b.openedAt, to: b.closedAt });
  });

  it("heal-only default: deleteSnapshotsOutsideWindow is NEVER called when trimOutsideWindow is omitted", async () => {
    const target = makeCalendar();
    const deleteSnapshotsOutsideWindow = vi.fn();

    const useCase = makeRepairJournalHistoryUseCase(
      makeDeps({ listCalendars: async () => ok([target]), deleteSnapshotsOutsideWindow }),
    );

    const result = await useCase({ scope: target.id });

    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value[0]?.deleted).toBeNull();
    expect(deleteSnapshotsOutsideWindow).not.toHaveBeenCalled();
  });

  it("trim opt-in: trimOutsideWindow=true calls deleteSnapshotsOutsideWindow and reports the deleted count", async () => {
    const target = makeCalendar();
    const deleteSnapshotsOutsideWindow = vi.fn().mockResolvedValue(ok({ deletedCount: 4 }));

    const useCase = makeRepairJournalHistoryUseCase(
      makeDeps({ listCalendars: async () => ok([target]), deleteSnapshotsOutsideWindow }),
    );

    const result = await useCase({ scope: target.id, trimOutsideWindow: true });

    expect(deleteSnapshotsOutsideWindow).toHaveBeenCalledWith(target.id, target.openedAt, target.closedAt);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value[0]?.deleted).toBe(4);
  });

  it("coverage: before/after rows/nonGapRows/days computed from readJournal via isGapRow", async () => {
    const target = makeCalendar();
    const beforeRows = [
      makeRow({ time: new Date("2026-06-01T14:30:00Z") }),
      gapRow({ time: new Date("2026-06-01T15:00:00Z") }),
      makeRow({ time: new Date("2026-06-02T14:30:00Z") }),
    ];
    const afterRows = [...beforeRows, makeRow({ time: new Date("2026-06-03T14:30:00Z") })];
    const readJournal = vi.fn().mockResolvedValueOnce(ok(beforeRows)).mockResolvedValueOnce(ok(afterRows));

    const useCase = makeRepairJournalHistoryUseCase(
      makeDeps({ listCalendars: async () => ok([target]), readJournal }),
    );

    const result = await useCase({ scope: target.id });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const report = result.value[0];
    expect(report?.before).toEqual({ rows: 3, nonGapRows: 2, days: 2 });
    expect(report?.after).toEqual({ rows: 4, nonGapRows: 3, days: 3 });
  });

  it("WR-01 (40-REVIEW.md): errorCount from the rebuild engine is surfaced on the calendar's report, never aborts the run", async () => {
    const target = makeCalendar();
    const rebuildCalendarHistory = vi
      .fn()
      .mockResolvedValue(ok({ slotsConsidered: 4, rowsHealed: 2, honestGapSlots: 1, errorCount: 1 }));

    const useCase = makeRepairJournalHistoryUseCase(
      makeDeps({ listCalendars: async () => ok([target]), rebuildCalendarHistory }),
    );

    const result = await useCase({ scope: target.id });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value[0]?.errorCount).toBe(1);
  });

  it("idempotent re-run: identical stub deps produce equal before/after coverage on a second run", async () => {
    const target = makeCalendar();
    const rows = [makeRow({ time: new Date("2026-06-01T14:30:00Z") })];

    const useCase = makeRepairJournalHistoryUseCase(
      makeDeps({ listCalendars: async () => ok([target]), readJournal: async () => ok(rows) }),
    );

    const first = await useCase({ scope: target.id });
    const second = await useCase({ scope: target.id });

    expect(first).toEqual(second);
  });

  it("error-propagation: a StorageError from listCalendars short-circuits before any read/rebuild call", async () => {
    const storageError = { kind: "storage-error" as const, message: "list failed" };
    const readJournal = vi.fn();
    const rebuildCalendarHistory = vi.fn();

    const useCase = makeRepairJournalHistoryUseCase(
      makeDeps({ listCalendars: async () => err(storageError), readJournal, rebuildCalendarHistory }),
    );

    const result = await useCase({ scope: "all" });

    expect(result).toEqual(err(storageError));
    expect(readJournal).not.toHaveBeenCalled();
    expect(rebuildCalendarHistory).not.toHaveBeenCalled();
  });

  it("error-propagation: a StorageError from readJournal (before-read) short-circuits the remaining calendars", async () => {
    const a = makeCalendar({ id: "cal-a" });
    const b = makeCalendar({ id: "cal-b" });
    const storageError = { kind: "storage-error" as const, message: "read failed" };
    const readJournal = vi.fn().mockResolvedValueOnce(err(storageError));
    const rebuildCalendarHistory = vi.fn();

    const useCase = makeRepairJournalHistoryUseCase(
      makeDeps({ listCalendars: async () => ok([a, b]), readJournal, rebuildCalendarHistory }),
    );

    const result = await useCase({ scope: "all" });

    expect(result).toEqual(err(storageError));
    expect(rebuildCalendarHistory).not.toHaveBeenCalled();
  });

  it("error-propagation: a StorageError from rebuildCalendarHistory short-circuits", async () => {
    const target = makeCalendar();
    const storageError = { kind: "storage-error" as const, message: "rebuild failed" };

    const useCase = makeRepairJournalHistoryUseCase(
      makeDeps({
        listCalendars: async () => ok([target]),
        rebuildCalendarHistory: async () => err(storageError),
      }),
    );

    const result = await useCase({ scope: target.id });

    expect(result).toEqual(err(storageError));
  });

  it("error-propagation: a StorageError from deleteSnapshotsOutsideWindow (trim) short-circuits", async () => {
    const target = makeCalendar();
    const storageError = { kind: "storage-error" as const, message: "trim failed" };

    const useCase = makeRepairJournalHistoryUseCase(
      makeDeps({
        listCalendars: async () => ok([target]),
        deleteSnapshotsOutsideWindow: async () => err(storageError),
      }),
    );

    const result = await useCase({ scope: target.id, trimOutsideWindow: true });

    expect(result).toEqual(err(storageError));
  });
});
