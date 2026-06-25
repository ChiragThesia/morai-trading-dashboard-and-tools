import { describe, it, expect } from "vitest";
import { parseConfig } from "./config.ts";

const BASE_VALID_ENV = {
  DATABASE_URL: "postgres://user:pass@localhost:5432/db",
  MCP_BEARER_TOKEN: "a-valid-token-1234",
  TOKEN_ENCRYPTION_KEY: "test-encryption-key-must-be-32-chars-long",
  SCHWAB_TRADER_APP_KEY: "test-trader-key",
  SCHWAB_TRADER_APP_SECRET: "test-trader-secret",
  SCHWAB_TRADER_CALLBACK_URL: "https://127.0.0.1:8182",
  SCHWAB_MARKET_APP_KEY: "test-market-key",
  SCHWAB_MARKET_APP_SECRET: "test-market-secret",
  SCHWAB_MARKET_CALLBACK_URL: "https://127.0.0.1:8183",
  // Phase 8 (D20 — updated): JWKS asymmetric verify — no shared secret; SUPABASE_URL replaces SUPABASE_JWT_SECRET
  SUPABASE_URL: "https://cwcdcosxoaqyqbsfifsh.supabase.co",
  WEB_ORIGIN: "http://localhost:5173",
};

describe("parseConfig", () => {
  it("returns a typed Config for a valid env", () => {
    const config = parseConfig(BASE_VALID_ENV);
    expect(config.DATABASE_URL).toBe("postgres://user:pass@localhost:5432/db");
    expect(config.MCP_BEARER_TOKEN).toBe("a-valid-token-1234");
    expect(config.PORT).toBe(3000);
    expect(config.TZ).toBe("America/New_York");
  });

  it("throws a Zod error naming DATABASE_URL when it is missing", () => {
    const env = { ...BASE_VALID_ENV, DATABASE_URL: undefined };
    expect(() => parseConfig(env)).toThrow(/DATABASE_URL/);
  });

  it("throws a Zod error when DATABASE_URL is not a valid URL", () => {
    const env = { ...BASE_VALID_ENV, DATABASE_URL: "not-a-url" };
    expect(() => parseConfig(env)).toThrow();
  });

  it("throws a Zod error when MCP_BEARER_TOKEN is shorter than 16 chars", () => {
    const env = { ...BASE_VALID_ENV, MCP_BEARER_TOKEN: "tooshort" };
    expect(() => parseConfig(env)).toThrow(/MCP_BEARER_TOKEN/);
  });

  it("respects DATABASE_POOL_URL as optional", () => {
    const config = parseConfig({
      ...BASE_VALID_ENV,
      DATABASE_POOL_URL: "postgres://user:pass@localhost:6543/db",
    });
    expect(config.DATABASE_POOL_URL).toBe("postgres://user:pass@localhost:6543/db");
  });

  it("coerces PORT from a string to a number", () => {
    const config = parseConfig({ ...BASE_VALID_ENV, PORT: "4000" });
    expect(config.PORT).toBe(4000);
  });

  // Phase 8 (D20 — updated): SUPABASE_URL + WEB_ORIGIN validation (SC-4 / AUTH-01)
  // SUPABASE_JWT_SECRET removed — asymmetric JWKS verify needs no shared secret.

  it("throws a Zod error naming SUPABASE_URL when it is missing", () => {
    const env = { ...BASE_VALID_ENV, SUPABASE_URL: undefined };
    expect(() => parseConfig(env)).toThrow(/SUPABASE_URL/);
  });

  it("throws a Zod error when SUPABASE_URL is not a valid URL", () => {
    const env = { ...BASE_VALID_ENV, SUPABASE_URL: "not-a-url" };
    expect(() => parseConfig(env)).toThrow(/SUPABASE_URL/);
  });

  it("throws a Zod error naming WEB_ORIGIN when it is missing", () => {
    const env = { ...BASE_VALID_ENV, WEB_ORIGIN: undefined };
    expect(() => parseConfig(env)).toThrow(/WEB_ORIGIN/);
  });

  it("throws a Zod error when WEB_ORIGIN is not a valid URL", () => {
    const env = { ...BASE_VALID_ENV, WEB_ORIGIN: "not-a-url" };
    expect(() => parseConfig(env)).toThrow(/WEB_ORIGIN/);
  });

  it("parses valid SUPABASE_URL and WEB_ORIGIN without throwing", () => {
    const config = parseConfig(BASE_VALID_ENV);
    expect(config.SUPABASE_URL).toBe("https://cwcdcosxoaqyqbsfifsh.supabase.co");
    expect(config.WEB_ORIGIN).toBe("http://localhost:5173");
  });
});
