import { describe, beforeAll, beforeEach, it, expect } from "vitest";
import { inject } from "vitest";
import { ok } from "@morai/shared";
import { makeRankCalendarsUseCase, makeRecordCalendarRankingUseCase } from "@morai/core";
import { runCalendarRankingContractTests } from "../../__contract__/calendar-ranking.contract.ts";
import { makePostgresCalendarRankingRepo } from "./calendar-ranking.ts";
import { makeDb } from "../db.ts";
import { calendarRanking } from "../schema.ts";
import { sql } from "drizzle-orm";
import type { CalendarChainQuote, CalendarRankingRow } from "@morai/core";

/**
 * Contract test for the Postgres calendar-ranking adapter.
 * Requires Docker (testcontainers postgres:16, migration chain incl. 0031_calendar_ranking.sql).
 * SQL is never mocked (tdd.md).
 *
 * The Postgres-specific cases below are the ones the in-memory twin cannot prove: that the
 * PRIMARY KEY really carries all six columns (a twin can agree with a wrong migration), and
 * that a numeric column round-trips the value the engine computed rather than a rounded one.
 *
 * beforeEach truncates calendar_ranking so the shared contract's empty-start case is honest.
 */

const dbUrl: string | undefined = inject("dbUrl");
const shouldSkip = !dbUrl;

describe.skipIf(shouldSkip)("postgres calendar-ranking adapter", () => {
  let db: ReturnType<typeof makeDb>;

  beforeAll(async () => {
    if (!dbUrl) return;
    db = makeDb(dbUrl);
  });

  beforeEach(async () => {
    if (!db) return;
    await db.delete(calendarRanking);
  });

  runCalendarRankingContractTests(() => {
    if (!db) throw new Error("db not initialized");
    const repo = makePostgresCalendarRankingRepo(db);
    return {
      insertCalendarRanking: repo.insertCalendarRanking,
      countRows: async (): Promise<number> => {
        const rows = await db.execute(sql`SELECT COUNT(*)::int AS cnt FROM calendar_ranking`);
        const row = rows[0];
        if (row === undefined) return 0;
        const rec: { [key: string]: unknown } = Object.fromEntries(Object.entries(row));
        const cnt = rec["cnt"];
        if (typeof cnt === "number") return cnt;
        if (typeof cnt === "string") return Number(cnt);
        return 0;
      },
    };
  });

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

  // ── The migration, not the repo: all six key columns are really in the PRIMARY KEY ──
  it("0029/0030: the PRIMARY KEY carries all six discriminating columns", async () => {
    if (!db) return;
    const rows = await db.execute(sql`
      SELECT a.attname::text AS col
      FROM pg_index i
      JOIN pg_attribute a ON a.attrelid = i.indrelid AND a.attnum = ANY(i.indkey)
      WHERE i.indrelid = 'calendar_ranking'::regclass AND i.indisprimary
      ORDER BY a.attname
    `);
    const cols = rows.map((r) => {
      const rec: { [key: string]: unknown } = Object.fromEntries(Object.entries(r));
      return String(rec["col"]);
    });
    expect(cols).toEqual([
      "as_of",
      "back_expiration",
      "contract_type",
      "front_expiration",
      "root",
      "strike",
    ]);
  });

  // ── The numbers survive the numeric column unrounded ────────────────────────────
  it("round-trips the engine's own precision, not a rounded copy", async () => {
    if (!db) return;
    const repo = makePostgresCalendarRankingRepo(db);
    const written = row();
    expect((await repo.insertCalendarRanking([written])).ok).toBe(true);

    const rows = await db.execute(sql`
      SELECT score, fwd_edge_raw, delta_balance_raw, fwd_iv, debit, spot, no_iv_legs, "rank"
      FROM calendar_ranking
    `);
    const stored = rows[0];
    expect(stored).toBeDefined();
    if (stored === undefined) return;
    const rec: { [key: string]: unknown } = Object.fromEntries(Object.entries(stored));
    expect(Number(rec["score"])).toBe(written.score);
    expect(Number(rec["fwd_edge_raw"])).toBe(written.fwdEdgeRaw);
    expect(Number(rec["delta_balance_raw"])).toBe(written.deltaBalanceRaw);
    expect(Number(rec["fwd_iv"])).toBe(written.fwdIv);
    expect(Number(rec["debit"])).toBe(written.debit);
    expect(Number(rec["spot"])).toBe(written.spot);
    expect(Number(rec["no_iv_legs"])).toBe(853);
    expect(Number(rec["rank"])).toBe(1);
  });

  // ── The stamp is the cohort's instant, stored to the second it was given ────────
  it("stores as_of exactly as handed over, never re-derived", async () => {
    if (!db) return;
    const repo = makePostgresCalendarRankingRepo(db);
    await repo.insertCalendarRanking([row()]);

    const rows = await db.execute(sql`SELECT as_of FROM calendar_ranking`);
    const stored = rows[0];
    expect(stored).toBeDefined();
    if (stored === undefined) return;
    const rec: { [key: string]: unknown } = Object.fromEntries(Object.entries(stored));
    expect(new Date(String(rec["as_of"])).toISOString()).toBe(AS_OF.toISOString());
  });

  // ── The REAL engine into the REAL columns ──────────────────────────────────────
  //
  // The two test layers above never meet: the core use-case test hands a hand-built ranking to
  // a fake port, and the contract suite hands hand-built rows to real Postgres. Typecheck proves
  // the types line up and nothing proves the engine's actual numbers survive the actual columns.
  //
  // The specific hazard is that `String(NaN)` and `String(Infinity)` are BOTH valid `numeric`
  // literals in Postgres — they store silently, and read back to a future backtest as numbers.
  // This is not hypothetical in this repo: `leg_observations.bsm_iv` uses the literal string
  // 'NaN' as a live sentinel. Seven of these columns carry no finiteness filter of their own.
  describe("the real ranking engine into the real table", () => {
    const NOW = new Date("2026-07-27T16:00:00.000Z");
    const SPOT = 7401.89;

    /** Mirrors rankCalendars.test.ts's own fixture — proven to yield a non-empty ranking. */
    function ladder(over: { expiration: string; ivAtm: number }): CalendarChainQuote[] {
      return [7350, 7400, 7450].map((k) => {
        const iv = over.ivAtm + ((7400 - k) / 50) * 0.004;
        const value = Math.max(20, 60 + (k - 7400) * 0.4);
        return {
          time: NOW,
          strike: k * 1000,
          expiration: over.expiration,
          contractType: "P" as const,
          underlyingPrice: SPOT,
          bsmIv: String(iv),
          root: "SPXW" as const,
          bid: value,
          ask: value + 1,
          openInterest: 39,
          source: "cboe" as const,
        };
      });
    }

    const CHAIN: CalendarChainQuote[] = [
      ...ladder({ expiration: "2026-08-11", ivAtm: 0.17 }),
      ...ladder({ expiration: "2026-08-26", ivAtm: 0.165 }),
      ...ladder({ expiration: "2026-09-11", ivAtm: 0.16 }),
    ];
    const CLOSES = Array.from({ length: 25 }, (_, i) => 7300 + i * 4);

    it("records a real ranking, and not one number of it is NaN or Infinity", async () => {
      if (!db) return;
      const repo = makePostgresCalendarRankingRepo(db);
      const record = makeRecordCalendarRankingUseCase({
        rankCalendars: makeRankCalendarsUseCase({
          readChain: () => Promise.resolve(ok(CHAIN)),
          readDailyCloses: () => Promise.resolve(ok(CLOSES)),
          now: () => NOW,
          carry: { rate: 0.045, divYield: 0.013 },
        }),
        persistRanking: repo.insertCalendarRanking,
      });

      const result = await record();
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      // Guards against a vacuous pass: an empty ranking would satisfy every assertion below.
      expect(result.value.rowsWritten).toBeGreaterThan(0);

      const counted = await db.execute(sql`SELECT COUNT(*)::int AS cnt FROM calendar_ranking`);
      const countRow = counted[0];
      expect(countRow).toBeDefined();
      if (countRow === undefined) return;
      const countRec: { [key: string]: unknown } = Object.fromEntries(Object.entries(countRow));
      expect(Number(countRec["cnt"])).toBe(result.value.rowsWritten);

      const poisoned = await db.execute(sql`
        SELECT COUNT(*)::int AS cnt FROM calendar_ranking
        WHERE fwd_iv::text IN ('NaN', 'Infinity', '-Infinity')
           OR front_ref_iv::text IN ('NaN', 'Infinity', '-Infinity')
           OR back_ref_iv::text IN ('NaN', 'Infinity', '-Infinity')
           OR debit::text IN ('NaN', 'Infinity', '-Infinity')
           OR net_theta::text IN ('NaN', 'Infinity', '-Infinity')
           OR net_vega::text IN ('NaN', 'Infinity', '-Infinity')
           OR score::text IN ('NaN', 'Infinity', '-Infinity')
           OR strike::text IN ('NaN', 'Infinity', '-Infinity')
           OR spot::text IN ('NaN', 'Infinity', '-Infinity')
           OR fwd_edge_raw::text IN ('NaN', 'Infinity', '-Infinity')
           OR delta_balance_raw::text IN ('NaN', 'Infinity', '-Infinity')
      `);
      const poisonRow = poisoned[0];
      expect(poisonRow).toBeDefined();
      if (poisonRow === undefined) return;
      const poisonRec: { [key: string]: unknown } = Object.fromEntries(
        Object.entries(poisonRow),
      );
      expect(Number(poisonRec["cnt"])).toBe(0);
    });

    it("re-recording the same cohort adds nothing (the cron's idempotency, end to end)", async () => {
      if (!db) return;
      const repo = makePostgresCalendarRankingRepo(db);
      const record = makeRecordCalendarRankingUseCase({
        rankCalendars: makeRankCalendarsUseCase({
          readChain: () => Promise.resolve(ok(CHAIN)),
          readDailyCloses: () => Promise.resolve(ok(CLOSES)),
          now: () => NOW,
          carry: { rate: 0.045, divYield: 0.013 },
        }),
        persistRanking: repo.insertCalendarRanking,
      });

      const first = await record();
      await record();

      expect(first.ok).toBe(true);
      if (!first.ok) return;
      const counted = await db.execute(sql`SELECT COUNT(*)::int AS cnt FROM calendar_ranking`);
      const countRow = counted[0];
      expect(countRow).toBeDefined();
      if (countRow === undefined) return;
      const rec: { [key: string]: unknown } = Object.fromEntries(Object.entries(countRow));
      expect(Number(rec["cnt"])).toBe(first.value.rowsWritten);
    });

    it("stamps every row with the cohort's observation instant, not the clock", async () => {
      if (!db) return;
      const repo = makePostgresCalendarRankingRepo(db);
      const record = makeRecordCalendarRankingUseCase({
        rankCalendars: makeRankCalendarsUseCase({
          readChain: () => Promise.resolve(ok(CHAIN)),
          readDailyCloses: () => Promise.resolve(ok(CLOSES)),
          // A clock far from the cohort: any row carrying it was stamped by the wrong thing.
          now: () => new Date("2026-07-27T23:59:00.000Z"),
          carry: { rate: 0.045, divYield: 0.013 },
        }),
        persistRanking: repo.insertCalendarRanking,
      });
      await record();

      const rows = await db.execute(sql`SELECT DISTINCT as_of FROM calendar_ranking`);
      expect(rows.length).toBe(1);
      const rec: { [key: string]: unknown } = Object.fromEntries(Object.entries(rows[0] ?? {}));
      expect(new Date(String(rec["as_of"])).toISOString()).toBe(NOW.toISOString());
    });
  });

  // ── A NULL score term is stored as NULL, never as a fabricated 0 ────────────────
  it("stores an unmeasurable term as NULL", async () => {
    if (!db) return;
    const repo = makePostgresCalendarRankingRepo(db);
    await repo.insertCalendarRanking([
      row({ fwdEdgeRaw: null, fwdEdgePercentile: null, spot: null }),
    ]);

    const rows = await db.execute(sql`
      SELECT fwd_edge_raw, fwd_edge_percentile, spot FROM calendar_ranking
    `);
    const stored = rows[0];
    expect(stored).toBeDefined();
    if (stored === undefined) return;
    const rec: { [key: string]: unknown } = Object.fromEntries(Object.entries(stored));
    expect(rec["fwd_edge_raw"]).toBeNull();
    expect(rec["fwd_edge_percentile"]).toBeNull();
    expect(rec["spot"]).toBeNull();
  });
});
