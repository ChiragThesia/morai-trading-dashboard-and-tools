/**
 * makePostgresCalendarEventAnnotationsRepo — Postgres implementation of the RULE-01
 * annotations ports (D-09/D-10/D24).
 *
 * upsertAnnotation: INSERT ... ON CONFLICT (fill_ids_hash) DO UPDATE — annotations are
 * editable anytime (D-10), unlike calendar_events' onConflictDoNothing idempotency.
 * readAnnotation: SELECT one row by fillIdsHash, or null when none exists.
 * readAnnotationsByHashes: SELECT the subset of rows matching a hash set (for the 20-09
 * read use-case's in-memory join against calendar_events).
 *
 * Architecture law: Drizzle confined to packages/adapters/postgres/.
 *
 * NOTE — port types are LOCAL to this file for now. packages/core/application/ports.ts
 * does not yet declare ForReadingAnnotations/ForWritingAnnotations (that lands in plan
 * 20-09); these local function-type aliases already match the shape those ports will
 * formalize, so wiring to the real ports later is a type-only swap, no logic change.
 */

import { ok, err } from "@morai/shared";
import type { Result } from "@morai/shared";
import { eq, inArray } from "drizzle-orm";
import { calendarEventAnnotations } from "../schema.ts";
import type { Db } from "../db.ts";

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

export type PostgresCalendarEventAnnotationsRepo = {
  readonly upsertAnnotation: UpsertAnnotation;
  readonly readAnnotation: ReadAnnotation;
  readonly readAnnotationsByHashes: ReadAnnotationsByHashes;
};

export function makePostgresCalendarEventAnnotationsRepo(
  db: Db,
): PostgresCalendarEventAnnotationsRepo {
  // ─── upsertAnnotation ──────────────────────────────────────────────────────
  // D-10: annotations are editable anytime — onConflictDoUpdate, never onConflictDoNothing.
  const upsertAnnotation: UpsertAnnotation = async (
    input: UpsertAnnotationInput,
  ): Promise<Result<CalendarEventAnnotation, StorageError>> => {
    try {
      const rows = await db
        .insert(calendarEventAnnotations)
        .values({
          fillIdsHash: input.fillIdsHash,
          ruleTags: [...input.ruleTags],
          otherNote: input.otherNote,
        })
        .onConflictDoUpdate({
          target: calendarEventAnnotations.fillIdsHash,
          set: {
            ruleTags: [...input.ruleTags],
            otherNote: input.otherNote,
            updatedAt: new Date(),
          },
        })
        .returning();

      const row = rows[0];
      if (row === undefined) {
        return err<StorageError>({ kind: "storage-error", message: "upsert returned no row" });
      }
      return ok({
        fillIdsHash: row.fillIdsHash,
        ruleTags: row.ruleTags,
        otherNote: row.otherNote ?? null,
        updatedAt: row.updatedAt,
      });
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      return err<StorageError>({ kind: "storage-error", message });
    }
  };

  // ─── readAnnotation ────────────────────────────────────────────────────────
  const readAnnotation: ReadAnnotation = async (
    fillIdsHash: string,
  ): Promise<Result<CalendarEventAnnotation | null, StorageError>> => {
    try {
      const rows = await db
        .select()
        .from(calendarEventAnnotations)
        .where(eq(calendarEventAnnotations.fillIdsHash, fillIdsHash));

      const row = rows[0];
      if (row === undefined) return ok(null);

      return ok({
        fillIdsHash: row.fillIdsHash,
        ruleTags: row.ruleTags,
        otherNote: row.otherNote ?? null,
        updatedAt: row.updatedAt,
      });
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      return err<StorageError>({ kind: "storage-error", message });
    }
  };

  // ─── readAnnotationsByHashes ───────────────────────────────────────────────
  // Returns only the rows matching the given hash set (for the 20-09 join use-case).
  const readAnnotationsByHashes: ReadAnnotationsByHashes = async (
    hashes: ReadonlyArray<string>,
  ): Promise<Result<ReadonlyArray<CalendarEventAnnotation>, StorageError>> => {
    if (hashes.length === 0) return ok([]);
    try {
      const rows = await db
        .select()
        .from(calendarEventAnnotations)
        .where(inArray(calendarEventAnnotations.fillIdsHash, [...hashes]));

      return ok(
        rows.map((row) => ({
          fillIdsHash: row.fillIdsHash,
          ruleTags: row.ruleTags,
          otherNote: row.otherNote ?? null,
          updatedAt: row.updatedAt,
        })),
      );
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      return err<StorageError>({ kind: "storage-error", message });
    }
  };

  return { upsertAnnotation, readAnnotation, readAnnotationsByHashes };
}
