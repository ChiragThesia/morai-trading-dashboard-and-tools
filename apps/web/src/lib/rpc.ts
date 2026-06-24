import { hc } from "hono/client";
// TYPE-ONLY import — verbatimModuleSyntax enforces this.
// CRITICAL: Never import AppType without `type` — that would bundle the entire server.
// The `import type` creates zero runtime overhead; hc<AppType>() resolves types at compile time.
// RPC-01 / SC-3: AppType exported from apps/server/src/main.ts after the default export.
import type { AppType } from "../../../server/src/main.ts";

// Module-level auth token — updated by setAuthToken whenever the Supabase session changes.
// Captured by the `headers` function at request time (not at client construction time).
let _token: string | null = null;

/**
 * setAuthToken — call with the Supabase session access_token on every auth state change,
 * or null on sign-out. The RPC client captures this at request time via the `headers` closure.
 *
 * Security (T-09-04): token is never logged — no console.* calls in this file.
 */
export function setAuthToken(token: string | null): void {
  _token = token;
}

/**
 * authHeaders — returns the Authorization header object when a token is present.
 * Used by both `rpc` (via hc<> headers option) and `apiFetch`.
 */
function authHeaders(): Record<string, string> {
  return {
    ...(_token !== null ? { Authorization: `Bearer ${_token}` } : {}),
    "Content-Type": "application/json",
  };
}

/**
 * rpc — typed Hono RPC client singleton.
 *
 * `hc<AppType>()` resolves route types at compile time.
 * Note: the server's `AppType` uses statement-style route chaining which limits compile-time
 * route inference; `apiFetch` is provided for route calls that need the auth header.
 *
 * VITE_API_BASE_URL: `https://` only (T-09-01 — never send Bearer over plain HTTP).
 * The `as string` cast here is the ONLY permitted `as` in this file: vite-env.d.ts declares
 * VITE_API_BASE_URL as `string` but exactOptionalPropertyTypes requires the cast for hc<>().
 */
// eslint-disable-next-line @typescript-eslint/consistent-type-assertions
export const rpc = hc<AppType>(import.meta.env.VITE_API_BASE_URL as string, {
  headers: authHeaders,
});

/**
 * apiFetch — typed-safe fetch helper that attaches the Bearer token header.
 *
 * Use this for API calls where hc<AppType>() route inference is unavailable due to
 * the server's statement-style route composition (which produces BlankSchema). Zod
 * parse-don't-cast at the call site provides type safety for the response body.
 *
 * Security (T-09-01): Only calls paths that start with "/" — full URL is composed from
 * VITE_API_BASE_URL which must be `https://` in production.
 */
export function apiFetch(path: string, init?: RequestInit): Promise<Response> {
  const base = import.meta.env.VITE_API_BASE_URL.replace(/\/$/, "");
  return fetch(`${base}${path}`, {
    ...init,
    headers: {
      ...authHeaders(),
      ...(init?.headers instanceof Headers
        ? Object.fromEntries(init.headers.entries())
        : (init?.headers ?? {})),
    },
  });
}
