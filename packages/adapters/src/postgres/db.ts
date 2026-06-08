import postgres from "postgres";
import { drizzle } from "drizzle-orm/postgres-js";
import * as schema from "./schema.ts";

export type Db = ReturnType<typeof makeDb>;

/**
 * makeDb — builds a full-pool postgres.js client + Drizzle instance.
 * Used by the API path (server composition root).
 * For migrations use runMigrations() from migrate.ts which creates a max:1 client.
 */
export function makeDb(connectionString: string) {
  const client = postgres(connectionString);
  return drizzle({ client, schema });
}
