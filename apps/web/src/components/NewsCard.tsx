import { useNews } from "../hooks/useNews.ts";
import { relAge } from "../screens/Market.tsx";
import { Panel, PanelHeading } from "./system/index.tsx";

/**
 * NewsCard — market headlines from the Alpaca News API (Benzinga wire, D28).
 *
 * Renders the newest 15 stored headlines as a compact row list: relative age +
 * headline (linking out in a new tab when the wire item carries a url) + symbol
 * tags. Data via useNews() — no props. Lives in MarketRail, so it appears on the
 * desktop rail AND inside the mobile Market <details> with no mobile-specific code.
 */

const MAX_ROWS = 15;

export function NewsCard(): React.ReactElement {
  const { data } = useNews();
  const items = data?.slice(0, MAX_ROWS);
  const newest = items?.[0];

  if (items === undefined || newest === undefined) {
    return (
      <Panel className="flex flex-col gap-2" style={{ minHeight: 120 }}>
        <PanelHeading title="Market news" />
        <div
          className="flex flex-1 items-center justify-center p-4 text-center font-mono text-[10px] text-dim"
          data-testid="news-empty"
        >
          News unavailable — set the Alpaca keys and run fetch-news to populate.
        </div>
      </Panel>
    );
  }

  return (
    <Panel className="flex flex-col gap-2" data-testid="news-card">
      <PanelHeading
        title="Market news"
        badge={
          <span className="rounded-sm border border-line2 px-1 py-px font-mono text-[10px] text-dim">
            {relAge(Date.now() - new Date(newest.publishedAt).getTime())}
          </span>
        }
      />

      <div className="flex flex-col gap-1.5">
        {items.map((item) => (
          <div
            key={item.id}
            className="flex flex-col gap-0.5 border-b border-line2/50 pb-1.5 last:border-b-0 last:pb-0"
            data-testid={`news-row-${item.id}`}
          >
            <div className="flex items-baseline gap-2">
              <span className="w-14 shrink-0 font-mono text-[10px] text-dim">
                {relAge(Date.now() - new Date(item.publishedAt).getTime())}
              </span>
              {item.url === null ? (
                <span className="min-w-0 text-[11px] leading-snug text-txt">
                  {item.headline}
                </span>
              ) : (
                <a
                  href={item.url}
                  target="_blank"
                  rel="noreferrer"
                  className="min-w-0 text-[11px] leading-snug text-txt hover:underline"
                >
                  {item.headline}
                </a>
              )}
            </div>
            {item.symbols.length > 0 && (
              <div className="flex flex-wrap gap-1 pl-16">
                {item.symbols.slice(0, 4).map((sym) => (
                  <span
                    key={sym}
                    className="rounded-sm border border-line2 px-1 py-px font-mono text-[10px] text-dim"
                  >
                    {sym}
                  </span>
                ))}
              </div>
            )}
          </div>
        ))}
      </div>

      <span className="font-mono text-[10px] text-dim">
        Alpaca News (Benzinga wire) · newest {items.length} of the stored batch.
      </span>
    </Panel>
  );
}
