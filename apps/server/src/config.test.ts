import { describe, it, expect } from "vitest";
import { parseConfig } from "./config.ts";

const BASE_VALID_ENV = {
  DATABASE_URL: "postgres://user:pass@localhost:5432/db",
  MCP_BEARER_TOKEN: "a-valid-token-1234",
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
});
