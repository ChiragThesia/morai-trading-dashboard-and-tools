/**
 * makeMemoryCalendarEventAnnotationsRepo — in-memory twin of the Postgres
 * calendar-event-annotations adapter (RULE-01, D-09/D-10/D24).
 *
 * Implements the same upsertAnnotation/readAnnotation/readAnnotationsByHashes shape using
 * a plain Map keyed on fillIdsHash — no Docker, no network, always available for unit tests.
 *
 * Architecture law: every driven port change updates the in-memory adapter in the same PR
 * (architecture-boundaries.md §8).
 *
 * No FK to calendar_events (D-09/D24) — this twin never validates fillIdsHash against a
 * calendars/events store; annotations are written and read purely by hash, mirroring the
 * Postgres table's deliberate lack of a foreign key.
 *
 * NOTE — types are duplicated (not imported) from the Postgres repo file for now, since
 * packages/core/application/ports.ts does not yet declare the real
 * ForReadingAnnotations/ForWritingAnnotations ports (plan 20-09 adds them). Both files'
 * shapes are structurally identical; 20-09 replaces both local blocks with a single
 * `import type {...} from "@morai/core"`.
 */

import { ok } from "@morai/shared";
import type { Result } from "@morai/shared";

export type StorageError = { readonly kind: "storage-error"; readonly message: string };

export type CalendarEventAnnotation = {
  readonly fillIdsHash: string;
  readonly ruleTags: ReadonlyArray<string>;
  readonly otherNote: string | null;
  readonly updatedAt: Date;
};

export type UpsertAnnotationInput = {
  readonly fillIdsHash: string;
  readonly ruleTags: ReadonlyArray<string>;
  readonly otherNote: string | null;
};

export type UpsertAnnotation = (
  input: UpsertAnnotationInput,
) => Promise<Result<CalendarEventAnnotation, StorageError>>;

export type ReadAnnotation = (
  fillIdsHash: string,
) => Promise<Result<CalendarEventAnnotation | null, StorageError>>;

export type ReadAnnotationsByHashes = (
  hashes: ReadonlyArray<string>,
) => Promise<Result<ReadonlyArray<CalendarEventAnnotation>, StorageError>>;

export type MemoryCalendarEventAnnotationsRepo = {
  readonly upsertAnnotation: UpsertAnnotation;
  readonly readAnnotation: ReadAnnotation;
  readonly readAnnotationsByHashes: ReadAnnotationsByHashes;
};

export function makeMemoryCalendarEventAnnotationsRepo(): MemoryCalendarEventAnnotationsRepo {
  // Key: fillIdsHash (PK equivalent)
  const store = new Map<string, CalendarEventAnnotation>();

  const upsertAnnotation: UpsertAnnotation = async (
    input: UpsertAnnotationInput,
  ): Promise<Result<CalendarEventAnnotation, StorageError>> => {
    const saved: CalendarEventAnnotation = {
      fillIdsHash: input.fillIdsHash,
      ruleTags: [...input.ruleTags],
      otherNote: input.otherNote,
      updatedAt: new Date(),
    };
    store.set(input.fillIdsHash, saved); // onConflictDoUpdate equivalent — always overwrites
    return ok(saved);
  };

  const readAnnotation: ReadAnnotation = async (
    fillIdsHash: string,
  ): Promise<Result<CalendarEventAnnotation | null, StorageError>> => {
    return ok(store.get(fillIdsHash) ?? null);
  };

  const readAnnotationsByHashes: ReadAnnotationsByHashes = async (
    hashes: ReadonlyArray<string>,
  ): Promise<Result<ReadonlyArray<CalendarEventAnnotation>, StorageError>> => {
    const wanted = new Set(hashes);
    const rows = [...store.values()].filter((a) => wanted.has(a.fillIdsHash));
    return ok(rows);
  };

  return { upsertAnnotation, readAnnotation, readAnnotationsByHashes };
}
