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
  // Phase 8: Supabase Auth + CORS (D20 / SC-4 / AUTH-01 — updated: JWKS asymmetric verify).
  // SUPABASE_URL: base URL of the Supabase project; JWKS path derived at runtime.
  // SUPABASE_JWT_SECRET removed — asymmetric ES256 verify needs no shared secret.
  // Both SUPABASE_URL and WEB_ORIGIN are non-secret public values.
  SUPABASE_URL: z.string().url("SUPABASE_URL must be a valid URL"),
  WEB_ORIGIN: z.string().url("WEB_ORIGIN must be a valid URL"),
  // Phase 12 (12-05): sidecar URL — server needs the sidecar base URL to reach
  //   /sidecar/events (live tick stream) + /sidecar/positions (STRM-05 reconcile)
  //   + /sidecar/subscribe (SC6 ad-hoc proxy via POST /api/stream/subscribe).
  // e.g. "http://sidecar.railway.internal:8000" on Railway; "http://localhost:8000" locally.
  // NOTE: Set this on the Railway server service (same value as the worker's SIDECAR_URL).
  SIDECAR_URL: z.string().url("SIDECAR_URL must be a valid URL"),
  // Phase 37 (37-05): shared secret for the sidecar's re-auth admin surface (REAUTH-05).
  // Same value set on the sidecar (37-03); Railway env setup on both services is owned by 37-07.
  SIDECAR_ADMIN_TOKEN: z.string().min(16, "SIDECAR_ADMIN_TOKEN must be at least 16 chars"),
  // Phase 30 (30-05): ad-hoc analyze use-case BSM inputs — same defaults as the worker's
  // compute-picker wiring (config.ts), so pasted-calendar scoring matches engine scoring.
  BSM_DIVIDEND_YIELD: z.coerce.number().nonnegative().default(0.013),
  BSM_RATE_FALLBACK: z.coerce.number().nonnegative().default(0.045),
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
