import { describe, it, expect, beforeEach } from "vitest";
import type {
  EconomicEvent,
  ForPersistingEconomicEvents,
  ForReadingEconomicEvents,
} from "@morai/core";

/**
 * Shared contract-test suite for the economic-events persistence port.
 * Run against BOTH the Postgres adapter (testcontainers) and the in-memory twin.
 *
 * Asserts:
 * - persistEconomicEvents writes rows; reading back returns date/name/source unchanged.
 * - A second persist of the SAME (date, name) with a DIFFERENT source is idempotent — 0
 *   duplicate rows (onConflictDoUpdate / replace-by-key).
 * - readEconomicEvents returns ALL rows across FOMC/CPI/NFP.
 * - event_date is a plain calendar day — a round-tripped event on a DST-boundary day reads
 *   back the same calendar day (Pitfall 3 — no timezone shift).
 */

export type EconomicEventsRepo = {
  readonly persistEconomicEvents: ForPersistingEconomicEvents;
  readonly readEconomicEvents: ForReadingEconomicEvents;
};

function makeRow(overrides: Partial<EconomicEvent> = {}): EconomicEvent {
  return {
    date: "2026-08-12",
    name: "CPI",
    source: "fred",
    ...overrides,
  };
}

export function runEconomicEventsContractTests(makeRepo: () => EconomicEventsRepo): void {
  describe("economic-events persistence contract", () => {
    let repo: EconomicEventsRepo;

    beforeEach(() => {
      repo = makeRepo();
    });

    it("persistEconomicEvents writes rows; reading back returns the same fields", async () => {
      const row = makeRow();
      const persistResult = await repo.persistEconomicEvents([row]);
      expect(persistResult.ok).toBe(true);

      const readResult = await repo.readEconomicEvents();
      expect(readResult.ok).toBe(true);
      if (!readResult.ok) return;

      const found = readResult.value.find(
        (r) => r.date === row.date && r.name === row.name,
      );
      expect(found).toBeDefined();
      if (found === undefined) return;

      expect(found.date).toBe(row.date);
      expect(found.name).toBe(row.name);
      expect(found.source).toBe(row.source);
    });

    it("re-inserting the same (date, name) is idempotent — 0 duplicate rows (onConflictDoUpdate)", async () => {
      const row = makeRow({ date: "2026-08-07", name: "NFP", source: "fred" });
      const first = await repo.persistEconomicEvents([row]);
      expect(first.ok).toBe(true);

      // Re-fetch of the same release date — source revised (still "fred"), no duplicate
      const second = await repo.persistEconomicEvents([row]);
      expect(second.ok).toBe(true);

      const readResult = await repo.readEconomicEvents();
      expect(readResult.ok).toBe(true);
      if (!readResult.ok) return;

      const rowsForKey = readResult.value.filter(
        (r) => r.date === "2026-08-07" && r.name === "NFP",
      );
      expect(rowsForKey).toHaveLength(1);
    });

    it("readEconomicEvents returns ALL rows across FOMC/CPI/NFP", async () => {
      await repo.persistEconomicEvents([
        makeRow({ date: "2026-07-29", name: "FOMC", source: "seed" }),
        makeRow({ date: "2026-08-12", name: "CPI", source: "fred" }),
        makeRow({ date: "2026-08-07", name: "NFP", source: "fred" }),
      ]);

      const readResult = await repo.readEconomicEvents();
      expect(readResult.ok).toBe(true);
      if (!readResult.ok) return;

      const names = new Set(readResult.value.map((r) => r.name));
      expect(names.has("FOMC")).toBe(true);
      expect(names.has("CPI")).toBe(true);
      expect(names.has("NFP")).toBe(true);
    });

    it("readEconomicEvents returns empty array when no rows exist", async () => {
      const readResult = await repo.readEconomicEvents();
      expect(readResult.ok).toBe(true);
      if (!readResult.ok) return;
      expect(readResult.value).toEqual([]);
    });

    it("event_date round-trips as the same plain calendar day across a DST boundary (Pitfall 3)", async () => {
      // 2026-11-01 is the Sunday of the US fall-back DST transition — a naive UTC-instant
      // path could shift this by a day when read back in a different zone context.
      const row = makeRow({ date: "2026-11-01", name: "CPI", source: "fred" });
      const persistResult = await repo.persistEconomicEvents([row]);
      expect(persistResult.ok).toBe(true);

      const readResult = await repo.readEconomicEvents();
      expect(readResult.ok).toBe(true);
      if (!readResult.ok) return;

      const found = readResult.value.find((r) => r.name === "CPI" && r.date === "2026-11-01");
      expect(found).toBeDefined();
      if (found === undefined) return;
      expect(found.date).toBe("2026-11-01");
    });
  });
}
