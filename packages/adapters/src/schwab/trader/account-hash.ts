/**
 * account-hash.ts — resolves the Schwab account hash from /accounts/accountNumbers.
 *
 * RESEARCH Pitfall 5: trader API requires hashValue, NOT the raw account number.
 * GET /trader/v1/accounts/accountNumbers → [{ accountNumber, hashValue }]
 *
 * T-04-19: Bearer token never logged; only {kind,message} returned on error.
 * T-04-21: AUTH_EXPIRED short-circuits before any network call.
 * D-12: Zod safeParse at boundary; malformed response → Result.err, never throw.
 */
import { z } from "zod";
import { ok, err } from "@morai/shared";
import type { Result } from "@morai/shared";
import type { FetchError, AuthExpiredError, ForResolvingAccountHash } from "@morai/core";

// ─── Endpoint ─────────────────────────────────────────────────────────────────

const ACCOUNT_NUMBERS_URL =
  "https://api.schwabapi.com/trader/v1/accounts/accountNumbers";

// ─── Zod schema (MEDIUM confidence — all fields optional + passthrough) ────────

const AccountNumberEntrySchema = z
  .object({
    accountNumber: z.string().optional(),
    hashValue: z.string().optional(),
  })
  .passthrough();

const AccountNumbersResponseSchema = z.array(AccountNumberEntrySchema);

// ─── Adapter type ─────────────────────────────────────────────────────────────

export type AccountHashResolver = {
  readonly resolveAccountHash: ForResolvingAccountHash;
};

/**
 * makeAccountHashResolver — resolves the Schwab account hash at runtime.
 *
 * Must be called before any trader data call (Pitfall 5).
 * Never uses the raw account number in data-call URLs.
 *
 * @param deps.fetch           - Injected fetch
 * @param deps.getAccessToken  - Returns ok(token) or err(AUTH_EXPIRED) — checked first
 * @param deps.userAgent       - User-Agent header
 */
export function makeAccountHashResolver(deps: {
  fetch: typeof globalThis.fetch;
  getAccessToken: () => Promise<Result<string, AuthExpiredError>>;
  userAgent: string;
}): AccountHashResolver {
  const resolveAccountHash: ForResolvingAccountHash = async (): Promise<
    Result<string, FetchError | AuthExpiredError>
  > => {
    // Step 1: Check access token freshness BEFORE any network call (T-04-21)
    const tokenResult = await deps.getAccessToken();
    if (!tokenResult.ok) {
      return err(tokenResult.error);
    }
    const accessToken = tokenResult.value;

    // Step 2: Fetch the account numbers list
    let rawBody: unknown;
    try {
      const response = await deps.fetch(ACCOUNT_NUMBERS_URL, {
        headers: {
          Authorization: `Bearer ${accessToken}`,
          "User-Agent": deps.userAgent,
        },
      });
      if (!response.ok) {
        return err({
          kind: "fetch-error",
          message: `Schwab accountNumbers returned HTTP ${response.status}`,
        });
      }
      rawBody = await response.json();
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      return err({ kind: "fetch-error", message });
    }

    // Step 3: Zod-parse at boundary (D-12)
    const parsed = AccountNumbersResponseSchema.safeParse(rawBody);
    if (parsed.success !== true) {
      return err({
        kind: "fetch-error",
        message: `Schwab accountNumbers parse error: ${parsed.error.message}`,
      });
    }

    const entries = parsed.data;
    if (entries.length === 0) {
      return err({
        kind: "fetch-error",
        message: "Schwab accountNumbers returned empty array",
      });
    }

    const first = entries[0];
    const hashValue = first?.hashValue;
    if (hashValue === undefined || hashValue.length === 0) {
      return err({
        kind: "fetch-error",
        message: "Schwab accountNumbers entry missing hashValue",
      });
    }

    return ok(hashValue);
  };

  return { resolveAccountHash };
}
