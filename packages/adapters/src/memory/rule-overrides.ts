/**
 * makeMemoryRuleOverridesRepo — in-memory twin of the Postgres rule-overrides adapter
 * (Phase 29, 29-08/29-09).
 *
 * Wraps a single raw (unvalidated) value mirroring the Postgres row's `overrides` jsonb
 * column. writeRuleOverrides validates via the @morai/contracts ruleOverrides schema
 * BEFORE storing (T-29-12, matches the Postgres write-boundary exactly); readRuleOverrides
 * re-validates via safeParse on read (parse-don't-cast at the read seam) so a row seeded
 * via seedRawOverrides (bypassing writeRuleOverrides' own validation) surfaces the SAME
 * StorageError behavior as a corrupted Postgres row.
 *
 * Architecture law: every driven port change ships its in-memory twin in the same PR
 * (architecture-boundaries.md §8).
 */
import { ok, err } from "@morai/shared";
import type { Result } from "@morai/shared";
import type { ForReadingRuleOverrides, ForWritingRuleOverrides, StorageError, StoredRuleOverrides } from "@morai/core";
import { ruleOverrides as ruleOverridesContract } from "@morai/contracts";
import type { RuleOverrides } from "@morai/contracts";

function isJsonObject(value: unknown): value is StoredRuleOverrides {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

// ponytail: JSON round-trip drops zod's optional `| undefined` fields so the result
// structurally satisfies StoredRuleOverrides' plain-JSON index signature — no `as`, no `any`.
function toJsonSafe(value: object): StoredRuleOverrides {
  const cloned: unknown = JSON.parse(JSON.stringify(value));
  return isJsonObject(cloned) ? cloned : {};
}

/** Drops null/absent groups from a validated RuleOverrides — mirrors the Postgres repo's
 * own conversion (the persisted blob never stores a literal null group, T-29-10). */
function toStoredOverrides(parsed: RuleOverrides): StoredRuleOverrides {
  const result: Record<string, StoredRuleOverrides> = {};
  if (parsed.picker != null) result["picker"] = toJsonSafe(parsed.picker);
  if (parsed.exits != null) result["exits"] = toJsonSafe(parsed.exits);
  if (parsed.regime != null) result["regime"] = toJsonSafe(parsed.regime);
  return result;
}

export type MemoryRuleOverridesRepo = {
  readonly readRuleOverrides: ForReadingRuleOverrides;
  readonly writeRuleOverrides: ForWritingRuleOverrides;
  /**
   * seedRawOverrides — test-only: write a raw, UNVALIDATED blob directly into the store,
   * bypassing writeRuleOverrides' own Zod validation. Simulates a legacy/corrupted stored
   * row so the shared contract can assert the SAME read-side StorageError behavior on both
   * adapters (mirrors exit-verdicts.ts's seedRawVerdict bypass).
   */
  readonly seedRawOverrides: (rawBlob: unknown) => void;
};

export function makeMemoryRuleOverridesRepo(): MemoryRuleOverridesRepo {
  let stored: unknown = undefined; // no row yet — mirrors an absent Postgres row

  const readRuleOverrides: ForReadingRuleOverrides = async (): Promise<
    Result<StoredRuleOverrides, StorageError>
  > => {
    if (stored === undefined) return ok({}); // fresh deployment — not a storage failure

    const parsed = ruleOverridesContract.safeParse(stored);
    if (!parsed.success) {
      return err<StorageError>({
        kind: "storage-error",
        message: `corrupt stored rule_overrides row: ${parsed.error.message}`,
      });
    }
    return ok(toStoredOverrides(parsed.data));
  };

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
    stored = toStoredOverrides(parsed.data);
    return ok(undefined);
  };

  const seedRawOverrides = (rawBlob: unknown): void => {
    stored = rawBlob;
  };

  return { readRuleOverrides, writeRuleOverrides, seedRawOverrides };
}
