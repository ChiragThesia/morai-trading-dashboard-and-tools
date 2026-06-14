import { describe, it, expect } from "vitest";
import { ok, err } from "@morai/shared";
import type { ForReadingJournal, StorageError, SnapshotRow } from "./ports.ts";
import { makeGetJournalUseCase } from "./getJournal.ts";

const CALENDAR_ID = "00000000-0000-0000-0000-000000000001";

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

describe("makeGetJournalUseCase", () => {
  it("returns null passthrough for an unknown calendarId (ok(null))", async () => {
    const readJournal: ForReadingJournal = async (_calendarId) => ok(null);
    const getJournal = makeGetJournalUseCase({ readJournal });
    const result = await getJournal(CALENDAR_ID);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value).toBeNull();
  });

  it("returns empty array for a known calendar with no snapshots", async () => {
    const readJournal: ForReadingJournal = async (_calendarId) => ok([]);
    const getJournal = makeGetJournalUseCase({ readJournal });
    const result = await getJournal(CALENDAR_ID);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value).toEqual([]);
  });

  it("forwards an ordered array of snapshot rows for a known calendar", async () => {
    const rows = [makeSnapshotRow(), makeSnapshotRow({ time: new Date("2026-06-14T15:30:00.000Z") })];
    const readJournal: ForReadingJournal = async (_calendarId) => ok(rows);
    const getJournal = makeGetJournalUseCase({ readJournal });
    const result = await getJournal(CALENDAR_ID);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value).toEqual(rows);
  });

  it("propagates a storage error from the port", async () => {
    const storageError: StorageError = { kind: "storage-error", message: "DB down" };
    const readJournal: ForReadingJournal = async (_calendarId) => err(storageError);
    const getJournal = makeGetJournalUseCase({ readJournal });
    const result = await getJournal(CALENDAR_ID);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.kind).toBe("storage-error");
  });

  it("passes the calendarId through to the port", async () => {
    let capturedId = "";
    const readJournal: ForReadingJournal = async (calendarId) => {
      capturedId = calendarId;
      return ok(null);
    };
    const getJournal = makeGetJournalUseCase({ readJournal });
    await getJournal("test-calendar-id");
    expect(capturedId).toBe("test-calendar-id");
  });
});
