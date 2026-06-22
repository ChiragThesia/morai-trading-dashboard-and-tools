/**
 * makeGetSkewUseCase — the get_skew read use-case (ANLY-03 / SPEC R5 read surface).
 *
 * Thin forwarder over ForReadingSkewSeries (getJournal/getTermStructure precedent). The "skew" read
 * surface returns the HEADLINE risk-reversal series (value = risk_reversal, with rr_rank +
 * underlying/expiration) — NOT the per-strike smile detail. Passes the optional underlying/
 * expiration filter through and returns the port's Result unchanged:
 *   - ok([])        → no data (drives a contract-valid empty array at the edge, never an error)
 *   - ok([...rows]) → ordered risk-reversal series
 *   - err(StorageError) → propagated to the adapter
 *
 * No business logic here — just dependency injection of the driven port.
 */

import type { ForReadingSkewSeries } from "./ports.ts";

/** Driver port — re-uses ForReadingSkewSeries directly (thin forwarder). */
export type ForRunningGetSkew = ForReadingSkewSeries;

export type GetSkewDeps = {
  readonly readSkewSeries: ForReadingSkewSeries;
};

export function makeGetSkewUseCase(deps: GetSkewDeps): ForRunningGetSkew {
  return (query) => deps.readSkewSeries(query);
}
