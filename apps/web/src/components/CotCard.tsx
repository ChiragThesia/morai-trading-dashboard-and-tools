import { useCot } from "../hooks/useCot.ts";
import { Panel, PanelHeading } from "./system/index.tsx";
import { cn } from "@/lib/utils";

/**
 * CotCard — CFTC Commitments-of-Traders positioning for E-mini S&P 500 (Phase 13 FE).
 *
 * Renders the newest weekly report as a net-per-class row list (long − short), each
 * with a sign-colored proportional bar and a week-over-week delta arrow. Leveraged
 * Funds is the headline "big guys" signal (D-05). Data via useCot() — no props.
 *
 * Design-system only (tokens + Tailwind); layout-only inline styles for bar width.
 * Empty/loading → the same "run the job to populate" pattern as Market's GEX card.
 */

// The five net-per-class fields — all `z.number().int()`, so indexing is always a number.
type NetKey =
  | "netDealer"
  | "netAssetManager"
  | "netLeveraged"
  | "netOther"
  | "netNonreportable";

// Net-per-class rows to render, top → bottom. Leveraged is the headline signal.
const CLASSES: ReadonlyArray<{ key: NetKey; label: string; headline?: boolean }> = [
  { key: "netDealer", label: "Dealer" },
  { key: "netAssetManager", label: "Asset Mgr" },
  { key: "netLeveraged", label: "Leveraged", headline: true },
  { key: "netOther", label: "Other rept" },
  { key: "netNonreportable", label: "Non-rept" },
];

/** Compact magnitude: 1.98M / 756K / 421. Unsigned. */
function fmtMag(abs: number): string {
  if (abs >= 1_000_000) return `${(abs / 1_000_000).toFixed(2)}M`;
  if (abs >= 1_000) return `${Math.round(abs / 1_000)}K`;
  return String(abs);
}

/** Signed compact: −756K / +993K (minus glyph, matching Market). */
function fmtSigned(v: number): string {
  return `${v < 0 ? "−" : "+"}${fmtMag(Math.abs(v))}`;
}

export function CotCard(): React.ReactElement {
  const { data } = useCot();
  const latest = data?.[0];
  const prev = data?.[1];

  if (latest === undefined) {
    return (
      <Panel className="flex flex-col gap-2" style={{ minHeight: 120 }}>
        <PanelHeading title="CFTC COT — dealer & spec positioning" />
        <div
          className="flex flex-1 items-center justify-center p-4 text-center font-mono text-[10px] text-dim"
          data-testid="cot-empty"
        >
          COT data unavailable — run fetch-cot to populate.
        </div>
      </Panel>
    );
  }

  // Bar scale: widest |net| across the five classes drives 100% width.
  const maxAbs =
    Math.max(...CLASSES.map((c) => Math.abs(latest[c.key]))) || 1;

  return (
    <Panel className="flex flex-col gap-2" data-testid="cot-card">
      <PanelHeading
        title="CFTC COT — dealer & spec positioning"
        badge={
          <span className="rounded-sm border border-line2 px-1 py-px font-mono text-[10px] text-dim">
            E-mini S&P · as of {latest.asOf}
          </span>
        }
      />

      <div className="flex flex-col gap-1.5">
        {CLASSES.map((c) => {
          const net = latest[c.key];
          const isLong = net >= 0;
          const pct = Math.min(100, (Math.abs(net) / maxAbs) * 100);
          const wow =
            prev !== undefined ? net - (prev[c.key]) : null;

          return (
            <div
              key={c.key}
              className="flex items-center gap-2 font-mono text-[10px] tabular-nums"
            >
              <span
                className={cn(
                  "w-[68px] shrink-0 font-display font-semibold tracking-[0.09em] uppercase",
                  c.headline === true ? "text-txt" : "text-dim",
                )}
              >
                {c.label}
              </span>

              <div className="relative h-2 flex-1 overflow-hidden rounded-sm bg-raise/40">
                <div
                  className={cn(
                    "absolute top-0 left-0 h-2 rounded-sm",
                    isLong ? "bg-up" : "bg-down",
                  )}
                  style={{ width: `${pct}%` }}
                />
              </div>

              <span
                className={cn(
                  "w-14 shrink-0 text-right",
                  isLong ? "text-up" : "text-down",
                )}
                data-testid={`cot-net-${c.key}`}
              >
                {fmtSigned(net)}
              </span>

              <span
                className="w-16 shrink-0 text-right text-dim"
                data-testid={`cot-wow-${c.key}`}
              >
                {wow === null ? "" : `${wow >= 0 ? "▲" : "▼"} ${fmtMag(Math.abs(wow))}`}
              </span>
            </div>
          );
        })}
      </div>

      <span className="font-mono text-[9px] text-dim">
        Net = long − short contracts · WoW vs prior week · Leveraged = the “big guys” (D-05).
      </span>
    </Panel>
  );
}
