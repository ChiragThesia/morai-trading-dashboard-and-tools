import postgres from "postgres";
import { drizzle } from "drizzle-orm/postgres-js";
import * as schema from "./schema.ts";

export type Db = ReturnType<typeof makeDb>;

/**
 * makeDb — builds a bounded postgres.js client + Drizzle instance.
 * Used by the API path (server composition root).
 * For migrations use runMigrations() from migrate.ts which creates a max:1 client.
 *
 * Pool bounds matter: the app runs behind a Supavisor session pooler with a hard
 * client ceiling. Four uncapped pools (server + worker × {postgres.js, pg-boss})
 * each defaulting to max:10 exhaust that ceiling and crash the server with
 * EMAXCONNSESSION. Callers pass a small `max`; `idleTimeout` releases idle
 * connections back to the pooler so steady-state usage stays low.
 */
export function makeDb(
  connectionString: string,
  opts?: {
    readonly max?: number;
    readonly idleTimeout?: number;
    /**
     * Per-connection statement_timeout in ms. Batch workers set this above the
     * pooler's 2min session default — the BSM drain SELECT can exceed 2min on
     * cold-cache/throttled IO and must not be killed mid-run (57014).
     */
    readonly statementTimeoutMs?: number;
  },
) {
  const client = postgres(connectionString, {
    max: opts?.max ?? 10,
    idle_timeout: opts?.idleTimeout ?? 20,
    ...(opts?.statementTimeoutMs !== undefined
      ? { connection: { statement_timeout: opts.statementTimeoutMs } }
      : {}),
  });
  return drizzle({ client, schema });
}
