import { describe } from "vitest";
import { runCalendarEventAnnotationsContractTests } from "../__contract__/calendar-event-annotations.contract.ts";
import { makeMemoryCalendarEventAnnotationsRepo } from "./calendar-event-annotations.ts";

/**
 * Contract test for the in-memory calendar-event-annotations adapter.
 * No Docker required — runs always.
 *
 * Verifies twin parity with the Postgres adapter per architecture-boundaries §8.
 * No FK to calendar_events (D-09/D24) — this twin never validates against a calendars/events
 * store; it is purely a fillIdsHash-keyed Map.
 */
describe("in-memory calendar-event-annotations adapter", () => {
  runCalendarEventAnnotationsContractTests(() => {
    const repo = makeMemoryCalendarEventAnnotationsRepo();
    return {
      upsertAnnotation: repo.upsertAnnotation,
      readAnnotation: repo.readAnnotation,
      readAnnotationsByHashes: repo.readAnnotationsByHashes,
    };
  });
});
