import { z } from "zod";

const configSchema = z.object({
  DATABASE_URL: z.string().url("DATABASE_URL must be a valid postgres URL"),
  DATABASE_POOL_URL: z.string().url().optional(),
  MCP_BEARER_TOKEN: z.string().min(16, "MCP_BEARER_TOKEN must be at least 16 chars"),
  PORT: z.coerce.number().int().min(1).max(65535).default(3000),
  TZ: z.string().default("America/New_York"),
  NODE_ENV: z
    .enum(["development", "production", "test"])
    .default("development"),
  // Phase 4: Schwab brokerage + token encryption (D-01/D-02/D-03/D-05)
  TOKEN_ENCRYPTION_KEY: z
    .string()
    .min(32, "TOKEN_ENCRYPTION_KEY must be at least 32 chars"),
  SCHWAB_TRADER_APP_KEY: z.string().min(1),
  SCHWAB_TRADER_APP_SECRET: z.string().min(1),
  SCHWAB_TRADER_CALLBACK_URL: z.string().url(),
  SCHWAB_MARKET_APP_KEY: z.string().min(1),
  SCHWAB_MARKET_APP_SECRET: z.string().min(1),
  SCHWAB_MARKET_CALLBACK_URL: z.string().url(),
  // Phase 8: Supabase Auth + CORS (D20 / SC-4 / AUTH-01)
  // T-01-12: values are NEVER logged — only field names on parse failure (bootConfig).
  SUPABASE_JWT_SECRET: z
    .string()
    .min(32, "SUPABASE_JWT_SECRET must be at least 32 chars"),
  WEB_ORIGIN: z.string().url("WEB_ORIGIN must be a valid URL"),
});

export type Config = z.infer<typeof configSchema>;

/**
 * parseConfig — parse a given env record against the config schema.
 *
 * The env parameter is accepted explicitly (not reading process.env directly)
 * so that the schema parse can be exercised in tests without killing the
 * test process. Throws a ZodError with field names on parse failure.
 *
 * In production, call bootConfig() at the composition root which wraps this
 * and calls process.exit(1) on failure (loud boot per DATA-04).
 */
export function parseConfig(env: Record<string, string | undefined>): Config {
  const result = configSchema.safeParse(env);
  if (result.success !== true) {
    throw result.error;
  }
  return result.data;
}

/**
 * bootConfig — reads process.env, calls parseConfig, exits non-zero with a
 * clear message naming the offending field on failure (DATA-04 loud boot).
 *
 * T-01-12: never log config values — only field names on failure.
 * Railway restart-loop gotcha: the error message must be visible in logs
 * before process.exit(1) so the problem is diagnosable without exec access.
 */
export function bootConfig(): Config {
  try {
    return parseConfig(process.env);
  } catch (e) {
    console.error(
      "Configuration error — check the following environment variables:",
    );
    if (e instanceof z.ZodError) {
      for (const issue of e.issues) {
        console.error(` - ${issue.path.join(".")}: ${issue.message}`);
      }
    }
    process.exit(1);
  }
}
