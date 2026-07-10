/**
 * merge.ts — pure, engine-agnostic merge helpers backing the runtime rule-settings GET/PUT
 * surface (Phase 29-09).
 *
 * Deliberately generic: this module never names a single picker/exits/regime field. The
 * settings context owns ONLY JSONB storage orchestration + the display merge — it NEVER
 * imports picker/exits/analytics `domain/` code (architecture rule 7, 29-CONTEXT.md). The
 * full default knob object is a plain value INJECTED by the composition root (29-13),
 * computed from the three engines' own resolve functions.
 *
 * `computeEffective` and `mergeStoredOverrides` both deep-merge nested plain objects (a group's
 * sub-objects like exits.take merge field-by-field; picker's atomic sub-objects like `weights`
 * are already all-or-none per the contract's validation, so deep-merging them still produces
 * the same result as a wholesale replace). Only `mergeStoredOverrides`'s top-level group keys
 * carry the extra `null` = "delete this group" reset-per-group sentinel (docs/architecture/
 * rule-overrides.md).
 */

type JsonPrimitive = number | string | boolean;
type JsonValue = JsonPrimitive | JsonObject | ReadonlyArray<JsonValue>;
type JsonObject = { readonly [key: string]: JsonValue };

function isPlainObject(value: JsonValue | null | undefined): value is JsonObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Deep-merges `patch` over `base`: nested plain objects recurse field-by-field; any other
 * value present in `patch` (number/string/boolean/array) replaces the base value outright. */
function deepMerge(base: JsonObject, patch: JsonObject): JsonObject {
  const result: Record<string, JsonValue> = { ...base };
  for (const key of Object.keys(patch)) {
    const patchValue = patch[key];
    if (patchValue === undefined) continue;
    const baseValue = result[key];
    result[key] = isPlainObject(baseValue) && isPlainObject(patchValue) ? deepMerge(baseValue, patchValue) : patchValue;
  }
  return result;
}

/** The full resolved knob object — `defaults`/`effective` in the GET/PUT surface. */
export type RuleConfig = JsonObject;

/** The persisted partial overrides blob — never contains a null group (T-29-10). */
export type StoredRuleOverrides = JsonObject;

/** A PUT request patch — each top-level group is either an object (merge into that group) or
 * `null` (reset-per-group: delete the group's stored override keys). */
export type RuleOverridesPatch = { readonly [group: string]: JsonObject | null | undefined };

/** computeEffective — the per-field merge of stored `overrides` over `defaults`. */
export function computeEffective(defaults: RuleConfig, overrides: StoredRuleOverrides): RuleConfig {
  return deepMerge(defaults, overrides);
}

/** mergeStoredOverrides — applies a request patch to the currently stored partial. A group set
 * to `null` deletes that group's stored keys entirely; an object value deep-merges into the
 * group's current stored overrides. Never emits a null group in its output. */
export function mergeStoredOverrides(current: StoredRuleOverrides, patch: RuleOverridesPatch): StoredRuleOverrides {
  const result: Record<string, JsonValue> = { ...current };
  for (const key of Object.keys(patch)) {
    const patchValue = patch[key];
    if (patchValue === undefined) continue;
    if (patchValue === null) {
      delete result[key];
      continue;
    }
    const currentValue = result[key];
    result[key] = isPlainObject(currentValue) ? deepMerge(currentValue, patchValue) : patchValue;
  }
  return result;
}
