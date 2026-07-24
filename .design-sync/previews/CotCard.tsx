import { CotCard, QueryClient, QueryClientProvider } from "@morai/web";

const WEEK_LATEST = {
  asOf: "2026-06-23", publishedAt: "2026-07-01T16:48:14.548Z", contractCode: "13874A", openInterest: 1980254,
  dealerLong: 112578, dealerShort: 868478, netDealer: -755900,
  assetMgrLong: 1171421, assetMgrShort: 178692, netAssetManager: 992729,
  levMoneyLong: 185058, levMoneyShort: 558526, netLeveraged: -373468,
  otherReptLong: 62151, otherReptShort: 48090, netOther: 14061,
  nonreptLong: 260145, nonreptShort: 137567, netNonreportable: 122578,
};
const WEEK_PREV = { ...WEEK_LATEST, asOf: "2026-06-16", netDealer: -625169, netAssetManager: 984009, netLeveraged: -515520 };

function seeded(data: unknown) {
  const qc = new QueryClient({ defaultOptions: { queries: { staleTime: Infinity, retry: false, refetchOnMount: false } } });
  qc.setQueryData(["cot"], data);
  return qc;
}

/** Latest CFTC week: net positioning per trader class with week-over-week deltas. */
export function LatestWeek() {
  return (
    <QueryClientProvider client={seeded([WEEK_LATEST, WEEK_PREV])}>
      <div style={{ maxWidth: 460 }}><CotCard /></div>
    </QueryClientProvider>
  );
}

/** One week only — no previous report, so no delta arrows. */
export function NoDeltas() {
  return (
    <QueryClientProvider client={seeded([WEEK_LATEST])}>
      <div style={{ maxWidth: 460 }}><CotCard /></div>
    </QueryClientProvider>
  );
}

/** Empty state before the Friday 17:00 ET fetch has ever landed. */
export function Empty() {
  return (
    <QueryClientProvider client={seeded([])}>
      <div style={{ maxWidth: 460 }}><CotCard /></div>
    </QueryClientProvider>
  );
}
