/**
 * status.ts — `auth status` subcommand (AUTH-03 success criterion 1).
 *
 * Reads per-app token freshness from the DB ONLY. MUST NOT construct or
 * call the Schwab OAuth client — no Schwab network call in this path.
 *
 * T-04-11: prints appId + freshness status only — never tokens or keys.
 */
import type { ForReadingTokenFreshness } from "@morai/core";

/**
 * runStatus — reads broker_tokens freshness and prints a per-app report.
 *
 * @param readTokenFreshness  Port function from the Postgres broker-tokens repo
 */
export async function runStatus(
  readTokenFreshness: ForReadingTokenFreshness,
): Promise<void> {
  const result = await readTokenFreshness();

  if (!result.ok) {
    console.error(
      `[status] error reading token freshness: ${result.error.message}`,
    );
    process.exit(1);
  }

  const freshness = result.value;

  if (freshness === "none yet") {
    console.warn("[status] no tokens stored yet — run `auth setup trader` and `auth setup market`");
    return;
  }

  const { trader, market } = freshness;
  console.warn(`[status] trader: ${trader.status}`);
  console.warn(`[status] market: ${market.status}`);
}
