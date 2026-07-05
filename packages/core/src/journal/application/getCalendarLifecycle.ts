/**
 * getCalendarLifecycle use-case (JRNL-01, 22-03) — the enriched-series read path.
 *
 * Thin forwarder over the EXISTING ForReadingJournal port (no new port, no new adapter,
 * no schema change): maps each row through computeForwardVol (22-01) + computeAttributionSeries
 * (22-02), preserving the ok(null)/ok([])/err(...) three-way Result contract that drives
 * 404-vs-200-empty at the route layer (see getJournal.ts).
 *
 * `guard` (computeForwardVol's own field name) is mapped explicitly to `forwardVolGuard` —
 * never spread blindly, which would leak a stray `guard` key and omit `forwardVolGuard`.
 *
 * Pure application logic: no I/O beyond the injected port, no try/catch (Result propagates).
 */

import { ok, err, assertDefined } from "@morai/shared";
import type { Result } from "@morai/shared";
import type { ForReadingJournal, SnapshotRow, StorageError } from "./ports.ts";
import { computeForwardVol } from "../domain/fwd-vol.ts";
import { computeAttributionSeries } from "../domain/attribution.ts";
import type { AttributionPoint } from "../domain/attribution.ts";

/** Enriched per-snapshot row: original SnapshotRow fields + forward-vol + attribution. */
export type LifecycleSnapshot = SnapshotRow & {
  readonly forwardVol: number | null;
  readonly forwardVolGuard: "ok" | "inverted";
} & AttributionPoint;

export type GetCalendarLifecycleDeps = { readonly readJournal: ForReadingJournal };

export type ForRunningGetCalendarLifecycle = (
  calendarId: string,
) => Promise<Result<ReadonlyArray<LifecycleSnapshot> | null, StorageError>>;

export function makeGetCalendarLifecycleUseCase(
  deps: GetCalendarLifecycleDeps,
): ForRunningGetCalendarLifecycle {
  return async (calendarId) => {
    const result = await deps.readJournal(calendarId);
    if (!result.ok) return err(result.error);
    if (result.value === null) return ok(null);

    const rows = result.value;
    const fwdVols = rows.map(computeForwardVol);
    const attribution = computeAttributionSeries(rows);

    return ok(
      rows.map((row, i) => {
        const fwdVol = fwdVols[i];
        const point = attribution[i];
        // Both arrays are mapped 1:1 from `rows` — always defined at index i.
        assertDefined(fwdVol, `fwdVols[${i}]`);
        assertDefined(point, `attribution[${i}]`);
        return {
          ...row,
          forwardVol: fwdVol.forwardVol,
          forwardVolGuard: fwdVol.guard,
          ...point,
        };
      }),
    );
  };
}
