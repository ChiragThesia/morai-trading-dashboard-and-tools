/**
 * broker-tokens.ts — Postgres implementation of the broker-tokens repo.
 *
 * Encrypts access_token and refresh_token at rest via pgcrypto pgp_sym_encrypt.
 * The encryption key is ALWAYS passed as a Drizzle sql`` bound parameter —
 * NEVER inlined via sql.raw() or string interpolation (D-03, RESEARCH Pitfall 7,
 * T-04-05).
 *
 * Hexagonal rules:
 *   - No process.env access — encryptionKey injected as constructor dep
 *   - No logging of encryptionKey or token values — only appId and timestamps
 *   - catch → err({kind:"storage-error"}) — never throw across the port
 */
import { ok, err } from "@morai/shared";
import type { Result } from "@morai/shared";
import type {
  AppId,
  SchwabTokenRow,
  TokenFreshnessMap,
  ForReadingTokens,
  ForWritingTokens,
  ForReadingTokenFreshness,
  StorageError,
} from "@morai/core";
import { toAppTokenStatus } from "@morai/core";
import { sql, eq } from "drizzle-orm";
import { brokerTokens } from "../schema.ts";
import type { Db } from "../db.ts";

// Type guard — Drizzle stores appId as text; guard narrows to the AppId union
function isAppId(value: string): value is AppId {
  return value === "trader" || value === "market";
}

// ─── Repo type ────────────────────────────────────────────────────────────────

export type PostgresBrokerTokensRepo = {
  readonly readTokens: ForReadingTokens;
  readonly writeTokens: ForWritingTokens;
  readonly readTokenFreshness: ForReadingTokenFreshness;
};

// ─── Factory ──────────────────────────────────────────────────────────────────

/**
 * makePostgresBrokerTokensRepo — builds the Postgres broker-tokens repo.
 *
 * @param db            Drizzle database instance
 * @param encryptionKey TOKEN_ENCRYPTION_KEY from config — never read from process.env here
 */
export function makePostgresBrokerTokensRepo(
  db: Db,
  encryptionKey: string,
): PostgresBrokerTokensRepo {
  // ─── readTokens ────────────────────────────────────────────────────────────
  const readTokens: ForReadingTokens = async (
    appId: AppId,
  ): Promise<Result<SchwabTokenRow | null, StorageError>> => {
    try {
      // pgp_sym_decrypt: key as bound parameter (D-03: never sql.raw or string interpolation)
      const rows = await db
        .select({
          appId: brokerTokens.appId,
          accessToken: sql<string>`pgp_sym_decrypt(${brokerTokens.accessToken}, ${encryptionKey})`,
          refreshToken: sql<string>`pgp_sym_decrypt(${brokerTokens.refreshToken}, ${encryptionKey})`,
          issuedAt: brokerTokens.issuedAt,
          refreshIssuedAt: brokerTokens.refreshIssuedAt,
          expiresAt: brokerTokens.expiresAt,
        })
        .from(brokerTokens)
        .where(eq(brokerTokens.appId, appId));

      const row = rows[0];
      if (row === undefined) return ok(null);

      // Narrow the Drizzle text column to the AppId union via type guard (no `as`)
      if (!isAppId(row.appId)) {
        return err<StorageError>({
          kind: "storage-error",
          message: `Unexpected appId in broker_tokens: ${row.appId}`,
        });
      }

      const tokenRow: SchwabTokenRow = {
        appId: row.appId,
        accessToken: row.accessToken,
        refreshToken: row.refreshToken,
        issuedAt: row.issuedAt,
        refreshIssuedAt: row.refreshIssuedAt,
        expiresAt: row.expiresAt,
      };

      return ok(tokenRow);
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      return err<StorageError>({ kind: "storage-error", message });
    }
  };

  // ─── writeTokens ───────────────────────────────────────────────────────────
  const writeTokens: ForWritingTokens = async (
    appId: AppId,
    tokens: SchwabTokenRow,
  ): Promise<Result<void, StorageError>> => {
    try {
      // pgp_sym_encrypt: key as bound parameter (D-03: never sql.raw or string interpolation)
      await db
        .insert(brokerTokens)
        .values({
          appId,
          // T-04-05: key bound as $N in wire protocol, never appears in query logs
          accessToken: sql`pgp_sym_encrypt(${tokens.accessToken}, ${encryptionKey})`,
          refreshToken: sql`pgp_sym_encrypt(${tokens.refreshToken}, ${encryptionKey})`,
          issuedAt: tokens.issuedAt,
          refreshIssuedAt: tokens.refreshIssuedAt,
          expiresAt: tokens.expiresAt,
          updatedAt: new Date(),
        })
        .onConflictDoUpdate({
          target: brokerTokens.appId,
          set: {
            accessToken: sql`pgp_sym_encrypt(${tokens.accessToken}, ${encryptionKey})`,
            refreshToken: sql`pgp_sym_encrypt(${tokens.refreshToken}, ${encryptionKey})`,
            issuedAt: tokens.issuedAt,
            refreshIssuedAt: tokens.refreshIssuedAt,
            expiresAt: tokens.expiresAt,
            updatedAt: new Date(),
          },
        });

      return ok(undefined);
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      return err<StorageError>({ kind: "storage-error", message });
    }
  };

  // ─── readTokenFreshness ────────────────────────────────────────────────────
  // Reads both apps' timestamp columns only (no decryption needed for freshness).
  // Composes toAppTokenStatus from the token-freshness domain.
  // T-04-04: only appId and timestamps are logged — never token values.
  const readTokenFreshness: ForReadingTokenFreshness = async (): Promise<
    Result<TokenFreshnessMap | "none yet", StorageError>
  > => {
    try {
      // Read only non-encrypted timestamp columns — no decryption key needed here
      const rows = await db
        .select({
          appId: brokerTokens.appId,
          issuedAt: brokerTokens.issuedAt,
          refreshIssuedAt: brokerTokens.refreshIssuedAt,
          expiresAt: brokerTokens.expiresAt,
        })
        .from(brokerTokens);

      if (rows.length === 0) {
        return ok("none yet");
      }

      // Build lookup: appId → row (both apps may or may not be present)
      const byAppId = new Map(rows.map((r) => [r.appId, r]));

      const traderRow = byAppId.get("trader");
      const marketRow = byAppId.get("market");

      // Both absent means "none yet" (rows.length > 0 only reaches here with at
      // least one app, so at least one of the two will be non-undefined)
      if (traderRow === undefined && marketRow === undefined) {
        return ok("none yet");
      }

      const now = new Date();

      const traderFreshness = toAppTokenStatus(
        traderRow !== undefined
          ? {
              appId: "trader",
              accessToken: "", // not needed for freshness
              refreshToken: "", // not needed for freshness
              issuedAt: traderRow.issuedAt,
              refreshIssuedAt: traderRow.refreshIssuedAt,
              expiresAt: traderRow.expiresAt,
            }
          : null,
        now,
      );

      const marketFreshness = toAppTokenStatus(
        marketRow !== undefined
          ? {
              appId: "market",
              accessToken: "",
              refreshToken: "",
              issuedAt: marketRow.issuedAt,
              refreshIssuedAt: marketRow.refreshIssuedAt,
              expiresAt: marketRow.expiresAt,
            }
          : null,
        now,
      );

      const freshnessMap: TokenFreshnessMap = {
        trader: traderFreshness,
        market: marketFreshness,
      };

      return ok(freshnessMap);
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      return err<StorageError>({ kind: "storage-error", message });
    }
  };

  return { readTokens, writeTokens, readTokenFreshness };
}
