/// <reference types="vitest" />

// Declare the types for values provided by the shared globalSetup
// (packages/adapters/test/globalSetup.ts, referenced in vitest.config.ts).
// The globalSetup calls context.provide("dbUrl", ...) to supply the Postgres
// testcontainer URL to contract/regression tests via inject("dbUrl").
declare module "vitest" {
  export interface ProvidedContext {
    dbUrl: string | undefined;
  }
}
