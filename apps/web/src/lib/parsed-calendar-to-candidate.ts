/**
 * parsed-calendar-to-candidate.ts — ParsedCalendar → PickerCandidate adapter (ad-hoc paste).
 *
 * Builds a lean, synthetic PickerCandidate from a user-pasted TOS calendar order so it can sit
 * in the same "Suggested calendars" rail and drive the same shared
 * candidate→position→repriceScenario payoff path as engine-scored candidates (D-02: one payoff
 * code path). A pasted calendar has no engine score, no breakdown, no greeks — every score/
 * breakdown/greek field is zeroed/empty rather than fabricated (lean per the paste redesign
 * decision: no fake θ/vega). The caller supplies a unique `id` (multi-paste redesign) so
 * several pasted cards can coexist in the rail.
 */
import { pickerCandidate } from "@morai/contracts";
import type { PickerCandidate } from "@morai/contracts";
import type { ParsedCalendar } from "./tos-parser.ts";

export function parsedCalendarToPickerCandidate(parsed: ParsedCalendar, id: string): PickerCandidate {
  const leg = { strike: parsed.strike, putCall: parsed.type, dte: parsed.frontDte, iv: parsed.iv };
  const candidate: PickerCandidate = {
    id,
    name: `${parsed.strike}${parsed.type} · pasted`,
    score: 0,
    breakdown: [],
    debit: (parsed.debit ?? 0) * 100 * parsed.qty,
    theta: 0,
    vega: 0,
    delta: 0,
    gamma: null,
    fwdIv: null,
    fwdIvGuard: "ok",
    slope: 0,
    fwdEdge: 0,
    expectedMove: 0,
    frontEvents: [],
    backEvents: [],
    frontLeg: leg,
    backLeg: { ...leg, dte: parsed.backDte },
    exitPlan: {
      profitTargetPct: 0.25,
      stopPct: 0.175,
      manageShortDte: 21,
      closeByExpiry: "",
      thetaCapturePct: null,
    },
  };
  return pickerCandidate.parse(candidate);
}
