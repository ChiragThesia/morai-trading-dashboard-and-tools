/**
 * calendar-rank-dto.ts — the calendar engine's two seam mappings, shared by its HTTP route and
 * its MCP tool so neither adapter carries logic of its own (architecture-boundaries §3).
 *
 * Same job as status-dto.ts: core carries a `Date`, the wire contract carries an ISO string, and
 * handing the raw payload to `.parse()` throws (Date != string). Everything else on
 * `CalendarRanking` is already JSON-primitive, so this is a one-field conversion plus two array
 * copies (core returns ReadonlyArray; the inferred contract type wants a mutable array).
 *
 * The `body: RankedCalendarResponse` annotation is deliberate and load-bearing: it is the ONLY
 * compile-time link between the core ranking type and the hand-mirrored Zod schema. Parsing an
 * `unknown` would type-check no matter how far the two drifted. With the annotation, a contract
 * field the engine does not produce — or produces with a different nullability — fails
 * `bun run typecheck` rather than the first real request.
 */

import { rankedCalendarResponse } from "@morai/contracts";
import type { RankCalendarsQuery, RankedCalendarResponse } from "@morai/contracts";
import type { CalendarRanking, RankCalendarsRequest } from "@morai/core";

/**
 * Map validated query params to the use-case request.
 *
 * Absent params are OMITTED rather than passed as `undefined` — exactOptionalPropertyTypes
 * forbids the assignment, and `{ limit: undefined }` would also override the use-case's own
 * default in any callee that tests key presence.
 */
export function toRankCalendarsRequest(query: RankCalendarsQuery): RankCalendarsRequest {
  return {
    ...(query.frontDteMax === undefined ? {} : { frontDteMax: query.frontDteMax }),
    ...(query.limit === undefined ? {} : { limit: query.limit }),
    ...(query.contractType === undefined ? {} : { contractType: query.contractType }),
  };
}

/** Map the core ranking to the validated wire body (asOf Date → ISO string). */
export function toRankedCalendarBody(ranking: CalendarRanking): RankedCalendarResponse {
  const body: RankedCalendarResponse = {
    ...ranking,
    asOf: ranking.asOf.toISOString(),
    candidates: [...ranking.candidates],
    defaultCarryExpiries: [...ranking.defaultCarryExpiries],
  };
  return rankedCalendarResponse.parse(body);
}
