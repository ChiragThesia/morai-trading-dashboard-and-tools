/**
 * previewRuleOverrides tests (Phase 32, Plan 04, B4) — the combined settings-context preview
 * use-case, branching per staged group over two fake engine preview ports.
 *
 * Covers: only-picker-staged / only-exits-staged / both / neither branch shapes, asOf sourcing
 * from the picker branch, and StorageError propagation from either engine.
 */

import { describe, it, expect } from "vitest";
import { ok, err } from "@morai/shared";
import { makePreviewRuleOverridesUseCase } from "./previewRuleOverrides.ts";
import type { PreviewRuleOverridesDeps } from "./previewRuleOverrides.ts";
import type { ForPreviewingPickerRuleOverrides, PickerPreviewResult } from "../../picker/application/ports.ts";
import type { ForPreviewingExitRuleOverrides, ExitPreviewResult } from "../../exits/application/ports.ts";
import type { StorageError } from "./ports.ts";

const AVAILABLE_PICKER_RESULT: PickerPreviewResult = {
  available: true,
  asOf: "2026-07-01",
  candidates: [],
  gate: {
    before: {
      vix: 10,
      vix3m: 20,
      ratio: 0.5,
      asOf: "2026-07-01",
      state: "open",
      penaltyMultiplier: 1,
      brakes: { maxOpen: false, cooldown: false, cooldownUntil: null },
      reasons: [],
    },
    after: {
      vix: 10,
      vix3m: 20,
      ratio: 0.5,
      asOf: "2026-07-01",
      state: "open",
      penaltyMultiplier: 1,
      brakes: { maxOpen: false, cooldown: false, cooldownUntil: null },
      reasons: [],
    },
  },
  sizing: {
    before: { tier: "low", contracts: 2, vix: 10 },
    after: { tier: "low", contracts: 2, vix: 10 },
  },
  universeNote: null,
};

const EXIT_PREVIEW_RESULT: ExitPreviewResult = [
  {
    calendarId: "cal-1",
    current: { verdict: "HOLD", rung: null, ruleId: "hold-default" },
    staged: {
      verdict: "HOLD",
      rung: null,
      ruleId: "hold-default",
      metric: { name: "pnlPct", value: 0.1, threshold: 0.25 },
    },
  },
];

function makeDeps(overrides: Partial<PreviewRuleOverridesDeps> = {}): PreviewRuleOverridesDeps {
  const previewPicker: ForPreviewingPickerRuleOverrides = async () => ok(AVAILABLE_PICKER_RESULT);
  const previewExit: ForPreviewingExitRuleOverrides = async () => ok(EXIT_PREVIEW_RESULT);
  return { previewPicker, previewExit, ...overrides };
}

describe("makePreviewRuleOverridesUseCase", () => {
  it("only-picker-staged: exits branch is null, previewExit is never called", async () => {
    let exitCalled = false;
    const deps = makeDeps({
      previewExit: async () => {
        exitCalled = true;
        return ok(EXIT_PREVIEW_RESULT);
      },
    });
    const result = await makePreviewRuleOverridesUseCase(deps)({ picker: { deltaBandMax: -0.2 } });
    expect(result).toEqual(ok({ asOf: "2026-07-01", picker: AVAILABLE_PICKER_RESULT, exits: null }));
    expect(exitCalled).toBe(false);
  });

  it("only-exits-staged: picker branch is null, previewPicker is never called, asOf is null", async () => {
    let pickerCalled = false;
    const deps = makeDeps({
      previewPicker: async () => {
        pickerCalled = true;
        return ok(AVAILABLE_PICKER_RESULT);
      },
    });
    const result = await makePreviewRuleOverridesUseCase(deps)({ exits: { take: { plus15Arm: 0.15, plus15Disarm: 0.13 } } });
    expect(result).toEqual(ok({ asOf: null, picker: null, exits: EXIT_PREVIEW_RESULT }));
    expect(pickerCalled).toBe(false);
  });

  it("both staged: both branches populated, asOf sourced from the picker branch", async () => {
    const deps = makeDeps();
    const result = await makePreviewRuleOverridesUseCase(deps)({
      picker: { deltaBandMax: -0.2 },
      exits: { take: { plus15Arm: 0.15, plus15Disarm: 0.13 } },
    });
    expect(result).toEqual(ok({ asOf: "2026-07-01", picker: AVAILABLE_PICKER_RESULT, exits: EXIT_PREVIEW_RESULT }));
  });

  it("neither staged (empty input): both branches null, asOf null, neither engine called", async () => {
    let pickerCalled = false;
    let exitCalled = false;
    const deps = makeDeps({
      previewPicker: async () => {
        pickerCalled = true;
        return ok(AVAILABLE_PICKER_RESULT);
      },
      previewExit: async () => {
        exitCalled = true;
        return ok(EXIT_PREVIEW_RESULT);
      },
    });
    const result = await makePreviewRuleOverridesUseCase(deps)({});
    expect(result).toEqual(ok({ asOf: null, picker: null, exits: null }));
    expect(pickerCalled).toBe(false);
    expect(exitCalled).toBe(false);
  });

  it("picker cold-start (available:false): asOf stays null even though the branch was computed", async () => {
    const deps = makeDeps({ previewPicker: async () => ok({ available: false }) });
    const result = await makePreviewRuleOverridesUseCase(deps)({ picker: {} });
    expect(result).toEqual(ok({ asOf: null, picker: { available: false }, exits: null }));
  });

  it("propagates a StorageError from previewPicker unchanged, never a throw", async () => {
    const storageError: StorageError = { kind: "storage-error", message: "picker read failed" };
    const deps = makeDeps({ previewPicker: async () => err(storageError) });
    const result = await makePreviewRuleOverridesUseCase(deps)({ picker: {} });
    expect(result).toEqual(err(storageError));
  });

  it("propagates a StorageError from previewExit unchanged, never a throw", async () => {
    const storageError: StorageError = { kind: "storage-error", message: "exit read failed" };
    const deps = makeDeps({ previewExit: async () => err(storageError) });
    const result = await makePreviewRuleOverridesUseCase(deps)({ exits: {} });
    expect(result).toEqual(err(storageError));
  });

  it("port hygiene: deps structurally exclude any persist port -- only these 2 fields exist", () => {
    const deps = makeDeps();
    expect(Object.keys(deps).sort()).toEqual(["previewExit", "previewPicker"].sort());
  });
});
