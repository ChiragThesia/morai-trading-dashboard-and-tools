import { describe, beforeAll, beforeEach, it, expect } from "vitest";
import { inject } from "vitest";
import { runPickerSnapshotContractTests } from "../../__contract__/picker-snapshot.contract.ts";
import { makePostgresPickerSnapshotRepo } from "./picker-snapshot.ts";
import { makeDb } from "../db.ts";
import { pickerSnapshots } from "../schema.ts";
import { sql } from "drizzle-orm";
import type { PickerSnapshotRow } from "@morai/core";

/**
 * Contract test for the Postgres picker-snapshot adapter.
 * Requires Docker (testcontainers postgres:16, migration chain incl. 0015_picker_snapshot.sql).
 * SQL is never mocked (tdd.md): proves append-history round-trip (D-06), empty→null, and
 * pickerSnapshotResponse boundary validation on write AND read (T-19-10).
 *
 * beforeEach truncates picker_snapshot so the shared contract (which includes an
 * empty→null case) sees a clean state.
 */

const dbUrl: string | undefined = inject("dbUrl");
const shouldSkip = !dbUrl;

describe.skipIf(shouldSkip)("postgres picker-snapshot adapter", () => {
  let db: ReturnType<typeof makeDb>;

  beforeAll(async () => {
    if (!dbUrl) return;
    db = makeDb(dbUrl);
  });

  beforeEach(async () => {
    if (!db) return;
    await db.delete(pickerSnapshots);
  });

  runPickerSnapshotContractTests(() => {
    if (!db) throw new Error("db not initialized");
    const repo = makePostgresPickerSnapshotRepo(db);
    return {
      insertPickerSnapshot: repo.insertPickerSnapshot,
      readPickerSnapshot: repo.readPickerSnapshot,
      countSnapshots: async (): Promise<number> => {
        const rows = await db.execute(
          sql`SELECT COUNT(*)::int AS cnt FROM picker_snapshot`,
        );
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

  // ── Postgres-specific: no onConflictDoUpdate — append-only proven via raw count ──
  it("D-06: inserting two DIFFERENT observedAt values produces exactly 2 rows (append, no upsert)", async () => {
    if (!db) return;
    const repo = makePostgresPickerSnapshotRepo(db);

    const baseSnapshot = {
      asOf: "2026-07-01",
      spot: 7381,
      source: "schwab" as const,
      gexContextStatus: "ok" as const,
      eventsContextStatus: "ok" as const,
      termStructure: [{ dte: 30, iv: 0.14 }],
      gex: {
        flip: 7488,
        callWall: 7600,
        putWall: 7400,
        netGammaAtSpot: -47.3,
        absGammaStrike: 7500,
      },
      events: [{ date: "2026-07-29", name: "FOMC" }],
      candidates: [],
    };
    const row1: PickerSnapshotRow = {
      observedAt: new Date("2026-07-01T14:00:00Z"),
      snapshot: baseSnapshot,
    };
    const row2: PickerSnapshotRow = {
      observedAt: new Date("2026-07-01T14:30:00Z"),
      snapshot: { ...baseSnapshot, spot: 7390 },
    };

    const r1 = await repo.insertPickerSnapshot(row1);
    expect(r1.ok).toBe(true);
    const r2 = await repo.insertPickerSnapshot(row2);
    expect(r2.ok).toBe(true);

    const countRows = await db.execute(sql`SELECT COUNT(*)::int AS cnt FROM picker_snapshot`);
    const countRow = countRows[0];
    expect(countRow).toBeDefined();
    if (countRow === undefined) return;
    const rec: { [key: string]: unknown } = Object.fromEntries(Object.entries(countRow));
    const cnt = rec["cnt"];
    const count = typeof cnt === "number" ? cnt : Number(cnt ?? 0);
    expect(count).toBe(2);
  });

  // ── Postgres-specific: boundary validation on WRITE (T-19-10) ──────────────────
  it("rejects an insert whose snapshot violates pickerSnapshotResponse (score out of [0,100] bounds)", async () => {
    if (!db) return;
    const repo = makePostgresPickerSnapshotRepo(db);

    const badRow: PickerSnapshotRow = {
      observedAt: new Date("2026-07-02T14:00:00Z"),
      snapshot: {
        asOf: "2026-07-02",
        spot: 7381,
        source: "schwab",
        gexContextStatus: "ok",
        eventsContextStatus: "ok",
        termStructure: [],
        gex: {
          flip: null,
          callWall: null,
          putWall: null,
          netGammaAtSpot: 0,
          absGammaStrike: null,
        },
        events: [],
        candidates: [
          {
            id: "c1",
            name: "bad candidate",
            score: 150, // violates pickerCandidate.score.min(0).max(100)
            breakdown: [],
            debit: 100,
            theta: -1,
            vega: 1,
            delta: 0,
            fwdIv: null,
            fwdIvGuard: "inverted",
            slope: 0,
            fwdEdge: 0,
            expectedMove: 0,
            frontEvents: [],
            backEvents: [],
            frontLeg: { strike: 7400, putCall: "P", dte: 30, iv: 0.14 },
            backLeg: { strike: 7400, putCall: "P", dte: 60, iv: 0.15 },
            exitPlan: {
              profitTargetPct: 0.25,
              stopPct: 0.175,
              manageShortDte: 7,
              closeByExpiry: "2026-08-01",
            },
          },
        ],
      },
    };

    const result = await repo.insertPickerSnapshot(badRow);
    expect(result.ok).toBe(false);

    // Never silently stored — confirm 0 rows landed for this observedAt.
    const countRows = await db.execute(
      sql`SELECT COUNT(*)::int AS cnt FROM picker_snapshot WHERE observed_at = ${badRow.observedAt.toISOString()}::timestamptz`,
    );
    const countRow = countRows[0];
    expect(countRow).toBeDefined();
    if (countRow === undefined) return;
    const rec: { [key: string]: unknown } = Object.fromEntries(Object.entries(countRow));
    const cnt = rec["cnt"];
    const count = typeof cnt === "number" ? cnt : Number(cnt ?? 0);
    expect(count).toBe(0);
  });

  // ── Postgres-specific: boundary validation on READ (T-19-10) ───────────────────
  it("rejects a read of a legacy/corrupted row that fails pickerSnapshotResponse validation", async () => {
    if (!db) return;
    const repo = makePostgresPickerSnapshotRepo(db);

    // Insert a structurally-invalid JSONB blob directly, bypassing the repo (simulates
    // a legacy row or manual DB tamper — the repo's own insert path always validates).
    await db.execute(sql`
      INSERT INTO picker_snapshot (observed_at, snapshot)
      VALUES (${"2026-07-03T14:00:00.000Z"}::timestamptz, ${JSON.stringify({ not: "a valid snapshot" })}::jsonb)
    `);

    const result = await repo.readPickerSnapshot();
    expect(result.ok).toBe(false);
  });
});
