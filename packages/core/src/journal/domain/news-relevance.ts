/**
 * news-relevance.ts — which headlines earn a row on the Overview card (D28).
 *
 * The book is SPX calendar spreads, delta-neutral: P&L rides IV term structure,
 * not single-name direction. So the bar is "does this move INDEX volatility?".
 *
 * Applied on the READ path only — `news_items` keeps the raw Alpaca firehose
 * (same raw-store/derived-read split as broker_transactions), so tightening or
 * loosening this rule never needs a re-ingest.
 *
 * Measured on the first live batch: analyst-rating notes were 66% of all rows.
 * They are dropped first and unconditionally — a price-target change moves one
 * name's direction, never the index vol surface.
 */

/**
 * Wire formats that are never a vol signal, dropped before any keep-rule runs.
 *
 * Analyst notes move one name's direction, never the index surface. The listicle
 * and clickbait formats matter just as much: an unusual-options-activity roundup
 * tags a dozen tickers, so it hits a mega-cap on every single post and would
 * otherwise flood the card (caught on the first live batch, not in fixtures).
 */
const WIRE_NOISE =
  /\b(maintains|initiates|upgrades|downgrades|reiterates|assumes coverage|price target|raises pt|lowers pt|whale (?:activity|alerts)|unusual options activity|quick spark|halftime report|final trades)\b/i;

/** Macro prints, central-bank policy, and the shocks that reprice the vol surface. */
const MACRO_SIGNAL =
  /\b(fed|fomc|powell|federal reserve|rate cut|rate hike|interest rates?|inflation|cpi|ppi|pce|jobs report|payrolls?|nonfarm|unemployment|jobless claims|gdp|recession|treasury yields?|yield curve|bond yields?|tariffs?|trade war|debt ceiling|government shutdown|geopolitical)\b/i;

/**
 * Index-level moves — the market as a whole, not a constituent.
 *
 * "Wall Street" needs a market-move verb after it: bare mentions are an
 * earnings-beat idiom ("Fries Wall Street Estimates"), not an index move.
 */
const INDEX_SIGNAL =
  /\b(s&p ?500|s&p|nasdaq|dow jones|dow (?:sheds|drops|gains|rises|falls)|russell 2000|vix|volatility index|wall street (?:opens|closes|rallies|slides|sinks|tumbles|falls|rises|braces|fears)|stocks? (?:rally|slide|selloff|sink|surge|tumble|plunge)|market(?:wide)? (?:selloff|rally|rout))\b/i;

/** Tagged tickers that ARE the index exposure. */
const INDEX_TAGS: ReadonlySet<string> = new Set([
  "SPY",
  "QQQ",
  "DIA",
  "IWM",
  "VIX",
  "VXX",
  "UVXY",
  "SPX",
  "ES",
]);

/**
 * Mega-caps heavy enough that their own event is an index-vol event.
 * Deliberately short — the further down the weight ladder, the less a single
 * name's news touches SPX term structure.
 */
const MEGA_CAPS: ReadonlySet<string> = new Set([
  "NVDA",
  "AAPL",
  "MSFT",
  "AMZN",
  "GOOGL",
  "GOOG",
  "META",
  "TSLA",
]);

/** One headline as seen by the filter — the subset of NewsItemRow it reads. */
type RelevanceInput = {
  readonly headline: string;
  readonly symbols: ReadonlyArray<string>;
};

/**
 * isMarketRelevant — true when a headline can plausibly move SPX implied vol.
 *
 * Order matters: rating noise is rejected first, so an upgrade note tagged SPY
 * never sneaks through on its ticker.
 */
export function isMarketRelevant(item: RelevanceInput): boolean {
  if (WIRE_NOISE.test(item.headline)) {
    return false;
  }

  if (MACRO_SIGNAL.test(item.headline) || INDEX_SIGNAL.test(item.headline)) {
    return true;
  }

  return item.symbols.some(
    (sym) => INDEX_TAGS.has(sym.toUpperCase()) || MEGA_CAPS.has(sym.toUpperCase()),
  );
}
