import { describe, beforeAll, beforeEach } from "vitest";
import { inject } from "vitest";
import { runRuleOverridesContractTests } from "../../__contract__/rule-overrides.contract.ts";
import { makePostgresRuleOverridesRepo } from "./rule-overrides.ts";
import { makeDb } from "../db.ts";
import { ruleOverrides } from "../schema.ts";
import { sql } from "drizzle-orm";

/**
 * Contract test for the Postgres rule-overrides adapter (Phase 29, 29-08).
 * Requires Docker (testcontainers postgres:16, migration chain incl. 0022_rule_overrides.sql).
 * SQL is never mocked (tdd.md): proves the singleton upsert + ruleOverrides contract
 * boundary validation on write AND read.
 */

const dbUrl: string | undefined = inject("dbUrl");
const shouldSkip = !dbUrl;

describe.skipIf(shouldSkip)("postgres rule-overrides adapter", () => {
  let db: ReturnType<typeof makeDb>;

  beforeAll(async () => {
    if (!dbUrl) return;
    db = makeDb(dbUrl);
  });

  beforeEach(async () => {
    if (!db) return;
    await db.delete(ruleOverrides);
  });

  runRuleOverridesContractTests(() => {
    if (!db) throw new Error("db not initialized");
    const repo = makePostgresRuleOverridesRepo(db);
    return {
      readRuleOverrides: repo.readRuleOverrides,
      writeRuleOverrides: repo.writeRuleOverrides,
      seedRawOverrides: async (rawBlob: unknown): Promise<void> => {
        await db.execute(sql`
          INSERT INTO rule_overrides (id, overrides, updated_at)
          VALUES ('default', ${JSON.stringify(rawBlob)}::jsonb, now())
          ON CONFLICT (id) DO UPDATE SET overrides = EXCLUDED.overrides, updated_at = EXCLUDED.updated_at
        `);
      },
    };
  });
});
