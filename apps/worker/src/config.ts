import { z } from "zod";

// Worker needs the direct connection (for migrations + pg-boss) and phase 2 tunables.
// DATABASE_URL: the direct/session Supabase URL (port 5432) used by runMigrations.
// DATABASE_POOL_URL: optional connection pooler URL for pg-boss (if absent, falls back to DATABASE_URL).
// D-13: all tunables have defaults so Railway env stays minimal (no required additions).
const workerConfigSchema = z.object({
  DATABASE_URL: z.string().url("DATABASE_URL must be a valid postgres URL"),
  // Optional pool URL for pg-boss (LISTEN/NOTIFY needs direct URL; pool URL preferred for job workers)
  DATABASE_POOL_URL: z.string().url().optional(),
  TZ: z.string().default("America/New_York"),
  NODE_ENV: z
    .enum(["development", "production", "test"])
    .default("development"),
  // Phase 2 tunables (D-13) — all have defaults, no Railway env required
  // FRED API key — absent → skip fetch, use 4.5% fallback (D-02)
  FRED_API_KEY: z.string().optional(),
  // BSM filter / compute tunables
  BSM_MAX_DTE: z.coerce.number().int().positive().default(90),
  BSM_STRIKE_BAND_PCT: z.coerce.number().positive().default(0.10),
  BSM_DIVIDEND_YIELD: z.coerce.number().nonnegative().default(0.013),
  BSM_RATE_FALLBACK: z.coerce.number().nonnegative().default(0.045),
});

export type WorkerConfig = z.infer<typeof workerConfigSchema>;

/**
 * parseWorkerConfig — parse a given env record against the worker config schema.
 *
 * Takes env explicitly (not process.env) so the parse can be tested without
 * killing the test process. Throws a ZodError on failure.
 */
export function parseWorkerConfig(
  env: Record<string, string | undefined>,
): WorkerConfig {
  const result = workerConfigSchema.safeParse(env);
  if (result.success !== true) {
    throw result.error;
  }
  return result.data;
}

/**
 * bootWorkerConfig — reads process.env, calls parseWorkerConfig, exits
 * non-zero with a clear message naming the offending field on failure.
 *
 * T-01-12: never log config values — only field names on failure.
 */
export function bootWorkerConfig(): WorkerConfig {
  try {
    return parseWorkerConfig(process.env);
  } catch (e) {
    console.error(
      "Worker configuration error — check the following environment variables:",
    );
    if (e instanceof z.ZodError) {
      for (const issue of e.issues) {
        console.error(` - ${issue.path.join(".")}: ${issue.message}`);
      }
    }
    process.exit(1);
  }
}
