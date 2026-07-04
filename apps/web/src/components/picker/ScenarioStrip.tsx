/**
 * ScenarioStrip — T+0/@exp P&L grid at the 5 key spot levels (ANLZ-02, D-02/D-06): put wall,
 * γ flip, spot, call wall, and the selected candidate's own strike.
 *
 * Reuses scenario-engine.ts's `buildScenarioStrip` verbatim for level selection (dedup + cap —
 * the same logic Overview.tsx's payoff hero uses) and reads T+0/@exp values off the SAME
 * `repriceScenario` curves the payoff chart already drew — no second pricing path (D-02).
 */
import { buildScenarioStrip } from "../../lib/scenario-engine.ts";
import type { AnalyzerPosition, ScenarioStripLevels, PayoffPoint } from "../../lib/scenario-engine.ts";
import { cn } from "@/lib/utils";

/** Nearest curve point's P&L for a given spot level — same nearest-point convention Overview.tsx's
 * own scenario strip (`nearestCurveValue`) and PayoffChart's own spot-dot readout already use. */
function nearestCurveValue(curve: ReadonlyArray<PayoffPoint>, level: number): number {
  let best: PayoffPoint | null = null;
  for (const p of curve) {
    if (best === null || Math.abs(p.spot - level) < Math.abs(best.spot - level)) best = p;
  }
  return best?.pl ?? 0;
}

function signedUsd(v: number): string {
  return `${v >= 0 ? "+" : "−"}$${Math.abs(v).toFixed(0)}`;
}

function signClass(v: number): string {
  return v >= 0 ? "text-up" : "text-down";
}

export interface ScenarioStripProps {
  /** The single adapted candidate position the strip evaluates (D-02: one payoff engine). */
  readonly position: AnalyzerPosition;
  /** GEX key levels (put wall / flip / call wall) — any may be null (omitted, not zeroed). */
  readonly levels: ScenarioStripLevels;
  readonly spot: number;
  readonly todayCurve: ReadonlyArray<PayoffPoint>;
  readonly expirationCurve: ReadonlyArray<PayoffPoint>;
}

export function ScenarioStrip({
  position,
  levels,
  spot,
  todayCurve,
  expirationCurve,
}: ScenarioStripProps): React.ReactElement | null {
  const strip = buildScenarioStrip(levels, [position], spot);

  if (strip.levels.length === 0) return null;

  return (
    <div
      data-testid="scenario-strip"
      className="mt-2 grid items-center gap-1 text-right font-mono text-[10px]"
      style={{ gridTemplateColumns: `70px repeat(${strip.levels.length}, 1fr)` }}
    >
      <span className="text-left text-dim">SPX →</span>
      {strip.levels.map((lvl) => (
        <span key={`lvl-${lvl}`} data-testid={`scenario-strip-level-${lvl}`} className="text-dim">
          {Math.round(lvl)}
        </span>
      ))}
      <span className="text-left text-dim">T+0</span>
      {strip.levels.map((lvl) => {
        const v = nearestCurveValue(todayCurve, lvl);
        return (
          <span
            key={`t0-${lvl}`}
            data-testid={`scenario-strip-t0-${lvl}`}
            className={cn("rounded-sm bg-raise px-1.5 py-0.5", signClass(v))}
          >
            {signedUsd(v)}
          </span>
        );
      })}
      <span className="text-left text-dim">@ exp</span>
      {strip.levels.map((lvl) => {
        const v = nearestCurveValue(expirationCurve, lvl);
        return (
          <span
            key={`exp-${lvl}`}
            data-testid={`scenario-strip-exp-${lvl}`}
            className={cn("rounded-sm bg-raise px-1.5 py-0.5", signClass(v))}
          >
            {signedUsd(v)}
          </span>
        );
      })}
    </div>
  );
}
