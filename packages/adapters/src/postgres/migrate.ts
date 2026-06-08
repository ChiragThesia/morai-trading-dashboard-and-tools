import postgres from "postgres";
import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import { fileURLToPath } from "node:url";
import { join, dirname } from "node:path";

// Resolve migrations folder relative to THIS file, regardless of CWD
const _dir = dirname(fileURLToPath(import.meta.url));
const migrationsFolder = join(_dir, "migrations");

/**
 * runMigrations — idempotent boot migrator.
 *
 * Creates a dedicated max:1 postgres.js client (Pitfall 3 — migrations need
 * max:1 so multiple statements in a file don't interleave across connections),
 * runs migrate() over the DIRECT connection, then closes the client.
 *
 * Safe to call twice — Drizzle's __drizzle_migrations ledger tracks which
 * files have already been applied; subsequent calls apply 0 and exit cleanly.
 */
export async function runMigrations(connectionString: string): Promise<void> {
  // T-01-08: max:1 prevents pooled-connection interleaving during DDL migrations
  const client = postgres(connectionString, { max: 1 });
  try {
    await migrate(drizzle({ client }), { migrationsFolder });
  } finally {
    await client.end();
  }
}
