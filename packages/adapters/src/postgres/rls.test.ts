import { describe, it, expect, inject } from "vitest";
import postgres from "postgres";

/**
 * RLS deny-all guard. Every journal table must have row-level security ENABLED
 * so Supabase's anon/authenticated API roles are denied by default (deny-all —
 * RLS on, no policies). Our app connects as the `postgres` role, which BYPASSES
 * RLS, so this only locks the public PostgREST surface, not our access.
 *
 * Encoded via .enableRLS() in schema.ts + the generated migration so a fresh DB
 * reproduces it — no drift from a hand-applied ALTER. Requires Docker
 * (testcontainers postgres:16); skips when the container URL is unavailable.
 */

const dbUrl: string | undefined = inject("dbUrl");
const shouldSkip = !dbUrl;

const TABLES = [
  "calendars",
  "calendar_snapshots",
  "leg_observations",
  "contracts",
  "fills",
  "orders",
  "rate_observations",
] as const;

describe.skipIf(shouldSkip)("RLS deny-all on journal tables", () => {
  it("every journal table has row-level security enabled", async () => {
    if (!dbUrl) return;
    const sql = postgres(dbUrl, { max: 1 });
    try {
      const rows = await sql<{ relname: string; relrowsecurity: boolean }[]>`
        SELECT c.relname, c.relrowsecurity
        FROM pg_class c
        JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE n.nspname = 'public'
          AND c.relname IN ${sql(TABLES)}
      `;
      const enabled = new Map(rows.map((r) => [r.relname, r.relrowsecurity]));
      for (const table of TABLES) {
        expect(enabled.get(table), `RLS must be enabled on ${table}`).toBe(
          true,
        );
      }
    } finally {
      await sql.end();
    }
  });
});
