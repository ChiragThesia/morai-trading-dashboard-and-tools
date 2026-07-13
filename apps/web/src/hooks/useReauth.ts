import { useQueryClient } from "@tanstack/react-query";
import { reauthStartResponse, reauthExchangeResponse } from "@morai/contracts";
import type { ReauthStartRequest, ReauthStartResponse, ReauthExchangeResponse } from "@morai/contracts";
import { apiFetch } from "../lib/rpc.ts";

/**
 * useReauth — re-auth wizard data hook (Phase 37-06). Mirrors useRuleSettings.ts: POST via
 * `apiFetch` (rpc.ts attaches the Bearer JWT automatically), parse-don't-cast the response
 * through the @morai/contracts schemas. A successful exchange (ok: true) invalidates the
 * ["status"] query so AuthExpiredBanner re-reads freshness and clears once the token is fresh.
 */

export type ReauthApp = ReauthStartRequest["app"];

export interface UseReauthResult {
  readonly startReauth: (app: ReauthApp) => Promise<ReauthStartResponse>;
  readonly exchangeReauth: (redirectUrl: string) => Promise<ReauthExchangeResponse>;
}

export function useReauth(): UseReauthResult {
  const queryClient = useQueryClient();

  async function startReauth(app: ReauthApp): Promise<ReauthStartResponse> {
    const res = await apiFetch("/api/reauth/start", {
      method: "POST",
      body: JSON.stringify({ app }),
    });

    if (!res.ok) {
      throw new Error(`POST /api/reauth/start failed: ${res.status}`);
    }

    return reauthStartResponse.parse(await res.json());
  }

  async function exchangeReauth(redirectUrl: string): Promise<ReauthExchangeResponse> {
    const res = await apiFetch("/api/reauth/exchange", {
      method: "POST",
      body: JSON.stringify({ redirectUrl }),
    });

    if (!res.ok) {
      throw new Error(`POST /api/reauth/exchange failed: ${res.status}`);
    }

    const parsed = reauthExchangeResponse.parse(await res.json());

    if (parsed.ok) {
      await queryClient.invalidateQueries({ queryKey: ["status"] });
    }

    return parsed;
  }

  return { startReauth, exchangeReauth };
}
