import { Panel, QueryClient, QueryClientProvider, SectionLabel, Shell, Stat } from "@morai/web";

// Shell mounts screens whose hooks call useQuery — without a client it throws.
function client() {
  return new QueryClient({ defaultOptions: { queries: { staleTime: Infinity, retry: false, refetchOnMount: false } } });
}

/** The app chrome: sticky header, nav tabs, and the active screen below. */
export function Overview() {
  return (
    <QueryClientProvider client={client()}><Shell activeScreen="Overview" onNavigate={() => {}}>
      <div style={{ padding: 12, display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
        <Panel><SectionLabel>Book P&amp;L</SectionLabel><div className="font-mono text-2xl text-up">+$1 284.00</div></Panel>
        <Panel><SectionLabel>Open calendars</SectionLabel><div className="font-mono text-2xl">5</div></Panel>
      </div>
    </Shell></QueryClientProvider>
  );
}

/** A different tab active — the nav reflects `activeScreen`. */
export function JournalTab() {
  return (
    <QueryClientProvider client={client()}><Shell activeScreen="Journal" onNavigate={() => {}}>
      <div style={{ padding: 12 }}>
        <Panel>
          <SectionLabel>Latest snapshot</SectionLabel>
          <div style={{ display: "flex", gap: 24, marginTop: 8 }}>
            <Stat label="Taken" value="14:30Z" />
            <Stat label="Rows" value="312" />
            <Stat label="Gaps" value="0" valueClassName="text-up" />
          </div>
        </Panel>
      </div>
    </Shell></QueryClientProvider>
  );
}
