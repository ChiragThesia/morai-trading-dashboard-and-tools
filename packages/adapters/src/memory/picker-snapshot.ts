import { ok } from "@morai/shared";
import type { Result } from "@morai/shared";
import type {
  ForPersistingPickerSnapshot,
  ForReadingPickerSnapshot,
  PickerSnapshotRow,
  StorageError,
} from "@morai/core";

/**
 * makeMemoryPickerSnapshotRepo — in-memory twin of the Postgres picker-snapshot adapter.
 *
 * Implements ForPersistingPickerSnapshot + ForReadingPickerSnapshot using an append-only
 * array (D-06 keeps history, unlike GEX's upsert-by-cycleTime convention) — a second
 * insert with a NEW observedAt never replaces a prior row. A second insert with a
 * DUPLICATE observedAt (a same-cohort re-trigger) is a no-op, mirroring the Postgres
 * adapter's `onConflictDoNothing` (WR-01) — first-write-wins, never an upsert.
 * readPickerSnapshot returns the row with the max observedAt, or null when the store
 * is empty.
 *
 * Always returns ok(...) — no network or DB calls, no error paths.
 *
 * Architectural rule: every driven port change ships with its in-memory twin in the same
 * PR (architecture-boundaries.md §8).
 */
export type MemoryPickerSnapshotRepo = {
  readonly insertPickerSnapshot: ForPersistingPickerSnapshot;
  readonly readPickerSnapshot: ForReadingPickerSnapshot;
  /** countSnapshots — test helper: count rows in picker_snapshot. */
  readonly countSnapshots: () => Promise<number>;
};

export function makeMemoryPickerSnapshotRepo(): MemoryPickerSnapshotRepo {
  const rows: PickerSnapshotRow[] = [];

  const insertPickerSnapshot: ForPersistingPickerSnapshot = async (
    row: PickerSnapshotRow,
  ): Promise<Result<void, StorageError>> => {
    const isDuplicate = rows.some(
      (existing) => existing.observedAt.getTime() === row.observedAt.getTime(),
    );
    if (isDuplicate) return ok(undefined); // first-write-wins (WR-01) — no-op, mirrors onConflictDoNothing
    rows.push(row); // append-only (D-06) — never replaces an existing row
    return ok(undefined);
  };

  const readPickerSnapshot: ForReadingPickerSnapshot = async (): Promise<
    Result<PickerSnapshotRow | null, StorageError>
  > => {
    if (rows.length === 0) return ok(null);
    const latest = rows.reduce((max, row) =>
      row.observedAt.getTime() > max.observedAt.getTime() ? row : max,
    );
    return ok(latest);
  };

  const countSnapshots = async (): Promise<number> => rows.length;

  return { insertPickerSnapshot, readPickerSnapshot, countSnapshots };
}
