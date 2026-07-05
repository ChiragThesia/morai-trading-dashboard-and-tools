/**
 * getCalendarEventsWithRules use-case — the previously-missing calendar_events read path
 * (RULE-01, RESEARCH: no read surface for calendar_events existed before this plan).
 *
 * Algorithm:
 *   1. Read a calendar's events (ForReadingCalendarEvents).
 *   2. Read the annotations matching those events' fillIdsHash set (ForReadingAnnotations).
 *   3. Left-join in memory: every event gets its annotation's tags/otherNote, defaulting to
 *      [] / null when unannotated.
 *   4. D-09 orphan policy: an annotation whose fillIdsHash matches no current event is
 *      logged (console.warn) and OMITTED from the result — never deleted. The port contract
 *      does not guarantee the adapter filters strictly, so this check is defense-in-depth,
 *      not dead code (T-20-12 boundary: recording layer only, no rule evaluation here).
 *
 * Pure application logic: no I/O beyond the injected ports.
 */

import { ok, err } from "@morai/shared";
import type { Result } from "@morai/shared";
import type { CalendarEvent } from "../domain/calendar-event.ts";
import type { ForReadingCalendarEvents, ForReadingAnnotations, StorageError } from "./ports.ts";

export type CalendarEventWithRules = {
  readonly event: CalendarEvent;
  readonly tags: ReadonlyArray<string>;
  readonly otherNote: string | null;
};

export type GetCalendarEventsWithRulesDeps = {
  readonly readCalendarEvents: ForReadingCalendarEvents;
  readonly readAnnotations: ForReadingAnnotations;
};

/** Driver port returned by the factory. */
export type ForRunningGetCalendarEventsWithRules = (
  calendarId: string,
) => Promise<Result<ReadonlyArray<CalendarEventWithRules>, StorageError>>;

export function makeGetCalendarEventsWithRulesUseCase(
  deps: GetCalendarEventsWithRulesDeps,
): ForRunningGetCalendarEventsWithRules {
  return async (calendarId) => {
    const eventsResult = await deps.readCalendarEvents(calendarId);
    if (!eventsResult.ok) return err(eventsResult.error);
    const events = eventsResult.value;

    const eventHashes = events.map((event) => event.fillIdsHash);
    const annotationsResult = await deps.readAnnotations.readAnnotationsByHashes(eventHashes);
    if (!annotationsResult.ok) return err(annotationsResult.error);
    const annotations = annotationsResult.value;

    const eventHashSet = new Set(eventHashes);
    const annotationByHash = new Map<string, (typeof annotations)[number]>();
    for (const annotation of annotations) {
      if (!eventHashSet.has(annotation.fillIdsHash)) {
        // D-09: log-and-orphan — never delete, never surface a stale annotation.
        console.warn(
          `getCalendarEventsWithRules: orphaned annotation fillIdsHash=${annotation.fillIdsHash} matches no current event in calendar ${calendarId}`,
        );
        continue;
      }
      annotationByHash.set(annotation.fillIdsHash, annotation);
    }

    const result: ReadonlyArray<CalendarEventWithRules> = events.map((event) => {
      const annotation = annotationByHash.get(event.fillIdsHash);
      return {
        event,
        tags: annotation?.ruleTags ?? [],
        otherNote: annotation?.otherNote ?? null,
      };
    });

    return ok(result);
  };
}
