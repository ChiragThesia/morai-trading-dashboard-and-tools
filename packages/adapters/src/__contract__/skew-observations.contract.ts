import { describe, it, expect, beforeEach } from "vitest";
import type {
  ForWritingSkewObservations,
  ForReadingSkewSmileDetail,
  SkewObservationRow,
} from "@morai/core";

/**
 * Shared contract-test suite for the skew-observations persistence port (per-strike smile).
 * Run against BOTH the in-memory twin (always) and the Postgres adapter (testcontainers).
 *
 * Asserts (ANLY-01 R1):
 * - storeSkewObservations: write N fresh rows → count N
 * - idempotency: re-writing the SAME (snapshot_time, underlying, expiration, strike) grain →
 *   count still N (0 new) — onConflictDoNothing
 * - readSkewSeries: rows ordered by snapshot_time ASC; optional underlying/expiration filter
 * - readSkewSeries: empty array (never null) when no rows
 * - iv/delta/moneyness round-trip; nullable delta/moneyness survive as null
 *
 * The skew table holds per-strike smile detail; the headline read surface uses risk-reversal.
 * readSkewSmileDetail returns SkewObservationRow rows — the per-strike smile points.
 */

export type SkewObservationsRepo = {
  readonly storeSkewObservations: ForWritingSkewObservations;
  readonly readSkewSmileDetail: ForReadingSkewSmileDetail;
  /** Count rows in skew_observations (optionally for one underlying) */
  readonly countObservations: (underlying?: string) => Promise<number>;
};

// ─── Fixtures ────────────────────────────────────────────────────────────────

const UNDERLYING = "SPX";
const EXPIRY = "2026-07-17";

function makeRow(
  snapshotTime: Date,
  strike: number,
  overrides: Partial<SkewObservationRow> = {},
): SkewObservationRow {
  // Use `in` so explicit null overrides survive (?? would replace null with the default).
  return {
    snapshotTime,
    underlying: overrides.underlying ?? UNDERLYING,
    expiration: overrides.expiration ?? EXPIRY,
    strike,
    root: overrides.root ?? "SPXW",
    // Defaults to the put wing so it agrees with the default delta of −0.25 below: a fixture
    // whose sign and type disagree would be a contract that cannot exist.
    contractType: overrides.contractType ?? "P",
    iv: overrides.iv ?? 0.2,
    delta: "delta" in overrides ? (overrides.delta ?? null) : -0.25,
    moneyness: "moneyness" in overrides ? (overrides.moneyness ?? null) : 0.98,
  };
}

// ─── Seed context (skew rows have no FK; seedNoop keeps parity with term-structure) ──

export type SkewSeedContext = {
  seedNoop: () => Promise<void>;
};

// ─── Contract test suite ──────────────────────────────────────────────────────

export function runSkewContractTests(
  makeRepo: (seed: SkewSeedContext) => SkewObservationsRepo,
  getSeedContext: () => SkewSeedContext,
): void {
  /**
   * REGRESSION (measured on production, 2026-07-28). The PK was
   * (snapshot_time, underlying, expiration, strike) with NO root, and `underlying` is always the
   * literal 'SPX'. SPX (AM-settled third-Friday monthlies) and SPXW (PM-settled weeklies) quote
   * the SAME strike on the SAME date with DIFFERENT books, so the two collide on that key and
   * `onConflictDoNothing` silently discards one of them -- arbitrarily, whichever the batch
   * ordered second.
   *
   * Measured on one live cycle: 709 colliding keys against 1,632 rows actually stored. Roughly
   * 30% of every skew snapshot was being thrown away, and had been for the life of the table.
   * This is the only per-strike IV history the project has, and it is the dataset the v2
   * percentile gates are waiting to accumulate -- so it was accumulating 30% wrong.
   *
   * Same failure mode as the contracts upsert outage the day before: a conflict clause papering
   * over a key that cannot distinguish two real rows.
   */
  describe("skew-observations: SPX and SPXW are different books", () => {
    let repo: SkewObservationsRepo;

    beforeEach(async () => {
      const seed = getSeedContext();
      repo = makeRepo(seed);
      await seed.seedNoop();
    });

    it("keeps BOTH roots at the same snapshot, expiration and strike", async () => {
      const t = new Date("2026-07-28T15:00:00.000Z");
      // The exact collision: identical on every old PK column, different book, different IV.
      const spx = makeRow(t, 7_400_000, { root: "SPX", iv: 0.2469 });
      const spxw = makeRow(t, 7_400_000, { root: "SPXW", iv: 0.1712 });

      const result = await repo.storeSkewObservations([spx, spxw]);
      expect(result.ok).toBe(true);
      expect(await repo.countObservations(UNDERLYING)).toBe(2);

      const read = await repo.readSkewSmileDetail(UNDERLYING, EXPIRY);
      expect(read.ok).toBe(true);
      if (!read.ok) return;
      const roots = read.value.map((r) => r.root).sort();
      expect(roots).toStrictEqual(["SPX", "SPXW"]);
      // And each keeps its OWN implied vol -- the whole point of separating the books.
      expect(read.value.find((r) => r.root === "SPX")?.iv).toBeCloseTo(0.2469, 9);
      expect(read.value.find((r) => r.root === "SPXW")?.iv).toBeCloseTo(0.1712, 9);
    });

    it("still treats a re-write of the SAME root as idempotent", async () => {
      const t = new Date("2026-07-28T15:00:00.000Z");
      const row = makeRow(t, 7_400_000, { root: "SPX", iv: 0.2469 });
      await repo.storeSkewObservations([row]);
      await repo.storeSkewObservations([row]);
      expect(await repo.countObservations(UNDERLYING)).toBe(1);
    });
  });

  /**
   * REGRESSION (measured on production, 2026-07-28). 0029 added `root` to this key and stopped
   * one column short: the key stayed
   * (snapshot_time, underlying, root, expiration, strike) with NO contract_type.
   *
   * readSmile emits one quote per SOLVED LEG, so it emits the CALL and the PUT at every strike --
   * two different contracts, identical on every one of those five columns. They collide inside a
   * SINGLE batch, where `onConflictDoNothing` discards one. No error, no metric.
   *
   * Measured on the live cohort behind snapshot_time 2026-07-28T14:00:00Z: 3,521 quotes, 1,773
   * distinct values of the old key, 3,521 distinct once contract_type joins it -- so the column
   * resolves the collision completely, with nothing left over. The table holds exactly 1,773 rows
   * for that stamp: 1,748 of them (49.6%) were thrown away in one call.
   *
   * Which wing survived is whichever the join emitted first -- a query plan, not a rule. Lifetime
   * that left 9,479 calls against 903 puts, and the owner trades PUT calendars.
   *
   * A dedupe in the repo would NOT fix this. These are not duplicate rows; they are the two wings
   * of one smile, and dropping either is the data loss, however deterministically it is chosen.
   */
  describe("skew-observations: the call and the put at one strike are two contracts", () => {
    let repo: SkewObservationsRepo;

    beforeEach(async () => {
      const seed = getSeedContext();
      repo = makeRepo(seed);
      await seed.seedNoop();
    });

    it("keeps BOTH wings at the same snapshot, root, expiration and strike", async () => {
      const t = new Date("2026-07-28T14:00:00.000Z");
      // The exact collision: identical on every column of the 0029 key, opposite wings.
      const call = makeRow(t, 7_400_000, { contractType: "C", delta: 0.31, iv: 0.1712 });
      const put = makeRow(t, 7_400_000, { contractType: "P", delta: -0.29, iv: 0.2469 });

      const result = await repo.storeSkewObservations([call, put]);
      expect(result.ok).toBe(true);
      expect(await repo.countObservations(UNDERLYING)).toBe(2);

      const read = await repo.readSkewSmileDetail({
        underlying: UNDERLYING,
        expiration: EXPIRY,
      });
      expect(read.ok).toBe(true);
      if (!read.ok) return;
      const types = read.value.map((r) => r.contractType).sort();
      expect(types).toStrictEqual(["C", "P"]);
      // Each wing keeps its OWN vol -- half a smile cannot bracket ±25Δ.
      expect(read.value.find((r) => r.contractType === "C")?.iv).toBeCloseTo(0.1712, 9);
      expect(read.value.find((r) => r.contractType === "P")?.iv).toBeCloseTo(0.2469, 9);
    });

    it("still treats a re-write of the SAME wing as idempotent", async () => {
      const t = new Date("2026-07-28T14:00:00.000Z");
      const row = makeRow(t, 7_400_000, { contractType: "C", delta: 0.31, iv: 0.1712 });
      await repo.storeSkewObservations([row]);
      await repo.storeSkewObservations([row]);
      expect(await repo.countObservations(UNDERLYING)).toBe(1);
    });
  });

  describe("skew-observations persistence contract", () => {
    let repo: SkewObservationsRepo;

    beforeEach(async () => {
      const seed = getSeedContext();
      repo = makeRepo(seed);
      await seed.seedNoop();
    });

    describe("storeSkewObservations — write + idempotency", () => {
      it("writing N fresh rows writes exactly N rows", async () => {
        const t = new Date("2026-07-01T19:00:00Z");
        const rows = [
          makeRow(t, 5300000, { delta: -0.35 }),
          makeRow(t, 5400000, { delta: -0.2 }),
          makeRow(t, 5600000, { delta: 0.2 }),
        ];

        const result = await repo.storeSkewObservations(rows);
        expect(result.ok).toBe(true);

        const count = await repo.countObservations();
        expect(count).toBe(3);
      });

      it("re-writing the same per-grain rows adds 0 new rows (idempotent)", async () => {
        const t = new Date("2026-07-01T19:30:00Z");
        const rows = [makeRow(t, 5300000), makeRow(t, 5400000)];

        await repo.storeSkewObservations(rows);
        await repo.storeSkewObservations(rows); // identical re-run

        const count = await repo.countObservations();
        expect(count).toBe(2); // idempotent — no duplicates
      });

      it("different strikes at the same snapshot time write distinct rows", async () => {
        const t = new Date("2026-07-01T19:00:00Z");
        await repo.storeSkewObservations([makeRow(t, 5300000)]);
        await repo.storeSkewObservations([makeRow(t, 5400000)]);

        const count = await repo.countObservations();
        expect(count).toBe(2);
      });
    });

    describe("readSkewSeries — ordering, filter, nullable round-trip", () => {
      it("returns rows ordered by snapshot_time ASC", async () => {
        const t1 = new Date("2026-07-01T19:00:00Z");
        const t2 = new Date("2026-07-01T19:30:00Z");
        const t3 = new Date("2026-07-01T20:00:00Z");

        await repo.storeSkewObservations([makeRow(t3, 5400000)]);
        await repo.storeSkewObservations([makeRow(t1, 5400000)]);
        await repo.storeSkewObservations([makeRow(t2, 5400000)]);

        const result = await repo.readSkewSmileDetail({ underlying: UNDERLYING });
        expect(result.ok).toBe(true);
        if (!result.ok) return;
        expect(result.value).toHaveLength(3);
        expect(result.value[0]?.snapshotTime.getTime()).toBeLessThan(
          result.value[1]?.snapshotTime.getTime() ?? 0,
        );
        expect(result.value[1]?.snapshotTime.getTime()).toBeLessThan(
          result.value[2]?.snapshotTime.getTime() ?? 0,
        );
      });

      it("filters by underlying + expiration when provided", async () => {
        const t = new Date("2026-07-01T19:00:00Z");
        await repo.storeSkewObservations([
          makeRow(t, 5400000, { underlying: "SPX", expiration: "2026-07-17" }),
          makeRow(t, 5400000, { underlying: "NDX", expiration: "2026-07-17" }),
          makeRow(t, 5400000, { underlying: "SPX", expiration: "2026-08-21" }),
        ]);

        const result = await repo.readSkewSmileDetail({ underlying: "SPX", expiration: "2026-07-17" });
        expect(result.ok).toBe(true);
        if (!result.ok) return;
        expect(result.value).toHaveLength(1);
        expect(result.value[0]?.underlying).toBe("SPX");
        expect(result.value[0]?.expiration).toBe("2026-07-17");
      });

      it("returns an empty array (not null/error) when no rows exist", async () => {
        const result = await repo.readSkewSmileDetail({});
        expect(result.ok).toBe(true);
        if (!result.ok) return;
        expect(result.value).toEqual([]);
      });

      it("round-trips iv exactly and preserves null delta/moneyness as null", async () => {
        const t = new Date("2026-07-01T19:00:00Z");
        const iv = 0.1875;
        await repo.storeSkewObservations([
          makeRow(t, 5400000, { iv, delta: null, moneyness: null }),
        ]);

        const result = await repo.readSkewSmileDetail({ underlying: UNDERLYING });
        expect(result.ok).toBe(true);
        if (!result.ok) return;
        const row = result.value[0];
        expect(row).toBeDefined();
        if (row === undefined) return;
        expect(row.iv).toBe(iv);
        expect(row.delta).toBeNull();
        expect(row.moneyness).toBeNull();
      });
    });
  });
}
