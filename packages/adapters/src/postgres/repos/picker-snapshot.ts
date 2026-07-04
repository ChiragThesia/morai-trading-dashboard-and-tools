import { ok, err } from "@morai/shared";
import type { Result } from "@morai/shared";
import type {
  ForPersistingPickerSnapshot,
  ForReadingPickerSnapshot,
  PickerSnapshotRow,
  StorageError,
} from "@morai/core";
import { pickerSnapshotResponse } from "@morai/contracts";
import { desc } from "drizzle-orm";
import { pickerSnapshots } from "../schema.ts";
import type { Db } from "../db.ts";

/**
 * makePostgresPickerSnapshotRepo — Postgres implementation of ForPersistingPickerSnapshot
 * and ForReadingPickerSnapshot.
 *
 * insertPickerSnapshot: plain INSERT — no conflict-target update (D-06 append-history;
 * every computed snapshot is retained for PICK-04's future slope backtest). The snapshot
 * blob is validated via pickerSnapshotResponse.parse BEFORE insert — a contract-violating
 * blob throws and is mapped to a StorageError, never silently stored (T-19-10).
 * readPickerSnapshot: ORDER BY observed_at DESC LIMIT 1 — the newest row, or ok(null) when
 * the table is empty. The stored blob is re-validated via pickerSnapshotResponse.parse AFTER
 * read (parse-don't-cast at the read seam) — a legacy/corrupted row surfaces a StorageError
 * rather than flowing into the domain as a silently invalid shape.
 */
export type PostgresPickerSnapshotRepo = {
  readonly insertPickerSnapshot: ForPersistingPickerSnapshot;
  readonly readPickerSnapshot: ForReadingPickerSnapshot;
};

export function makePostgresPickerSnapshotRepo(db: Db): PostgresPickerSnapshotRepo {
  const insertPickerSnapshot: ForPersistingPickerSnapshot = async (
    row: PickerSnapshotRow,
  ): Promise<Result<void, StorageError>> => {
    try {
      const validated = pickerSnapshotResponse.parse(row.snapshot);
      await db.insert(pickerSnapshots).values({
        observedAt: row.observedAt,
        snapshot: validated,
      }); // append-only (D-06) — plain insert, never a conflict-target update
      return ok(undefined);
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      return err<StorageError>({ kind: "storage-error", message });
    }
  };

  const readPickerSnapshot: ForReadingPickerSnapshot = async (): Promise<
    Result<PickerSnapshotRow | null, StorageError>
  > => {
    try {
      const rows = await db
        .select()
        .from(pickerSnapshots)
        .orderBy(desc(pickerSnapshots.observedAt))
        .limit(1);

      const row = rows[0];
      if (row === undefined) return ok(null);

      const validated = pickerSnapshotResponse.parse(row.snapshot);
      return ok({ observedAt: row.observedAt, snapshot: validated });
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      return err<StorageError>({ kind: "storage-error", message });
    }
  };

  return { insertPickerSnapshot, readPickerSnapshot };
}
