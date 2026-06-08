// Worker composition root.
// Boot: parse config → run idempotent migrator over the direct connection → idle.
// No pg-boss jobs this phase (Phase 1 walking skeleton).

import { bootWorkerConfig } from "./config.ts";
import { runMigrations } from "@morai/adapters";

const config = bootWorkerConfig();

// DATA-02: idempotent boot migration over the direct connection.
// runMigrations creates a dedicated max:1 client (Pitfall 3) and closes it.
await runMigrations(config.DATABASE_URL);

console.warn("morai worker: migrations applied, idling");

// Phase 1: no jobs. Worker stays alive to demonstrate idle pattern.
// pg-boss job registration lands in Phase 3+.
setInterval(() => {
  // intentional idle — no jobs this phase
}, 60_000);
