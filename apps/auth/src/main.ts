/**
 * main.ts — Auth CLI composition root and dispatch.
 *
 * Reads process.argv ONCE here. Builds config → db → repos → dispatch.
 * No business logic — only composition and dispatch.
 *
 * Subcommands: setup <appId> | refresh <appId> | status | doctor
 *
 * T-04-11: No secret or token value ever appears in CLI output.
 */
import { bootAuthConfig } from "./config.ts";
import { makeDb, makePostgresBrokerTokensRepo } from "@morai/adapters";
import { makeSchwabOAuthClient } from "@morai/adapters";
import { runStatus } from "./status.ts";
import { runDoctorCommand } from "./doctor.ts";
import { runSetup } from "./setup.ts";
import { runRefresh } from "./refresh.ts";

const [, , rawSubcommand, ...rest] = process.argv;
const subcommand: string = rawSubcommand ?? "";

const config = bootAuthConfig();

// Build the Postgres pool + Drizzle instance
const db = makeDb(config.DATABASE_URL);

// Build the broker-tokens repo with pgcrypto encryption (TOKEN_ENCRYPTION_KEY injected)
const repo = makePostgresBrokerTokensRepo(db, config.TOKEN_ENCRYPTION_KEY);

switch (subcommand) {
  case "setup": {
    const appId = rest[0];
    if (appId !== "trader" && appId !== "market") {
      console.error(
        `auth setup requires <appId>: "trader" or "market". Got: ${appId ?? "(none)"}`,
      );
      process.exit(1);
    }
    await runSetup(config, repo, appId);
    break;
  }

  case "refresh": {
    const appId = rest[0];
    if (appId !== "trader" && appId !== "market") {
      console.error(
        `auth refresh requires <appId>: "trader" or "market". Got: ${appId ?? "(none)"}`,
      );
      process.exit(1);
    }
    // Build oauth client for the selected app
    const oauthConfig =
      appId === "trader"
        ? {
            appKey: config.SCHWAB_TRADER_APP_KEY,
            appSecret: config.SCHWAB_TRADER_APP_SECRET,
            callbackUrl: config.SCHWAB_TRADER_CALLBACK_URL,
          }
        : {
            appKey: config.SCHWAB_MARKET_APP_KEY,
            appSecret: config.SCHWAB_MARKET_APP_SECRET,
            callbackUrl: config.SCHWAB_MARKET_CALLBACK_URL,
          };
    const oauthClient = makeSchwabOAuthClient({
      ...oauthConfig,
      fetch: globalThis.fetch,
    });
    await runRefresh(config, repo, oauthClient, appId);
    break;
  }

  case "status": {
    await runStatus(repo.readTokenFreshness);
    break;
  }

  case "doctor": {
    // Build a trader oauth client for the live-refresh probe
    const traderClient = makeSchwabOAuthClient({
      appKey: config.SCHWAB_TRADER_APP_KEY,
      appSecret: config.SCHWAB_TRADER_APP_SECRET,
      callbackUrl: config.SCHWAB_TRADER_CALLBACK_URL,
      fetch: globalThis.fetch,
    });
    await runDoctorCommand(config, repo, traderClient.refreshTokens);
    break;
  }

  default: {
    console.error(
      `Unknown subcommand: ${subcommand ?? "(none)"}. Use: setup | refresh | status | doctor`,
    );
    process.exit(1);
  }
}
