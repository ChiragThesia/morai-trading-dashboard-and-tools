/**
 * news-relevance.test.ts — isMarketRelevant (D28 filter).
 *
 * The book is SPX calendar spreads, delta-neutral: P&L rides IV term structure.
 * Only news that moves INDEX volatility earns a row on the Overview card —
 * macro prints, index-level moves, and the mega-caps heavy enough to drag the
 * index. Analyst rating changes never do, so they are dropped outright.
 */

import { describe, it, expect } from "vitest";
import { isMarketRelevant } from "./news-relevance.ts";
import type { NewsItemRow } from "../application/ports.ts";

function row(overrides: Partial<NewsItemRow> = {}): NewsItemRow {
  return {
    id: "1",
    headline: "Some Headline",
    summary: "",
    source: "benzinga",
    url: null,
    symbols: [],
    publishedAt: new Date("2026-07-24T13:00:00Z"),
    updatedAt: new Date("2026-07-24T13:00:00Z"),
    ...overrides,
  };
}

describe("isMarketRelevant — DROP analyst-rating noise", () => {
  const ratingHeadlines = [
    "Truist Securities Maintains Hold on Quest Diagnostics, Raises Price Target to $250",
    "TD Cowen Maintains Hold on QuantumScape, Lowers Price Target to $6",
    "Goldman Sachs Initiates Coverage On Acme Corp With Buy Rating",
    "Morgan Stanley Upgrades Widget Inc To Overweight",
    "B of A Securities Downgrades Foo Corp To Underperform",
    "Barclays Reiterates Equal-Weight on Bar Industries",
    "Wells Fargo Assumes Coverage Of Baz Holdings",
  ];

  for (const headline of ratingHeadlines) {
    it(`drops: ${headline.slice(0, 46)}…`, () => {
      expect(isMarketRelevant(row({ headline }))).toBe(false);
    });
  }

  it("drops a rating note even when tagged with an index ETF (ratings never move index vol)", () => {
    expect(
      isMarketRelevant(
        row({
          headline: "Analyst Maintains Buy on Apple, Raises Price Target",
          symbols: ["AAPL", "SPY"],
        }),
      ),
    ).toBe(false);
  });
});

describe("isMarketRelevant — KEEP macro prints and policy", () => {
  const macroHeadlines = [
    "Fed Holds Rates Steady, Powell Signals Higher-For-Longer",
    "FOMC Minutes Show Divided Committee On September Cut",
    "CPI Comes In Hotter Than Expected At 3.4%",
    "PPI Cools More Than Forecast",
    "Core PCE Ticks Up To 2.8%",
    "Nonfarm Payrolls Blow Past Estimates",
    "Jobless Claims Rise To Six-Month High",
    "Unemployment Rate Falls To 3.9%",
    "GDP Growth Revised Higher In Second Estimate",
    "Treasury Yields Spike After Weak Auction",
    "Trump Announces New Tariff On Chinese Imports",
    "Recession Odds Climb As Yield Curve Re-Inverts",
    "Government Shutdown Deadline Looms",
  ];

  for (const headline of macroHeadlines) {
    it(`keeps: ${headline.slice(0, 46)}…`, () => {
      expect(isMarketRelevant(row({ headline }))).toBe(true);
    });
  }
});

describe("isMarketRelevant — KEEP index-level moves", () => {
  const indexHeadlines = [
    "S&P 500 Slips As Investors Digest Earnings",
    "Nasdaq Rallies To Record High",
    "Dow Jones Sheds 400 Points",
    "VIX Spikes Above 25 On Geopolitical Fears",
    "Wall Street Opens Sharply Lower",
    "Stocks Selloff Deepens Into The Close",
  ];

  for (const headline of indexHeadlines) {
    it(`keeps: ${headline.slice(0, 46)}…`, () => {
      expect(isMarketRelevant(row({ headline }))).toBe(true);
    });
  }

  it("keeps an item tagged with an index ETF even when the headline is plain", () => {
    expect(isMarketRelevant(row({ headline: "Market Wrap", symbols: ["SPY"] }))).toBe(true);
  });
});

describe("isMarketRelevant — KEEP index-moving mega-caps", () => {
  it("keeps NVDA earnings (a genuine index-vol event)", () => {
    expect(
      isMarketRelevant(
        row({ headline: "Nvidia Beats On Q3 Revenue, Guides Higher", symbols: ["NVDA"] }),
      ),
    ).toBe(true);
  });

  it("keeps a mega-cap item tagged AAPL", () => {
    expect(isMarketRelevant(row({ headline: "Apple Unveils New Lineup", symbols: ["AAPL"] }))).toBe(
      true,
    );
  });
});

describe("isMarketRelevant — DROP single-name noise", () => {
  const noise = [
    row({ headline: "FS.com Rides High-speed AI Networks To Higher Profits" }),
    row({ headline: "Popular Inc Announces Quarterly Dividend", symbols: ["BPOP"] }),
    row({ headline: "IMAX Signs Deal For Twelve New Screens", symbols: ["IMAX"] }),
    row({ headline: "RingCentral Names New CFO", symbols: ["RNG"] }),
  ];

  for (const item of noise) {
    it(`drops: ${item.headline.slice(0, 46)}…`, () => {
      expect(isMarketRelevant(item)).toBe(false);
    });
  }
});

describe("isMarketRelevant — false positives caught on the live firehose", () => {
  // Every case below survived the first filter draft against real prod rows.
  // Synthetic fixtures never produced them — the live batch did.

  it("drops an earnings-beat idiom that merely says 'Wall Street'", () => {
    expect(
      isMarketRelevant(
        row({
          headline: "French Fry Giant Lamb Weston Fries Wall Street Estimates, Serves up Strong 2027",
          symbols: ["LW"],
        }),
      ),
    ).toBe(false);
  });

  it("still keeps a genuine Wall Street market-move headline", () => {
    expect(isMarketRelevant(row({ headline: "Wall Street Opens Sharply Lower" }))).toBe(true);
  });

  it("drops unusual-options-activity listicles (they tag a dozen names, always hitting a mega-cap)", () => {
    expect(
      isMarketRelevant(
        row({
          headline: "10 Information Technology Stocks Whale Activity In Today's Session",
          symbols: ["AMD", "CRM", "LRCX", "NVDA"],
        }),
      ),
    ).toBe(false);
  });

  it("drops 'Whale Alerts' listicles too", () => {
    expect(
      isMarketRelevant(
        row({
          headline: "10 Consumer Discretionary Stocks With Whale Alerts In Today's Session",
          symbols: ["AMZN", "BURL", "CCL"],
        }),
      ),
    ).toBe(false);
  });

  it("drops Benzinga 'QUICK SPARK' clickbait even on a mega-cap tag", () => {
    expect(
      isMarketRelevant(
        row({
          headline: "QUICK SPARK: Tesla Stock Heads For Worst Week Since March 2020",
          symbols: ["TSLA"],
        }),
      ),
    ).toBe(false);
  });

  it("drops the recurring CNBC Halftime Report segment (same class as whale alerts)", () => {
    expect(
      isMarketRelevant(
        row({
          headline:
            "CNBC Halftime Report Final Trades: Amazon, Alphabet Class A, IBM, Goldman Sachs Nasdaq-100 Premium Income ETF",
          symbols: ["AMZN", "GOOGL", "GPIQ"],
        }),
      ),
    ).toBe(false);
  });

  it("keeps a real geopolitical shock tagged SPY", () => {
    expect(
      isMarketRelevant(
        row({
          headline:
            "Trump Meets With Top Advisers as He Weighs a Major Escalation in Iran - New York Times",
          symbols: ["SPY"],
        }),
      ),
    ).toBe(true);
  });

  it("keeps a tariff-escalation headline (direct vol catalyst)", () => {
    expect(
      isMarketRelevant(
        row({
          headline:
            "Trump Says EU Will Pay A Very Big Price; Substantial Tariff To Be Placed At Earliest Possible Moment",
          symbols: ["SPY", "VGK"],
        }),
      ),
    ).toBe(true);
  });
});

describe("isMarketRelevant — word-boundary discipline", () => {
  it("does not match 'fed' inside an unrelated word (federated/feeding)", () => {
    expect(isMarketRelevant(row({ headline: "Federated Farmers Group Reports Feeding Costs" }))).toBe(
      false,
    );
  });

  it("matches regardless of case", () => {
    expect(isMarketRelevant(row({ headline: "fomc holds rates" }))).toBe(true);
  });
});
