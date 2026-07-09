import { describe, beforeAll, beforeEach, it, expect } from "vitest";
import { inject } from "vitest";
import { runExitVerdictsContractTests } from "../../__contract__/exit-verdicts.contract.ts";
import { makePostgresExitVerdictsRepo } from "./exit-verdicts.ts";
import { makeDb } from "../db.ts";
import { exitVerdicts } from "../schema.ts";
import { sql } from "drizzle-orm";

/**
 * Contract test for the Postgres exit-verdicts adapter (Phase 26, Plan 03).
 * Requires Docker (testcontainers postgres:16, migration chain incl. 0020_exit_verdicts.sql).
 * SQL is never mocked (tdd.md): proves append-history idempotency (WR-01), latest-per-calendar,
 * and exitVerdict contract boundary validation on write AND read.
 */

const dbUrl: string | undefined = inject("dbUrl");
const shouldSkip = !dbUrl;

describe.skipIf(shouldSkip)("postgres exit-verdicts adapter", () => {
  let db: ReturnType<typeof makeDb>;

  beforeAll(async () => {
    if (!dbUrl) return;
    db = makeDb(dbUrl);
  });

  beforeEach(async () => {
    if (!db) return;
    await db.delete(exitVerdicts);
  });

  runExitVerdictsContractTests(() => {
    if (!db) throw new Error("db not initialized");
    const repo = makePostgresExitVerdictsRepo(db);
    return {
      insertExitVerdict: repo.insertExitVerdict,
      readLatestVerdictsPerCalendar: repo.readLatestVerdictsPerCalendar,
      seedRawVerdict: async (
        observedAt: Date,
        calendarId: string,
        rawBlob: unknown,
      ): Promise<void> => {
        await db.execute(sql`
          INSERT INTO exit_verdicts (observed_at, calendar_id, verdict)
          VALUES (${observedAt.toISOString()}::timestamptz, ${calendarId}::uuid, ${JSON.stringify(rawBlob)}::jsonb)
        `);
      },
    };
  });

  // ── Postgres-specific: no onConflictDoUpdate — first-write-wins proven via raw count ──
  it("WR-01: inserting two DIFFERENT (observedAt, calendarId) pairs produces exactly 2 rows", async () => {
    if (!db) return;
    const repo = makePostgresExitVerdictsRepo(db);
    const calA = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
    const calB = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
    const baseVerdict = {
      verdict: "HOLD" as const,
      rung: null,
      ruleId: "HOLD-default",
      metric: { name: "pnlPct", value: 0.01, threshold: 0.05 },
      indicative: false,
      escalate: false,
      roll: null,
    };

    await repo.insertExitVerdict({
      observedAt: new Date("2026-07-01T14:00:00Z"),
      calendarId: calA,
      verdict: baseVerdict,
    });
    await repo.insertExitVerdict({
      observedAt: new Date("2026-07-01T14:00:00Z"),
      calendarId: calB,
      verdict: baseVerdict,
    });

    const countRows = await db.execute(sql`SELECT COUNT(*)::int AS cnt FROM exit_verdicts`);
    const countRow = countRows[0];
    expect(countRow).toBeDefined();
    if (countRow === undefined) return;
    const rec: { [key: string]: unknown } = Object.fromEntries(Object.entries(countRow));
    const cnt = rec["cnt"];
    const count = typeof cnt === "number" ? cnt : Number(cnt ?? 0);
    expect(count).toBe(2);
  });
});
