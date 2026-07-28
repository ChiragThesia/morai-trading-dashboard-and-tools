import { describe, it, expect, beforeEach } from "vitest";
import type { CalendarRankingRow, ForPersistingCalendarRanking } from "@morai/core";

/**
 * Shared contract-test suite for the calendar_ranking persistence port.
 * Run against BOTH the Postgres adapter (testcontainers) and the in-memory twin.
 *
 * FOUR OF THESE ARE REGRESSION TESTS FOR DEFECTS THIS REPO HAS ALREADY SHIPPED. The conflict
 * key is the whole safety story here, and reasoning about it has failed three times:
 *   - two rows differing only by `contract_type` must BOTH land — migration 0030 left that
 *     column out of the skew key because it "never varies", and 49.6% of every smile was
 *     silently discarded for the table's whole life;
 *   - two rows differing only by `strike` must BOTH land — migration 0029's shape, a column
 *     missing from the key collapsing genuinely different rows onto one;
 *   - a batch containing a duplicate key must NOT throw — commit 0224db1, duplicate
 *     occ_symbols crashing an upsert into an ~80-minute outage. This is the test that fails
 *     if someone later "improves" onConflictDoNothing into an upsert;
 *   - re-inserting the same batch must be a no-op — the idempotency the cron depends on,
 *     because `asOf` is the cohort's instant and does not advance between re-runs.
 */

export type CalendarRankingRepo = {
  readonly insertCalendarRanking: ForPersistingCalendarRanking;
  /** Count rows in calendar_ranking. The only read either side needs. */
  readonly countRows: () => Promise<number>;
};

// ─── Fixtures ────────────────────────────────────────────────────────────────

const AS_OF = new Date("2026-07-28T18:00:22.000Z");

function row(over: Partial<CalendarRankingRow> = {}): CalendarRankingRow {
  return {
    asOf: AS_OF,
    root: "SPXW",
    contractType: "P",
    frontExpiration: "2026-08-14",
    backExpiration: "2026-08-31",
    strike: 7405,
    rank: 1,
    score: 99.59745051995975,
    fwdEdgeRaw: 0.06648054818065363,
    fwdEdgePercentile: 100,
    deltaBalanceRaw: -0.0008785011068798143,
    deltaBalancePercentile: 98.65816839986581,
    fwdIv: 0.137775142244205,
    frontRefIv: 0.14693450922626727,
    backRefIv: 0.1424393074740334,
    debit: 32.494,
    netTheta: 0.895966232014092,
    netVega: 2.6046793359823193,
    spot: 7431.8198,
    noIvLegs: 853,
    ...over,
  };
}

export function runCalendarRankingContractTests(makeRepo: () => CalendarRankingRepo): void {
  describe("calendar-ranking persistence contract", () => {
    let repo: CalendarRankingRepo;

    beforeEach(() => {
      repo = makeRepo();
    });

    it("starts empty", async () => {
      expect(await repo.countRows()).toBe(0);
    });

    it("writes every row of one cycle", async () => {
      const result = await repo.insertCalendarRanking([
        row({ rank: 1, strike: 7405 }),
        row({ rank: 2, strike: 7410, frontExpiration: "2026-08-13" }),
        row({ rank: 3, strike: 7400, backExpiration: "2026-09-01" }),
      ]);

      expect(result.ok).toBe(true);
      expect(await repo.countRows()).toBe(3);
    });

    it("accepts an empty batch without writing", async () => {
      const result = await repo.insertCalendarRanking([]);
      expect(result.ok).toBe(true);
      expect(await repo.countRows()).toBe(0);
    });

    it("is a NO-OP when the same cycle is written twice (idempotency)", async () => {
      // The cron re-runs against a cohort whose `asOf` has not advanced. First-write-wins.
      const batch = [row({ rank: 1, strike: 7405 }), row({ rank: 2, strike: 7410 })];

      expect((await repo.insertCalendarRanking(batch)).ok).toBe(true);
      expect((await repo.insertCalendarRanking(batch)).ok).toBe(true);

      expect(await repo.countRows()).toBe(2);
    });

    it("keeps the FIRST write's values when a key is written again", async () => {
      await repo.insertCalendarRanking([row({ rank: 1, score: 99.5 })]);
      await repo.insertCalendarRanking([row({ rank: 7, score: 12.3 })]);

      // Never an upsert: one row, and it is still the first one.
      expect(await repo.countRows()).toBe(1);
    });

    it("0030's defect: two rows differing ONLY by contract_type both land", async () => {
      const result = await repo.insertCalendarRanking([
        row({ contractType: "P" }),
        row({ contractType: "C" }),
      ]);

      expect(result.ok).toBe(true);
      expect(await repo.countRows()).toBe(2);
    });

    it("0029's shape: two rows differing ONLY by strike both land", async () => {
      const result = await repo.insertCalendarRanking([
        row({ strike: 7405 }),
        row({ strike: 7410 }),
      ]);

      expect(result.ok).toBe(true);
      expect(await repo.countRows()).toBe(2);
    });

    it("two rows differing ONLY by root both land", async () => {
      // SPX and SPXW quote the same strike on the same date with different books.
      const result = await repo.insertCalendarRanking([
        row({ root: "SPXW" }),
        row({ root: "SPX" }),
      ]);

      expect(result.ok).toBe(true);
      expect(await repo.countRows()).toBe(2);
    });

    it("two rows differing ONLY by an expiration both land", async () => {
      const result = await repo.insertCalendarRanking([
        row({ frontExpiration: "2026-08-14" }),
        row({ frontExpiration: "2026-08-13" }),
        row({ backExpiration: "2026-09-01" }),
      ]);

      expect(result.ok).toBe(true);
      expect(await repo.countRows()).toBe(3);
    });

    it("two cycles an instant apart are two cycles", async () => {
      await repo.insertCalendarRanking([row()]);
      await repo.insertCalendarRanking([row({ asOf: new Date("2026-07-28T18:30:19.000Z") })]);

      expect(await repo.countRows()).toBe(2);
    });

    it("0224db1: a batch carrying a DUPLICATE key does not throw", async () => {
      // The engine's own pair-collapse makes this impossible today. The test exists so that
      // stays true of the adapter regardless: DO UPDATE would raise "command cannot affect row
      // a second time" here, which is exactly what took the ingest down for ~80 minutes.
      const result = await repo.insertCalendarRanking([
        row({ rank: 1 }),
        row({ rank: 2 }), // same key: same asOf/root/type/expirations/strike
      ]);

      expect(result.ok).toBe(true);
      expect(await repo.countRows()).toBe(1);
    });

    it("stores a row whose score terms were unmeasurable", async () => {
      const result = await repo.insertCalendarRanking([
        row({ fwdEdgeRaw: null, fwdEdgePercentile: null, spot: null }),
      ]);

      expect(result.ok).toBe(true);
      expect(await repo.countRows()).toBe(1);
    });
  });
}
