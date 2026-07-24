import { AuthExpiredBanner, QueryClient, QueryClientProvider } from "@morai/web";

const fresh = { status: "FRESH", lastRefreshedAt: "2026-07-24T13:02:00.000Z" };
const expired = { status: "AUTH_EXPIRED", lastRefreshedAt: "2026-07-17T09:14:00.000Z" };

/**
 * The banner is `position: fixed; bottom: 0` — it escapes any normal card. A transformed
 * ancestor makes `fixed` resolve against this box instead of the viewport, so the real
 * component renders in place with no markup changes.
 */
function Dock({ children }: { children: React.ReactNode }) {
  return (
    <div style={{ position: "relative", transform: "translateZ(0)", height: 150, width: 640, border: "1px dashed #27313f", borderRadius: 6 }}>
      {children}
    </div>
  );
}

function seeded(trader: unknown, market: unknown) {
  const qc = new QueryClient({ defaultOptions: { queries: { staleTime: Infinity, retry: false, refetchOnMount: false } } });
  qc.setQueryData(["status"], { tokenFreshness: { trader, market } });
  return qc;
}

/** One app expired — the banner names it and opens the re-auth wizard. */
export function OneExpired() {
  return (
    <QueryClientProvider client={seeded(expired, fresh)}>
      <Dock><AuthExpiredBanner /></Dock>
    </QueryClientProvider>
  );
}

/** Both Schwab apps expired — the weekly re-auth is fully due. */
export function BothExpired() {
  return (
    <QueryClientProvider client={seeded(expired, expired)}>
      <Dock><AuthExpiredBanner /></Dock>
    </QueryClientProvider>
  );
}
