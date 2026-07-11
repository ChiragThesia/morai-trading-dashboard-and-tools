/**
 * AnalyzerMobile — the dedicated mobile Analyzer tree root (Phase 36, D-01/D-06).
 *
 * This plan (36-01) lands the skeleton root only: the switch mounts it below 1024px and the
 * shared model hook is wired live from day one. The real sections — paste row, candidates +
 * fold, scorecard hero, full-bleed chart, and the term/why/plan disclosures — land in plan
 * 36-02 (UI-SPEC §4).
 *
 * Root owns no horizontal padding (sections own `px-4`; the chart section owns `px-0`).
 *
 * No any/as/!.
 */
import { useAnalyzerModel } from "./useAnalyzerModel.ts";

export function AnalyzerMobile(): React.ReactElement {
  // Live from day one so the shared model runs under the mobile branch (D-02). The sections
  // that consume its slices land in plan 36-02.
  useAnalyzerModel();

  return (
    <div data-testid="analyzer-mobile-root" className="flex flex-col gap-6 pb-10 pt-4">
      {/* Sections (paste · candidates · scorecard · chart · disclosures) land in plan 36-02. */}
    </div>
  );
}
