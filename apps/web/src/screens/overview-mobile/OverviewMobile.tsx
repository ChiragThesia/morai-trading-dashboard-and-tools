/**
 * OverviewMobile — the dedicated mobile Overview tree (35.1, <1024px branch of the
 * Overview switch). Hero-first per UI-SPEC §Screen Composition: MobileHero →
 * MobileRiskPanel; positions cards land in plan 03, MobileMarketSection in plan 04.
 * No horizontal padding on the root; sections own their px-4 (the chart section owns px-0).
 */
import { useOverviewModel } from "./useOverviewModel.ts";
import { MobileHero } from "./MobileHero.tsx";
import { MobileRiskPanel } from "./MobileRiskPanel.tsx";

export function OverviewMobile(): React.ReactElement {
  // D-01: only one tree mounts, and the model hook is the surface's single
  // useLiveStream consumer.
  const m = useOverviewModel();

  return (
    <div data-testid="overview-mobile-root" className="flex flex-col gap-6 pb-10">
      {/* Hero spot comes from gex — null (→ "—") when the snapshot is absent, never the
          model's 5800 pricing fallback (Copywriting Contract per-segment rule). */}
      <MobileHero
        bookPnl={m.bookPnl}
        hasPositions={m.positions.length > 0}
        spot={m.gex?.spot ?? null}
        vix={m.macroValues.vix}
        regime={m.regime}
      />
      <MobileRiskPanel
        scenario={m.scenario}
        payoffDomain={m.payoffDomain}
        spot={m.spot}
        gex={m.gex}
        toggles={m.toggles}
        onToggle={m.handleToggle}
        dateControl={m.dateControl}
        bounds={m.bounds}
        positionSetSignature={m.positionSetSignature}
        excludedFromT0Count={m.excludedFromT0Count}
        freshness={m.freshness}
      />
      {/* Plans 03-04: positions section / MobileMarketSection. */}
    </div>
  );
}
