import { describe, it, expect } from "vitest";
import { ok, err, formatOccSymbol } from "@morai/shared";
import type { OccSymbol } from "@morai/shared";
import type { ForGettingCalendarById, ForReadingLatestLegObs, Calendar, LegSnapshot, StorageError } from "./ports.ts";
import { makeGetLiveGreeksUseCase } from "./getLiveGreeks.ts";

const CALENDAR_ID = "550e8400-e29b-41d4-a716-446655440002";

// SPX calendar: underlying=SPX, strike=7100000 (×1000), optionType=C,
// frontExpiry=2026-06-20, backExpiry=2026-09-18
const CALENDAR: Calendar = {
  id: "550e8400-e29b-41d4-a716-446655440002",
  underlying: "SPX",
  strike: 7100000, // 7100 * 1000
  optionType: "C",
  frontExpiry: "2026-06-20",
  backExpiry: "2026-09-18",
  qty: 1,
  openNetDebit: 25.0,
  status: "open",
  openedAt: new Date("2026-06-01T00:00:00.000Z"),
  closedAt: null,
  notes: null,
};

// The OCC symbols the use-case should construct for the above calendar
// formatOccSymbol expects strike in POINTS (not ×1000), so divide by 1000
const FRONT_OCC = formatOccSymbol({
  root: "SPX",
  expiry: new Date("2026-06-20T12:00:00Z"),
  type: "C",
  strike: 7100, // 7100000 / 1000
});
const BACK_OCC = formatOccSymbol({
  root: "SPX",
  expiry: new Date("2026-09-18T12:00:00Z"),
  type: "C",
  strike: 7100,
});

function makeLegSnapshot(occSymbol: OccSymbol, overrides?: Partial<LegSnapshot>): LegSnapshot {
  return {
    occSymbol,
    mark: 25.4,
    underlyingPrice: 7274.14,
    ivRaw: 0.25,
    bsmIv: "0.25",
    bsmDelta: "0.498",
    bsmGamma: "0.0061",
    bsmTheta: "-25.88",
    bsmVega: "0.6955",
    ...overrides,
  };
}

describe("makeGetLiveGreeksUseCase", () => {
  it("returns ok with empty legs when calendar is unknown (null from getCalendar)", async () => {
    const getCalendar: ForGettingCalendarById = async (_id) => ok(null);
    const getLatestLegObs: ForReadingLatestLegObs = async (_occ) => ok(null);
    const getLiveGreeks = makeGetLiveGreeksUseCase({ getCalendar, getLatestLegObs });
    const result = await getLiveGreeks(CALENDAR_ID);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    // Never an error — returns empty legs (SPEC §7)
    expect(result.value.calendarId).toBe(CALENDAR_ID);
    expect(result.value.legs).toEqual([]);
  });

  it("returns ok with populated legs when both observations exist", async () => {
    const getCalendar: ForGettingCalendarById = async (_id) => ok(CALENDAR);
    const frontLeg = makeLegSnapshot(FRONT_OCC);
    const backLeg = makeLegSnapshot(BACK_OCC);
    const getLatestLegObs: ForReadingLatestLegObs = async (occ) => {
      if (occ === FRONT_OCC) return ok(frontLeg);
      if (occ === BACK_OCC) return ok(backLeg);
      return ok(null);
    };
    const getLiveGreeks = makeGetLiveGreeksUseCase({ getCalendar, getLatestLegObs });
    const result = await getLiveGreeks(CALENDAR_ID);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.calendarId).toBe(CALENDAR_ID);
    expect(result.value.legs).toHaveLength(2);
    // Both OCC symbols should appear
    const occSymbols = result.value.legs.map((l) => l.occSymbol);
    expect(occSymbols).toContain(FRONT_OCC);
    expect(occSymbols).toContain(BACK_OCC);
  });

  it("returns 'NaN'/absent bsm fields (without throwing) when a leg has no observation", async () => {
    const getCalendar: ForGettingCalendarById = async (_id) => ok(CALENDAR);
    // Front leg has obs, back leg does not
    const frontLeg = makeLegSnapshot(FRONT_OCC);
    const getLatestLegObs: ForReadingLatestLegObs = async (occ) => {
      if (occ === FRONT_OCC) return ok(frontLeg);
      return ok(null); // back leg missing
    };
    const getLiveGreeks = makeGetLiveGreeksUseCase({ getCalendar, getLatestLegObs });
    const result = await getLiveGreeks(CALENDAR_ID);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    // Should still return 2 legs (one for each OCC symbol)
    expect(result.value.legs).toHaveLength(2);
    const backEntry = result.value.legs.find((l) => l.occSymbol === BACK_OCC);
    expect(backEntry).toBeDefined();
    if (!backEntry) return;
    // Missing-observation leg should have NaN bsm fields
    expect(backEntry.bsmIv).toBe("NaN");
    expect(backEntry.bsmDelta).toBe("NaN");
    expect(backEntry.bsmGamma).toBe("NaN");
    expect(backEntry.bsmTheta).toBe("NaN");
    expect(backEntry.bsmVega).toBe("NaN");
  });

  it("propagates a storage error from getCalendar", async () => {
    const storageError: StorageError = { kind: "storage-error", message: "DB down" };
    const getCalendar: ForGettingCalendarById = async (_id) => err(storageError);
    const getLatestLegObs: ForReadingLatestLegObs = async (_occ) => ok(null);
    const getLiveGreeks = makeGetLiveGreeksUseCase({ getCalendar, getLatestLegObs });
    const result = await getLiveGreeks(CALENDAR_ID);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.kind).toBe("storage-error");
  });

  it("constructs OCC symbols using formatOccSymbol with strike/1000 (not ×1000 int)", async () => {
    let capturedOccs: string[] = [];
    const getCalendar: ForGettingCalendarById = async (_id) => ok(CALENDAR);
    const getLatestLegObs: ForReadingLatestLegObs = async (occ) => {
      capturedOccs = [...capturedOccs, occ];
      return ok(null);
    };
    const getLiveGreeks = makeGetLiveGreeksUseCase({ getCalendar, getLatestLegObs });
    await getLiveGreeks(CALENDAR_ID);
    expect(capturedOccs).toContain(FRONT_OCC);
    expect(capturedOccs).toContain(BACK_OCC);
  });
});
