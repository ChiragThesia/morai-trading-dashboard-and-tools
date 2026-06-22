import { describe, it, expect, beforeEach } from "vitest";
import type {
  ForWritingTermStructureObservations,
  ForReadingTermStructureSeries,
  TermStructureObservationRow,
} from "@morai/core";

/**
 * Shared contract-test suite for the term-structure-observations persistence ports.
 * Run against BOTH the in-memory twin (always) and the Postgres adapter (testcontainers).
 *
 * Asserts (ANLY-02 / SPEC R3):
 * - storeTermStructureObservations: write N fresh rows → count N
 * - idempotency: re-writing the SAME (snapshot_time, calendar_id) grain → count still N (0 new)
 * - readTermStructureSeries: rows ordered by snapshot_time ASC
 * - readTermStructureSeries({calendarId}): filters to that calendar
 * - readTermStructureSeries: empty array (never null) when no rows
 * - value round-trips EXACTLY (numeric string ↔ number) so the term_slope equality
 *   (= back_iv − front_iv) cannot drift through the repo (T-06-07)
 */

export type TermStructureObservationsRepo = {
  readonly storeTermStructureObservations: ForWritingTermStructureObservations;
  readonly readTermStructureSeries: ForReadingTermStructureSeries;
  /** Count rows in term_structure_observations (optionally for one calendarId) */
  readonly countObservations: (calendarId?: string) => Promise<number>;
};

// ─── Fixtures ────────────────────────────────────────────────────────────────

const CAL_A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const CAL_B = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";

function makeRow(
  snapshotTime: Date,
  calendarId: string,
  overrides: Partial<TermStructureObservationRow> = {},
): TermStructureObservationRow {
  const frontIv = overrides.frontIv ?? 0.2;
  const backIv = overrides.backIv ?? 0.25;
  return {
    snapshotTime,
    calendarId,
    // value = back_iv − front_iv, passed through from calendar_snapshots.term_slope
    value: overrides.value ?? backIv - frontIv,
    frontIv,
    backIv,
  };
}

// ─── Seed context (provided by each contract test file) ───────────────────────

export type TermStructureSeedContext = {
  /** Seed a calendar row so the FK on term_structure_observations.calendar_id resolves */
  seedCalendar: (id: string) => Promise<void>;
};

// ─── Contract test suite ──────────────────────────────────────────────────────

export function runTermStructureContractTests(
  makeRepo: (seed: TermStructureSeedContext) => TermStructureObservationsRepo,
  getSeedContext: () => TermStructureSeedContext,
): void {
  describe("term-structure-observations persistence contract", () => {
    let repo: TermStructureObservationsRepo;
    let seed: TermStructureSeedContext;

    beforeEach(async () => {
      seed = getSeedContext();
      repo = makeRepo(seed);
      await seed.seedCalendar(CAL_A);
      await seed.seedCalendar(CAL_B);
    });

    describe("storeTermStructureObservations — write + idempotency", () => {
      it("writing N fresh rows writes exactly N rows", async () => {
        const t = new Date("2026-07-01T19:00:00Z");
        const rows = [
          makeRow(t, CAL_A, { frontIv: 0.2, backIv: 0.25 }),
          makeRow(t, CAL_B, { frontIv: 0.18, backIv: 0.3 }),
        ];

        const result = await repo.storeTermStructureObservations(rows);
        expect(result.ok).toBe(true);

        const count = await repo.countObservations();
        expect(count).toBe(2);
      });

      it("re-writing the same (snapshot_time, calendar_id) grain adds 0 new rows", async () => {
        const t = new Date("2026-07-01T19:30:00Z");
        const rows = [makeRow(t, CAL_A), makeRow(t, CAL_B)];

        await repo.storeTermStructureObservations(rows);
        await repo.storeTermStructureObservations(rows); // identical re-run

        const count = await repo.countObservations();
        expect(count).toBe(2); // idempotent — no duplicates
      });

      it("different snapshot times for the same calendar write distinct rows", async () => {
        const t1 = new Date("2026-07-01T19:00:00Z");
        const t2 = new Date("2026-07-01T19:30:00Z");

        await repo.storeTermStructureObservations([makeRow(t1, CAL_A)]);
        await repo.storeTermStructureObservations([makeRow(t2, CAL_A)]);

        const count = await repo.countObservations(CAL_A);
        expect(count).toBe(2);
      });
    });

    describe("readTermStructureSeries — ordering, filter, value round-trip", () => {
      it("returns rows ordered by snapshot_time ASC", async () => {
        const t1 = new Date("2026-07-01T19:00:00Z");
        const t2 = new Date("2026-07-01T19:30:00Z");
        const t3 = new Date("2026-07-01T20:00:00Z");

        // Insert out of order
        await repo.storeTermStructureObservations([makeRow(t3, CAL_A)]);
        await repo.storeTermStructureObservations([makeRow(t1, CAL_A)]);
        await repo.storeTermStructureObservations([makeRow(t2, CAL_A)]);

        const result = await repo.readTermStructureSeries({ calendarId: CAL_A });
        expect(result.ok).toBe(true);
        if (!result.ok) return;
        const series = result.value;
        expect(series).toHaveLength(3);
        expect(series[0]?.snapshotTime.getTime()).toBeLessThan(
          series[1]?.snapshotTime.getTime() ?? 0,
        );
        expect(series[1]?.snapshotTime.getTime()).toBeLessThan(
          series[2]?.snapshotTime.getTime() ?? 0,
        );
      });

      it("filters by calendarId when provided", async () => {
        const t = new Date("2026-07-01T19:00:00Z");
        await repo.storeTermStructureObservations([
          makeRow(t, CAL_A),
          makeRow(t, CAL_B),
        ]);

        const result = await repo.readTermStructureSeries({ calendarId: CAL_B });
        expect(result.ok).toBe(true);
        if (!result.ok) return;
        expect(result.value).toHaveLength(1);
        expect(result.value[0]?.calendarId).toBe(CAL_B);
      });

      it("returns an empty array (not null/error) when no rows exist", async () => {
        const result = await repo.readTermStructureSeries({});
        expect(result.ok).toBe(true);
        if (!result.ok) return;
        expect(result.value).toEqual([]);
      });

      it("round-trips the value EXACTLY (no term_slope drift through the repo)", async () => {
        const t = new Date("2026-07-01T19:00:00Z");
        // A value with enough precision to catch any float↔string corruption.
        const frontIv = 0.1875;
        const backIv = 0.2625;
        const exactValue = backIv - frontIv; // 0.075
        await repo.storeTermStructureObservations([
          makeRow(t, CAL_A, { frontIv, backIv, value: exactValue }),
        ]);

        const result = await repo.readTermStructureSeries({ calendarId: CAL_A });
        expect(result.ok).toBe(true);
        if (!result.ok) return;
        const row = result.value[0];
        expect(row).toBeDefined();
        if (row === undefined) return;
        // T-06-07: the written value must come back bit-for-equal — no recompute, no rounding.
        expect(row.value).toBe(exactValue);
        expect(row.frontIv).toBe(frontIv);
        expect(row.backIv).toBe(backIv);
      });
    });
  });
}
