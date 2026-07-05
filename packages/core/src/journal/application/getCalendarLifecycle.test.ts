import { describe, it, expect, vi } from "vitest";
import { ok, err } from "@morai/shared";
import type { StorageError } from "./ports.ts";
import type { SnapshotRow } from "./ports.ts";
import { makeGetCalendarLifecycleUseCase } from "./getCalendarLifecycle.ts";

const CALENDAR_ID = "550e8400-e29b-41d4-a716-446655440001";

function makeSnapshotRow(overrides?: Partial<SnapshotRow>): SnapshotRow {
  return {
    time: new Date("2026-06-14T15:00:00.000Z"),
    calendarId: CALENDAR_ID,
    spot: "7274.14",
    netMark: "12.5",
    frontMark: "25.4",
    backMark: "37.9",
    frontIv: "0.25",
    backIv: "0.2341",
    frontIvRaw: "0.26",
    backIvRaw: "0.1818",
    netDelta: "-0.05",
    netGamma: "0.001",
    netTheta: "-12.3",
    netVega: "4.5",
    termSlope: "-0.016",
    dteFront: 7,
    dteBack: 97,
    pnlOpen: "-450",
    source: "cboe",
    ...overrides,
  };
}

describe("makeGetCalendarLifecycleUseCase", () => {
  it("returns ok(null) when readJournal returns ok(null) (unknown calendarId)", async () => {
    const readJournal = vi.fn().mockResolvedValue(ok(null));
    const use = makeGetCalendarLifecycleUseCase({ readJournal });

    const result = await use(CALENDAR_ID);
    expect(result).toEqual(ok(null));
  });

  it("returns ok([]) when readJournal returns ok([]) (known calendar, zero snapshots)", async () => {
    const readJournal = vi.fn().mockResolvedValue(ok([]));
    const use = makeGetCalendarLifecycleUseCase({ readJournal });

    const result = await use(CALENDAR_ID);
    expect(result).toEqual(ok([]));
  });

  it("propagates StorageError from readJournal", async () => {
    const storageError: StorageError = { kind: "storage-error", message: "boom" };
    const readJournal = vi.fn().mockResolvedValue(err(storageError));
    const use = makeGetCalendarLifecycleUseCase({ readJournal });

    const result = await use(CALENDAR_ID);
    expect(result).toEqual(err(storageError));
  });

  it("enriches each row with forwardVol/forwardVolGuard/isGap/cumTheta/cumVega/cumDeltaGamma/cumResidual", async () => {
    const rows = [
      makeSnapshotRow({ time: new Date("2026-06-14T15:00:00.000Z") }),
      makeSnapshotRow({ time: new Date("2026-06-14T15:30:00.000Z"), pnlOpen: "-400" }),
    ];
    const readJournal = vi.fn().mockResolvedValue(ok(rows));
    const use = makeGetCalendarLifecycleUseCase({ readJournal });

    const result = await use(CALENDAR_ID);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value).not.toBeNull();
    const value = result.value ?? [];
    expect(value).toHaveLength(2);
    for (const row of value) {
      expect(row).toHaveProperty("forwardVol");
      expect(row).toHaveProperty("forwardVolGuard");
      expect(row).toHaveProperty("isGap");
      expect(row).toHaveProperty("cumTheta");
      expect(row).toHaveProperty("cumVega");
      expect(row).toHaveProperty("cumDeltaGamma");
      expect(row).toHaveProperty("cumResidual");
      // Original SnapshotRow fields carried through
      expect(row).toHaveProperty("time");
      expect(row).toHaveProperty("calendarId", CALENDAR_ID);
    }
    // Both rows are non-gap normal data → forwardVolGuard "ok", never a stray `guard` key.
    expect(value[0]?.forwardVolGuard).toBe("ok");
    expect(value[0]).not.toHaveProperty("guard");
  });
});
