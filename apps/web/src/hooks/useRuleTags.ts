import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { getEventsWithRulesResponse, setRuleTagsResponse } from "@morai/contracts";
import type { EventWithRulesEntry, GetEventsWithRulesResponse } from "@morai/contracts";
import { apiFetch } from "../lib/rpc.ts";

/**
 * useRuleTags — RULE-01 data hook: fetches the combined events+rule-tag payload for a
 * calendar (GET /api/journal/:calendarId/rules) and exposes a save mutation
 * (PUT /api/journal/events/:hash/rules) with a per-event retry path.
 *
 * - Parses both responses via the journal-rules contracts (mirrors usePicker's
 *   fetch/parse/error idiom) — no `as` cast.
 * - Non-optimistic (T-20-17): `save` never flips local state before the PUT resolves. On
 *   success it invalidates the events query so the UI reflects only the server-confirmed
 *   tags; on failure it records an error keyed by `fillIdsHash` (drives the inline
 *   "Couldn't save rule tags." + Retry copy) and remembers the payload so `retry` can
 *   resubmit the exact same request.
 */

interface RuleTagsPayload {
  readonly tags: ReadonlyArray<string>;
  readonly otherNote?: string;
}

export interface UseRuleTagsResult {
  readonly events: ReadonlyArray<EventWithRulesEntry>;
  readonly isPending: boolean;
  readonly errors: Readonly<Record<string, string>>;
  readonly save: (
    fillIdsHash: string,
    tags: ReadonlyArray<string>,
    otherNote?: string,
  ) => Promise<void>;
  readonly retry: (fillIdsHash: string) => void;
}

function buildBody(payload: RuleTagsPayload): Record<string, unknown> {
  return {
    tags: payload.tags,
    ...(payload.otherNote !== undefined ? { otherNote: payload.otherNote } : {}),
  };
}

export function useRuleTags(calendarId: string): UseRuleTagsResult {
  const queryClient = useQueryClient();
  const queryKey = ["ruleTags", calendarId];

  const query = useQuery({
    queryKey,
    queryFn: async (): Promise<GetEventsWithRulesResponse> => {
      const res = await apiFetch(`/api/journal/${calendarId}/rules`);

      if (!res.ok) {
        throw new Error(`GET /api/journal/${calendarId}/rules failed: ${res.status}`);
      }

      return getEventsWithRulesResponse.parse(await res.json());
    },
  });

  const [errors, setErrors] = useState<Record<string, string>>({});
  const [lastPayload, setLastPayload] = useState<Record<string, RuleTagsPayload>>({});

  async function save(
    fillIdsHash: string,
    tags: ReadonlyArray<string>,
    otherNote?: string,
  ): Promise<void> {
    const payload: RuleTagsPayload = { tags, ...(otherNote !== undefined ? { otherNote } : {}) };
    setLastPayload((prev) => ({ ...prev, [fillIdsHash]: payload }));

    try {
      const res = await apiFetch(`/api/journal/events/${fillIdsHash}/rules`, {
        method: "PUT",
        body: JSON.stringify(buildBody(payload)),
      });

      if (!res.ok) {
        throw new Error(`PUT /api/journal/events/${fillIdsHash}/rules failed: ${res.status}`);
      }

      setRuleTagsResponse.parse(await res.json());

      setErrors((prev) => {
        if (!(fillIdsHash in prev)) return prev;
        const next = { ...prev };
        delete next[fillIdsHash];
        return next;
      });

      await queryClient.invalidateQueries({ queryKey });
    } catch {
      setErrors((prev) => ({ ...prev, [fillIdsHash]: "Couldn't save rule tags." }));
    }
  }

  function retry(fillIdsHash: string): void {
    const payload = lastPayload[fillIdsHash];
    if (payload === undefined) return;
    void save(fillIdsHash, payload.tags, payload.otherNote);
  }

  return {
    events: query.data?.events ?? [],
    isPending: query.isPending,
    errors,
    save,
    retry,
  };
}
