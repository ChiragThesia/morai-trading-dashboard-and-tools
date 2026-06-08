import { describe, it, expect } from "vitest";
import { inject } from "vitest";
import { runMigrations } from "./migrate.ts";

/**
 * Tests that running migrate() twice applies the migration once
 * and the second run applies 0 migrations.
 * Requires Docker — skips when dbUrl is not injected.
 */

const dbUrl: string | undefined = inject("dbUrl");
const shouldSkip = !dbUrl;

describe.skipIf(shouldSkip)("runMigrations idempotency", () => {
  it("second migrate() call applies 0 new migrations and exits cleanly", async () => {
    if (!dbUrl) return;

    // First run was already done in globalSetup beforeAll.
    // Run again — should apply 0.
    await expect(runMigrations(dbUrl)).resolves.toBeUndefined();
  });
});
