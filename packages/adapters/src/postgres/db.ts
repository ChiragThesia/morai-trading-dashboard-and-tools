import postgres from "postgres";
import { sql } from "drizzle-orm";
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
  opts?: { readonly max?: number; readonly idleTimeout?: number },
) {
  const client = postgres(connectionString, {
    max: opts?.max ?? 10,
    idle_timeout: opts?.idleTimeout ?? 20,
  });
  return drizzle({ client, schema });
}

/** Transaction handle passed to withStatementTimeout's callback. */
export type DbTx = Parameters<Parameters<Db["transaction"]>[0]>[0];

/**
 * withStatementTimeout — run fn in a transaction with a raised statement_timeout.
 *
 * Supavisor (the session pooler) strips statement_timeout sent as a connection
 * startup parameter, so per-connection config cannot override its 2min session
 * default — a long batch statement (the BSM drain SELECT on cold-cache IO) gets
 * killed mid-run (57014). SET LOCAL inside the transaction is pooler-proof and
 * scopes the override to exactly the statements that need it.
 */
export async function withStatementTimeout<T>(
  db: Db,
  timeoutMs: number,
  fn: (tx: DbTx) => Promise<T>,
): Promise<T> {
  return db.transaction(async (tx) => {
    // SET LOCAL reverts at COMMIT/ROLLBACK. Value is a code constant (ms integer),
    // never user input — sql.raw is safe here.
    await tx.execute(sql.raw(`set local statement_timeout = ${Math.floor(timeoutMs)}`));
    return fn(tx);
  });
}
