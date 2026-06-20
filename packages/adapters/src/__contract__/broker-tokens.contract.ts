import { describe, it, expect, beforeEach } from "vitest";
import type {
  ForReadingTokens,
  ForWritingTokens,
  ForReadingTokenFreshness,
  SchwabTokenRow,
} from "@morai/core";

/**
 * BrokerTokensRepo — the minimal surface contract tests need to exercise.
 * Includes a rawRead helper for the ciphertext-not-plaintext assertion
 * (reads the raw bytea column without decryption).
 */
export type BrokerTokensRepo = {
  readonly readTokens: ForReadingTokens;
  readonly writeTokens: ForWritingTokens;
  readonly readTokenFreshness: ForReadingTokenFreshness;
  /** Read the raw (potentially encrypted) access_token bytes as a string. */
  readonly rawReadAccessToken: (appId: "trader" | "market") => Promise<Buffer | null>;
};

/**
 * runBrokerTokensContractTests — shared contract-test suite for the broker-tokens repo.
 *
 * Run this suite against the Postgres adapter (testcontainers + pgcrypto).
 * Each test must call makeRepo() to get a fresh repo instance with the same DB.
 *
 * Asserts (AUTH-02):
 * - writeTokens then readTokens round-trips the plaintext accessToken/refreshToken
 * - The raw stored bytea column is NOT equal to the plaintext token (T-04-04/T-04-05)
 * - readTokens for unknown appId → ok(null)
 * - writeTokens is an upsert: writing the same appId twice keeps one row
 * - readTokenFreshness: fresh row → {status:'fresh'}, 8-day-old row → {status:'AUTH_EXPIRED'}
 */
export function runBrokerTokensContractTests(
  makeRepo: () => BrokerTokensRepo,
): void {
  const now = new Date();
  const thirtyMinLater = new Date(now.getTime() + 30 * 60 * 1000);

  function makeRow(overrides: Partial<SchwabTokenRow> = {}): SchwabTokenRow {
    return {
      appId: "trader",
      accessToken: "plaintext-access-token-value",
      refreshToken: "plaintext-refresh-token-value",
      issuedAt: now,
      refreshIssuedAt: now,
      expiresAt: thirtyMinLater,
      ...overrides,
    };
  }

  describe("broker_tokens repo contract", () => {
    let repo: BrokerTokensRepo;

    beforeEach(() => {
      repo = makeRepo();
    });

    it("readTokens for unknown appId returns ok(null)", async () => {
      const result = await repo.readTokens("trader");
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.value).toBeNull();
    });

    it("writeTokens then readTokens round-trips plaintext tokens", async () => {
      const row = makeRow({ appId: "trader" });
      const writeResult = await repo.writeTokens("trader", row);
      expect(writeResult.ok).toBe(true);

      const readResult = await repo.readTokens("trader");
      expect(readResult.ok).toBe(true);
      if (!readResult.ok) return;
      expect(readResult.value).not.toBeNull();
      if (readResult.value === null) return;
      expect(readResult.value.accessToken).toBe(row.accessToken);
      expect(readResult.value.refreshToken).toBe(row.refreshToken);
    });

    it("raw stored bytea column is NOT equal to the plaintext token (encryption at rest)", async () => {
      const row = makeRow({
        appId: "trader",
        accessToken: "super-secret-access-token",
      });
      await repo.writeTokens("trader", row);

      const rawBytes = await repo.rawReadAccessToken("trader");
      expect(rawBytes).not.toBeNull();
      if (rawBytes === null) return;

      // The stored bytes must NOT match the plaintext
      const plaintextBuf = Buffer.from("super-secret-access-token", "utf-8");
      expect(rawBytes.equals(plaintextBuf)).toBe(false);

      // pgp_sym_encrypt output starts with a magic PGP header — minimum length check
      expect(rawBytes.length).toBeGreaterThan(plaintextBuf.length);
    });

    it("writeTokens is an upsert — writing the same appId twice keeps one row", async () => {
      const row1 = makeRow({ appId: "market", accessToken: "token-version-1", refreshToken: "refresh-v1" });
      const row2 = makeRow({ appId: "market", accessToken: "token-version-2", refreshToken: "refresh-v2" });

      await repo.writeTokens("market", row1);
      await repo.writeTokens("market", row2);

      const result = await repo.readTokens("market");
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.value).not.toBeNull();
      if (result.value === null) return;
      // Should have the SECOND write's tokens (upsert replaced first)
      expect(result.value.accessToken).toBe("token-version-2");
      expect(result.value.refreshToken).toBe("refresh-v2");
    });

    it("readTokenFreshness: fresh trader row + 8-day-old market row → correct statuses", async () => {
      // Trader: issued now → fresh
      const traderRow = makeRow({ appId: "trader" });
      await repo.writeTokens("trader", traderRow);

      // Market: refreshIssuedAt 8 days ago → AUTH_EXPIRED
      const eightDaysAgo = new Date(now.getTime() - 8 * 24 * 60 * 60 * 1000);
      const marketRow = makeRow({
        appId: "market",
        refreshIssuedAt: eightDaysAgo,
        accessToken: "market-access",
        refreshToken: "market-refresh",
      });
      await repo.writeTokens("market", marketRow);

      const freshnessResult = await repo.readTokenFreshness();
      expect(freshnessResult.ok).toBe(true);
      if (!freshnessResult.ok) return;
      const freshness = freshnessResult.value;
      expect(freshness).not.toBe("none yet");
      if (freshness === "none yet") return;

      // Trader must be fresh (issued now, 30 min until expiry)
      expect(freshness.trader.status).toBe("fresh");
      // Market must be AUTH_EXPIRED (refreshIssuedAt 8 days ago)
      expect(freshness.market.status).toBe("AUTH_EXPIRED");
    });

    it("readTokenFreshness returns 'none yet' when no rows exist", async () => {
      const result = await repo.readTokenFreshness();
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.value).toBe("none yet");
    });
  });
}
