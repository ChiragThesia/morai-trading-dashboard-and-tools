// Reauth bounded context — driven port TYPE declarations (Phase 37, Plan 02, REAUTH-05).
// Hexagon law (architecture-boundaries §2): this file imports ONLY @morai/shared. No
// Hono/fetch/process.env — the sidecar HTTP adapter (packages/adapters) implements these ports;
// core stays framework-free.

import type { Result } from "@morai/shared";

export type ReauthApp = "trader" | "market";

/** ReauthError — driven-port failure for the two re-auth operations. */
export type ReauthError = {
  readonly kind: "network-error" | "upstream-error" | "parse-error";
  readonly message: string;
};

/** ForStartingReauth — mint a Schwab authorize URL for one app. */
export type ForStartingReauth = (
  app: ReauthApp,
) => Promise<Result<{ readonly authUrl: string }, ReauthError>>;

/** ForExchangingReauth — exchange a captured redirect URL for tokens. */
export type ForExchangingReauth = (
  redirectUrl: string,
) => Promise<Result<{ readonly app: ReauthApp; readonly ok: boolean }, ReauthError>>;
