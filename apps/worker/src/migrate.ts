import { bootWorkerConfig } from "./config.ts";
import { runMigrations } from "@morai/adapters";

// This file is the entrypoint for `bun run migrate` (root script).
// It parses config and calls the idempotent migrator over the DIRECT connection.
// runMigrations uses a max:1 postgres.js client and closes it after completion.

const config = bootWorkerConfig();
await runMigrations(config.DATABASE_URL);
console.warn("migrate: all migrations applied");
