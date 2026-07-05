import { describe, it, expect, beforeEach } from "vitest";
import type { Result } from "@morai/shared";
import type {
  CalendarEventAnnotation,
  ReadAnnotation,
  ReadAnnotationsByHashes,
  StorageError,
  UpsertAnnotation,
} from "../postgres/repos/calendar-event-annotations.ts";

/**
 * Shared contract-test suite for the calendar-event-annotations persistence ports
 * (RULE-01, D-09/D-10/D24).
 *
 * Run this suite against both:
 *   - The Postgres adapter (testcontainers) — packages/adapters/src/postgres/repos/calendar-event-annotations.contract.test.ts
 *   - The in-memory twin — packages/adapters/src/memory/calendar-event-annotations.contract.test.ts
 *
 * No FK to calendar_events (D-09/D24) — this contract never seeds a calendar or an event;
 * annotations are written and read purely by fillIdsHash.
 *
 * Asserts:
 * - readAnnotation: returns null when no annotation exists for a hash.
 * - upsertAnnotation: first write inserts; readAnnotation returns it.
 * - upsertAnnotation: a second write for the SAME hash updates ruleTags/otherNote (D-10
 *   editable-anytime) — readAnnotation returns the LATEST value, never both.
 * - readAnnotationsByHashes: returns only the rows matching the given hash set, in any order;
 *   a hash with no annotation is simply absent from the result (not a null placeholder).
 */

export type CalendarEventAnnotationsRepo = {
  readonly upsertAnnotation: UpsertAnnotation;
  readonly readAnnotation: ReadAnnotation;
  readonly readAnnotationsByHashes: ReadAnnotationsByHashes;
};

// ─── Fixtures ────────────────────────────────────────────────────────────────

const HASH_1 = "a".repeat(64);
const HASH_2 = "b".repeat(64);
const HASH_3 = "c".repeat(64); // never annotated — used for read-many "absent" case

export function runCalendarEventAnnotationsContractTests(
  makeRepo: () => CalendarEventAnnotationsRepo,
): void {
  describe("calendar-event-annotations persistence contract", () => {
    let repo: CalendarEventAnnotationsRepo;

    beforeEach(() => {
      repo = makeRepo();
    });

    describe("readAnnotation — missing", () => {
      it("returns null when no annotation exists for the hash", async () => {
        const result: Result<CalendarEventAnnotation | null, StorageError> =
          await repo.readAnnotation(HASH_1);
        expect(result.ok).toBe(true);
        if (!result.ok) return;
        expect(result.value).toBeNull();
      });
    });

    describe("upsertAnnotation — insert then update (D-10 editable-anytime)", () => {
      it("first write inserts; readAnnotation returns the saved annotation", async () => {
        const upserted = await repo.upsertAnnotation({
          fillIdsHash: HASH_1,
          ruleTags: ["iv-skew-favorable"],
          otherNote: null,
        });
        expect(upserted.ok).toBe(true);
        if (!upserted.ok) return;
        expect(upserted.value.fillIdsHash).toBe(HASH_1);
        expect(upserted.value.ruleTags).toEqual(["iv-skew-favorable"]);
        expect(upserted.value.otherNote).toBeNull();

        const read = await repo.readAnnotation(HASH_1);
        expect(read.ok).toBe(true);
        if (!read.ok) return;
        expect(read.value?.ruleTags).toEqual(["iv-skew-favorable"]);
        expect(read.value?.otherNote).toBeNull();
      });

      it("a second write for the SAME hash updates ruleTags/otherNote — readAnnotation returns only the latest", async () => {
        await repo.upsertAnnotation({
          fillIdsHash: HASH_1,
          ruleTags: ["iv-skew-favorable"],
          otherNote: null,
        });

        const updated = await repo.upsertAnnotation({
          fillIdsHash: HASH_1,
          ruleTags: ["other"],
          otherNote: "unwound early on a macro print",
        });
        expect(updated.ok).toBe(true);
        if (!updated.ok) return;
        expect(updated.value.ruleTags).toEqual(["other"]);
        expect(updated.value.otherNote).toBe("unwound early on a macro print");

        const read = await repo.readAnnotation(HASH_1);
        expect(read.ok).toBe(true);
        if (!read.ok) return;
        expect(read.value?.ruleTags).toEqual(["other"]);
        expect(read.value?.otherNote).toBe("unwound early on a macro print");
      });

      it("different hashes → two independent annotations", async () => {
        await repo.upsertAnnotation({
          fillIdsHash: HASH_1,
          ruleTags: ["profit-target"],
          otherNote: null,
        });
        await repo.upsertAnnotation({
          fillIdsHash: HASH_2,
          ruleTags: ["max-loss"],
          otherNote: null,
        });

        const read1 = await repo.readAnnotation(HASH_1);
        const read2 = await repo.readAnnotation(HASH_2);
        expect(read1.ok && read1.value?.ruleTags).toEqual(["profit-target"]);
        expect(read2.ok && read2.value?.ruleTags).toEqual(["max-loss"]);
      });
    });

    describe("readAnnotationsByHashes — subset read", () => {
      it("returns only existing rows for the given hash set; an unannotated hash is absent", async () => {
        await repo.upsertAnnotation({
          fillIdsHash: HASH_1,
          ruleTags: ["iv-skew-favorable"],
          otherNote: null,
        });
        await repo.upsertAnnotation({
          fillIdsHash: HASH_2,
          ruleTags: ["max-loss"],
          otherNote: null,
        });

        const result = await repo.readAnnotationsByHashes([HASH_1, HASH_2, HASH_3]);
        expect(result.ok).toBe(true);
        if (!result.ok) return;
        expect(result.value).toHaveLength(2);
        const byHash = new Map(result.value.map((a) => [a.fillIdsHash, a]));
        expect(byHash.get(HASH_1)?.ruleTags).toEqual(["iv-skew-favorable"]);
        expect(byHash.get(HASH_2)?.ruleTags).toEqual(["max-loss"]);
        expect(byHash.has(HASH_3)).toBe(false);
      });

      it("returns an empty array when none of the given hashes has an annotation", async () => {
        const result = await repo.readAnnotationsByHashes([HASH_3]);
        expect(result.ok).toBe(true);
        if (!result.ok) return;
        expect(result.value).toHaveLength(0);
      });

      it("returns an empty array for an empty hash set", async () => {
        const result = await repo.readAnnotationsByHashes([]);
        expect(result.ok).toBe(true);
        if (!result.ok) return;
        expect(result.value).toHaveLength(0);
      });
    });
  });
}
