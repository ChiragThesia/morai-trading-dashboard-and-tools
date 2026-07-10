/**
 * setRuleOverrides use-case — PUT /api/settings/rules write path (Phase 29-09).
 *
 * Reads the current stored overrides, applies the request patch via mergeStoredOverrides
 * (reset-per-group: a group set to null deletes that group's stored keys — 29-CONTEXT.md),
 * writes the merged partial, and returns the saved overrides + newly-resolved effective
 * config. `defaults` is injected by the composition root (29-13) — engine-agnostic.
 */

import { ok, err } from "@morai/shared";
import type { Result } from "@morai/shared";
import { computeEffective, mergeStoredOverrides } from "../domain/merge.ts";
import type { RuleConfig, RuleOverridesPatch, StoredRuleOverrides } from "../domain/merge.ts";
import type { ForReadingRuleOverrides, ForWritingRuleOverrides, StorageError } from "./ports.ts";

export type SetRuleOverridesResult = {
  readonly overrides: StoredRuleOverrides;
  readonly effective: RuleConfig;
};

export type SetRuleOverridesDeps = {
  readonly readRuleOverrides: ForReadingRuleOverrides;
  readonly writeRuleOverrides: ForWritingRuleOverrides;
  readonly defaults: RuleConfig;
};

/** Driver port returned by the factory. */
export type ForRunningSetRuleOverrides = (
  patch: RuleOverridesPatch,
) => Promise<Result<SetRuleOverridesResult, StorageError>>;

export function makeSetRuleOverridesUseCase(deps: SetRuleOverridesDeps): ForRunningSetRuleOverrides {
  return async (patch) => {
    const currentResult = await deps.readRuleOverrides();
    if (!currentResult.ok) return err(currentResult.error);

    const merged = mergeStoredOverrides(currentResult.value, patch);

    const writeResult = await deps.writeRuleOverrides(merged);
    if (!writeResult.ok) return err(writeResult.error);

    return ok({
      overrides: merged,
      effective: computeEffective(deps.defaults, merged),
    });
  };
}
