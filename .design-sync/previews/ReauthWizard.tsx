import { QueryClient, QueryClientProvider, ReauthWizard } from "@morai/web";

function wrap(children: React.ReactNode) {
  const qc = new QueryClient({ defaultOptions: { queries: { staleTime: Infinity, retry: false, refetchOnMount: false } } });
  qc.setQueryData(["status"], {
    tokenFreshness: {
      trader: { status: "AUTH_EXPIRED", lastRefreshedAt: "2026-07-17T09:14:00.000Z" },
      market: { status: "AUTH_EXPIRED", lastRefreshedAt: "2026-07-17T09:14:00.000Z" },
    },
  });
  return <QueryClientProvider client={qc}><div style={{ maxWidth: 640 }}>{children}</div></QueryClientProvider>;
}

/** Both Schwab apps expired — the wizard walks trader then market. */
export function BothApps() {
  return wrap(<ReauthWizard expiredApps={["trader", "market"]} />);
}

/** Only the market-data app needs re-authorising. */
export function MarketOnly() {
  return wrap(<ReauthWizard expiredApps={["market"]} />);
}
