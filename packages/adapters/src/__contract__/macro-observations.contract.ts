import { describe, it, expect, beforeEach } from "vitest";
import type {
  ForPersistingMacroObservation,
  ForReadingMacroObservations,
  MacroObservationRow,
} from "@morai/core";

/**
 * Shared contract-test suite for the macro-observations persistence port.
 * Run against BOTH the Postgres adapter (testcontainers) and the in-memory twin.
 *
 * Asserts:
 * - insertMacroObservation writes a row; reading back returns it with the same
 *   seriesId/date/value/source.
 * - A second insert for the SAME (date, seriesId) with a DIFFERENT value REVISES
 *   the stored value (onConflictDoUpdate / replace-by-key) — MAC-01 idempotency:
 *   re-runs never duplicate but may update.
 * - readMacroObservations returns ALL rows across multiple series (no filtering).
 */

export type MacroObservationsRepo = {
  readonly insertMacroObservation: ForPersistingMacroObservation;
  readonly readMacroObservations: ForReadingMacroObservations;
};

function makeRow(overrides: Partial<MacroObservationRow> = {}): MacroObservationRow {
  return {
    seriesId: "VIXCLS",
    date: "2026-06-30",
    value: 18.9,
    source: "fred",
    ...overrides,
  };
}

export function runMacroObservationsContractTests(
  makeRepo: () => MacroObservationsRepo,
): void {
  describe("macro-observations persistence contract", () => {
    let repo: MacroObservationsRepo;

    beforeEach(() => {
      repo = makeRepo();
    });

    it("insertMacroObservation writes a row; reading back returns the same fields", async () => {
      const row = makeRow();
      const insertResult = await repo.insertMacroObservation(row);
      expect(insertResult.ok).toBe(true);

      const readResult = await repo.readMacroObservations();
      expect(readResult.ok).toBe(true);
      if (!readResult.ok) return;

      const found = readResult.value.find(
        (r) => r.seriesId === row.seriesId && r.date === row.date,
      );
      expect(found).toBeDefined();
      if (found === undefined) return;

      expect(found.seriesId).toBe(row.seriesId);
      expect(found.date).toBe(row.date);
      expect(found.value).toBe(row.value);
      expect(found.source).toBe(row.source);
    });

    it("a second insert for the SAME (date, seriesId) with a DIFFERENT value REVISES the stored value (upsert, MAC-01)", async () => {
      const row = makeRow({ seriesId: "DFF", date: "2026-06-30", value: 4.33 });
      const first = await repo.insertMacroObservation(row);
      expect(first.ok).toBe(true);

      const revised = makeRow({ seriesId: "DFF", date: "2026-06-30", value: 4.5 });
      const second = await repo.insertMacroObservation(revised);
      expect(second.ok).toBe(true);

      const readResult = await repo.readMacroObservations();
      expect(readResult.ok).toBe(true);
      if (!readResult.ok) return;

      const rowsForKey = readResult.value.filter(
        (r) => r.seriesId === "DFF" && r.date === "2026-06-30",
      );
      // Exactly ONE row — upsert revises, never duplicates
      expect(rowsForKey).toHaveLength(1);
      const found = rowsForKey.at(0);
      expect(found).toBeDefined();
      if (found === undefined) return;
      // Revised to the new value, not the original
      expect(found.value).toBe(4.5);
    });

    it("readMacroObservations returns ALL rows across multiple series (no filtering)", async () => {
      await repo.insertMacroObservation(
        makeRow({ seriesId: "DFF", date: "2026-06-30", value: 4.33 }),
      );
      await repo.insertMacroObservation(
        makeRow({ seriesId: "VIXCLS", date: "2026-06-30", value: 18.9 }),
      );
      await repo.insertMacroObservation(
        makeRow({ seriesId: "VVIX", date: "2026-06-30", value: 89.0, source: "cboe" }),
      );
      // VXVCLS (VIX3M, Phase 23/MACRO-01) — no DB enum, series is a text column, so an
      // id absent from the contracts enum still inserts+reads cleanly (no migration).
      await repo.insertMacroObservation(
        makeRow({ seriesId: "VXVCLS", date: "2026-06-30", value: 19.01 }),
      );
      // BAMLH0A0HYM2 (HY OAS, Phase 24/MACRO-02) — same text-column parity: a new series id
      // inserts+reads cleanly with zero migration (docs/architecture/regime-board.md).
      await repo.insertMacroObservation(
        makeRow({ seriesId: "BAMLH0A0HYM2", date: "2026-06-30", value: 2.67 }),
      );

      const readResult = await repo.readMacroObservations();
      expect(readResult.ok).toBe(true);
      if (!readResult.ok) return;

      const seriesIds = new Set(readResult.value.map((r) => r.seriesId));
      expect(seriesIds.has("DFF")).toBe(true);
      expect(seriesIds.has("VIXCLS")).toBe(true);
      expect(seriesIds.has("VVIX")).toBe(true);
      expect(seriesIds.has("VXVCLS")).toBe(true);
      expect(seriesIds.has("BAMLH0A0HYM2")).toBe(true);
    });

    it("readMacroObservations returns empty array when no rows exist", async () => {
      const readResult = await repo.readMacroObservations();
      expect(readResult.ok).toBe(true);
      if (!readResult.ok) return;
      expect(readResult.value).toEqual([]);
    });
  });
}
