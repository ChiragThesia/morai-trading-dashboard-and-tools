import { describe, beforeAll, beforeEach } from "vitest";
import { inject } from "vitest";
import { runCalendarEventAnnotationsContractTests } from "../../__contract__/calendar-event-annotations.contract.ts";
import { makePostgresCalendarEventAnnotationsRepo } from "./calendar-event-annotations.ts";
import { makeDb } from "../db.ts";
import { calendarEventAnnotations } from "../schema.ts";

/**
 * Contract test for the Postgres calendar-event-annotations adapter.
 * Requires Docker (testcontainers postgres:16 with migrations applied, including
 * 0017_calendar_event_annotations.sql).
 * Skips gracefully when the container URL is not provided (Docker unavailable).
 *
 * beforeEach truncates calendar_event_annotations directly (no FK — D-09/D24 — so no
 * cascade/seed ordering is needed, unlike calendar-events.contract.test.ts).
 *
 * Verifies:
 * - upsertAnnotation: onConflictDoUpdate on fillIdsHash PK (D-10 editable-anytime)
 * - readAnnotation: null when missing
 * - readAnnotationsByHashes: subset read, absent hashes simply missing from the result
 */

const dbUrl: string | undefined = inject("dbUrl");
const shouldSkip = !dbUrl;

describe.skipIf(shouldSkip)("postgres calendar-event-annotations adapter", () => {
  let db: ReturnType<typeof makeDb>;

  beforeAll(async () => {
    if (!dbUrl) return;
    db = makeDb(dbUrl);
  });

  beforeEach(async () => {
    if (!db) return;
    await db.delete(calendarEventAnnotations);
  });

  runCalendarEventAnnotationsContractTests(() => {
    if (!db) throw new Error("db not initialized");
    const repo = makePostgresCalendarEventAnnotationsRepo(db);
    return {
      upsertAnnotation: repo.upsertAnnotation,
      readAnnotation: repo.readAnnotation,
      readAnnotationsByHashes: repo.readAnnotationsByHashes,
    };
  });
});
