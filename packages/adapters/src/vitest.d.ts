/// <reference types="vitest" />

// Declare the types for values provided by globalSetup via context.provide()
declare module "vitest" {
  export interface ProvidedContext {
    dbUrl: string | undefined;
  }
}
