import { describe, beforeAll, afterAll, afterEach } from "vitest";
import { inject } from "vitest";
import { runBrokerTokensContractTests } from "../../__contract__/broker-tokens.contract.ts";
import { makePostgresBrokerTokensRepo } from "./broker-tokens.ts";
import { makeDb } from "../db.ts";
import { sql } from "drizzle-orm";

/**
 * Contract test for the Postgres broker-tokens adapter.
 * Requires Docker (testcontainers postgres:16 with pgcrypto).
 * Skips gracefully when Docker is unavailable (dbUrl not provided).
 *
 * Asserts AUTH-02:
 * - pgcrypto round-trip: writeTokens → readTokens decrypts to original plaintext
 * - Raw bytea != plaintext (encryption at rest, T-04-04/T-04-05)
 * - Key never inlined into SQL (always a bound parameter, D-03)
 */

const TEST_ENCRYPTION_KEY = "test-encryption-key-min-32-chars-long!!";

const dbUrl: string | undefined = inject("dbUrl");
const shouldSkip = !dbUrl;

describe.skipIf(shouldSkip)("postgres broker-tokens adapter", () => {
  let db: ReturnType<typeof makeDb>;

  beforeAll(async () => {
    if (!dbUrl) return;
    db = makeDb(dbUrl);
  });

  afterEach(async () => {
    // Truncate broker_tokens between tests to ensure isolation
    if (!db) return;
    await db.execute(sql`TRUNCATE TABLE broker_tokens`);
  });

  afterAll(async () => {
    // postgres.js auto-closes on process exit
  });

  runBrokerTokensContractTests(() => {
    if (!db) throw new Error("db not initialized");
    const repo = makePostgresBrokerTokensRepo(db, TEST_ENCRYPTION_KEY);
    return {
      readTokens: repo.readTokens,
      writeTokens: repo.writeTokens,
      readTokenFreshness: repo.readTokenFreshness,
      // rawReadAccessToken reads the raw bytea without decryption to prove encryption
      rawReadAccessToken: async (appId) => {
        const rows = await db.execute(
          sql`SELECT access_token FROM broker_tokens WHERE app_id = ${appId}`,
        );
        const row = rows[0];
        if (row === undefined) return null;
        const rec: { [key: string]: unknown } = Object.fromEntries(
          Object.entries(row),
        );
        const raw = rec["access_token"];
        if (raw instanceof Buffer) return raw;
        if (raw instanceof Uint8Array) return Buffer.from(raw);
        // postgres.js may return bytea as a hex string like "\\x..."
        if (typeof raw === "string") return Buffer.from(raw.replace(/^\\x/, ""), "hex");
        return null;
      },
    };
  });
});
