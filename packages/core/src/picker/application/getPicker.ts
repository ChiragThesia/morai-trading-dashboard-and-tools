/**
 * makeGetPickerUseCase — the get-picker read use-case (PICK-02).
 *
 * Thin forwarder over ForReadingPickerSnapshot (getGex.ts precedent — same shape, renamed
 * types). Returns the latest stored PickerSnapshotRow, or ok(null) when no snapshot exists yet.
 * D-04: the picker snapshot is NEVER re-derived on read — this is a pure DB read of the stored
 * row (write-once-then-read, mirrors GEX).
 *
 * Passes the Result unchanged:
 *   - ok(row)            → snapshot exists
 *   - ok(null)           → no snapshot yet (clean cold-start case, D-18)
 *   - err(StorageError)  → propagated to the adapter
 *
 * No business logic here — just dependency injection of the driven port.
 * Hexagon law (architecture-boundaries §2): imports only @morai/shared + local ports.
 */

import type { ForReadingPickerSnapshot, ForRunningGetPicker, PickerSnapshotRow, StorageError } from "./ports.ts";
import type { Result } from "@morai/shared";

export type GetPickerDeps = {
  readonly readPickerSnapshot: ForReadingPickerSnapshot;
};

export function makeGetPickerUseCase(deps: GetPickerDeps): ForRunningGetPicker {
  return (): Promise<Result<PickerSnapshotRow | null, StorageError>> => deps.readPickerSnapshot();
}
