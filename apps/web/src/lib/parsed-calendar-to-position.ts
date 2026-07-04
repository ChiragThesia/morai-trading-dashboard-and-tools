/**
 * parsed-calendar-to-position.ts — ParsedCalendar → AnalyzerPosition adapter (ad-hoc analysis).
 *
 * The paste-in counterpart of candidate-to-position.ts: takes a TOS order the user pasted
 * (parsed by tos-parser) and produces one throwaway, view-only AnalyzerPosition so the pasted
 * calendar feeds the SAME repriceScenario/PayoffChart stack as the fixture candidates — the one
 * payoff engine (D-02). tos-parser bisects a single flat IV, so both legs get that same IV.
 *
 * `live` is always false — a pasted, hypothetical calendar is never a real broker position.
 */
import type { AnalyzerPosition } from "./scenario-engine.ts";
import type { ParsedCalendar } from "./tos-parser.ts";
import { occSymbolForStrike } from "./candidate-to-position.ts";

export function parsedCalendarToAnalyzerPosition(parsed: ParsedCalendar): AnalyzerPosition {
  return {
    id: "adhoc",
    name: `${parsed.strike}${parsed.type} · pasted calendar`,
    live: false,
    occSymbol: occSymbolForStrike(parsed.strike, parsed.type),
    putCall: parsed.type,
    frontDte: parsed.frontDte,
    backDte: parsed.backDte,
    frontIv: parsed.iv,
    backIv: parsed.iv,
    qty: parsed.qty,
    included: true,
  };
}
