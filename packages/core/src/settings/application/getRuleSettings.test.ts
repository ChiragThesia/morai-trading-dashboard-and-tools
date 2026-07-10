/**
 * getRuleSettings.test.ts — makeGetRuleSettingsUseCase (Phase 29-09).
 *
 * Locked behavior (29-09-PLAN.md):
 *   1. Reads stored overrides via ForReadingRuleOverrides, returns { defaults, overrides,
 *      effective: computeEffective(defaults, overrides) }.
 *   2. No stored row (empty overrides) -> effective deep-equals defaults.
 *   3. A read error propagates as Result err.
 */

import { describe, it, expect } from "vitest";
import { ok, err } from "@morai/shared";
import { makeGetRuleSettingsUseCase } from "./getRuleSettings.ts";
import type { ForReadingRuleOverrides, StorageError } from "./ports.ts";
import type { RuleConfig } from "../domain/merge.ts";

const defaults: RuleConfig = {
  picker: { maxOpenCalendars: 6 },
  exits: { take: { plus15Arm: 0.15, plus15Disarm: 0.13 } },
  regime: { vvixWarn: 100 },
};

describe("makeGetRuleSettingsUseCase", () => {
  it("returns defaults/overrides/effective, with effective the per-field merge", async () => {
    const readRuleOverrides: ForReadingRuleOverrides = async () =>
      ok({ picker: { maxOpenCalendars: 8 } });
    const useCase = makeGetRuleSettingsUseCase({ readRuleOverrides, defaults });

    const result = await useCase();

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.defaults).toEqual(defaults);
    expect(result.value.overrides).toEqual({ picker: { maxOpenCalendars: 8 } });
    expect(result.value.effective).toEqual({
      picker: { maxOpenCalendars: 8 },
      exits: defaults["exits"],
      regime: defaults["regime"],
    });
  });

  it("no stored row (empty overrides) -> effective deep-equals defaults", async () => {
    const readRuleOverrides: ForReadingRuleOverrides = async () => ok({});
    const useCase = makeGetRuleSettingsUseCase({ readRuleOverrides, defaults });

    const result = await useCase();

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.effective).toEqual(defaults);
  });

  it("a read error propagates as Result err", async () => {
    const storageError: StorageError = { kind: "storage-error", message: "db down" };
    const readRuleOverrides: ForReadingRuleOverrides = async () => err(storageError);
    const useCase = makeGetRuleSettingsUseCase({ readRuleOverrides, defaults });

    const result = await useCase();

    expect(result).toEqual(err(storageError));
  });
});
