import { QueryClient, QueryClientProvider, RegimeBoard } from "@morai/web";

const INDICATORS = [
  { id: "vix-term-structure", label: "VIX/VIX3M Term Structure", value: 0.92, band: "warning", bandWarn: 0.9, bandCrisis: 0.95, asOf: "2026-07-08", source: "eco3min.fr, systemtrader.co", rationale: "0.90 warn / 0.95 crisis, confirmed by independent sources." },
  { id: "vvix", label: "VVIX", value: 89.0, band: "calm", bandWarn: 100, bandCrisis: 115, asOf: "2026-07-08", source: "SpotGamma, TOS Indicators", rationale: "100 warn confirmed directly by 4 independent sources." },
  { id: "vix9d-vix", label: "VIX9D/VIX", value: 1.15, band: "crisis", bandWarn: 1.0, bandCrisis: 1.1, asOf: "2026-07-08", source: "topstep.com, macroption.com, cboe.com", rationale: "[ASSUMED] structural analogy to the VIX/VIX3M ratio." },
  { id: "hy-oas", label: "HY OAS (Credit Spread)", value: 3.4, band: "warning", bandWarn: 3.0, bandCrisis: 5.0, asOf: "2026-07-07", source: "eco3min.fr, macroradar.io, convextrade.com", rationale: "Synthesized from 3 practitioner sources." },
];

const MACRO = {
  DFF: [{ time: "2026-06-30", value: 4.33 }],
  SOFR: [{ time: "2026-06-30", value: 4.35 }],
  T10Y2Y: [{ time: "2026-06-30", value: 0.52 }],
  T10Y3M: [{ time: "2026-06-30", value: -0.18 }],
  DGS1MO: [{ time: "2026-06-30", value: 5.28 }],
  DGS3MO: [{ time: "2026-06-30", value: 5.1 }],
};

function seeded(regime: unknown, macro: unknown) {
  const qc = new QueryClient({ defaultOptions: { queries: { staleTime: Infinity, retry: false, refetchOnMount: false } } });
  qc.setQueryData(["regime-board"], regime);
  qc.setQueryData(["macro"], macro);
  qc.setQueryData(["picker"], null);
  return qc;
}

/** All four indicators across the calm / warning / crisis bands, plus the rates row. */
export function AllBands() {
  return (
    <QueryClientProvider client={seeded(INDICATORS, MACRO)}>
      <div style={{ maxWidth: 720 }}><RegimeBoard /></div>
    </QueryClientProvider>
  );
}

/** No macro series — the rates row is omitted rather than fabricated. */
export function WithoutRates() {
  return (
    <QueryClientProvider client={seeded(INDICATORS, {})}>
      <div style={{ maxWidth: 720 }}><RegimeBoard /></div>
    </QueryClientProvider>
  );
}

/** Empty board before the daily fetch lands. */
export function Empty() {
  return (
    <QueryClientProvider client={seeded([], {})}>
      <div style={{ maxWidth: 720 }}><RegimeBoard /></div>
    </QueryClientProvider>
  );
}
