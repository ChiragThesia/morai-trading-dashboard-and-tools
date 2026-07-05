/**
 * setRuleTags use-case — validate + upsert a rule-tag annotation (RULE-01, D-07/D-14/D-21).
 *
 * Recording layer only (T-20-12): this use-case records exactly the tags the caller
 * supplied. It never infers or evaluates which rule "should" fire.
 *
 * Validation order (fails closed — no upsert on any failure):
 *   1. The target event must exist in the calendar (unknown fillIdsHash → validation-error,
 *      never a blind write — T-20-14).
 *   2. Every supplied tag must belong to that event's CalendarEventType enum
 *      (ruleTagEnumForEventType) — a cross-type tag is rejected (T-20-11 defense-in-depth
 *      beyond the contract's Zod refine, since a route/MCP caller could bypass the contract).
 *   3. D-21: 'other' among tags requires a non-empty (non-whitespace) otherNote.
 *
 * Only on full validation does it call ForWritingAnnotations.
 */

import { ok, err } from "@morai/shared";
import type { Result } from "@morai/shared";
import { ruleTagEnumForEventType } from "../domain/rule-tags.ts";
import type { ValidationError } from "./registerCalendar.ts";
import type {
  CalendarEventAnnotation,
  ForReadingCalendarEvents,
  ForWritingAnnotations,
  StorageError,
} from "./ports.ts";

export type SetRuleTagsInput = {
  readonly calendarId: string;
  readonly fillIdsHash: string;
  readonly tags: ReadonlyArray<string>;
  readonly otherNote: string | null;
};

export type SetRuleTagsDeps = {
  readonly readCalendarEvents: ForReadingCalendarEvents;
  readonly writeAnnotations: ForWritingAnnotations;
};

/** Driver port returned by the factory. */
export type ForRunningSetRuleTags = (
  input: SetRuleTagsInput,
) => Promise<Result<CalendarEventAnnotation, StorageError | ValidationError>>;

export function makeSetRuleTagsUseCase(deps: SetRuleTagsDeps): ForRunningSetRuleTags {
  return async (input) => {
    const eventsResult = await deps.readCalendarEvents(input.calendarId);
    if (!eventsResult.ok) return err(eventsResult.error);

    const targetEvent = eventsResult.value.find(
      (event) => event.fillIdsHash === input.fillIdsHash,
    );
    if (targetEvent === undefined) {
      return err<ValidationError>({
        kind: "validation-error",
        message: `Unknown fillIdsHash: no event in calendar ${input.calendarId} matches ${input.fillIdsHash}`,
      });
    }

    const tagEnum = ruleTagEnumForEventType(targetEvent.eventType);
    const allowedTags = new Set<string>(tagEnum.options);
    for (const tag of input.tags) {
      if (!allowedTags.has(tag)) {
        return err<ValidationError>({
          kind: "validation-error",
          message: `Tag "${tag}" is not valid for a ${targetEvent.eventType} event`,
        });
      }
    }

    // D-21: OTHER-requires-note, re-checked here as defense-in-depth beyond the contract refine.
    if (
      input.tags.includes("other") &&
      (input.otherNote === null || input.otherNote.trim().length === 0)
    ) {
      return err<ValidationError>({
        kind: "validation-error",
        message: "otherNote is required when 'other' is among tags",
      });
    }

    return deps.writeAnnotations({
      fillIdsHash: input.fillIdsHash,
      ruleTags: input.tags,
      otherNote: input.otherNote,
    });
  };
}
