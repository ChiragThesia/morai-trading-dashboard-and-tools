/**
 * config.ts — Auth CLI configuration (DATA-04 loud-fail pattern).
 *
 * parseAuthConfig accepts an explicit env record (testable without process.exit).
 * bootAuthConfig() is the thin loud-fail wrapper that reads process.env.
 *
 * T-04-11: never log config values — only field names on failure.
 */
import { z } from "zod";

const authConfigSchema = z.object({
  DATABASE_URL: z.string().url("DATABASE_URL must be a valid postgres URL"),
  TOKEN_ENCRYPTION_KEY: z
    .string()
    .min(32, "TOKEN_ENCRYPTION_KEY must be at least 32 chars"),
  SCHWAB_TRADER_APP_KEY: z.string().min(1),
  SCHWAB_TRADER_APP_SECRET: z.string().min(1),
  SCHWAB_TRADER_CALLBACK_URL: z.string().url(),
  SCHWAB_MARKET_APP_KEY: z.string().min(1),
  SCHWAB_MARKET_APP_SECRET: z.string().min(1),
  SCHWAB_MARKET_CALLBACK_URL: z.string().url(),
});

export type AuthConfig = z.infer<typeof authConfigSchema>;

/**
 * parseAuthConfig — parse a given env record against the auth config schema.
 *
 * Takes env explicitly (not process.env) so the parse can be tested without
 * killing the test process. Throws a ZodError with field names on parse failure.
 */
export function parseAuthConfig(
  env: Record<string, string | undefined>,
): AuthConfig {
  const result = authConfigSchema.safeParse(env);
  if (result.success !== true) {
    throw result.error;
  }
  return result.data;
}

/**
 * bootAuthConfig — reads process.env, calls parseAuthConfig, exits non-zero
 * with a clear message naming the offending field on failure (DATA-04 loud boot).
 *
 * T-04-11: never log config values — only field names on failure.
 */
export function bootAuthConfig(): AuthConfig {
  try {
    return parseAuthConfig(process.env);
  } catch (e) {
    console.error(
      "Auth CLI configuration error — check the following environment variables:",
    );
    if (e instanceof z.ZodError) {
      for (const issue of e.issues) {
        console.error(` - ${issue.path.join(".")}: ${issue.message}`);
      }
    }
    process.exit(1);
  }
}
