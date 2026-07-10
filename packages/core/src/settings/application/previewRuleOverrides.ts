/**
 * previewRuleOverrides.ts — the combined settings-context preview use-case (Phase 32, Plan 04,
 * B4). ONE seam both `POST /api/settings/rules/preview` and its MCP twin call — branches per
 * staged group (picker/exits) over the two engine preview use-cases (32-02/32-03), so HTTP and
 * MCP can never drift (the "hand-copies rot" lesson, 32-CONTEXT.md).
 *
 * Never persists — structural: `PreviewRuleOverridesDeps` carries only the two injected engine
 * preview driver ports, no write port exists to call. Never imports `@morai/contracts` (core
 * law) — returns a domain result the route/MCP adapter maps through the shared contract schema.
 *
 * Hexagon law (architecture-boundaries §7): cross bounded contexts through application ports —
 * `ForPreviewingPickerRuleOverrides`/`ForPreviewingExitRuleOverrides` are the picker/exits
 * contexts' own driver ports (application-owned), imported here — never their `domain/`.
 */

import { ok, err } from "@morai/shared";
import type { Result } from "@morai/shared";
import type { ForPreviewingPickerRuleOverrides, PickerPreviewResult } from "../../picker/application/ports.ts";
import type { ForPreviewingExitRuleOverrides, ExitPreviewResult } from "../../exits/application/ports.ts";
import type { StorageError } from "./ports.ts";

export type PreviewRuleOverridesDeps = {
  readonly previewPicker: ForPreviewingPickerRuleOverrides;
  readonly previewExit: ForPreviewingExitRuleOverrides;
};

/**
 * RulePreviewInput — the core-side staged override groups from the in-flight edit. A group is
 * typed via `Parameters<>` of the engine's OWN driver port (rather than importing
 * `PickerRuleOverrides`/`ExitRuleOverrides` from picker/exits `domain/` directly) so this file
 * never crosses the hexagon boundary except through the already-injected application ports.
 */
export type RulePreviewInput = {
  readonly picker?: Parameters<ForPreviewingPickerRuleOverrides>[0];
  readonly exits?: Parameters<ForPreviewingExitRuleOverrides>[0];
};

/**
 * RulePreviewResult — the combined picker/exits staged-change preview (B4). A branch is `null`
 * when its group was ABSENT from the input (never computed — no wasted read); otherwise it
 * carries the full engine result, including the picker branch's own distinct `available:false`
 * cold-start state (computed, but nothing to preview against). `asOf` is sourced from the
 * picker preview when it was computed and available, else null.
 */
export type RulePreviewResult = {
  readonly asOf: string | null;
  readonly picker: PickerPreviewResult | null;
  readonly exits: ExitPreviewResult | null;
};

/** ForRunningPreviewRuleOverrides — driver port for the combined preview use-case (B4). Shared
 *  verbatim by the HTTP route and the MCP tool (32-04) — the one seam that can never drift. */
export type ForRunningPreviewRuleOverrides = (
  input: RulePreviewInput,
) => Promise<Result<RulePreviewResult, StorageError>>;

export function makePreviewRuleOverridesUseCase(deps: PreviewRuleOverridesDeps): ForRunningPreviewRuleOverrides {
  return async (input) => {
    let picker: PickerPreviewResult | null = null;
    let asOf: string | null = null;
    if (input.picker !== undefined) {
      const pickerResult = await deps.previewPicker(input.picker);
      if (!pickerResult.ok) return err(pickerResult.error);
      picker = pickerResult.value;
      if (picker.available) asOf = picker.asOf;
    }

    let exits: ExitPreviewResult | null = null;
    if (input.exits !== undefined) {
      const exitResult = await deps.previewExit(input.exits);
      if (!exitResult.ok) return err(exitResult.error);
      exits = exitResult.value;
    }

    return ok({ asOf, picker, exits });
  };
}
