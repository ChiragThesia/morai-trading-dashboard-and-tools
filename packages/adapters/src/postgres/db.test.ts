import { describe, it, expect } from "vitest";
import { inject } from "vitest";
import { sql } from "drizzle-orm";
import { makeDb } from "./db.ts";

/**
 * makeDb statement_timeout pass-through.
 * Requires Docker (testcontainers postgres:16).
 * Skips gracefully when the container URL is not provided (Docker unavailable).
 */

const dbUrl: string | undefined = inject("dbUrl");
const shouldSkip = !dbUrl;

describe.skipIf(shouldSkip)("makeDb statementTimeoutMs", () => {
  it("sets statement_timeout on the connection when given", async () => {
    if (!dbUrl) throw new Error("dbUrl not injected");
    const db = makeDb(dbUrl, { max: 1, statementTimeoutMs: 600_000 });
    const rows = await db.execute(sql`show statement_timeout`);
    expect(rows[0]).toEqual({ statement_timeout: "10min" });
  });

  it("leaves statement_timeout at the server default when omitted", async () => {
    if (!dbUrl) throw new Error("dbUrl not injected");
    const db = makeDb(dbUrl, { max: 1 });
    const rows = await db.execute(sql`show statement_timeout`);
    expect(rows[0]).toEqual({ statement_timeout: "0" });
  });
});
