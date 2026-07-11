/**
 * OverviewMobile — the dedicated mobile Overview tree (35.1, <1024px branch of the
 * Overview switch). Skeleton this plan: sections land in plans 02-04 — MobileHero →
 * MobileRiskPanel → positions cards → MobileMarketSection (UI-SPEC §Screen Composition).
 * No horizontal padding on the root; sections own their px-4 (the chart section owns px-0).
 */
import { useOverviewModel } from "./useOverviewModel.ts";

export function OverviewMobile(): React.ReactElement {
  // D-01: only one tree mounts, and the model hook is the surface's single
  // useLiveStream consumer — called here from day one so the invariant holds
  // before any mobile sections exist.
  useOverviewModel();

  return (
    <div data-testid="overview-mobile-root" className="flex flex-col gap-6 pb-10">
      {/* Plans 02-04: MobileHero / MobileRiskPanel / positions section / MobileMarketSection. */}
    </div>
  );
}
