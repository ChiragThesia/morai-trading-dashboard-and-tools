/**
 * candidate-to-position.ts — Candidate → AnalyzerPosition adapter (Phase 18, D-02/D-02b, ANLZ-02)
 *
 * Converts one PickerCandidate (contract-typed, hypothetical calendar) into one throwaway,
 * view-only AnalyzerPosition so the picker screen can feed it into the existing repriceScenario/
 * PayoffChart stack — the ONE payoff engine (D-02: "no second payoff code path").
 *
 * Pattern source: apps/web/src/screens/Analyzer.tsx's private calendarToAnalyzerPosition
 * (imitated, never imported — that function is shaped for broker CalendarGroup legs, which
 * require longQty/shortQty/BrokerPositionResponse fields a hypothetical candidate doesn't have;
 * see 18-RESEARCH.md Pitfall 2).
 */

import type { AnalyzerPosition } from "./scenario-engine.ts";
import type { PickerCandidate } from "@morai/contracts";

/**
 * Synthesize an OCC-shaped 21-char symbol carrying only the strike (positions 13-20, in
 * thousandths of a dollar) and putCall (position 12) — the fields scenario-engine.ts's
 * extractStrike reads. The date field is zeroed out since this symbol never represents a real,
 * tradable broker contract (D-02b) — never a real broker symbol.
 */
function occSymbolForStrike(strike: number, putCall: "C" | "P"): string {
  const thousandths = Math.round(strike * 1000).toString().padStart(8, "0");
  return `SPX   000000${putCall}${thousandths}`;
}

/**
 * Map one scored PickerCandidate into the one view-only AnalyzerPosition repriceScenario needs
 * (D-02). `live` is always false — a candidate-derived position is never a real broker position
 * (D-02b), so it must never be mistaken for one downstream.
 */
export function candidateToAnalyzerPosition(candidate: PickerCandidate): AnalyzerPosition {
  return {
    id: candidate.id,
    name: candidate.name,
    live: false,
    occSymbol: occSymbolForStrike(candidate.backLeg.strike, candidate.backLeg.putCall),
    putCall: candidate.backLeg.putCall,
    frontDte: candidate.frontLeg.dte,
    backDte: candidate.backLeg.dte,
    frontIv: candidate.frontLeg.iv,
    backIv: candidate.backLeg.iv,
    qty: 1,
    included: true,
  };
}
