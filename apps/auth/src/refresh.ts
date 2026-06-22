/**
 * refresh.ts — `auth refresh` subcommand (AUTH-03).
 *
 * Wires makeRefreshTokenUseCase from @morai/core and runs it for the given app.
 * Prints ok/auth-expired — never the token values (T-04-11).
 */
import { makeRefreshTokenUseCase } from "@morai/core";
import type { AppId, ForReadingTokens, ForWritingTokens } from "@morai/core";
import type { SchwabTokens, OAuthError, SchwabOAuthClient } from "@morai/adapters";
import type { Result } from "@morai/shared";
import type { AuthConfig } from "./config.ts";

/**
 * runRefresh — on-demand token rotation for the given app.
 *
 * @param config      Parsed auth config (unused here — kept for interface consistency)
 * @param repo        Broker-tokens repo (readTokens + writeTokens)
 * @param oauthClient Schwab OAuth client for the target app (refreshTokens used)
 * @param appId       "trader" | "market"
 */
export async function runRefresh(
  _config: AuthConfig,
  repo: {
    readonly readTokens: ForReadingTokens;
    readonly writeTokens: ForWritingTokens;
  },
  oauthClient: Pick<SchwabOAuthClient, "refreshTokens">,
  appId: AppId,
): Promise<void> {
  // Build the refresh use-case from injected deps (no direct adapter import in core)
  const refreshUseCase = makeRefreshTokenUseCase({
    readTokens: repo.readTokens,
    writeTokens: repo.writeTokens,
    refreshTokens: (refreshToken: string): Promise<Result<SchwabTokens, OAuthError>> =>
      oauthClient.refreshTokens(refreshToken),
  });

  const result = await refreshUseCase(appId);

  if (result.ok) {
    // T-04-11: print appId only — never the new tokens
    console.warn(`[refresh] ${appId}: token rotated successfully`);
  } else {
    const refreshErr = result.error;
    if (refreshErr.kind === "auth-expired") {
      console.error(
        `[refresh] ${appId}: AUTH_EXPIRED — run \`auth setup ${appId}\` to re-authenticate`,
      );
      process.exit(1);
    } else {
      console.error(
        `[refresh] ${appId}: storage error — ${refreshErr.message}`,
      );
      process.exit(1);
    }
  }
}
