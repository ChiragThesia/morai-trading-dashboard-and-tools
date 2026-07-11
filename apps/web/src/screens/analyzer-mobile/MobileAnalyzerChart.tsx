/**
 * MobileAnalyzerChart — the mobile Analyzer chart block (Phase 36, D-09).
 *
 * ONE slim chrome row (the shared MobileChartControls, D-05) above a full-bleed PayoffChart, then
 * a single 9px worst-of caption. The section owns `px-0` so the chart bleeds edge-to-edge; the
 * control row and caption own their own `px-4`. PayoffChart mounts with the Analyzer-specific
 * props it carries on desktop (picker curve colors, EM band, snapshot GEX walls) PLUS the 35.1
 * mobile props (`showBePills={false}` / `aspectRatio={1.3}` / `highlightedPositionId={null}`).
 *
 * The center-panel `⧉ Copy TOS order` button does NOT render here (D-09) — every CandidateCard
 * already carries its own copy affordance.
 *
 * No any/as/!.
 */
import { cn } from "@/lib/utils";
import type { PickerCandidate, PickerSnapshotResponse } from "@morai/contracts";
import { PayoffChart } from "../../components/charts/PayoffChart.tsx";
import type { PayoffChartToggles } from "../../components/charts/PayoffChart.tsx";
import { MobileChartControls } from "../../components/charts/MobileChartControls.tsx";
import type { ScenarioResult, SpotDomain } from "../../lib/scenario-engine.ts";
import type { PayoffDateControl } from "../../hooks/usePayoffDateControl.ts";
import { TODAY_CURVE_COLOR, EXPIRATION_CURVE_COLOR } from "./useAnalyzerModel.ts";

function noop(): void {}

export interface MobileAnalyzerChartProps {
  readonly selected: PickerCandidate;
  readonly scenarioResult: ScenarioResult;
  /** Non-null by the caller's chart-block gate (WR-01/catch #26): the chart never
   *  prices without a snapshot, so provenance is never fabricated here. */
  readonly snapshot: PickerSnapshotResponse;
  readonly payoffDomain: SpotDomain;
  readonly spot: number;
  readonly toggles: PayoffChartToggles;
  readonly onToggle: (key: keyof PayoffChartToggles) => void;
  readonly dateControl: PayoffDateControl;
  readonly bounds: { readonly minIso: string; readonly maxIso: string };
  readonly positionSetSignature: string;
}

export function MobileAnalyzerChart({
  selected,
  scenarioResult,
  snapshot,
  payoffDomain,
  spot,
  toggles,
  onToggle,
  dateControl,
  bounds,
  positionSetSignature,
}: MobileAnalyzerChartProps): React.ReactElement {
  // Worst-of caption dot: fresh only when both context statuses are "ok" AND session is RTH.
  const session = snapshot.marketSession;
  const contextsOk = snapshot.gexContextStatus === "ok" && snapshot.eventsContextStatus === "ok";
  const freshDot = contextsOk && session === "rth";

  return (
    <section className="px-0">
      {/* ONE slim control row — the shared chrome (D-05); owns its own px-4. */}
      <MobileChartControls dateControl={dateControl} bounds={bounds} toggles={toggles} onToggle={onToggle} />

      {/* Chart — full-bleed (section owns px-0). */}
      <div className="mt-2 w-full">
        <PayoffChart
          todayCurve={scenarioResult.payoffCurve}
          fanCurves={[]}
          expirationCurve={scenarioResult.expirationCurve}
          rollCurve={null}
          gex={{
            callWall: snapshot.gex.callWall,
            putWall: snapshot.gex.putWall,
            flip: snapshot.gex.flip,
          }}
          domain={payoffDomain}
          spot={spot}
          toggles={toggles}
          fitY={false}
          onFitYConsumed={noop}
          positionSetSignature={positionSetSignature}
          baseExpirationCurve={scenarioResult.expirationCurve}
          todayCurveColor={TODAY_CURVE_COLOR}
          expirationCurveColor={EXPIRATION_CURVE_COLOR}
          expectedMoveBand={selected.expectedMove > 0 ? { spot, em: selected.expectedMove } : null}
          highlightedPositionId={null}
          showBePills={false}
          aspectRatio={1.3}
        />
      </div>

      {/* Single worst-of caption. */}
      <div
        data-testid="analyzer-mobile-caption"
        className="mt-1.5 flex items-center gap-1.5 px-4 font-mono text-[9px] text-dim"
      >
        <span className={cn("size-1.5 shrink-0 rounded-full", freshDot ? "bg-up" : "bg-amber")} />
        <span className="truncate">
          {snapshot.source} · {snapshot.asOf}
          {session === "after-hours" && " · AH — indicative"}
        </span>
      </div>
    </section>
  );
}
