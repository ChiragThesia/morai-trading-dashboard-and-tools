/**
 * setRuleOverrides.test.ts — makeSetRuleOverridesUseCase (Phase 29-09).
 *
 * Locked behavior (29-09-PLAN.md):
 *   1. Reads current, mergeStoredOverrides(current, request), writes the merged partial,
 *      returns { overrides: merged, effective: computeEffective(defaults, merged) }.
 *   2. { picker: null } persists overrides WITHOUT the picker group.
 *   3. A write error propagates as Result err.
 */

import { describe, it, expect } from "vitest";
import { ok, err } from "@morai/shared";
import { makeSetRuleOverridesUseCase } from "./setRuleOverrides.ts";
import type { ForReadingRuleOverrides, ForWritingRuleOverrides, StorageError } from "./ports.ts";
import type { RuleConfig, StoredRuleOverrides } from "../domain/merge.ts";

const defaults: RuleConfig = {
  picker: { maxOpenCalendars: 6 },
  exits: { take: { plus15Arm: 0.15, plus15Disarm: 0.13 } },
  regime: { vvixWarn: 100 },
};

describe("makeSetRuleOverridesUseCase", () => {
  it("merges the request patch over the current stored overrides, writes and returns it", async () => {
    const current: StoredRuleOverrides = { picker: { maxOpenCalendars: 8 } };
    let written: StoredRuleOverrides | undefined;
    const readRuleOverrides: ForReadingRuleOverrides = async () => ok(current);
    const writeRuleOverrides: ForWritingRuleOverrides = async (overrides) => {
      written = overrides;
      return ok(undefined);
    };
    const useCase = makeSetRuleOverridesUseCase({ readRuleOverrides, writeRuleOverrides, defaults });

    const result = await useCase({ regime: { vvixWarn: 105 } });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const expectedMerged = { picker: { maxOpenCalendars: 8 }, regime: { vvixWarn: 105 } };
    expect(result.value.overrides).toEqual(expectedMerged);
    expect(written).toEqual(expectedMerged);
    expect(result.value.effective).toEqual({
      picker: { maxOpenCalendars: 8 },
      exits: defaults["exits"],
      regime: { vvixWarn: 105 },
    });
  });

  it("{ picker: null } persists overrides without the picker group", async () => {
    const current: StoredRuleOverrides = { picker: { maxOpenCalendars: 8 }, regime: { vvixWarn: 105 } };
    let written: StoredRuleOverrides | undefined;
    const readRuleOverrides: ForReadingRuleOverrides = async () => ok(current);
    const writeRuleOverrides: ForWritingRuleOverrides = async (overrides) => {
      written = overrides;
      return ok(undefined);
    };
    const useCase = makeSetRuleOverridesUseCase({ readRuleOverrides, writeRuleOverrides, defaults });

    const result = await useCase({ picker: null });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.overrides).toEqual({ regime: { vvixWarn: 105 } });
    expect(written).toEqual({ regime: { vvixWarn: 105 } });
    expect(result.value.effective).toEqual({
      picker: defaults["picker"],
      exits: defaults["exits"],
      regime: { vvixWarn: 105 },
    });
  });

  it("a write error propagates as Result err", async () => {
    const storageError: StorageError = { kind: "storage-error", message: "db down" };
    const readRuleOverrides: ForReadingRuleOverrides = async () => ok({});
    const writeRuleOverrides: ForWritingRuleOverrides = async () => err(storageError);
    const useCase = makeSetRuleOverridesUseCase({ readRuleOverrides, writeRuleOverrides, defaults });

    const result = await useCase({ picker: { maxOpenCalendars: 8 } });

    expect(result).toEqual(err(storageError));
  });

  it("a read error propagates as Result err (never reaches write)", async () => {
    const storageError: StorageError = { kind: "storage-error", message: "db down" };
    const readRuleOverrides: ForReadingRuleOverrides = async () => err(storageError);
    const writeRuleOverrides: ForWritingRuleOverrides = async () => ok(undefined);
    const useCase = makeSetRuleOverridesUseCase({ readRuleOverrides, writeRuleOverrides, defaults });

    const result = await useCase({ picker: { maxOpenCalendars: 8 } });

    expect(result).toEqual(err(storageError));
  });
});
