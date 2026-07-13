/**
 * strm04-regression.test.ts — STRM-04 no-persistence regression gate
 *
 * Behavioural invariant: exercising the streaming fan-out path (bufferTick + flushTicks +
 * recomputeLiveGreek) must NOT write any rows to leg_observations.
 *
 * STRM-04 constraint: stream data is display-only — no per-tick Postgres writes.
 * This test is a testcontainers integration test so it survives comment-text grep checks.
 *
 * Architecture: streams through the real production code paths:
 *   1. recomputeLiveGreek (packages/core) — BSM greek recompute from a raw tick
 *   2. bufferTick (stream-fan-out) — coalescer buffer write
 *   3. flushTicks (stream-fan-out) — fan-out to a fake SSEClient
 *
 * The test runs against a real Postgres 16 container (via globalSetup in vitest.config.ts).
 * Skips gracefully when Docker is unavailable (inject("dbUrl") returns undefined).
 *
 * Failure condition: if any streaming code path ever writes a leg_observations row,
 * this test fails and blocks the build (T-12-04-04).
 */

import { describe, it, expect, beforeAll, afterAll, afterEach } from "vitest";
import { inject } from "vitest";
// sql is re-exported from @morai/adapters to avoid a direct drizzle-orm import
// from the server package (drizzle-orm is confined to adapters per architecture rules,
// and the drizzle-orm symlink in apps/server/node_modules is a bun workspace artifact
// that may not resolve correctly from the vite transform pipeline).
import { sql, makeDb } from "@morai/adapters";
import { recomputeLiveGreek } from "@morai/core";
import type { RawOptionTick } from "@morai/core";
import {
  registerClient,
  bufferTick,
  flushTicks,
  bufferSpot,
  flushSpot,
  bufferIndices,
  flushIndices,
  resetForTesting,
} from "./stream-fan-out.ts";
import type { SSEClient } from "./stream-fan-out.ts";

// ─── Helpers ─────────────────────────────────────────────────────────────────

/** Extract COUNT(*)::int result from a raw Drizzle execute row. */
function extractCnt(row: unknown): number {
  if (typeof row !== "object" || row === null) return 0;
  const entries = Object.entries(row);
  const rec: { [key: string]: unknown } = Object.fromEntries(entries);
  const cnt = rec["cnt"];
  if (typeof cnt === "number") return cnt;
  if (typeof cnt === "string") return Number(cnt);
  return 0;
}

/** Minimal fake SSEClient that records writes without throwing. */
function makeSilentClient(): SSEClient {
  const client: SSEClient = {
    aborted: false,
    onAbort(_listener: () => void) {
      /* no-op */
    },
    writeSSE(_msg: { event?: string; data: string }): Promise<void> {
      return Promise.resolve();
    },
  };
  return client;
}

// ─── Testcontainers setup ─────────────────────────────────────────────────────

const dbUrl: string | undefined = inject("dbUrl");
const shouldSkip = !dbUrl;

describe.skipIf(shouldSkip)(
  "STRM-04 regression: streaming path writes zero leg_observations rows",
  () => {
    let db: ReturnType<typeof makeDb>;

    beforeAll(
      async () => {
        if (!dbUrl) return;
        db = makeDb(dbUrl);
        // Migrations were already applied by globalSetup — DB schema is ready.
      },
      // Allow up to 30s for the initial DB connection; container is already running.
      30_000,
    );

    afterEach(() => {
      resetForTesting();
    });

    afterAll(async () => {
      // postgres.js auto-closes on process exit; no explicit teardown needed.
      resetForTesting();
    });

    it(
      "leg_observations count is unchanged after exercising the streaming fan-out path",
      async () => {
        if (!db) throw new Error("db not initialised — check globalSetup");

        // ── Step 1: Record the initial row count ────────────────────────────
        const beforeRows = await db.execute(
          sql`SELECT COUNT(*)::int AS cnt FROM leg_observations`,
        );
        const beforeRow = beforeRows[0];
        const before = extractCnt(beforeRow);

        // ── Step 2: Drive a streaming-only cycle ────────────────────────────
        // Register a silent fake SSEClient (no DB writes in writeSSE).
        const client = makeSilentClient();
        registerClient(client);

        // Build a sample raw tick for a far-dated SPX call (T ≈ 1.47yr from 2026-06-28).
        // OCC format: {root:6}{YYMMDD}{C/P}{strike×1000:8}
        // "SPX   271218C05000000" → root=SPX, expiry=2027-12-18, type=C, strike=5000
        const rawTick: RawOptionTick = {
          occSymbol: "SPX   271218C05000000",
          mark: 120,
          bid: 118,
          ask: 122,
          underlyingPrice: 5850,
          ts: "2026-06-28T10:00:00.000Z",
        };

        // Recompute live greeks via the BSM engine (D-02). If this returns err, the tick
        // is simply skipped — which is also a valid no-write scenario.
        const now = new Date("2026-06-28T10:00:00.000Z");
        const recomputed = recomputeLiveGreek(rawTick, 0.045, 0.013, now);
        if (recomputed.ok) {
          bufferTick(recomputed.value);
        } else {
          // Fallback: buffer a synthetic LiveGreekTick to exercise the flush path
          // even if BSM inversion fails (e.g., very deep OTM, model boundary).
          bufferTick({
            occSymbol: rawTick.occSymbol,
            mark: 120,
            bid: 118,
            ask: 122,
            bsmIv: 0.20,
            bsmDelta: 0.45,
            bsmGamma: 0.01,
            bsmTheta: -0.05,
            bsmVega: 0.10,
            ts: rawTick.ts,
          });
        }

        // Flush the coalescer buffer to the fake client (the hot path).
        flushTicks();

        // Allow any async microtasks (writeSSE promise chains) to settle.
        await new Promise<void>((resolve) => setTimeout(resolve, 10));

        // ── Step 3: Assert the count has not changed ────────────────────────
        const afterRows = await db.execute(
          sql`SELECT COUNT(*)::int AS cnt FROM leg_observations`,
        );
        const afterRow = afterRows[0];
        const after = extractCnt(afterRow);

        expect(after).toBe(before);
      },
      // 30s per-test timeout — DB is already running; the query itself is fast.
      30_000,
    );

    it(
      "bufferTick + flushTicks without a real BSM tick also writes zero rows",
      async () => {
        if (!db) throw new Error("db not initialised");

        const beforeRows = await db.execute(
          sql`SELECT COUNT(*)::int AS cnt FROM leg_observations`,
        );
        const before = extractCnt(beforeRows[0]);

        // Directly buffer a synthetic LiveGreekTick (no BSM recompute involved).
        const client = makeSilentClient();
        registerClient(client);
        bufferTick({
          occSymbol: "SPX   261218P05000000",
          mark: 80,
          bid: null,
          ask: null,
          bsmIv: 0.18,
          bsmDelta: -0.40,
          bsmGamma: 0.008,
          bsmTheta: -0.04,
          bsmVega: 0.09,
          ts: "2026-06-28T10:00:00.000Z",
        });
        flushTicks();
        await new Promise<void>((resolve) => setTimeout(resolve, 10));

        const afterRows = await db.execute(
          sql`SELECT COUNT(*)::int AS cnt FROM leg_observations`,
        );
        const after = extractCnt(afterRows[0]);

        expect(after).toBe(before);
      },
      30_000,
    );

    it(
      "spot lane (bufferSpot + flushSpot) writes zero leg_observations rows",
      async () => {
        if (!db) throw new Error("db not initialised");

        const beforeRows = await db.execute(
          sql`SELECT COUNT(*)::int AS cnt FROM leg_observations`,
        );
        const before = extractCnt(beforeRows[0]);

        const client = makeSilentClient();
        registerClient(client);
        bufferSpot(5842.375, "2026-06-28T10:00:00.000Z");
        flushSpot();
        await new Promise<void>((resolve) => setTimeout(resolve, 10));

        const afterRows = await db.execute(
          sql`SELECT COUNT(*)::int AS cnt FROM leg_observations`,
        );
        const after = extractCnt(afterRows[0]);

        expect(after).toBe(before);
      },
      30_000,
    );

    it(
      "indices lane (bufferIndices + flushIndices) writes zero leg_observations rows",
      async () => {
        if (!db) throw new Error("db not initialised");

        const beforeRows = await db.execute(
          sql`SELECT COUNT(*)::int AS cnt FROM leg_observations`,
        );
        const before = extractCnt(beforeRows[0]);

        const client = makeSilentClient();
        registerClient(client);
        bufferIndices(
          { vix: 16.2, vvix: 88.5, vix9d: 15.1, vix3m: 17.8 },
          "2026-06-28T10:00:00.000Z",
        );
        flushIndices();
        await new Promise<void>((resolve) => setTimeout(resolve, 10));

        const afterRows = await db.execute(
          sql`SELECT COUNT(*)::int AS cnt FROM leg_observations`,
        );
        const after = extractCnt(afterRows[0]);

        expect(after).toBe(before);
      },
      30_000,
    );
  },
);
