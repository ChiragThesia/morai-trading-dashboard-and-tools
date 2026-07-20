import { describe, it, expect } from "vitest";
import { inject } from "vitest";
import { sql } from "drizzle-orm";
import { makeDb, withStatementTimeout } from "./db.ts";

/**
 * withStatementTimeout — pooler-proof statement_timeout override.
 * Requires Docker (testcontainers postgres:16).
 * Skips gracefully when the container URL is not provided (Docker unavailable).
 */

const dbUrl: string | undefined = inject("dbUrl");
const shouldSkip = !dbUrl;

describe.skipIf(shouldSkip)("withStatementTimeout", () => {
  it("raises statement_timeout inside the transaction", async () => {
    if (!dbUrl) throw new Error("dbUrl not injected");
    const db = makeDb(dbUrl, { max: 1 });
    const rows = await withStatementTimeout(db, 600_000, async (tx) =>
      tx.execute(sql`select current_setting('statement_timeout') as statement_timeout`),
    );
    expect(rows[0]).toEqual({ statement_timeout: "10min" });
  });

  it("does not leak the override outside the transaction", async () => {
    if (!dbUrl) throw new Error("dbUrl not injected");
    const db = makeDb(dbUrl, { max: 1 });
    await withStatementTimeout(db, 600_000, async (tx) =>
      tx.execute(sql`select 1`),
    );
    const after = await db.execute(sql`show statement_timeout`);
    expect(after[0]).toEqual({ statement_timeout: "0" });
  });
});
