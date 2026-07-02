/**
 * getMacro.test.ts — makeGetMacroUseCase read use-case (MAC-02).
 *
 * Tests verify:
 *   1. rows are grouped by seriesId, each series' array sorted ASCENDING by time (D-10)
 *   2. empty store → ok({}) (not an error)
 *   3. default 90-day window excludes rows older than 90 days before `now`
 *   4. `days` override widens the window
 *   5. `series` filter narrows to only the requested series
 *   6. combined `{ days, series }` applies both filters
 *   7. StorageError from the repo is propagated unchanged
 *
 * Test doubles are inline function implementations (core cannot import adapters —
 * architecture-boundaries §2). No any/as/! (typescript.md). All promises awaited.
 */

import { describe, it, expect } from "vitest";
import { ok, err } from "@morai/shared";
import type { ForReadingMacroObservations, MacroObservationRow, StorageError } from "./ports.ts";
import { makeGetMacroUseCase } from "./getMacro.ts";

// ─── Fixtures ─────────────────────────────────────────────────────────────────

function row(
  seriesId: string,
  date: string,
  value: number,
  source: "fred" | "cboe" = "fred",
): MacroObservationRow {
  return { seriesId, date, value, source };
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("makeGetMacroUseCase", () => {
  it("groups rows by seriesId, each series array ascending by time", async () => {
    const rows: ReadonlyArray<MacroObservationRow> = [
      row("DFF", "2026-06-02", 4.33),
      row("DFF", "2026-06-01", 4.3),
      row("VVIX", "2026-06-01", 89.0, "cboe"),
    ];
    const readMacroObservations: ForReadingMacroObservations = async () => ok(rows);
    const getMacro = makeGetMacroUseCase({
      readMacroObservations,
      now: () => new Date("2026-06-15T00:00:00Z"),
    });

    const result = await getMacro();

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value["DFF"]).toEqual([
        { time: "2026-06-01", value: 4.3 },
        { time: "2026-06-02", value: 4.33 },
      ]);
      expect(result.value["VVIX"]).toEqual([{ time: "2026-06-01", value: 89.0 }]);
    }
  });

  it("returns ok({}) when the store is empty", async () => {
    const readMacroObservations: ForReadingMacroObservations = async () => ok([]);
    const getMacro = makeGetMacroUseCase({ readMacroObservations });

    const result = await getMacro();

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value).toEqual({});
    }
  });

  it("applies the default 90-day window, excluding rows older than 90 days", async () => {
    const now = new Date("2026-07-01T00:00:00Z");
    const rows: ReadonlyArray<MacroObservationRow> = [
      row("DFF", "2026-06-30", 4.33), // within 90d
      row("DFF", "2026-01-01", 4.1), // older than 90d — excluded
    ];
    const readMacroObservations: ForReadingMacroObservations = async () => ok(rows);
    const getMacro = makeGetMacroUseCase({ readMacroObservations, now: () => now });

    const result = await getMacro();

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value["DFF"]).toEqual([{ time: "2026-06-30", value: 4.33 }]);
    }
  });

  it("widens the window when days is provided", async () => {
    const now = new Date("2026-07-01T00:00:00Z");
    const rows: ReadonlyArray<MacroObservationRow> = [row("DFF", "2026-01-01", 4.1)];
    const readMacroObservations: ForReadingMacroObservations = async () => ok(rows);
    const getMacro = makeGetMacroUseCase({ readMacroObservations, now: () => now });

    const result = await getMacro({ days: 365 });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value["DFF"]).toEqual([{ time: "2026-01-01", value: 4.1 }]);
    }
  });

  it("filters to only the requested series", async () => {
    const rows: ReadonlyArray<MacroObservationRow> = [
      row("DFF", "2026-06-01", 4.33),
      row("VVIX", "2026-06-01", 89.0, "cboe"),
    ];
    const readMacroObservations: ForReadingMacroObservations = async () => ok(rows);
    const getMacro = makeGetMacroUseCase({
      readMacroObservations,
      now: () => new Date("2026-06-15T00:00:00Z"),
    });

    const result = await getMacro({ series: ["VVIX"] });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(Object.keys(result.value)).toEqual(["VVIX"]);
      expect(result.value["VVIX"]).toEqual([{ time: "2026-06-01", value: 89.0 }]);
    }
  });

  it("applies both days and series filters together", async () => {
    const now = new Date("2026-07-01T00:00:00Z");
    const rows: ReadonlyArray<MacroObservationRow> = [
      row("DFF", "2026-01-01", 4.1), // outside default 90d, inside 365d
      row("VVIX", "2026-01-01", 88.0, "cboe"),
    ];
    const readMacroObservations: ForReadingMacroObservations = async () => ok(rows);
    const getMacro = makeGetMacroUseCase({ readMacroObservations, now: () => now });

    const result = await getMacro({ days: 365, series: ["DFF"] });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(Object.keys(result.value)).toEqual(["DFF"]);
      expect(result.value["DFF"]).toEqual([{ time: "2026-01-01", value: 4.1 }]);
    }
  });

  it("propagates StorageError from the repo unchanged", async () => {
    const storageError: StorageError = { kind: "storage-error", message: "db down" };
    const readMacroObservations: ForReadingMacroObservations = async () => err(storageError);
    const getMacro = makeGetMacroUseCase({ readMacroObservations });

    const result = await getMacro();

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toEqual(storageError);
    }
  });
});
