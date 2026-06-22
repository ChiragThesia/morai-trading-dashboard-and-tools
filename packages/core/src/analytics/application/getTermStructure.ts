/**
 * makeGetTermStructureUseCase — the get_term_structure use-case (ANLY-03 read surface).
 *
 * Thin forwarder over ForReadingTermStructureSeries (getJournal precedent). Passes the optional
 * calendarId filter through and returns the port's Result unchanged:
 *   - ok([])        → no data (drives a contract-valid empty array at the edge, never an error)
 *   - ok([...rows]) → ordered term-structure series
 *   - err(StorageError) → propagated to the adapter
 *
 * No business logic here — just dependency injection of the driven port.
 */

import type { ForReadingTermStructureSeries } from "./ports.ts";

/** Driver port — re-uses ForReadingTermStructureSeries directly (thin forwarder). */
export type ForRunningGetTermStructure = ForReadingTermStructureSeries;

export type GetTermStructureDeps = {
  readonly readTermStructureSeries: ForReadingTermStructureSeries;
};

export function makeGetTermStructureUseCase(
  deps: GetTermStructureDeps,
): ForRunningGetTermStructure {
  return (query) => deps.readTermStructureSeries(query);
}
