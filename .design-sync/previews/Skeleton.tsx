import { Skeleton } from "@morai/web";

/** The loading placeholder shape used while a panel's query is in flight. */
export function PanelLoading() {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 8, maxWidth: 360 }}>
      <Skeleton className="h-3 w-28" />
      <Skeleton className="h-8 w-full" />
      <Skeleton className="h-8 w-full" />
      <Skeleton className="h-8 w-2/3" />
    </div>
  );
}

/** A single inline value still loading next to its label. */
export function InlineValue() {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
      <span className="font-display text-[10px] font-semibold tracking-[0.09em] text-muted-foreground uppercase">Net gamma</span>
      <Skeleton className="h-5 w-24" />
    </div>
  );
}
