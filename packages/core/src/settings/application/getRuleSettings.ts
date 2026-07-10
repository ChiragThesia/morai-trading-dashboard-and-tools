/**
 * getRuleSettings use-case — GET /api/settings/rules read path (Phase 29-09).
 *
 * Reads the persisted overrides via ForReadingRuleOverrides and merges them over the
 * INJECTED `defaults` (the full resolved knob object, computed by the composition root
 * from the three engines' own resolve functions — 29-13). This context never imports
 * picker/exits/analytics domain code (hexagon law) — `defaults` is a plain value.
 */

import { ok, err } from "@morai/shared";
import type { Result } from "@morai/shared";
import { computeEffective } from "../domain/merge.ts";
import type { RuleConfig, StoredRuleOverrides } from "../domain/merge.ts";
import type { ForReadingRuleOverrides, StorageError } from "./ports.ts";

export type GetRuleSettingsResult = {
  readonly defaults: RuleConfig;
  readonly overrides: StoredRuleOverrides;
  readonly effective: RuleConfig;
};

export type GetRuleSettingsDeps = {
  readonly readRuleOverrides: ForReadingRuleOverrides;
  readonly defaults: RuleConfig;
};

/** Driver port returned by the factory. */
export type ForRunningGetRuleSettings = () => Promise<Result<GetRuleSettingsResult, StorageError>>;

export function makeGetRuleSettingsUseCase(deps: GetRuleSettingsDeps): ForRunningGetRuleSettings {
  return async () => {
    const overridesResult = await deps.readRuleOverrides();
    if (!overridesResult.ok) return err(overridesResult.error);
    const overrides = overridesResult.value;

    return ok({
      defaults: deps.defaults,
      overrides,
      effective: computeEffective(deps.defaults, overrides),
    });
  };
}
