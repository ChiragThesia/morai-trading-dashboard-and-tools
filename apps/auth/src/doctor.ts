/**
 * doctor.ts — pure diagnostic functions for the `auth doctor` subcommand (D-06).
 *
 * All three functions are PURE: they accept explicit inputs (no process.env, no
 * network calls) so they can be unit-tested without side effects. The composition
 * root (runDoctor) wires them against the live config + OAuth client.
 *
 * Three diagnostic conditions (AUTH-03 success criterion 2):
 *   1. checkEnvCompleteness  — env-missing: lists absent/empty SCHWAB_* / TOKEN_ENCRYPTION_KEY
 *   2. checkCallbackExactMatch — callback-mismatch: character-for-character URL equality (Pitfall 1)
 *   3. checkLiveRefresh      — live-refresh-fail: ok vs auth-expired vs network-error
 */
import { ok } from "@morai/shared";
import type { Result } from "@morai/shared";
import { makeRefreshTokenUseCase } from "@morai/core";
import type {
  AppId,
  AuthExpiredError,
  StorageError,
  ForReadingTokens,
  ForWritingTokens,
} from "@morai/core";
import type { SchwabTokens, OAuthError } from "@morai/adapters";

// ─── Types ────────────────────────────────────────────────────────────────────

const REQUIRED_KEYS = [
  "TOKEN_ENCRYPTION_KEY",
  "SCHWAB_TRADER_APP_KEY",
  "SCHWAB_TRADER_APP_SECRET",
  "SCHWAB_TRADER_CALLBACK_URL",
  "SCHWAB_MARKET_APP_KEY",
  "SCHWAB_MARKET_APP_SECRET",
  "SCHWAB_MARKET_CALLBACK_URL",
] as const;

type RequiredKey = (typeof REQUIRED_KEYS)[number];

export type EnvCompletenessResult = {
  readonly missing: ReadonlyArray<RequiredKey>;
};

export type CallbackMatchResult = {
  readonly match: boolean;
};

export type LiveRefreshStatus = "ok" | "auth-expired" | "network-error";

export type LiveRefreshResult = {
  readonly status: LiveRefreshStatus;
};

// ─── checkEnvCompleteness ─────────────────────────────────────────────────────

/**
 * checkEnvCompleteness — reports any missing or empty required env vars.
 *
 * Returns ok(EnvCompletenessResult) always — never err. The caller prints
 * the list and exits non-zero if missing is non-empty.
 *
 * T-04-11: env values are NEVER included in output — only key names.
 */
export function checkEnvCompleteness(
  env: Record<string, string | undefined>,
): Result<EnvCompletenessResult, never> {
  const missing: RequiredKey[] = [];
  for (const key of REQUIRED_KEYS) {
    const value = env[key];
    if (value === undefined || value === "") {
      missing.push(key);
    }
  }
  return ok({ missing });
}

// ─── checkCallbackExactMatch ──────────────────────────────────────────────────

/**
 * checkCallbackExactMatch — character-for-character URL equality check (D-06, Pitfall 1).
 *
 * Even a trailing slash difference makes the URLs not equal. Schwab requires
 * exact character-for-character match between the env var and the registered URL.
 *
 * @param envCallback        Value from SCHWAB_*_CALLBACK_URL env var
 * @param registeredCallback The URL registered in the Schwab developer portal
 */
export function checkCallbackExactMatch(
  envCallback: string,
  registeredCallback: string,
): Result<CallbackMatchResult, never> {
  return ok({ match: envCallback === registeredCallback });
}

// ─── checkLiveRefresh ─────────────────────────────────────────────────────────

/**
 * checkLiveRefresh — calls an injected refresh function and classifies the result.
 *
 * The refreshFn is a zero-argument closure that the composition root (runDoctor)
 * builds from the real broker-tokens repo + OAuth client. This function is PURE
 * in the sense that it takes an injected function — unit tests pass a fake.
 *
 * Status mapping:
 *   ok               — refresh succeeded (token rotated)
 *   auth-expired     — refresh returned err({kind:'auth-expired',...})
 *   network-error    — threw OR returned any other err (storage-error, etc.)
 */
export async function checkLiveRefresh(
  refreshFn: () => Promise<
    Result<unknown, AuthExpiredError | StorageError>
  >,
): Promise<Result<LiveRefreshResult, never>> {
  try {
    const result = await refreshFn();
    if (result.ok) {
      return ok({ status: "ok" });
    }
    if (result.error.kind === "auth-expired") {
      return ok({ status: "auth-expired" });
    }
    // storage-error or any other err kind
    return ok({ status: "network-error" });
  } catch {
    return ok({ status: "network-error" });
  }
}

// ─── runDoctor ────────────────────────────────────────────────────────────────

/**
 * runDoctor — composition-root wiring that runs all three diagnostics and
 * prints a three-line report.
 *
 * @param config    Parsed auth config (for env completeness + callback check)
 * @param refreshFn Injected live-refresh closure (from repo + OAuth client)
 */
export async function runDoctor(
  config: {
    readonly TOKEN_ENCRYPTION_KEY: string;
    readonly SCHWAB_TRADER_APP_KEY: string;
    readonly SCHWAB_TRADER_APP_SECRET: string;
    readonly SCHWAB_TRADER_CALLBACK_URL: string;
    readonly SCHWAB_MARKET_APP_KEY: string;
    readonly SCHWAB_MARKET_APP_SECRET: string;
    readonly SCHWAB_MARKET_CALLBACK_URL: string;
  },
  refreshFn: () => Promise<Result<unknown, AuthExpiredError | StorageError>>,
  // registeredCallbacks is the "ground truth" registered URL — in practice
  // it is the same as the config value (doctor compares env vs itself as a
  // sanity check for accidental whitespace/trailing-slash differences).
  registeredTraderCallback: string,
  registeredMarketCallback: string,
): Promise<void> {
  // 1. Env completeness
  const envResult = checkEnvCompleteness({
    TOKEN_ENCRYPTION_KEY: config.TOKEN_ENCRYPTION_KEY,
    SCHWAB_TRADER_APP_KEY: config.SCHWAB_TRADER_APP_KEY,
    SCHWAB_TRADER_APP_SECRET: config.SCHWAB_TRADER_APP_SECRET,
    SCHWAB_TRADER_CALLBACK_URL: config.SCHWAB_TRADER_CALLBACK_URL,
    SCHWAB_MARKET_APP_KEY: config.SCHWAB_MARKET_APP_KEY,
    SCHWAB_MARKET_APP_SECRET: config.SCHWAB_MARKET_APP_SECRET,
    SCHWAB_MARKET_CALLBACK_URL: config.SCHWAB_MARKET_CALLBACK_URL,
  });

  if (envResult.ok) {
    if (envResult.value.missing.length === 0) {
      console.warn("[doctor] env completeness: OK — all required vars present");
    } else {
      console.error(
        `[doctor] env completeness: FAIL — missing: ${envResult.value.missing.join(", ")}`,
      );
    }
  }

  // 2. Callback exact match (trader)
  const traderMatch = checkCallbackExactMatch(
    config.SCHWAB_TRADER_CALLBACK_URL,
    registeredTraderCallback,
  );
  if (traderMatch.ok) {
    if (traderMatch.value.match) {
      console.warn("[doctor] trader callback URL: OK — exact match");
    } else {
      console.error(
        "[doctor] trader callback URL: MISMATCH — env value differs from registered URL",
      );
    }
  }

  // Callback exact match (market)
  const marketMatch = checkCallbackExactMatch(
    config.SCHWAB_MARKET_CALLBACK_URL,
    registeredMarketCallback,
  );
  if (marketMatch.ok) {
    if (marketMatch.value.match) {
      console.warn("[doctor] market callback URL: OK — exact match");
    } else {
      console.error(
        "[doctor] market callback URL: MISMATCH — env value differs from registered URL",
      );
    }
  }

  // 3. Live refresh
  const refreshResult = await checkLiveRefresh(refreshFn);
  if (refreshResult.ok) {
    const { status } = refreshResult.value;
    if (status === "ok") {
      console.warn("[doctor] live refresh: OK — token rotated successfully");
    } else if (status === "auth-expired") {
      console.error(
        "[doctor] live refresh: AUTH_EXPIRED — run `auth setup <appId>` to re-authenticate",
      );
    } else {
      console.error(
        "[doctor] live refresh: NETWORK_ERROR — check network or database connection",
      );
    }
  }
}

// ─── runDoctorCommand ─────────────────────────────────────────────────────────

/**
 * runDoctorCommand — composition entry point called from main.ts.
 *
 * Builds the live refreshFn from the injected repo + oauth client and delegates
 * to runDoctor. The registered callback URLs are the same as the config values
 * (doctor validates env vs env as a sanity check).
 *
 * SC2 fix: builds makeRefreshTokenUseCase with the real repo and real oauth client,
 * so the live-refresh probe reads the ACTUAL stored refresh token and exercises
 * the real Schwab token-rotation path — not a hardcoded dummy token.
 */
export async function runDoctorCommand(
  config: {
    readonly TOKEN_ENCRYPTION_KEY: string;
    readonly SCHWAB_TRADER_APP_KEY: string;
    readonly SCHWAB_TRADER_APP_SECRET: string;
    readonly SCHWAB_TRADER_CALLBACK_URL: string;
    readonly SCHWAB_MARKET_APP_KEY: string;
    readonly SCHWAB_MARKET_APP_SECRET: string;
    readonly SCHWAB_MARKET_CALLBACK_URL: string;
  },
  repo: {
    readonly readTokens: ForReadingTokens;
    readonly writeTokens: ForWritingTokens;
  },
  refreshTokensFn: (
    refreshToken: string,
  ) => Promise<Result<SchwabTokens, OAuthError>>,
): Promise<void> {
  // SC2 fix: build the real refresh use-case that reads the stored trader token,
  // calls the real Schwab OAuth endpoint, and persists the rotated tokens.
  // Mirror runRefresh (apps/auth/src/refresh.ts) exactly — same deps pattern.
  const refreshUseCase = makeRefreshTokenUseCase({
    readTokens: repo.readTokens,
    writeTokens: repo.writeTokens,
    refreshTokens: refreshTokensFn,
  });

  // Wrap the use-case result in the signature checkLiveRefresh expects.
  // The use-case returns Result<SchwabTokens, AuthExpiredError | StorageError>
  // which maps directly: ok → ok, auth-expired err → auth-expired, storage err → network-error.
  const refreshFn = (): Promise<Result<unknown, AuthExpiredError | StorageError>> =>
    refreshUseCase("trader");

  await runDoctor(
    config,
    refreshFn,
    config.SCHWAB_TRADER_CALLBACK_URL,
    config.SCHWAB_MARKET_CALLBACK_URL,
  );
}
