/**
 * recomputeSnapshotPnl.test.ts — TDD RED→GREEN for the JRNL-01 pnl-unit-mismatch fix.
 *
 * Regression coverage: calendar 65aac62e (SPXW 7425P) carried a dollar-scale openNetDebit
 * (3235 instead of 32.35 points), so every historical calendar_snapshots row's stored pnl_open
 * was ~100x wrong (frozen at snapshot-write time — see snapshotCalendars.ts D-05). Once
 * openNetDebit is corrected (e.g. via rebuild-journal), the frozen historical pnl_open rows
 * are still stale until this use-case re-derives them from each row's stored net_mark.
 */

import { describe, it, expect } from "vitest";
import { ok, err } from "@morai/shared";
import type {
  Calendar,
  ForGettingCalendarById,
  ForRecomputingSnapshotPnl,
  StorageError,
} from "./ports.ts";
import { makeRecomputeSnapshotPnlUseCase } from "./recomputeSnapshotPnl.ts";

const CALENDAR_ID = "65aac62e-70e0-4c94-93b4-11cc7dd8e4d0";

function makeCalendar(overrides?: Partial<Calendar>): Calendar {
  return {
    id: CALENDAR_ID,
    underlying: "SPXW",
    strike: 7425000,
    optionType: "P",
    frontExpiry: "2026-08-07",
    backExpiry: "2026-08-31",
    qty: 1,
    openNetDebit: 32.35, // CORRECTED value (points) — was 3235 (dollars) before the fix
    status: "open",
    openedAt: new Date("2026-06-22T00:00:00.000Z"),
    closedAt: null,
    notes: null,
    ...overrides,
  };
}

describe("makeRecomputeSnapshotPnlUseCase", () => {
  it("reads the calendar's CURRENT openNetDebit/qty and forwards them to the recompute port", async () => {
    let captured: { calendarId: string; openNetDebit: number; qty: number } | null = null;
    const getCalendarById: ForGettingCalendarById = async (_id) => ok(makeCalendar({ qty: 1 }));
    const recomputeSnapshotPnl: ForRecomputingSnapshotPnl = async (calendarId, openNetDebit, qty) => {
      captured = { calendarId, openNetDebit, qty };
      return ok({ rowsUpdated: 42 });
    };

    const useCase = makeRecomputeSnapshotPnlUseCase({ getCalendarById, recomputeSnapshotPnl });
    const result = await useCase(CALENDAR_ID);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value).toEqual({ rowsUpdated: 42 });
    expect(captured).toEqual({ calendarId: CALENDAR_ID, openNetDebit: 32.35, qty: 1 });
  });

  it("returns not-found when the calendarId is unknown — never calls the recompute port", async () => {
    const getCalendarById: ForGettingCalendarById = async (_id) => ok(null);
    let called = false;
    const recomputeSnapshotPnl: ForRecomputingSnapshotPnl = async (_id, _debit, _qty) => {
      called = true;
      return ok({ rowsUpdated: 0 });
    };

    const useCase = makeRecomputeSnapshotPnlUseCase({ getCalendarById, recomputeSnapshotPnl });
    const result = await useCase(CALENDAR_ID);

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.kind).toBe("not-found");
    expect(called).toBe(false);
  });

  it("propagates a storage error from getCalendarById", async () => {
    const storageError: StorageError = { kind: "storage-error", message: "DB down" };
    const getCalendarById: ForGettingCalendarById = async (_id) => err(storageError);
    const recomputeSnapshotPnl: ForRecomputingSnapshotPnl = async (_id, _debit, _qty) =>
      ok({ rowsUpdated: 0 });

    const useCase = makeRecomputeSnapshotPnlUseCase({ getCalendarById, recomputeSnapshotPnl });
    const result = await useCase(CALENDAR_ID);

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toEqual(storageError);
  });

  it("propagates a storage error from the recompute port", async () => {
    const storageError: StorageError = { kind: "storage-error", message: "update failed" };
    const getCalendarById: ForGettingCalendarById = async (_id) => ok(makeCalendar());
    const recomputeSnapshotPnl: ForRecomputingSnapshotPnl = async (_id, _debit, _qty) =>
      err(storageError);

    const useCase = makeRecomputeSnapshotPnlUseCase({ getCalendarById, recomputeSnapshotPnl });
    const result = await useCase(CALENDAR_ID);

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toEqual(storageError);
  });

  it("regression: a closed calendar's corrected openNetDebit (32.35 pts, was 3235 $) still recomputes", async () => {
    // 65aac62e itself, post-correction — qty=1, openNetDebit=32.35 points.
    const getCalendarById: ForGettingCalendarById = async (_id) =>
      ok(makeCalendar({ status: "closed", closedAt: new Date("2026-07-01T00:00:00.000Z") }));
    let captured: { openNetDebit: number; qty: number } | null = null;
    const recomputeSnapshotPnl: ForRecomputingSnapshotPnl = async (_id, openNetDebit, qty) => {
      captured = { openNetDebit, qty };
      return ok({ rowsUpdated: 5 });
    };

    const useCase = makeRecomputeSnapshotPnlUseCase({ getCalendarById, recomputeSnapshotPnl });
    const result = await useCase(CALENDAR_ID);

    expect(result.ok).toBe(true);
    // The dollar-scale value (3235) must NEVER be what reaches the recompute port again.
    expect(captured).toEqual({ openNetDebit: 32.35, qty: 1 });
    expect(captured).not.toEqual({ openNetDebit: 3235, qty: 1 });
  });
});
