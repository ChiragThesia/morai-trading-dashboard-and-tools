/**
 * ports.ts — driven ports for the settings bounded context (Phase 29-09).
 *
 * Implemented by the postgres repo + in-memory twin (29-08). `StoredRuleOverrides` is the
 * contract's `ruleOverrides` partial with non-null groups only (a group is either present
 * as an object or entirely absent — never null; reset-per-group deletes the key).
 */

import type { Result } from "@morai/shared";
import type { StoredRuleOverrides } from "../domain/merge.ts";

// Domain error for storage operations (used by driven ports) — same shape as every other
// bounded context's own StorageError (journal/exits/analytics), kept local per convention.
export type StorageError = {
  readonly kind: "storage-error";
  readonly message: string;
};

/**
 * ForReadingRuleOverrides — read the single persisted rule-overrides row (29-08's repo
 * implements this). Returns an empty object (not an error) when no row exists yet — a
 * fresh deployment has no overrides, not a storage failure.
 */
export type ForReadingRuleOverrides = () => Promise<Result<StoredRuleOverrides, StorageError>>;

/**
 * ForWritingRuleOverrides — upsert the single persisted rule-overrides row with the full
 * merged partial (the use-case, not the adapter, computes the merge — see setRuleOverrides.ts).
 */
export type ForWritingRuleOverrides = (overrides: StoredRuleOverrides) => Promise<Result<void, StorageError>>;
