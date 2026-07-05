/**
 * setRuleTags use-case — validate + upsert a rule-tag annotation (RULE-01, D-07/D-14/D-21).
 *
 * Recording layer only (T-20-12): this use-case records exactly the tags the caller
 * supplied. It never infers or evaluates which rule "should" fire.
 *
 * Addressed by fillIdsHash alone (plan 20-10): the HTTP route is
 * PUT /api/journal/events/:hash/rules — no calendarId in the path. fill_ids_hash is the
 * DB UNIQUE idempotency key on calendar_events, so a target event can be looked up by hash
 * alone (ForReadingCalendarEventByHash), matching how ForReadingAnnotations/
 * ForWritingAnnotations already address annotations by fillIdsHash alone (D-09).
 *
 * Validation order (fails closed — no upsert on any failure):
 *   1. The target event must exist (unknown fillIdsHash → not-found, never a blind write —
 *      T-20-14). Returned as CalendarNotFound (kind: "not-found"), distinct from the
 *      validation-error kind below, so the HTTP route can map it to 404 vs 400.
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
  CalendarNotFound,
  ForReadingCalendarEventByHash,
  ForWritingAnnotations,
  StorageError,
} from "./ports.ts";

export type SetRuleTagsInput = {
  readonly fillIdsHash: string;
  readonly tags: ReadonlyArray<string>;
  readonly otherNote: string | null;
};

export type SetRuleTagsDeps = {
  readonly readEventByHash: ForReadingCalendarEventByHash;
  readonly writeAnnotations: ForWritingAnnotations;
};

/** Driver port returned by the factory. */
export type ForRunningSetRuleTags = (
  input: SetRuleTagsInput,
) => Promise<Result<CalendarEventAnnotation, StorageError | ValidationError | CalendarNotFound>>;

export function makeSetRuleTagsUseCase(deps: SetRuleTagsDeps): ForRunningSetRuleTags {
  return async (input) => {
    const eventResult = await deps.readEventByHash(input.fillIdsHash);
    if (!eventResult.ok) return err(eventResult.error);

    const targetEvent = eventResult.value;
    if (targetEvent === null) {
      return err<CalendarNotFound>({ kind: "not-found" });
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
