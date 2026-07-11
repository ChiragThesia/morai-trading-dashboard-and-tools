/**
 * MobileRiskPanel — the mobile Overview chart block (35.1, D-05/D-06/D-09/D-13; row
 * slimmed per user UAT feedback 2026-07-11).
 *
 * ONE slim control row above a full-bleed PayoffChart: ghost `‹ › ` steppers around a
 * date PILL + a `⋯` overflow Dialog. The pill opens a Projection dialog (quick jump
 * chips + day slider + exact date input); the ⋯ Dialog holds ALL series toggles
 * (@ exp/Fan/Walls/Profit zone — same toggle state object the desktop uses, no second
 * store). Freshness reduces to one 9px caption line below the chart with a single
 * worst-of dot. Fully controlled — the model hook feeds every prop; PayoffChart
 * internals are untouched (D-06: mobile differences enter only via
 * showBePills/aspectRatio/highlightedPositionId).
 */
import { cn } from "@/lib/utils";
import type { GexSnapshotEntry } from "@morai/contracts";
import { PayoffChart } from "../../components/charts/PayoffChart.tsx";
import type { PayoffChartToggles } from "../../components/charts/PayoffChart.tsx";
import { MobileChartControls } from "../../components/charts/MobileChartControls.tsx";
import type { PayoffPoint, SpotDomain } from "../../lib/scenario-engine.ts";
import type { PayoffDateControl } from "../../hooks/usePayoffDateControl.ts";
import { relAge } from "../Market.tsx";

const noop = (): void => {};

export interface MobileRiskPanelProps {
  readonly scenario: {
    readonly payoffCurve: ReadonlyArray<PayoffPoint>;
    readonly expirationCurve: ReadonlyArray<PayoffPoint>;
  };
  readonly payoffDomain: SpotDomain;
  readonly spot: number;
  readonly gex: GexSnapshotEntry | undefined;
  readonly toggles: PayoffChartToggles;
  readonly onToggle: (key: keyof PayoffChartToggles) => void;
  readonly dateControl: PayoffDateControl;
  /** bounds.minIso IS today's ISO by the usePayoffDateControl/computeProjectionBounds
   *  contract — offsets and the slider range derive from it, dependency-free. */
  readonly bounds: { readonly minIso: string; readonly maxIso: string };
  readonly positionSetSignature: string;
  readonly excludedFromT0Count: number;
  readonly freshness: {
    readonly gexFresh: boolean;
    readonly gexAsOf: string;
    readonly gexAgeMs: number | null;
    readonly markFresh: boolean;
    readonly markAsOf: string;
    readonly markAgeMs: number | null;
  };
}

export function MobileRiskPanel({
  scenario,
  payoffDomain,
  spot,
  gex,
  toggles,
  onToggle,
  dateControl,
  bounds,
  positionSetSignature,
  excludedFromT0Count,
  freshness,
}: MobileRiskPanelProps): React.ReactElement {
  // Same {callWall,putWall,flip} mapping as the desktop call site.
  const gexWalls =
    gex !== undefined ? { callWall: gex.callWall, putWall: gex.putWall, flip: gex.flip } : null;
  const bothFresh = freshness.gexFresh && freshness.markFresh;
  const gexAgeSegment = freshness.gexAgeMs !== null ? ` · ${relAge(freshness.gexAgeMs)}` : "";
  const markAgeSegment = freshness.markAgeMs !== null ? ` · ${relAge(freshness.markAgeMs)}` : "";

  return (
    <section>
      {/* ONE slim control row — shared chrome extracted to MobileChartControls (D-05). */}
      <MobileChartControls
        dateControl={dateControl}
        bounds={bounds}
        toggles={toggles}
        onToggle={onToggle}
      />

      {/* Chart — full-bleed (the section owns px-0; row and caption own px-4, D-05/D-06). */}
      <div data-testid="mobile-payoff" className="mt-2 w-full">
        <PayoffChart
          todayCurve={scenario.payoffCurve}
          fanCurves={[]}
          expirationCurve={scenario.expirationCurve}
          rollCurve={null}
          gex={gexWalls}
          domain={payoffDomain}
          spot={spot}
          toggles={toggles}
          fitY={false}
          onFitYConsumed={noop}
          positionSetSignature={positionSetSignature}
          baseExpirationCurve={scenario.expirationCurve}
          excludedFromT0Count={excludedFromT0Count}
          highlightedPositionId={null}
          showBePills={false}
          aspectRatio={1.3}
        />
      </div>

      {/* Single worst-of freshness caption (D-05). */}
      <div
        data-testid="mobile-freshness"
        className="flex items-center gap-1.5 px-4 mt-1.5 font-mono text-[9px] text-dim"
      >
        <span
          className={cn("size-1.5 shrink-0 rounded-full", bothFresh ? "bg-up" : "bg-amber")}
        />
        <span className="truncate">
          GEX {freshness.gexAsOf}
          {gexAgeSegment} · mark {freshness.markAsOf}
          {markAgeSegment}
        </span>
      </div>
    </section>
  );
}
