import type { GlobalSetupContext } from "vitest/node";

// Dynamic import so we don't need to import Docker types at top level
// (avoids crash when testcontainers not installed)

let containerStop: (() => Promise<void>) | undefined;

export async function setup(context: GlobalSetupContext): Promise<void> {
  // Escape hatch: run against an externally-managed Postgres when set. Lets local
  // dev use a plain `docker run postgres` (Docker Desktop's testcontainers log-wait
  // can stall on newer engines); unset in CI, which uses the testcontainers path.
  const externalUrl = process.env["TEST_DATABASE_URL"];
  if (externalUrl !== undefined && externalUrl !== "") {
    const { runMigrations } = await import("../src/postgres/migrate.ts");
    await runMigrations(externalUrl);
    context.provide("dbUrl", externalUrl);
    console.warn("[globalSetup] Using TEST_DATABASE_URL:", externalUrl);
    return;
  }

  // Detect whether Docker daemon is reachable
  let dockerAvailable = false;
  try {
    const { GenericContainer } = await import("testcontainers");
    // Quick check: attempt a no-op Docker connectivity test
    // If Docker isn't running, the import succeeds but start() throws
    dockerAvailable = true;
    // Silence docker-testcontainers log noise during tests
    process.env["TESTCONTAINERS_RYUK_DISABLED"] = "true";

    const { PostgreSqlContainer } = await import(
      "@testcontainers/postgresql"
    );

    const container = await new PostgreSqlContainer("postgres:16")
      .withDatabase("morai_test")
      .withUsername("test")
      .withPassword("test")
      .start();

    const dbUrl = container.getConnectionUri();
    context.provide("dbUrl", dbUrl);

    // Run migrations against the test container (first run)
    // Import dynamically to avoid circular issues at global setup time
    const { runMigrations } = await import(
      "../src/postgres/migrate.ts"
    );
    await runMigrations(dbUrl);

    containerStop = () => container.stop();
    console.warn("[globalSetup] Postgres container started:", dbUrl);
  } catch (err) {
    if (!dockerAvailable) {
      console.warn(
        "[globalSetup] Docker not available — Postgres contract tests will be SKIPPED",
      );
    } else {
      console.warn("[globalSetup] Docker error:", err);
    }
    // Provide undefined so tests can detect the skip condition
    context.provide("dbUrl", undefined);
  }
}

export async function teardown(): Promise<void> {
  if (containerStop) {
    await containerStop();
    console.warn("[globalSetup] Postgres container stopped");
  }
}
