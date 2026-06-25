/**
 * Journal screen — trade lifecycle + per-calendar rebuild (JOURNAL-01 + REBUILD-01)
 *
 * UI-SPEC "Journal screen" 3-column layout:
 *   Left  (250px) — trade list: sorted newest-open-first, then closed reverse-chron.
 *                   history/entry-exit/OPEN badges; selected row = violet border.
 *   Center (1fr)  — lifecycle: trade header + 3 KPIs + LifecycleChart (for history trades)
 *                   OR dashed pre-history stub + "no day-by-day (pre Jun-12)" (for entry/exit-only).
 *                   RebuildButton is present and wired to the selected calendar.
 *   Right (290px) — snapshot table (Time/SPX/Net/P&L/Θ/Vega) + "Why it moved" callout + Notes.
 *
 * Data: useJournal(calendarId) per selected trade (60s poll, parse via journalResponse).
 * Empty state: locked "No journal history yet…" copy (JOURNAL-01).
 * Pre-Jun-12 trades: graceful stub — NEVER error, NEVER blank (JOURNAL-01 invariant).
 * Rebuild: RebuildButton triggers POST /api/jobs/rebuild-journal/trigger (REBUILD-01).
 *
 * No seed data. Loading = locked copy / skeleton. No `any`/`as`/`!`.
 */

import { useState } from "react";
import { classifyTradeHistory } from "../lib/journal-history.ts";
import { useJournal } from "../hooks/useJournal.ts";
import { LifecycleChart } from "../components/LifecycleChart.tsx";
import { RebuildButton } from "../components/RebuildButton.tsx";
import type { SnapshotResponse } from "@morai/contracts";

// ─── Types ────────────────────────────────────────────────────────────────────

/** Minimal trade descriptor that the Journal screen needs from its parent. */
export interface TradeSummary {
  readonly id: string;
  readonly calendarId: string;
  readonly name: string;
  readonly openedAt: string;
  readonly closedAt: string | null;
  readonly realizedPnl: string;
  readonly hasSnapshots: boolean;
}

interface JournalProps {
  /** All trades to show in the left-column list */
  trades: ReadonlyArray<TradeSummary>;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

/** Format ISO datetime as "MMM DD YYYY" */
function fmtDate(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleDateString("en-US", {
    month: "short",
    day: "2-digit",
    year: "numeric",
    timeZone: "UTC",
  });
}

/** Format realized P&L with sign */
function fmtPnl(val: string | null): string {
  if (val === null) return "open";
  const n = parseFloat(val);
  if (!Number.isFinite(n)) return "—";
  const sign = n >= 0 ? "+" : "−";
  return `${sign}$${Math.abs(n).toFixed(2)}`;
}

/** Format a snapshot time as "MMM DD HH:MM" */
function fmtSnapTime(iso: string): string {
  const d = new Date(iso);
  const month = d.toLocaleString("en-US", { month: "short", timeZone: "UTC" });
  const day = d.getUTCDate();
  const hh = String(d.getUTCHours()).padStart(2, "0");
  const mm = String(d.getUTCMinutes()).padStart(2, "0");
  return `${month} ${day} ${hh}:${mm}`;
}

// ─── Sub-components ───────────────────────────────────────────────────────────

/** Snapshot table rows (right column) */
function SnapshotTable({
  snapshots,
  selectedIndex,
}: {
  snapshots: ReadonlyArray<SnapshotResponse>;
  selectedIndex: number;
}): React.ReactElement {
  return (
    <table
      style={{
        width: "100%",
        borderCollapse: "collapse",
        fontSize: 10.5,
        fontFamily: "'JetBrains Mono', ui-monospace, monospace",
        fontVariantNumeric: "tabular-nums",
      }}
    >
      <thead>
        <tr>
          {["Time", "SPX", "Net", "P&L", "Θ", "Vega"].map((col) => (
            <th
              key={col}
              style={{
                textAlign: col === "Time" ? "left" : "right",
                padding: "4px 5px",
                borderBottom: "1px solid #0c111a",
                color: "#566273",
                fontSize: 9,
                textTransform: "uppercase",
                fontWeight: 500,
              }}
            >
              {col}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {snapshots.map((s, i) => {
          const pnl = parseFloat(s.pnlOpen);
          const pnlColor = pnl >= 0 ? "#26a69a" : "#ef5350";
          const isSelected = i === selectedIndex;

          return (
            <tr
              key={s.time}
              style={{
                background: isSelected ? "rgba(22,32,48,0.27)" : undefined,
              }}
            >
              <td
                style={{
                  textAlign: "left",
                  padding: "4px 5px",
                  borderBottom: "1px solid #0c111a",
                  color: "#d6dbe4",
                }}
              >
                {fmtSnapTime(s.time)}
              </td>
              <td style={{ textAlign: "right", padding: "4px 5px", borderBottom: "1px solid #0c111a", color: "#5b9cf6" }}>
                {parseFloat(s.spot).toLocaleString()}
              </td>
              <td style={{ textAlign: "right", padding: "4px 5px", borderBottom: "1px solid #0c111a", color: "#d6dbe4" }}>
                {parseFloat(s.netMark).toFixed(2)}
              </td>
              <td style={{ textAlign: "right", padding: "4px 5px", borderBottom: "1px solid #0c111a", color: pnlColor }}>
                {pnl >= 0 ? "+" : ""}${Math.abs(pnl).toFixed(2)}
              </td>
              <td style={{ textAlign: "right", padding: "4px 5px", borderBottom: "1px solid #0c111a", color: "#f0b429" }}>
                {parseFloat(s.netTheta).toFixed(1)}
              </td>
              <td style={{ textAlign: "right", padding: "4px 5px", borderBottom: "1px solid #0c111a", color: "#26a69a" }}>
                {parseFloat(s.netVega).toFixed(0)}
              </td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}

/** Pre-Jun-12 graceful stub — dashed border placeholder (JOURNAL-01) */
function PreHistoryStub(): React.ReactElement {
  return (
    <div
      style={{
        border: "1px dashed #27313f",
        borderRadius: 8,
        padding: 16,
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        minHeight: 200,
        color: "#566273",
        fontFamily: "'JetBrains Mono', ui-monospace, monospace",
        fontSize: 11,
        textAlign: "center",
        gap: 8,
      }}
      aria-label="no day-by-day (pre Jun-12)"
    >
      <span>no day-by-day (pre Jun-12)</span>
      <span style={{ fontSize: 10, color: "#3a4453" }}>
        Chain history starts 2026-06-12. Only entry and exit events are available for this trade.
      </span>
    </div>
  );
}

/** Center column lifecycle section for a selected trade */
function LifecycleSection({
  trade,
  snapshots,
  isPending,
}: {
  trade: TradeSummary;
  snapshots: ReadonlyArray<SnapshotResponse>;
  isPending: boolean;
}): React.ReactElement {
  const kind = classifyTradeHistory({
    openedAt: trade.openedAt,
    closedAt: trade.closedAt,
    hasSnapshots: snapshots.length > 0,
  });

  const pnlNum = parseFloat(trade.realizedPnl);
  const pnlColor = pnlNum >= 0 ? "#26a69a" : "#ef5350";
  const isOpen = trade.closedAt === null;

  // KPI calculations from snapshots
  const pnlValues = snapshots.map((s) => parseFloat(s.pnlOpen));
  const maxFav = pnlValues.length > 0 ? Math.max(...pnlValues) : null;
  const maxAdv = pnlValues.length > 0 ? Math.min(...pnlValues) : null;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      {/* Trade header card */}
      <div
        style={{
          background: "linear-gradient(180deg, #0f1521, #0c111a)",
          border: "1px solid #1b2433",
          borderRadius: 12,
          padding: "10px 11px",
        }}
      >
        <div
          style={{
            display: "flex",
            alignItems: "baseline",
            gap: 12,
            marginBottom: 10,
          }}
        >
          <div
            style={{
              fontFamily: "'Space Grotesk', system-ui, sans-serif",
              fontWeight: 700,
              fontSize: 16,
              color: "#d6dbe4",
            }}
          >
            {trade.name}
          </div>
          <div style={{ color: "#566273", fontSize: 11, fontFamily: "'JetBrains Mono', ui-monospace, monospace" }}>
            {fmtDate(trade.openedAt)}
            {!isOpen ? ` → ${fmtDate(trade.closedAt ?? "")}` : " (open)"}
          </div>
          <div
            style={{
              marginLeft: "auto",
              fontFamily: "'Space Grotesk', system-ui, sans-serif",
              fontWeight: 700,
              fontSize: 18,
              color: isOpen ? "#5b9cf6" : pnlColor,
            }}
          >
            {isOpen ? "open" : fmtPnl(trade.realizedPnl)}
          </div>
        </div>

        {/* 3 KPIs */}
        <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 8 }}>
          <div
            style={{
              background: "#0c111a",
              border: "1px solid #1b2433",
              borderRadius: 9,
              padding: "8px 9px",
            }}
          >
            <div style={{ color: "#566273", fontSize: 9, textTransform: "uppercase", letterSpacing: "0.5px" }}>
              Realized
            </div>
            <div
              style={{
                fontFamily: "'Space Grotesk', system-ui, sans-serif",
                fontWeight: 700,
                fontSize: 15,
                marginTop: 1,
                color: isOpen ? "#5b9cf6" : pnlColor,
                fontVariantNumeric: "tabular-nums",
              }}
            >
              {isOpen ? "open" : fmtPnl(trade.realizedPnl)}
            </div>
          </div>

          <div
            style={{
              background: "#0c111a",
              border: "1px solid #1b2433",
              borderRadius: 9,
              padding: "8px 9px",
            }}
          >
            <div style={{ color: "#566273", fontSize: 9, textTransform: "uppercase", letterSpacing: "0.5px" }}>
              Max favorable
            </div>
            <div
              style={{
                fontFamily: "'Space Grotesk', system-ui, sans-serif",
                fontWeight: 700,
                fontSize: 15,
                marginTop: 1,
                color: "#26a69a",
                fontVariantNumeric: "tabular-nums",
              }}
            >
              {maxFav !== null ? `+$${maxFav.toFixed(2)}` : "—"}
            </div>
          </div>

          <div
            style={{
              background: "#0c111a",
              border: "1px solid #1b2433",
              borderRadius: 9,
              padding: "8px 9px",
            }}
          >
            <div style={{ color: "#566273", fontSize: 9, textTransform: "uppercase", letterSpacing: "0.5px" }}>
              Max adverse
            </div>
            <div
              style={{
                fontFamily: "'Space Grotesk', system-ui, sans-serif",
                fontWeight: 700,
                fontSize: 15,
                marginTop: 1,
                color: "#ef5350",
                fontVariantNumeric: "tabular-nums",
              }}
            >
              {maxAdv !== null ? `−$${Math.abs(maxAdv).toFixed(2)}` : "—"}
            </div>
          </div>
        </div>
      </div>

      {/* Lifecycle chart card */}
      <div
        style={{
          background: "linear-gradient(180deg, #0f1521, #0c111a)",
          border: "1px solid #1b2433",
          borderRadius: 12,
          padding: "10px 11px",
          flex: 1,
          display: "flex",
          flexDirection: "column",
          minHeight: 300,
        }}
      >
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
          <div style={{ color: "#566273", fontSize: 10, fontFamily: "'JetBrains Mono', ui-monospace, monospace" }}>
            {kind === "history" ? "30-min snapshots" : "entry/exit only"}
          </div>
          <RebuildButton calendarId={trade.calendarId} />
        </div>

        {isPending && (
          <div
            style={{
              flex: 1,
              background: "#1b2433",
              borderRadius: 6,
              opacity: 0.4,
              minHeight: 200,
            }}
            aria-busy="true"
            aria-label="Loading lifecycle"
          />
        )}

        {!isPending && kind === "history" && snapshots.length > 1 && (
          <LifecycleChart snapshots={snapshots} />
        )}

        {!isPending && kind === "entry-exit-only" && (
          <PreHistoryStub />
        )}

        {!isPending && kind === "history" && snapshots.length <= 1 && (
          <div style={{ color: "#566273", fontSize: 11, padding: 16, textAlign: "center" }}>
            No snapshots yet. Snapshots are captured every 30 minutes during RTH.
          </div>
        )}
      </div>
    </div>
  );
}

// ─── Main screen ─────────────────────────────────────────────────────────────

export function Journal({ trades }: JournalProps): React.ReactElement {
  // Default-select the first trade (newest / open first)
  const [selectedId, setSelectedId] = useState<string | null>(
    trades.length > 0 && trades[0] !== undefined ? trades[0].id : null,
  );

  const selectedTrade = trades.find((t) => t.id === selectedId) ?? trades[0] ?? null;

  const { data, isPending } = useJournal(selectedTrade?.calendarId ?? "");

  const snapshots: ReadonlyArray<SnapshotResponse> = data?.snapshots ?? [];

  // ── Empty state ─────────────────────────────────────────────────────────────
  if (trades.length === 0) {
    return (
      <div
        style={{
          height: "100%",
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          color: "#566273",
          fontFamily: "'JetBrains Mono', ui-monospace, monospace",
          fontSize: 12,
          gap: 8,
        }}
      >
        <span>No journal history yet.</span>
        <span style={{ fontSize: 10 }}>Trades before Jun 12 have entry/exit only.</span>
      </div>
    );
  }

  return (
    <div
      style={{
        display: "grid",
        gridTemplateColumns: "250px 1fr 290px",
        gap: 12,
        padding: 12,
        height: "100%",
        overflow: "hidden",
      }}
    >
      {/* ── Left column — trade list ─────────────────────────────────────── */}
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          gap: 12,
          minHeight: 0,
          overflowY: "auto",
        }}
      >
        <div
          style={{
            background: "linear-gradient(180deg, #0f1521, #0c111a)",
            border: "1px solid #1b2433",
            borderRadius: 12,
            padding: "10px 11px",
          }}
        >
          {/* Heading */}
          <h3
            style={{
              margin: "0 0 10px",
              fontFamily: "'Space Grotesk', system-ui, sans-serif",
              fontSize: 10,
              fontWeight: 600,
              letterSpacing: "0.9px",
              textTransform: "uppercase",
              color: "#7b8696",
              display: "flex",
              gap: 7,
              alignItems: "center",
            }}
          >
            Trades
            <span
              style={{
                marginLeft: "auto",
                fontSize: 9,
                color: "#566273",
                border: "1px solid #27313f",
                borderRadius: 999,
                padding: "1px 7px",
              }}
            >
              SPXW put calendars
            </span>
          </h3>

          {/* Trade rows */}
          <div>
            {trades.map((trade) => {
              const isSelected = trade.id === selectedId;
              const isOpen = trade.closedAt === null;
              const kind = classifyTradeHistory({
                openedAt: trade.openedAt,
                closedAt: trade.closedAt,
                hasSnapshots: trade.hasSnapshots,
              });
              const pnlNum = parseFloat(trade.realizedPnl);
              const pnlColor = isOpen
                ? "#5b9cf6"
                : pnlNum >= 0
                  ? "#26a69a"
                  : "#ef5350";

              return (
                <div
                  key={trade.id}
                  onClick={() => {
                    setSelectedId(trade.id);
                  }}
                  role="button"
                  tabIndex={0}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" || e.key === " ") setSelectedId(trade.id);
                  }}
                  style={{
                    display: "grid",
                    gridTemplateColumns: "1fr auto",
                    gap: 6,
                    padding: "7px 9px",
                    background: isSelected ? "#1b1733" : "#0c111a",
                    border: `1px solid ${isSelected ? "#a78bfa" : "#1b2433"}`,
                    borderRadius: 8,
                    cursor: "pointer",
                    marginBottom: 5,
                  }}
                >
                  <div>
                    <div
                      style={{
                        fontFamily: "'Space Grotesk', system-ui, sans-serif",
                        fontSize: 12,
                        color: "#d6dbe4",
                        display: "flex",
                        alignItems: "center",
                        gap: 4,
                      }}
                    >
                      {trade.name}
                      {isOpen && (
                        <span
                          style={{
                            fontSize: 8,
                            padding: "0 5px",
                            borderRadius: 3,
                            border: "1px solid #1d3f47",
                            color: "#22d3ee",
                          }}
                        >
                          OPEN
                        </span>
                      )}
                    </div>
                    <div style={{ color: "#566273", fontSize: 9 }}>
                      {fmtDate(trade.openedAt)}
                      {trade.closedAt !== null ? ` → ${fmtDate(trade.closedAt)}` : ""}
                    </div>
                  </div>

                  <div style={{ textAlign: "right" }}>
                    <div
                      style={{
                        fontFamily: "'Space Grotesk', system-ui, sans-serif",
                        fontWeight: 700,
                        fontSize: 12,
                        color: pnlColor,
                        fontVariantNumeric: "tabular-nums",
                      }}
                    >
                      {isOpen ? "open" : fmtPnl(trade.realizedPnl)}
                    </div>
                    {/* History badge */}
                    <div
                      style={{
                        marginTop: 3,
                        fontSize: 8,
                        padding: "0 5px",
                        borderRadius: 3,
                        border: `1px solid ${kind === "history" ? "#1d3f47" : "#27313f"}`,
                        color: kind === "history" ? "#22d3ee" : "#566273",
                        display: "inline-block",
                      }}
                    >
                      {kind === "history" ? "history" : "entry/exit"}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </div>

      {/* ── Center column — lifecycle ─────────────────────────────────────── */}
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          gap: 12,
          minHeight: 0,
          overflowY: "auto",
        }}
      >
        {selectedTrade !== null && (
          <LifecycleSection
            trade={selectedTrade}
            snapshots={snapshots}
            isPending={isPending}
          />
        )}
      </div>

      {/* ── Right column — snapshot table + notes ─────────────────────────── */}
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          gap: 12,
          minHeight: 0,
          overflowY: "auto",
        }}
      >
        {/* Snapshot table card */}
        <div
          style={{
            background: "linear-gradient(180deg, #0f1521, #0c111a)",
            border: "1px solid #1b2433",
            borderRadius: 12,
            padding: "10px 11px",
          }}
        >
          <h3
            style={{
              margin: "0 0 10px",
              fontFamily: "'Space Grotesk', system-ui, sans-serif",
              fontSize: 10,
              fontWeight: 600,
              letterSpacing: "0.9px",
              textTransform: "uppercase",
              color: "#7b8696",
              display: "flex",
              gap: 7,
              alignItems: "center",
            }}
          >
            Lifecycle
            <span
              style={{
                marginLeft: "auto",
                fontSize: 9,
                color: "#566273",
                border: "1px solid #27313f",
                borderRadius: 999,
                padding: "1px 7px",
              }}
            >
              per snapshot
            </span>
          </h3>

          {snapshots.length > 0 ? (
            <SnapshotTable snapshots={snapshots} selectedIndex={snapshots.length - 1} />
          ) : (
            <div
              style={{
                color: "#566273",
                fontSize: 10,
                fontFamily: "'JetBrains Mono', ui-monospace, monospace",
                padding: "8px 0",
              }}
            >
              {isPending ? "Loading…" : "No snapshots available."}
            </div>
          )}
        </div>

        {/* Why it moved card */}
        <div
          style={{
            background: "linear-gradient(180deg, #0f1521, #0c111a)",
            border: "1px solid #1b2433",
            borderRadius: 12,
            padding: "10px 11px",
          }}
        >
          <h3
            style={{
              margin: "0 0 10px",
              fontFamily: "'Space Grotesk', system-ui, sans-serif",
              fontSize: 10,
              fontWeight: 600,
              letterSpacing: "0.9px",
              textTransform: "uppercase",
              color: "#7b8696",
            }}
          >
            Why it moved
          </h3>
          <div
            style={{
              fontSize: 11,
              background: "#0c111a",
              border: "1px solid #1b2433",
              borderLeft: "2px solid #a78bfa",
              borderRadius: 6,
              padding: "8px 10px",
              color: "#566273",
              lineHeight: 1.5,
              fontFamily: "'JetBrains Mono', ui-monospace, monospace",
            }}
          >
            {snapshots.length > 0
              ? "For a calendar the headline driver is vega split + theta. Check front vs back vega to understand which leg drove the move."
              : "Select a trade with chain history to see the attribution narrative."}
          </div>
        </div>

        {/* Notes card */}
        <div
          style={{
            background: "linear-gradient(180deg, #0f1521, #0c111a)",
            border: "1px solid #1b2433",
            borderRadius: 12,
            padding: "10px 11px",
          }}
        >
          <h3
            style={{
              margin: "0 0 10px",
              fontFamily: "'Space Grotesk', system-ui, sans-serif",
              fontSize: 10,
              fontWeight: 600,
              letterSpacing: "0.9px",
              textTransform: "uppercase",
              color: "#7b8696",
              display: "flex",
              gap: 7,
              alignItems: "center",
            }}
          >
            Notes
            <span
              style={{
                marginLeft: "auto",
                fontSize: 9,
                color: "#566273",
                border: "1px solid #27313f",
                borderRadius: 999,
                padding: "1px 7px",
              }}
            >
              thesis · review
            </span>
          </h3>
          <textarea
            placeholder="Entry thesis, management, post-mortem…"
            style={{
              width: "100%",
              background: "#0c111a",
              border: "1px solid #27313f",
              borderRadius: 7,
              color: "#d6dbe4",
              fontFamily: "'JetBrains Mono', ui-monospace, monospace",
              fontSize: 11,
              padding: 8,
              resize: "vertical",
              minHeight: 60,
              boxSizing: "border-box",
            }}
          />
        </div>
      </div>
    </div>
  );
}
