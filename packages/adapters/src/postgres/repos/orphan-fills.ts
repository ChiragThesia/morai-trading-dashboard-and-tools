/**
 * makePostgresOrphanFillsRepo — Postgres implementation of orphan-fills ports.
 *
 * storeOrphanFill: INSERT onConflictDoNothing on fill_id PK (idempotent).
 *   Same fill re-processed → no-op (T-05-18: never silently dropped, never duplicated).
 *
 * Architecture law: Drizzle confined to packages/adapters/postgres/.
 * D-05: unmatched fills are always parked here; never silently dropped.
 */

import { ok, err } from "@morai/shared";
import type { Result } from "@morai/shared";
import type {
  ForStoringOrphanFill,
  OrphanFillInput,
  StorageError,
} from "@morai/core";
import { orphanFills } from "../schema.ts";
import type { Db } from "../db.ts";

export type PostgresOrphanFillsRepo = {
  readonly storeOrphanFill: ForStoringOrphanFill;
};

export function makePostgresOrphanFillsRepo(db: Db): PostgresOrphanFillsRepo {
  // ─── storeOrphanFill (ForStoringOrphanFill) ───────────────────────────────────
  // Idempotent INSERT — fill_id PK absorbs duplicates (D-05).
  const storeOrphanFill: ForStoringOrphanFill = async (
    orphan: OrphanFillInput,
  ): Promise<Result<void, StorageError>> => {
    try {
      await db
        .insert(orphanFills)
        .values({
          fillId: orphan.fillId,
          occSymbol: orphan.occSymbol,
          side: orphan.side,
          qty: orphan.qty,
          price: String(orphan.price),
          filledAt: orphan.filledAt,
          reason: orphan.reason,
        })
        .onConflictDoNothing(); // fill_id PK → re-run same orphan = no-op (T-05-18)
      return ok(undefined);
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      return err<StorageError>({ kind: "storage-error", message });
    }
  };

  return { storeOrphanFill };
}
