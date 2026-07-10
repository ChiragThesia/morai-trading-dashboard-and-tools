import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { getRuleSettingsResponse, setRuleOverridesResponse } from "@morai/contracts";
import type { GetRuleSettingsResponse } from "@morai/contracts";
import { apiFetch } from "../lib/rpc.ts";

/**
 * useRuleSettings — RULE-settings data hook (Phase 29-14). Mirrors useRuleTags.ts exactly:
 * a `useQuery` for GET /api/settings/rules exposing { defaults, overrides, effective }, and a
 * non-optimistic per-group mutation for PUT /api/settings/rules (T-29-19: state never flips
 * before the PUT resolves) that invalidates the settings query on success.
 *
 * `resetGroup(group)` PUTs `{ [group]: null }` — the reset-per-group sentinel (29-CONTEXT.md
 * "Reset to defaults per group" = delete those override keys).
 */

export type RuleSettingsGroup = "picker" | "exits" | "regime";

export interface UseRuleSettingsResult {
  readonly defaults: GetRuleSettingsResponse["defaults"] | undefined;
  readonly overrides: GetRuleSettingsResponse["overrides"] | undefined;
  readonly effective: GetRuleSettingsResponse["effective"] | undefined;
  readonly isPending: boolean;
  readonly errors: Readonly<Record<string, string>>;
  readonly saveGroup: (group: RuleSettingsGroup, groupOverrides: Record<string, unknown>) => Promise<void>;
  readonly resetGroup: (group: RuleSettingsGroup) => Promise<void>;
}

export function useRuleSettings(): UseRuleSettingsResult {
  const queryClient = useQueryClient();
  const queryKey = ["settings", "rules"];

  const query = useQuery({
    queryKey,
    queryFn: async (): Promise<GetRuleSettingsResponse> => {
      const res = await apiFetch("/api/settings/rules");

      if (!res.ok) {
        throw new Error(`GET /api/settings/rules failed: ${res.status}`);
      }

      return getRuleSettingsResponse.parse(await res.json());
    },
  });

  const [errors, setErrors] = useState<Record<string, string>>({});

  async function putGroup(group: RuleSettingsGroup, value: Record<string, unknown> | null): Promise<void> {
    try {
      const res = await apiFetch("/api/settings/rules", {
        method: "PUT",
        body: JSON.stringify({ [group]: value }),
      });

      if (!res.ok) {
        throw new Error(`PUT /api/settings/rules failed: ${res.status}`);
      }

      setRuleOverridesResponse.parse(await res.json());

      setErrors((prev) => {
        if (!(group in prev)) return prev;
        const next = { ...prev };
        delete next[group];
        return next;
      });

      await queryClient.invalidateQueries({ queryKey });
    } catch {
      setErrors((prev) => ({ ...prev, [group]: `Couldn't save ${group} settings.` }));
    }
  }

  return {
    defaults: query.data?.defaults,
    overrides: query.data?.overrides,
    effective: query.data?.effective,
    isPending: query.isPending,
    errors,
    saveGroup: (group, groupOverrides) => putGroup(group, groupOverrides),
    resetGroup: (group) => putGroup(group, null),
  };
}
