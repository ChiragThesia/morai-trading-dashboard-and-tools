/**
 * reauth-adapter.ts — Real ForStartingReauth/ForExchangingReauth over the sidecar admin surface.
 *
 * Implements the ForStartingReauth/ForExchangingReauth ports from @morai/core (37-02). Forwards
 * to POST /sidecar/admin/reauth/{start,exchange} with the shared-secret X-Sidecar-Admin-Token
 * header — the server's only credential for the otherwise-unauthenticated sidecar admin surface
 * (T-37-03).
 *
 * Pattern: mirrors positions-reconciler.ts (D-08):
 *   - fetch-based HTTP adapter (never Postgres, no memory/ twin — HTTP adapters are tested
 *     with an injected fake fetch, not an in-memory repo double)
 *   - Zod safeParse at the boundary via the reauth contracts (parse-don't-cast)
 *   - non-ok HTTP status -> err({ kind: "upstream-error" })
 *   - thrown fetch -> err({ kind: "network-error" })
 *   - parse failure -> err({ kind: "parse-error" })
 *
 * T-37-02: no code/state/redirect URL ever logged — only the error's constructor name.
 */

import type { z } from "zod";
import { ok, err } from "@morai/shared";
import type { Result } from "@morai/shared";
import type { ForStartingReauth, ForExchangingReauth, ReauthApp, ReauthError } from "@morai/core";
import { reauthStartSidecarResponse, reauthExchangeResponse } from "@morai/contracts";

export type SidecarReauthAdapterDeps = {
  /** Base URL of the sidecar service (e.g. http://sidecar.railway.internal:8000). */
  readonly baseUrl: string;
  /** Shared secret for the sidecar admin surface (config.SIDECAR_ADMIN_TOKEN). */
  readonly adminToken: string;
  /** Injectable fetch — defaults to globalThis.fetch; tests inject a fake. */
  readonly fetch: typeof globalThis.fetch;
};

/** postToSidecar — shared POST + safeParse + Result-mapping for both admin endpoints. */
async function postToSidecar<T>(
  deps: SidecarReauthAdapterDeps,
  path: string,
  body: Readonly<Record<string, unknown>>,
  schema: z.ZodType<T>,
): Promise<Result<T, ReauthError>> {
  let resp: Response;
  try {
    resp = await deps.fetch(`${deps.baseUrl}${path}`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Sidecar-Admin-Token": deps.adminToken },
      body: JSON.stringify(body),
    });
  } catch (e) {
    const errName = e instanceof Error ? e.constructor.name : "UnknownError";
    console.error(`reauth-adapter: fetch failed — ${errName} (message redacted)`);
    return err({ kind: "network-error", message: "fetch failed" });
  }

  if (!resp.ok) {
    console.error(`reauth-adapter: sidecar returned ${resp.status} (body redacted)`);
    return err({ kind: "upstream-error", message: `sidecar returned ${resp.status}` });
  }

  let rawBody: unknown;
  try {
    rawBody = await resp.json();
  } catch (e) {
    const errName = e instanceof Error ? e.constructor.name : "UnknownError";
    console.error(`reauth-adapter: body read failed — ${errName} (message redacted)`);
    return err({ kind: "parse-error", message: "body read failed" });
  }

  // Zod safeParse at the trust boundary (parse-don't-cast, typescript.md)
  const parsed = schema.safeParse(rawBody);
  if (!parsed.success) {
    return err({ kind: "parse-error", message: "sidecar reauth response parse error" });
  }

  return ok(parsed.data);
}

/**
 * makeSidecarReauthAdapter — factory returning real ForStartingReauth/ForExchangingReauth
 * implementations backed by the sidecar's admin endpoints.
 */
export function makeSidecarReauthAdapter(
  deps: SidecarReauthAdapterDeps,
): { readonly startReauth: ForStartingReauth; readonly exchangeReauth: ForExchangingReauth } {
  return {
    startReauth: async (app: ReauthApp) => {
      const result = await postToSidecar(
        deps,
        "/sidecar/admin/reauth/start",
        { app },
        reauthStartSidecarResponse,
      );
      if (!result.ok) return result;
      // Never forward `state` beyond this boundary (T-37-06) — the port only needs authUrl.
      return ok({ authUrl: result.value.authUrl });
    },
    exchangeReauth: async (redirectUrl: string) => {
      const result = await postToSidecar(
        deps,
        "/sidecar/admin/reauth/exchange",
        { redirectUrl },
        reauthExchangeResponse,
      );
      if (!result.ok) return result;
      return ok({ app: result.value.app, ok: result.value.ok });
    },
  };
}
