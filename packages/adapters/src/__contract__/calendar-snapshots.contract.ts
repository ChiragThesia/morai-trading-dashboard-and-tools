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
  ForReadingCalendarSnapshotsForCycle,
  ForReadingLatestSnapshotTime,
  ForRecomputingSnapshotPnl,
  ForReadingLatestSnapshotPerOpenCalendarForJournal,
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
  /** 06-04: read the most recent snapshot cycle on or before a time (term-slope passthrough) */
  readonly readSnapshotsForCycle: ForReadingCalendarSnapshotsForCycle;
  /** 20-05: read MAX(time) across all calendar_snapshots rows (SNAP-01 cooldown ground truth) */
  readonly readLatestSnapshotTime: ForReadingLatestSnapshotTime;
  /** JRNL-01 pnl-unit-mismatch fix: re-derive pnl_open on every row from openNetDebit/qty */
  readonly recomputeSnapshotPnl: ForRecomputingSnapshotPnl;
  /** 26-03 (EXIT-02): latest calendar_snapshots row per open calendar, DISTINCT ON (calendar_id) */
  readonly readLatestSnapshotPerOpenCalendar: ForReadingLatestSnapshotPerOpenCalendarForJournal;
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
        // OPS-01: LegSnapshot.time must round-trip the real seeded timestamptz column —
        // proving the field maps the actual leg_observations.time, not a stub.
        expect(leg.time.getTime()).toBe(obsTime.getTime());
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
        // time round-trips the LATEST seeded row (t2), not the earlier t1.
        expect(leg.time.getTime()).toBe(t2.getTime());
      });
    });

    describe("readSnapshotsForCycle — current-cycle term-slope passthrough (06-04)", () => {
      it("returns the rows at the most recent snapshot time ≤ the cycle time", async () => {
        await seed.seedCalendar(CAL_ID);
        const t1 = new Date("2026-07-01T19:00:00Z");
        const t2 = new Date("2026-07-01T19:30:00Z");
        await repo.persistSnapshot(makeSnapshotRow(t1, CAL_ID, { termSlope: "0.04" }));
        await repo.persistSnapshot(makeSnapshotRow(t2, CAL_ID, { termSlope: "0.06" }));

        // Cycle time slightly after t2 → latest cycle is t2.
        const result = await repo.readSnapshotsForCycle(new Date("2026-07-01T19:31:00Z"));
        expect(result.ok).toBe(true);
        if (!result.ok) return;
        expect(result.value).toHaveLength(1);
        const row = result.value[0];
        expect(row).toBeDefined();
        if (row === undefined) return;
        expect(row.snapshotTime.getTime()).toBe(t2.getTime());
        // term_slope read THROUGH from the source — equals back_iv − front_iv (0.25 − 0.20).
        expect(row.termSlope).toBeCloseTo(0.06, 10);
        expect(row.frontIv).toBeCloseTo(0.2, 10);
        expect(row.backIv).toBeCloseTo(0.25, 10);
      });

      it("returns NaN termSlope for a continuity row (caller skips it)", async () => {
        await seed.seedCalendar(CAL_ID);
        const time = new Date("2026-07-01T20:00:00Z");
        await repo.persistSnapshot(makeNanSnapshotRow(time, CAL_ID));

        const result = await repo.readSnapshotsForCycle(new Date("2026-07-01T20:01:00Z"));
        expect(result.ok).toBe(true);
        if (!result.ok) return;
        const row = result.value[0];
        expect(row).toBeDefined();
        if (row === undefined) return;
        expect(Number.isNaN(row.termSlope)).toBe(true);
      });

      it("returns an empty array when no snapshot exists on or before the time", async () => {
        const result = await repo.readSnapshotsForCycle(new Date("2020-01-01T00:00:00Z"));
        expect(result.ok).toBe(true);
        if (!result.ok) return;
        expect(result.value).toEqual([]);
      });
    });

    describe("trigger provenance — round-trip (SNAP-01, D-12, 20-05)", () => {
      it("persists and reads back an 'event-move' trigger", async () => {
        await seed.seedCalendar(CAL_ID);
        const time = new Date("2026-07-01T19:00:00Z");
        await repo.persistSnapshot(makeSnapshotRow(time, CAL_ID, { trigger: "event-move" }));

        const result = await repo.readJournal(CAL_ID);
        expect(result.ok).toBe(true);
        if (!result.ok) return;
        const rows = result.value;
        expect(rows).not.toBeNull();
        if (rows === null) return;
        expect(rows[0]?.trigger).toBe("event-move");
      });

      it("persists and reads back a 'scheduled' trigger", async () => {
        await seed.seedCalendar(CAL_ID);
        const time = new Date("2026-07-01T19:30:00Z");
        await repo.persistSnapshot(makeSnapshotRow(time, CAL_ID, { trigger: "scheduled" }));

        const result = await repo.readJournal(CAL_ID);
        expect(result.ok).toBe(true);
        if (!result.ok) return;
        const rows = result.value;
        expect(rows).not.toBeNull();
        if (rows === null) return;
        expect(rows[0]?.trigger).toBe("scheduled");
      });

      it("reads a legacy/absent trigger as 'scheduled'", async () => {
        await seed.seedCalendar(CAL_ID);
        const time = new Date("2026-07-01T20:00:00Z");
        // No trigger override — makeSnapshotRow's default has no trigger key set.
        await repo.persistSnapshot(makeSnapshotRow(time, CAL_ID));

        const result = await repo.readJournal(CAL_ID);
        expect(result.ok).toBe(true);
        if (!result.ok) return;
        const rows = result.value;
        expect(rows).not.toBeNull();
        if (rows === null) return;
        expect(rows[0]?.trigger).toBe("scheduled");
      });
    });

    describe("readLatestSnapshotTime — MAX(time) cooldown ground truth (SNAP-01, Pattern 2, 20-05)", () => {
      it("returns null on a cold start (no snapshots at all)", async () => {
        const result = await repo.readLatestSnapshotTime();
        expect(result.ok).toBe(true);
        if (!result.ok) return;
        expect(result.value).toBeNull();
      });

      it("returns the max time across all calendars after inserts", async () => {
        await seed.seedCalendar(CAL_ID);
        await seed.seedCalendar(CAL_ID_EMPTY);
        const t1 = new Date("2026-07-01T19:00:00Z");
        const t2 = new Date("2026-07-01T19:30:00Z");
        const t3 = new Date("2026-07-01T20:00:00Z");

        await repo.persistSnapshot(makeSnapshotRow(t1, CAL_ID));
        await repo.persistSnapshot(makeSnapshotRow(t3, CAL_ID_EMPTY));
        await repo.persistSnapshot(makeSnapshotRow(t2, CAL_ID));

        const result = await repo.readLatestSnapshotTime();
        expect(result.ok).toBe(true);
        if (!result.ok) return;
        expect(result.value).not.toBeNull();
        expect(result.value?.getTime()).toBe(t3.getTime());
      });
    });

    describe("recomputeSnapshotPnl — JRNL-01 pnl-unit-mismatch data-correction path", () => {
      it("re-derives pnl_open on every row from the given openNetDebit/qty (D-05 formula)", async () => {
        await seed.seedCalendar(CAL_ID);
        const t1 = new Date("2026-07-01T19:00:00Z");
        const t2 = new Date("2026-07-01T19:30:00Z");
        // Both rows persisted with a STALE pnl_open (as if computed from the wrong-scale
        // openNetDebit=3235 $ instead of the corrected 32.35 pts) — mirrors the real bug.
        await repo.persistSnapshot(
          makeSnapshotRow(t1, CAL_ID, { netMark: "36.5", pnlOpen: "-319850" }),
        );
        await repo.persistSnapshot(
          makeSnapshotRow(t2, CAL_ID, { netMark: "40", pnlOpen: "-319500" }),
        );

        const result = await repo.recomputeSnapshotPnl(CAL_ID, 32.35, 1);
        expect(result.ok).toBe(true);
        if (!result.ok) return;
        expect(result.value.rowsUpdated).toBe(2);

        const journalResult = await repo.readJournal(CAL_ID);
        expect(journalResult.ok).toBe(true);
        if (!journalResult.ok) return;
        const rows = journalResult.value;
        expect(rows).not.toBeNull();
        if (rows === null) return;
        expect(rows).toHaveLength(2);
        // (36.5 - 32.35) * 1 * 100 = 415
        expect(parseFloat(rows[0]?.pnlOpen ?? "NaN")).toBeCloseTo(415, 5);
        // (40 - 32.35) * 1 * 100 = 765
        expect(parseFloat(rows[1]?.pnlOpen ?? "NaN")).toBeCloseTo(765, 5);
      });

      it("scales by qty (D-05: * qty * 100)", async () => {
        await seed.seedCalendar(CAL_ID);
        const t1 = new Date("2026-07-01T19:00:00Z");
        await repo.persistSnapshot(
          makeSnapshotRow(t1, CAL_ID, { netMark: "10", pnlOpen: "0" }),
        );

        const result = await repo.recomputeSnapshotPnl(CAL_ID, 5, 3);
        expect(result.ok).toBe(true);
        if (!result.ok) return;
        expect(result.value.rowsUpdated).toBe(1);

        const journalResult = await repo.readJournal(CAL_ID);
        expect(journalResult.ok).toBe(true);
        if (!journalResult.ok) return;
        const rows = journalResult.value;
        if (rows === null) return;
        // (10 - 5) * 3 * 100 = 1500
        expect(parseFloat(rows[0]?.pnlOpen ?? "NaN")).toBeCloseTo(1500, 5);
      });

      it("returns rowsUpdated: 0 (not an error) for a calendar with no snapshot rows", async () => {
        await seed.seedCalendar(CAL_ID_EMPTY);
        const result = await repo.recomputeSnapshotPnl(CAL_ID_EMPTY, 10, 1);
        expect(result.ok).toBe(true);
        if (!result.ok) return;
        expect(result.value.rowsUpdated).toBe(0);
      });

      it("does not touch a different calendar's rows", async () => {
        await seed.seedCalendar(CAL_ID);
        await seed.seedCalendar(CAL_ID_EMPTY);
        const t1 = new Date("2026-07-01T19:00:00Z");
        await repo.persistSnapshot(
          makeSnapshotRow(t1, CAL_ID, { netMark: "36.5", pnlOpen: "-319850" }),
        );
        await repo.persistSnapshot(
          makeSnapshotRow(t1, CAL_ID_EMPTY, { netMark: "36.5", pnlOpen: "-319850" }),
        );

        await repo.recomputeSnapshotPnl(CAL_ID, 32.35, 1);

        const otherResult = await repo.readJournal(CAL_ID_EMPTY);
        expect(otherResult.ok).toBe(true);
        if (!otherResult.ok) return;
        const otherRows = otherResult.value;
        if (otherRows === null) return;
        // Untouched: still the stale value.
        expect(parseFloat(otherRows[0]?.pnlOpen ?? "NaN")).toBeCloseTo(-319850, 5);
      });
    });

    describe("readLatestSnapshotPerOpenCalendar — per-open-calendar latest read (26-03, EXIT-02)", () => {
      it("returns the single most-recent row per calendar when multiple snapshots exist", async () => {
        await seed.seedCalendar(CAL_ID);
        const t1 = new Date("2026-07-01T19:00:00Z");
        const t2 = new Date("2026-07-01T19:30:00Z");
        await repo.persistSnapshot(makeSnapshotRow(t1, CAL_ID, { netMark: "10" }));
        await repo.persistSnapshot(makeSnapshotRow(t2, CAL_ID, { netMark: "20" }));

        const result = await repo.readLatestSnapshotPerOpenCalendar();
        expect(result.ok).toBe(true);
        if (!result.ok) return;
        const rowsForCal = result.value.filter((r) => r.calendarId === CAL_ID);
        expect(rowsForCal).toHaveLength(1);
        const row = rowsForCal[0];
        expect(row).toBeDefined();
        if (row === undefined) return;
        expect(row.snapshot.time.getTime()).toBe(t2.getTime());
        expect(row.snapshot.netMark).toBe("20");
      });

      it("Pitfall-1 regression: a calendar whose latest row is schwab_chain-sourced IS returned (never dropped)", async () => {
        const CAL_SCHWAB = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";
        const CAL_CBOE = "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee";
        await seed.seedCalendar(CAL_SCHWAB);
        await seed.seedCalendar(CAL_CBOE);
        // Distinct timestamps (green-suite lesson) — "latest" must be unambiguous.
        const tSchwab = new Date("2026-07-01T19:00:00Z");
        const tCboe = new Date("2026-07-01T19:05:00Z");
        await repo.persistSnapshot(
          makeSnapshotRow(tSchwab, CAL_SCHWAB, { source: "schwab_chain" }),
        );
        await repo.persistSnapshot(makeSnapshotRow(tCboe, CAL_CBOE, { source: "cboe" }));

        const result = await repo.readLatestSnapshotPerOpenCalendar();
        expect(result.ok).toBe(true);
        if (!result.ok) return;
        const bySource = new Map(result.value.map((r) => [r.calendarId, r]));

        // The regression: a naive readJournal/mapSnapshotRow reuse would silently drop
        // CAL_SCHWAB's row (source !== "cboe" guard) — both must be present here.
        expect(bySource.has(CAL_SCHWAB)).toBe(true);
        expect(bySource.has(CAL_CBOE)).toBe(true);
        expect(bySource.get(CAL_SCHWAB)?.snapshot.source).toBe("schwab_chain");
        expect(bySource.get(CAL_CBOE)?.snapshot.source).toBe("cboe");
      });

      it("a calendar with zero snapshot rows is absent from the result (not an error)", async () => {
        await seed.seedCalendar(CAL_ID_EMPTY);

        const result = await repo.readLatestSnapshotPerOpenCalendar();
        expect(result.ok).toBe(true);
        if (!result.ok) return;
        expect(result.value.some((r) => r.calendarId === CAL_ID_EMPTY)).toBe(false);
      });
    });
  });
}
