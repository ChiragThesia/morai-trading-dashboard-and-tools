/**
 * makeGetGexUseCase — the get-gex read use-case (GEX-01 / SC-1 read surface).
 *
 * Thin forwarder over ForReadingGexSnapshot (getSkew/getTermStructure precedent).
 * Returns the latest stored GexSnapshotRow, or ok(null) when no snapshot exists yet.
 * D-01: GEX is NEVER recomputed on read — this is a pure DB read of the stored row.
 *
 * Passes the Result unchanged:
 *   - ok(row)         → snapshot exists
 *   - ok(null)        → no snapshot yet (clean no-data case)
 *   - err(StorageError) → propagated to the adapter
 *
 * No business logic here — just dependency injection of the driven port.
 * Hexagon law (architecture-boundaries §2): imports only @morai/shared + local ports.
 */

import type { ForReadingGexSnapshot, GexSnapshotRow, StorageError } from "./ports.ts";
import type { Result } from "@morai/shared";

export type GetGexDeps = {
  readonly readGexSnapshot: ForReadingGexSnapshot;
};

/** Driver port returned by the factory — thin forwarder over ForReadingGexSnapshot. */
export type ForRunningGetGex = () => Promise<Result<GexSnapshotRow | null, StorageError>>;

export function makeGetGexUseCase(deps: GetGexDeps): ForRunningGetGex {
  return () => deps.readGexSnapshot();
}
