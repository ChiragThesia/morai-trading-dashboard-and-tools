/**
 * Shared contract-test suite for the calendar-snapshots persistence ports.
 * Run this suite against the Postgres adapter (testcontainers).
 *
 * Asserts:
 * - persistSnapshot: insert → one row
 * - persistSnapshot idempotency: double-insert same (time, calendarId) → one row
 * - readJournal: returns rows ordered by time ASC
 * - readJournal: unknown calendarId → null (drives 404 in Postgres; may be [] in memory)
 * - readJournal: known calendarId with no rows → empty array
 * - resolveLegSnapshot: hit → LegSnapshot with bsm* fields
 * - resolveLegSnapshot: unknown contract → null
 * - resolveLegSnapshot: known contract, no observation → null
 * - 'NaN' string in numeric columns inserts cleanly (D-06 / T-03-13)
 */

import { describe, it, expect, beforeEach } from "vitest";
import type {
  ForPersistingSnapshot,
  ForReadingJournal,
  ForResolvingLegSnapshot,
  SnapshotRow,
  LegSnapshot,
  StorageError,
} from "@morai/core";
import type { OccSymbol } from "@morai/shared";
import { formatOccSymbol } from "@morai/shared";

// ─── Repo type ────────────────────────────────────────────────────────────────

export type CalendarSnapshotsRepo = {
  readonly persistSnapshot: ForPersistingSnapshot;
  readonly readJournal: ForReadingJournal;
  readonly resolveLegSnapshot: ForResolvingLegSnapshot;
  /** Count rows in calendar_snapshots for the given calendarId */
  readonly countSnapshots: (calendarId: string) => Promise<number>;
};

// ─── Fixtures ────────────────────────────────────────────────────────────────

const CAL_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const CAL_ID_EMPTY = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const CAL_ID_UNKNOWN = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";

function makeSnapshotRow(time: Date, calendarId: string, overrides: Partial<SnapshotRow> = {}): SnapshotRow {
  return {
    time,
    calendarId,
    spot: "5000",
    netMark: "15",
    frontMark: "10",
    backMark: "25",
    frontIv: "0.20",
    backIv: "0.25",
    frontIvRaw: "0.19",
    backIvRaw: "0.24",
    netDelta: "30",
    netGamma: "0.6",
    netTheta: "-360",
    netVega: "1240",
    termSlope: "0.05",
    dteFront: 17,
    dteBack: 80,
    pnlOpen: "2000",
    source: "cboe",
    ...overrides,
  };
}

function makeNanSnapshotRow(time: Date, calendarId: string): SnapshotRow {
  return makeSnapshotRow(time, calendarId, {
    frontIv: "NaN",
    backIv: "0.25",
    frontIvRaw: "NaN",
    netDelta: "NaN",
    netGamma: "NaN",
    netTheta: "NaN",
    netVega: "NaN",
    termSlope: "NaN",
  });
}

// ─── Seed helpers (provided by each contract test file) ───────────────────────

type SeedContext = {
  /** Seed a calendar row into the calendars table (needed for readJournal FK) */
  seedCalendar: (id: string) => Promise<void>;
  /** Seed a contract row into contracts table */
  seedContract: (occ: OccSymbol, strike: number, expiration: string, optionType: "C" | "P") => Promise<void>;
  /** Seed a leg_observation row for a contract */
  seedObservation: (
    occ: OccSymbol,
    time: Date,
    mark: number,
    underlyingPrice: number,
    bsmIv: string | null,
    bsmDelta: string | null,
    bsmGamma: string | null,
    bsmTheta: string | null,
    bsmVega: string | null,
    ivRaw: number | null,
  ) => Promise<void>;
};

// ─── Contract test suite ──────────────────────────────────────────────────────

export function runCalendarSnapshotsContractTests(
  makeRepo: (seed: SeedContext) => CalendarSnapshotsRepo,
  getSeedContext: () => SeedContext,
): void {
  describe("calendar-snapshots persistence contract", () => {
    let repo: CalendarSnapshotsRepo;
    let seed: SeedContext;

    beforeEach(() => {
      seed = getSeedContext();
      repo = makeRepo(seed);
    });

    describe("persistSnapshot — idempotency", () => {
      it("inserts one row on first persist", async () => {
        await seed.seedCalendar(CAL_ID);
        const time = new Date("2026-07-01T19:00:00Z");
        const row = makeSnapshotRow(time, CAL_ID);

        const result = await repo.persistSnapshot(row);
        expect(result.ok).toBe(true);

        const count = await repo.countSnapshots(CAL_ID);
        expect(count).toBe(1);
      });

      it("re-inserting the same (time, calendarId) is a no-op — exactly one row", async () => {
        await seed.seedCalendar(CAL_ID);
        const time = new Date("2026-07-01T19:30:00Z");
        const row = makeSnapshotRow(time, CAL_ID);

        await repo.persistSnapshot(row);
        await repo.persistSnapshot(row); // second call — idempotent

        const count = await repo.countSnapshots(CAL_ID);
        expect(count).toBe(1);
      });

      it("different time for same calendarId inserts two rows", async () => {
        await seed.seedCalendar(CAL_ID);
        const t1 = new Date("2026-07-01T19:00:00Z");
        const t2 = new Date("2026-07-01T19:30:00Z");

        await repo.persistSnapshot(makeSnapshotRow(t1, CAL_ID));
        await repo.persistSnapshot(makeSnapshotRow(t2, CAL_ID));

        const count = await repo.countSnapshots(CAL_ID);
        expect(count).toBe(2);
      });
    });

    describe("persistSnapshot — NaN string columns (T-03-13, D-06)", () => {
      it("inserts a row with 'NaN' in numeric columns without error", async () => {
        await seed.seedCalendar(CAL_ID);
        const time = new Date("2026-07-01T20:00:00Z");
        const nanRow = makeNanSnapshotRow(time, CAL_ID);

        const result = await repo.persistSnapshot(nanRow);
        expect(result.ok).toBe(true);

        const count = await repo.countSnapshots(CAL_ID);
        expect(count).toBe(1);
      });
    });

    describe("readJournal — ordering and null semantics", () => {
      it("returns rows ordered by time ASC for a known calendarId", async () => {
        await seed.seedCalendar(CAL_ID);
        const t1 = new Date("2026-07-01T19:00:00Z");
        const t2 = new Date("2026-07-01T19:30:00Z");
        const t3 = new Date("2026-07-01T20:00:00Z");

        // Insert out of order
        await repo.persistSnapshot(makeSnapshotRow(t3, CAL_ID));
        await repo.persistSnapshot(makeSnapshotRow(t1, CAL_ID));
        await repo.persistSnapshot(makeSnapshotRow(t2, CAL_ID));

        const result = await repo.readJournal(CAL_ID);
        expect(result.ok).toBe(true);
        if (!result.ok) return;
        const rows = result.value;
        // Must be non-null (calendar exists)
        expect(rows).not.toBeNull();
        if (rows === null) return;

        expect(rows).toHaveLength(3);
        expect(rows[0]?.time.getTime()).toBeLessThan(rows[1]?.time.getTime() ?? 0);
        expect(rows[1]?.time.getTime()).toBeLessThan(rows[2]?.time.getTime() ?? 0);
      });

      it("returns empty array for a known calendarId with no snapshots", async () => {
        await seed.seedCalendar(CAL_ID_EMPTY);

        const result = await repo.readJournal(CAL_ID_EMPTY);
        expect(result.ok).toBe(true);
        if (!result.ok) return;
        const rows = result.value;
        // Known calendar, no rows → empty array (not null)
        expect(rows).not.toBeNull();
        expect(rows).toHaveLength(0);
      });

      it("returns null for an unknown calendarId (drives 404)", async () => {
        const result = await repo.readJournal(CAL_ID_UNKNOWN);
        expect(result.ok).toBe(true);
        if (!result.ok) return;
        expect(result.value).toBeNull();
      });
    });

    describe("resolveLegSnapshot — hit/miss semantics", () => {
      it("returns null when no matching contract exists", async () => {
        const result = await repo.resolveLegSnapshot({
          underlying: "SPX",
          strike: 5000000,
          optionType: "C",
          expiry: "2026-07-18",
        });
        expect(result.ok).toBe(true);
        if (!result.ok) return;
        expect(result.value).toBeNull();
      });

      it("returns null when contract exists but no leg_observation", async () => {
        // Strike 5000 → ×1000 = 5000000
        const occ = formatOccSymbol({
          root: "SPX",
          expiry: new Date("2026-07-18T12:00:00Z"),
          type: "C",
          strike: 5000,
        });
        await seed.seedContract(occ, 5000000, "2026-07-18", "C");

        const result = await repo.resolveLegSnapshot({
          underlying: "SPX",
          strike: 5000000,
          optionType: "C",
          expiry: "2026-07-18",
        });
        expect(result.ok).toBe(true);
        if (!result.ok) return;
        expect(result.value).toBeNull();
      });

      it("returns LegSnapshot with bsm* fields when observation exists", async () => {
        const occ = formatOccSymbol({
          root: "SPX",
          expiry: new Date("2026-07-18T12:00:00Z"),
          type: "C",
          strike: 5000,
        });
        const obsTime = new Date("2026-07-01T19:00:00Z");
        await seed.seedContract(occ, 5000000, "2026-07-18", "C");
        await seed.seedObservation(
          occ, obsTime,
          20.0,    // mark
          5010.0,  // underlyingPrice
          "0.22",  // bsmIv
          "0.55",  // bsmDelta
          "0.003", // bsmGamma
          "-1.8",  // bsmTheta
          "6.2",   // bsmVega
          0.21,    // ivRaw
        );

        const result = await repo.resolveLegSnapshot({
          underlying: "SPX",
          strike: 5000000,
          optionType: "C",
          expiry: "2026-07-18",
        });
        expect(result.ok).toBe(true);
        if (!result.ok) return;
        // result.value is LegSnapshot | null — guard handles the null case
        const legOrNull = result.value;
        expect(legOrNull).not.toBeNull();
        if (legOrNull === null) return;
        const leg: LegSnapshot = legOrNull;
        expect(leg.mark).toBeCloseTo(20.0, 2);
        expect(leg.underlyingPrice).toBeCloseTo(5010.0, 2);
        expect(leg.bsmIv).toBe("0.22");
        expect(leg.bsmDelta).toBe("0.55");
        expect(leg.ivRaw).toBeCloseTo(0.21, 4);
      });

      it("returns the LATEST observation when multiple exist (ORDER BY time DESC LIMIT 1)", async () => {
        const occ = formatOccSymbol({
          root: "SPX",
          expiry: new Date("2026-09-19T12:00:00Z"),
          type: "C",
          strike: 5000,
        });
        const t1 = new Date("2026-07-01T19:00:00Z");
        const t2 = new Date("2026-07-01T19:30:00Z");
        await seed.seedContract(occ, 5000000, "2026-09-19", "C");
        await seed.seedObservation(occ, t1, 18.0, 5000.0, "0.20", null, null, null, null, null);
        await seed.seedObservation(occ, t2, 22.0, 5010.0, "0.23", "0.56", "0.003", "-1.9", "6.5", 0.22);

        const result = await repo.resolveLegSnapshot({
          underlying: "SPX",
          strike: 5000000,
          optionType: "C",
          expiry: "2026-09-19",
        });
        expect(result.ok).toBe(true);
        if (!result.ok) return;
        const leg2OrNull = result.value;
        if (leg2OrNull === null) throw new Error("expected LegSnapshot but got null");
        const leg: LegSnapshot = leg2OrNull;
        // Should return the t2 observation (mark=22.0, the latest)
        expect(leg.mark).toBeCloseTo(22.0, 2);
        expect(leg.bsmIv).toBe("0.23");
      });
    });
  });
}
