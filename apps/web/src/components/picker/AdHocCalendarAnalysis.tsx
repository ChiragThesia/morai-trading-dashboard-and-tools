/**
 * AdHocCalendarAnalysis.tsx — top-of-Analyzer paste-to-analyze panel.
 *
 * Paste a Thinkorswim calendar order → parse (tos-parser) → adapt to an AnalyzerPosition →
 * reprice through the SAME engine as the fixture cards (repriceScenario) → payoff readout:
 * PayoffChart + scenario strip + "debit = max loss". A pasted calendar is NOT scored/ranked —
 * that's the Phase-19 engine — so the panel says "scoring in Phase 19" and shows no why-panel.
 *
 * Fully self-contained: owns the input/parsed/error state; `today/spot/rate/gex` are props so
 * the parse (DTE from today) and the reprice (spot/rate) are deterministic and testable.
 */
import { useCallback, useMemo, useState } from "react";
import { Panel, PanelHeading } from "../system/index.tsx";
import { PayoffChart } from "../charts/PayoffChart.tsx";
import { ScenarioStrip } from "./ScenarioStrip.tsx";
import { parseTosOrder } from "../../lib/tos-parser.ts";
import type { ParsedCalendar } from "../../lib/tos-parser.ts";
import { parsedCalendarToAnalyzerPosition } from "../../lib/parsed-calendar-to-position.ts";
import { repriceScenario } from "../../lib/scenario-engine.ts";

const DEFAULT_DIV = 0.013;
const BTN =
  "cursor-pointer rounded-[3px] border border-line2 bg-transparent px-2.5 py-1 font-mono text-[10px] text-dim hover:text-txt";

function noop(): void {}

export interface AdHocCalendarAnalysisProps {
  /** Reference date the pasted order's DTEs are computed from (Analyzer passes its stable today). */
  readonly today: Date;
  readonly spot: number;
  readonly rate: number;
  readonly gex: { readonly putWall: number; readonly flip: number; readonly callWall: number };
}

export function AdHocCalendarAnalysis({
  today,
  spot,
  rate,
  gex,
}: AdHocCalendarAnalysisProps): React.ReactElement {
  const [text, setText] = useState<string>("");
  const [parsed, setParsed] = useState<ParsedCalendar | null>(null);
  const [error, setError] = useState<string | null>(null);

  const handleAnalyze = useCallback((): void => {
    const result = parseTosOrder(text, today, spot, rate);
    if (result === null) {
      setError(
        "Couldn't read that. Paste a TOS calendar order, e.g. BUY +1 CALENDAR SPX 100 18 SEP 26 [AM]/14 AUG 26 7425 PUT @48.75 LMT GTC",
      );
      setParsed(null);
      return;
    }
    setError(null);
    setParsed(result);
  }, [text, today, spot, rate]);

  const handleClear = useCallback((): void => {
    setText("");
    setParsed(null);
    setError(null);
  }, []);

  const analysis = useMemo(() => {
    if (parsed === null) return null;
    const position = parsedCalendarToAnalyzerPosition(parsed);
    const result = repriceScenario([position], {
      spot,
      daysForward: 0,
      ivShift: 0,
      rate,
      divYield: DEFAULT_DIV,
    });
    return { position, result };
  }, [parsed, spot, rate]);

  return (
    <Panel>
      <div className="mb-2 flex items-center justify-between gap-2">
        <PanelHeading title="Analyze a pasted calendar" />
        {parsed !== null && (
          <button type="button" data-testid="adhoc-clear" onClick={handleClear} className={BTN}>
            Clear
          </button>
        )}
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <input
          type="text"
          data-testid="adhoc-input"
          value={text}
          onChange={(e) => { setText(e.target.value); }}
          placeholder="BUY +1 CALENDAR SPX 100 18 SEP 26 [AM]/14 AUG 26 7425 PUT @48.75 LMT GTC"
          className="min-w-0 flex-1 rounded-[3px] border border-line2 bg-transparent px-2 py-1 font-mono text-[11px] text-txt"
        />
        <button type="button" data-testid="adhoc-analyze" onClick={handleAnalyze} className={BTN}>
          Analyze
        </button>
      </div>

      {error !== null && (
        <p data-testid="adhoc-error" className="mt-2 font-mono text-[10px] text-down">
          {error}
        </p>
      )}

      {parsed !== null && analysis !== null && (
        <div className="mt-3">
          <p data-testid="adhoc-summary" className="mb-1.5 font-mono text-[10px] text-dim">
            <span className="text-violet">
              {`${parsed.strike}${parsed.type} · ${parsed.frontDte}/${parsed.backDte} DTE · flat IV ${(parsed.iv * 100).toFixed(1)}%`}
            </span>
            {` · Debit = max loss $${Math.round(parsed.debit * 100 * parsed.qty).toLocaleString("en-US")}`}
            <span className="ml-2 text-amber">scoring in Phase 19</span>
          </p>
          <PayoffChart
            todayCurve={analysis.result.payoffCurve}
            fanCurves={[]}
            expirationCurve={analysis.result.expirationCurve}
            rollCurve={null}
            gex={{ callWall: gex.callWall, putWall: gex.putWall, flip: gex.flip }}
            spot={spot}
            toggles={{ showFan: false, showExpiration: true, showWalls: true, showProfitZone: true }}
            fitY={false}
            onFitYConsumed={noop}
            positionSetSignature={`adhoc-${parsed.strike}-${parsed.frontDte}-${parsed.backDte}`}
            baseExpirationCurve={analysis.result.expirationCurve}
          />
          <ScenarioStrip
            position={analysis.position}
            levels={{ putWall: gex.putWall, flip: gex.flip, callWall: gex.callWall }}
            spot={spot}
            todayCurve={analysis.result.payoffCurve}
            expirationCurve={analysis.result.expirationCurve}
          />
        </div>
      )}
    </Panel>
  );
}
