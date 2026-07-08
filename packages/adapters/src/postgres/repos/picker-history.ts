import { ok, err } from "@morai/shared";
import type { Result } from "@morai/shared";
import { z } from "zod";
import type {
  ForReadingDailySpotCloses,
  ForReadingPickerSlopeHistory,
  StorageError,
} from "@morai/core";
import { sql } from "drizzle-orm";
import type { Db } from "../db.ts";

/**
 * makePostgresPickerHistoryRepo — Postgres implementation of the picker's experimental-rule
 * history reads (rules.ts `vrp` + `slopePercentile`).
 *
 * readDailySpotCloses: the last observation per UTC calendar day from leg_observations
 * (underlying_price), last N available days, ASCENDING by day — realizedVol() consumes the
 * series in time order. Anchored to the data (last N distinct days present), never to the
 * wall clock, so tests are deterministic and market holidays don't punch holes.
 *
 * readPickerSlopeHistory: candidate slopes from the most recent N picker_snapshot rows (the
 * PICK-04 corpus). Rows whose JSONB doesn't carry a parseable candidates[].slope are skipped
 * (pre-registry rows still count — slope has been on the candidate shape since Phase 19).
 */
export type PostgresPickerHistoryRepo = {
  readonly readDailySpotCloses: ForReadingDailySpotCloses;
  readonly readPickerSlopeHistory: ForReadingPickerSlopeHistory;
};

/** Minimal lens into the stored snapshot blob — only what slope-history needs. */
const snapshotSlopes = z.object({
  candidates: z.array(z.looseObject({ slope: z.number() })),
});

export function makePostgresPickerHistoryRepo(db: Db): PostgresPickerHistoryRepo {
  const readDailySpotCloses: ForReadingDailySpotCloses = async (
    days: number,
  ): Promise<Result<ReadonlyArray<number>, StorageError>> => {
    try {
      const rows = await db.execute(sql`
        SELECT underlying_price
        FROM (
          SELECT DISTINCT ON (time::date) time::date AS day, underlying_price
          FROM leg_observations
          ORDER BY time::date DESC, time DESC
          LIMIT ${days}
        ) latest_per_day
        ORDER BY day ASC
      `);

      const closes: number[] = [];
      for (const row of rows) {
        const rec: { [key: string]: unknown } = Object.fromEntries(Object.entries(row));
        const raw = rec["underlying_price"];
        const value = typeof raw === "number" ? raw : Number(raw);
        if (Number.isFinite(value)) closes.push(value);
      }
      return ok(closes);
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      return err<StorageError>({ kind: "storage-error", message });
    }
  };

  const readPickerSlopeHistory: ForReadingPickerSlopeHistory = async (
    limit: number,
  ): Promise<Result<ReadonlyArray<number>, StorageError>> => {
    try {
      const rows = await db.execute(sql`
        SELECT snapshot
        FROM picker_snapshot
        ORDER BY observed_at DESC
        LIMIT ${limit}
      `);

      const slopes: number[] = [];
      for (const row of rows) {
        const rec: { [key: string]: unknown } = Object.fromEntries(Object.entries(row));
        const parsed = snapshotSlopes.safeParse(rec["snapshot"]);
        if (!parsed.success) continue;
        for (const candidate of parsed.data.candidates) {
          if (Number.isFinite(candidate.slope)) slopes.push(candidate.slope);
        }
      }
      return ok(slopes);
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      return err<StorageError>({ kind: "storage-error", message });
    }
  };

  return { readDailySpotCloses, readPickerSlopeHistory };
}
