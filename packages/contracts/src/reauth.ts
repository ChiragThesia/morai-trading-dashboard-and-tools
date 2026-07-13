import { z } from "zod";

// REAUTH-05: browser-facing re-auth Zod contracts (Phase 37, Plan 02).
// All four schemas are `.strict()` — an extra key is REJECTED. The exchange response is a
// bare `{ app, ok }`: no code/state/error-detail may ever reach the browser (CONTEXT + UI-SPEC
// no-leak invariant, T-37-06).

export const reauthStartRequest = z
  .object({
    app: z.enum(["trader", "market"]),
  })
  .strict();

export type ReauthStartRequest = z.infer<typeof reauthStartRequest>;

// Sidecar→server wire shape: the sidecar's StartResponse always carries all three fields
// (reauth_admin.py). The server adapter parses THIS, then narrows to { authUrl } before the
// value crosses toward the browser — `state` (the CSRF nonce) never leaves the adapter (T-37-06).
export const reauthStartSidecarResponse = z
  .object({
    app: z.enum(["trader", "market"]),
    authUrl: z.string().url(),
    state: z.string(),
  })
  .strict();

export type ReauthStartSidecarResponse = z.infer<typeof reauthStartSidecarResponse>;

// Server→browser wire shape: { authUrl } ONLY. Being `.strict()` and state-free, the schema
// structurally cannot carry the CSRF state or an auth code into the browser (no-leak invariant).
export const reauthStartResponse = z
  .object({
    authUrl: z.string().url(),
  })
  .strict();

export type ReauthStartResponse = z.infer<typeof reauthStartResponse>;

export const reauthExchangeRequest = z
  .object({
    redirectUrl: z.string().url(),
  })
  .strict();

export type ReauthExchangeRequest = z.infer<typeof reauthExchangeRequest>;

export const reauthExchangeResponse = z
  .object({
    app: z.enum(["trader", "market"]),
    ok: z.boolean(),
    // NEVER add code/state/redirect echo here — no-leak invariant (T-37-06).
  })
  .strict();

export type ReauthExchangeResponse = z.infer<typeof reauthExchangeResponse>;
