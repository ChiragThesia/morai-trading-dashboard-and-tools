// makeExchangeReauth — thin passthrough use-case wrapping ForExchangingReauth (Pattern 4: even a
// passthrough capability gets a core use-case, mirroring makeEnqueueJobUseCase).

import type { Result } from "@morai/shared";
import type { ForExchangingReauth, ReauthApp, ReauthError } from "./ports.ts";

export type ExchangeReauthDeps = {
  readonly exchangeReauth: ForExchangingReauth;
};

export function makeExchangeReauth(
  deps: ExchangeReauthDeps,
): (
  redirectUrl: string,
) => Promise<Result<{ readonly app: ReauthApp; readonly ok: boolean }, ReauthError>> {
  return (redirectUrl: string) => deps.exchangeReauth(redirectUrl);
}
