/**
 * makePostgresRuleOverridesRepo — Postgres implementation of the settings bounded
 * context's ForReadingRuleOverrides / ForWritingRuleOverrides ports (Phase 29, 29-08/29-09).
 *
 * Single row keyed by the fixed literal "default" (mirrors broker_tokens' singleton
 * convention — T-28-11 override: constants stay the DEFAULTS, this row is an explicit
 * editable layer). The stored JSONB blob is validated through @morai/contracts'
 * ruleOverrides schema at the adapter boundary on BOTH write and read (T-19-10 convention,
 * T-29-12) — a corrupt/tampered blob surfaces a StorageError, never a silently-applied
 * bad config.
 *
 * writeRuleOverrides upserts via onConflictDoUpdate on the fixed id — settings are
 * editable anytime, not append-history (mirrors calendar-event-annotations' D-10).
 */
import { ok, err } from "@morai/shared";
import type { Result } from "@morai/shared";
import type { ForReadingRuleOverrides, ForWritingRuleOverrides, StorageError, StoredRuleOverrides } from "@morai/core";
import { ruleOverrides as ruleOverridesContract } from "@morai/contracts";
import type { RuleOverrides } from "@morai/contracts";
import { eq } from "drizzle-orm";
import { ruleOverrides as ruleOverridesTable } from "../schema.ts";
import type { Db } from "../db.ts";

const SINGLETON_ID = "default";

function isJsonObject(value: unknown): value is StoredRuleOverrides {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

// ponytail: JSON round-trip drops zod's optional `| undefined` fields so the result
// structurally satisfies StoredRuleOverrides' plain-JSON index signature — no `as`, no `any`.
function toJsonSafe(value: object): StoredRuleOverrides {
  const cloned: unknown = JSON.parse(JSON.stringify(value));
  return isJsonObject(cloned) ? cloned : {};
}

/** Drops null/absent groups from a validated RuleOverrides — the persisted blob never
 * stores a literal null group (mergeStoredOverrides deletes the key instead, T-29-10). */
function toStoredOverrides(parsed: RuleOverrides): StoredRuleOverrides {
  const result: Record<string, StoredRuleOverrides> = {};
  if (parsed.picker != null) result["picker"] = toJsonSafe(parsed.picker);
  if (parsed.exits != null) result["exits"] = toJsonSafe(parsed.exits);
  if (parsed.regime != null) result["regime"] = toJsonSafe(parsed.regime);
  return result;
}

export type PostgresRuleOverridesRepo = {
  readonly readRuleOverrides: ForReadingRuleOverrides;
  readonly writeRuleOverrides: ForWritingRuleOverrides;
};

export function makePostgresRuleOverridesRepo(db: Db): PostgresRuleOverridesRepo {
  // ─── readRuleOverrides ───────────────────────────────────────────────────────
  const readRuleOverrides: ForReadingRuleOverrides = async (): Promise<
    Result<StoredRuleOverrides, StorageError>
  > => {
    try {
      const rows = await db
        .select()
        .from(ruleOverridesTable)
        .where(eq(ruleOverridesTable.id, SINGLETON_ID));

      const row = rows[0];
      if (row === undefined) return ok({}); // fresh deployment — not a storage failure

      const parsed = ruleOverridesContract.safeParse(row.overrides);
      if (!parsed.success) {
        return err<StorageError>({
          kind: "storage-error",
          message: `corrupt stored rule_overrides row: ${parsed.error.message}`,
        });
      }
      return ok(toStoredOverrides(parsed.data));
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      return err<StorageError>({ kind: "storage-error", message });
    }
  };

  // ─── writeRuleOverrides ──────────────────────────────────────────────────────
  const writeRuleOverrides: ForWritingRuleOverrides = async (
    overrides: StoredRuleOverrides,
  ): Promise<Result<void, StorageError>> => {
    const parsed = ruleOverridesContract.safeParse(overrides);
    if (!parsed.success) {
      return err<StorageError>({
        kind: "storage-error",
        message: `refusing to write invalid rule_overrides blob: ${parsed.error.message}`,
      });
    }
    try {
      const validated = toStoredOverrides(parsed.data);
      await db
        .insert(ruleOverridesTable)
        .values({ id: SINGLETON_ID, overrides: validated, updatedAt: new Date() })
        .onConflictDoUpdate({
          target: ruleOverridesTable.id,
          set: { overrides: validated, updatedAt: new Date() },
        });
      return ok(undefined);
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      return err<StorageError>({ kind: "storage-error", message });
    }
  };

  return { readRuleOverrides, writeRuleOverrides };
}
