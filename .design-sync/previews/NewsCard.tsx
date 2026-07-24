import { NewsCard, QueryClient, QueryClientProvider } from "@morai/web";

const ITEMS = [
  { id: "24843171", headline: "S&P 500 Slips As Fed Officials Signal Higher-For-Longer Rates", summary: "Markets retreated after hawkish commentary from two regional Fed presidents.", source: "benzinga", url: "https://www.benzinga.com/markets/24843171", symbols: ["SPY", "QQQ"], publishedAt: "2026-07-24T13:05:00.000Z" },
  { id: "24843200", headline: "Crude Rallies On Surprise Inventory Draw", summary: "", source: "benzinga", url: null, symbols: [], publishedAt: "2026-07-24T13:10:00.000Z" },
  { id: "24843244", headline: "Nvidia Extends Gains Ahead Of Earnings; Options Skew Steepens", summary: "Front-month calls bid into the print.", source: "benzinga", url: "https://www.benzinga.com/markets/24843244", symbols: ["NVDA"], publishedAt: "2026-07-24T12:44:00.000Z" },
  { id: "24843301", headline: "Treasury Yields Ease As Jobless Claims Come In Soft", summary: "The 10s2s spread narrowed four basis points.", source: "benzinga", url: "https://www.benzinga.com/markets/24843301", symbols: ["TLT", "IEF"], publishedAt: "2026-07-24T12:02:00.000Z" },
  { id: "24843355", headline: "Gold Holds $2,410 As Dollar Index Retreats", summary: "", source: "benzinga", url: "https://www.benzinga.com/markets/24843355", symbols: ["GLD"], publishedAt: "2026-07-24T11:30:00.000Z" },
];

function seeded(data: unknown) {
  const qc = new QueryClient({ defaultOptions: { queries: { staleTime: Infinity, retry: false, refetchOnMount: false } } });
  qc.setQueryData(["news"], data);
  return qc;
}

/** The live feed: newest-first headlines, symbol tags, outbound links. */
export function Feed() {
  return (
    <QueryClientProvider client={seeded(ITEMS)}>
      <div style={{ maxWidth: 460 }}><NewsCard /></div>
    </QueryClientProvider>
  );
}

/** Empty state — the operator hint, never a fabricated row. */
export function Empty() {
  return (
    <QueryClientProvider client={seeded([])}>
      <div style={{ maxWidth: 460 }}><NewsCard /></div>
    </QueryClientProvider>
  );
}
