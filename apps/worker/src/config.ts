import { z } from "zod";

// Worker only needs the direct connection (for migrations) and TZ.
// DATABASE_URL: the direct/session Supabase URL (port 5432) used by runMigrations.
// DATABASE_POOL_URL: not used in the worker — migrations MUST use the direct URL.
const workerConfigSchema = z.object({
  DATABASE_URL: z.string().url("DATABASE_URL must be a valid postgres URL"),
  TZ: z.string().default("America/New_York"),
  NODE_ENV: z
    .enum(["development", "production", "test"])
    .default("development"),
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
