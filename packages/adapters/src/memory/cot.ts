import { ok, err } from "@morai/shared";
import type { Result } from "@morai/shared";
import type { ForFetchingCotReport, CotReport, FetchError } from "@morai/core";

/**
 * makeMemoryCotReportAdapter — in-memory twin of the CFTC Socrata COT adapter.
 *
 * Implements ForFetchingCotReport using a stored CotReport (null = unseeded).
 * Exposes `seed(report)` for test setup.
 *
 * No fabricated fallback (landmine 4 parity with the real adapter):
 * unseeded `fetchReport` returns err(FetchError), never a fake report.
 *
 * Architectural rule: every driven port change updates the in-memory adapter
 * in the same PR (architecture-boundaries.md §8).
 */
export type MemoryCotReportAdapter = {
  readonly fetchReport: ForFetchingCotReport;
  readonly seed: (report: CotReport) => void;
};

export function makeMemoryCotReportAdapter(): MemoryCotReportAdapter {
  // Backing store: single CotReport (null = unseeded, unlike FRED which has a fallback)
  let stored: CotReport | null = null;

  const fetchReport: ForFetchingCotReport = async (
    _contractCode: string,
  ): Promise<Result<CotReport, FetchError>> => {
    // Landmine 4: unseeded → err (no fabricated report, unlike makeMemoryRateAdapter)
    if (stored === null) {
      return err({
        kind: "fetch-error",
        message: "MemoryCotReportAdapter: not seeded — call seed() first",
      });
    }
    return ok(stored);
  };

  const seed = (report: CotReport): void => {
    stored = report;
  };

  return { fetchReport, seed };
}
