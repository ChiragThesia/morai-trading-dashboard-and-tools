import { defineConfig } from "drizzle-kit";

export default defineConfig({
  dialect: "postgresql",
  schema: "./packages/adapters/src/postgres/schema.ts",
  out: "./packages/adapters/src/postgres/migrations",
});
