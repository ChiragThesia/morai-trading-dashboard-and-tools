import { usePositions } from "../hooks/usePositions.ts";
import { useStatus } from "../hooks/useStatus.ts";
import { ComingSoon } from "../components/stubs/ComingSoon.tsx";

/**
 * Overview — the main dashboard screen (Plan 05, Task 2).
 *
 * 12-column card grid layout per UI-SPEC "Overview screen":
 *   Row A: Open positions (span 7) + Net greeks (span 2) + P&L (span 3)
 *   Row B: What's affecting your positions — Market regime (4) + Your strike (4) + Volatility (4)
 *   Row C: Catalysts stub (4) + System health (4) + Recent activity (4)
 *
 * Data: live from usePositions() + useStatus() (no seed/sample data — D-04).
 * Empty state: locked copy "No open positions…" when positions array is empty.
 * Economic calendar: ComingSoon stub with "○ needs feed" badge.
 */
export function Overview(): React.ReactElement {
  const { data: posData, isPending: posLoading } = usePositions();
  const { data: statusData } = useStatus();

  const positions = posData?.positions ?? [];

  return (
    <div
      style={{
        maxWidth: "1480px",
        margin: "0 auto",
        padding: "14px",
        boxSizing: "border-box",
      }}
    >
      {/* Data range note — locked copy (UI-SPEC Copywriting Contract) */}
      <p
        style={{
          fontSize: "10px",
          fontFamily: "'JetBrains Mono', ui-monospace, monospace",
          color: "#566273",
          margin: "0 0 12px 0",
        }}
      >
        Data from 2026-06-12 forward (chain history start). Older trades = entry/exit only.
      </p>

      {/* Row A: Book summary */}
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(12, 1fr)",
          gap: "12px",
          marginBottom: "12px",
        }}
      >
        {/* Open positions card (span 7) */}
        <div
          style={{
            gridColumn: "span 7",
            background: "linear-gradient(180deg, #0f1521, #0c111a)",
            border: "1px solid #1b2433",
            borderRadius: "8px",
            padding: "12px",
          }}
        >
          <div
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              marginBottom: "8px",
            }}
          >
            <h3
              style={{
                margin: 0,
                fontSize: "10px",
                fontFamily: "'Space Grotesk', system-ui, sans-serif",
                fontWeight: 600,
                textTransform: "uppercase",
                letterSpacing: "0.9px",
                color: "#7b8696",
              }}
            >
              Open positions
            </h3>
            <a
              href="#"
              onClick={(e) => e.preventDefault()}
              style={{
                fontSize: "10px",
                color: "#a78bfa",
                textDecoration: "none",
                fontFamily: "'Space Grotesk', system-ui, sans-serif",
              }}
            >
              open analyzer →
            </a>
          </div>

          {posLoading ? (
            <div
              style={{
                height: "80px",
                background: "#1b2433",
                borderRadius: "4px",
                animation: "shimmer 1.5s infinite",
              }}
            />
          ) : positions.length === 0 ? (
            <p
              style={{
                fontSize: "12px",
                fontFamily: "'JetBrains Mono', ui-monospace, monospace",
                color: "#7b8696",
                margin: "16px 0",
                lineHeight: 1.45,
              }}
            >
              No open positions. Register a calendar via the API or paste a TOS order to analyze a scenario.
            </p>
          ) : (
            <table
              style={{
                width: "100%",
                borderCollapse: "collapse",
                fontSize: "12px",
                fontFamily: "'JetBrains Mono', ui-monospace, monospace",
                fontVariantNumeric: "tabular-nums",
              }}
            >
              <thead>
                <tr>
                  {["Position", "Structure", "DTE", "Debit", "Mark", "Unreal P&L", "Δ", "Θ/d", "Vega"].map((col) => (
                    <th
                      key={col}
                      style={{
                        textAlign: "left",
                        padding: "4px 8px",
                        fontSize: "10px",
                        fontFamily: "'Space Grotesk', system-ui, sans-serif",
                        fontWeight: 600,
                        textTransform: "uppercase",
                        letterSpacing: "0.9px",
                        color: "#566273",
                        borderBottom: "1px solid #1b2433",
                      }}
                    >
                      {col}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {positions.map((pos) => (
                  <tr key={pos.occSymbol}>
                    <td style={{ padding: "4px 8px", color: "#d6dbe4" }}>
                      {pos.occSymbol}
                    </td>
                    <td style={{ padding: "4px 8px", color: "#7b8696" }}>
                      {pos.putCall}
                    </td>
                    <td style={{ padding: "4px 8px", color: "#d6dbe4" }}>—</td>
                    <td style={{ padding: "4px 8px", color: "#d6dbe4" }}>
                      {pos.averagePrice !== null
                        ? `$${pos.averagePrice.toFixed(2)}`
                        : "—"}
                    </td>
                    <td style={{ padding: "4px 8px", color: "#d6dbe4" }}>
                      {pos.marketValue !== null
                        ? `$${pos.marketValue.toFixed(2)}`
                        : "—"}
                    </td>
                    <td style={{ padding: "4px 8px", color: "#7b8696" }}>—</td>
                    <td style={{ padding: "4px 8px", color: "#7b8696" }}>—</td>
                    <td style={{ padding: "4px 8px", color: "#7b8696" }}>—</td>
                    <td style={{ padding: "4px 8px", color: "#7b8696" }}>—</td>
                  </tr>
                ))}
                {/* Net row */}
                <tr style={{ borderTop: "1px solid #1b2433", fontWeight: 700 }}>
                  <td colSpan={5} style={{ padding: "4px 8px", color: "#d6dbe4" }}>
                    Net
                  </td>
                  <td colSpan={4} style={{ padding: "4px 8px", color: "#7b8696" }}>—</td>
                </tr>
              </tbody>
            </table>
          )}
        </div>

        {/* Net greeks card (span 2) */}
        <div
          style={{
            gridColumn: "span 2",
            background: "linear-gradient(180deg, #0f1521, #0c111a)",
            border: "1px solid #1b2433",
            borderRadius: "8px",
            padding: "12px",
          }}
        >
          <h3
            style={{
              margin: "0 0 8px 0",
              fontSize: "10px",
              fontFamily: "'Space Grotesk', system-ui, sans-serif",
              fontWeight: 600,
              textTransform: "uppercase",
              letterSpacing: "0.9px",
              color: "#7b8696",
            }}
          >
            Net greeks
          </h3>
          {[
            { label: "Δ", value: "—" },
            { label: "Γ", value: "—" },
            { label: "Θ/d", value: "—" },
            { label: "Vega", value: "—" },
          ].map(({ label, value }) => (
            <div
              key={label}
              style={{
                display: "flex",
                justifyContent: "space-between",
                padding: "4px 0",
                fontSize: "12px",
                fontFamily: "'JetBrains Mono', ui-monospace, monospace",
                fontVariantNumeric: "tabular-nums",
              }}
            >
              <span style={{ color: "#7b8696" }}>{label}</span>
              <span style={{ color: "#d6dbe4" }}>{value}</span>
            </div>
          ))}
        </div>

        {/* P&L card (span 3) */}
        <div
          style={{
            gridColumn: "span 3",
            background: "linear-gradient(180deg, #0f1521, #0c111a)",
            border: "1px solid #1b2433",
            borderRadius: "8px",
            padding: "12px",
          }}
        >
          <div
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              marginBottom: "8px",
            }}
          >
            <h3
              style={{
                margin: 0,
                fontSize: "10px",
                fontFamily: "'Space Grotesk', system-ui, sans-serif",
                fontWeight: 600,
                textTransform: "uppercase",
                letterSpacing: "0.9px",
                color: "#7b8696",
              }}
            >
              P&amp;L
            </h3>
            <span
              style={{
                fontSize: "10px",
                color: "#566273",
                fontFamily: "'Space Grotesk', system-ui, sans-serif",
              }}
            >
              realized YTD
            </span>
          </div>
          <p
            style={{
              fontSize: "24px",
              fontFamily: "'Space Grotesk', system-ui, sans-serif",
              fontWeight: 700,
              color: "#d6dbe4",
              margin: "0 0 4px 0",
              fontVariantNumeric: "tabular-nums",
            }}
          >
            —
          </p>
        </div>
      </div>

      {/* Row B: What's affecting your positions */}
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(12, 1fr)",
          gap: "12px",
          marginBottom: "12px",
        }}
      >
        {/* Section header (span 12) */}
        <div style={{ gridColumn: "span 12" }}>
          <h3
            style={{
              margin: 0,
              fontSize: "10px",
              fontFamily: "'Space Grotesk', system-ui, sans-serif",
              fontWeight: 600,
              textTransform: "uppercase",
              letterSpacing: "0.9px",
              color: "#566273",
            }}
          >
            What&apos;s affecting your positions
          </h3>
        </div>

        {/* Market regime (span 4) */}
        <div
          style={{
            gridColumn: "span 4",
            background: "linear-gradient(180deg, #0f1521, #0c111a)",
            border: "1px solid #1b2433",
            borderRadius: "8px",
            padding: "12px",
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: "8px", marginBottom: "8px" }}>
            <h3
              style={{
                margin: 0,
                fontSize: "10px",
                fontFamily: "'Space Grotesk', system-ui, sans-serif",
                fontWeight: 600,
                textTransform: "uppercase",
                letterSpacing: "0.9px",
                color: "#7b8696",
              }}
            >
              Market regime
            </h3>
            <span
              style={{
                fontSize: "10px",
                color: "#566273",
                fontFamily: "'Space Grotesk', system-ui, sans-serif",
              }}
            >
              dealer gamma
            </span>
          </div>
          <p style={{ fontSize: "12px", color: "#7b8696", margin: 0, fontFamily: "'JetBrains Mono', ui-monospace, monospace" }}>
            —
          </p>
        </div>

        {/* Your strike (span 4) */}
        <div
          style={{
            gridColumn: "span 4",
            background: "linear-gradient(180deg, #0f1521, #0c111a)",
            border: "1px solid #1b2433",
            borderRadius: "8px",
            padding: "12px",
          }}
        >
          <h3
            style={{
              margin: "0 0 8px 0",
              fontSize: "10px",
              fontFamily: "'Space Grotesk', system-ui, sans-serif",
              fontWeight: 600,
              textTransform: "uppercase",
              letterSpacing: "0.9px",
              color: "#7b8696",
            }}
          >
            Your strike vs key levels
          </h3>
          <p style={{ fontSize: "12px", color: "#7b8696", margin: 0, fontFamily: "'JetBrains Mono', ui-monospace, monospace" }}>
            —
          </p>
        </div>

        {/* Volatility (span 4) */}
        <div
          style={{
            gridColumn: "span 4",
            background: "linear-gradient(180deg, #0f1521, #0c111a)",
            border: "1px solid #1b2433",
            borderRadius: "8px",
            padding: "12px",
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: "8px", marginBottom: "8px" }}>
            <h3
              style={{
                margin: 0,
                fontSize: "10px",
                fontFamily: "'Space Grotesk', system-ui, sans-serif",
                fontWeight: 600,
                textTransform: "uppercase",
                letterSpacing: "0.9px",
                color: "#7b8696",
              }}
            >
              Volatility
            </h3>
            <span
              style={{
                fontSize: "10px",
                color: "#566273",
                fontFamily: "'Space Grotesk', system-ui, sans-serif",
              }}
            >
              SPX · live
            </span>
          </div>
          <p style={{ fontSize: "12px", color: "#7b8696", margin: 0, fontFamily: "'JetBrains Mono', ui-monospace, monospace" }}>
            —
          </p>
        </div>
      </div>

      {/* Row C: System */}
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(12, 1fr)",
          gap: "12px",
        }}
      >
        {/* Catalysts — ComingSoon stub (span 4) — UI-SPEC "Catalysts" stub exact copy */}
        <ComingSoon
          badge="○ needs feed"
          title="Catalysts"
          body="Event calendar not wired — FOMC · CPI · OPEX · jobs — add an economic-calendar feed"
          style={{ gridColumn: "span 4" }}
        />

        {/* System health (span 4) */}
        <div
          style={{
            gridColumn: "span 4",
            background: "linear-gradient(180deg, #0f1521, #0c111a)",
            border: "1px solid #1b2433",
            borderRadius: "8px",
            padding: "12px",
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: "8px", marginBottom: "8px" }}>
            <h3
              style={{
                margin: 0,
                fontSize: "10px",
                fontFamily: "'Space Grotesk', system-ui, sans-serif",
                fontWeight: 600,
                textTransform: "uppercase",
                letterSpacing: "0.9px",
                color: "#7b8696",
              }}
            >
              System health
            </h3>
            <span
              style={{
                fontSize: "10px",
                color: "#26a69a",
                fontFamily: "'Space Grotesk', system-ui, sans-serif",
              }}
            >
              live
            </span>
          </div>
          {statusData !== undefined &&
          statusData.lastJobRuns !== "none yet" ? (
            Object.entries(statusData.lastJobRuns).map(([jobName, jobRecord]) => {
              const isHealthy = jobRecord.lastErrorAt === null || (
                jobRecord.lastSuccessAt !== null &&
                jobRecord.lastErrorAt !== null &&
                jobRecord.lastSuccessAt > jobRecord.lastErrorAt
              );
              const dotColor = isHealthy ? "#26a69a" : "#ef5350";
              const statusLabel = isHealthy ? "ok" : "error";
              return (
                <div
                  key={jobName}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: "8px",
                    padding: "4px 0",
                    fontSize: "12px",
                    fontFamily: "'JetBrains Mono', ui-monospace, monospace",
                  }}
                >
                  <span
                    style={{
                      width: "8px",
                      height: "8px",
                      borderRadius: "50%",
                      background: dotColor,
                      flexShrink: 0,
                    }}
                  />
                  <span style={{ color: "#7b8696" }}>{jobName}</span>
                  <span style={{ color: "#566273", marginLeft: "auto" }}>
                    {statusLabel}
                  </span>
                </div>
              );
            })
          ) : (
            <div
              style={{
                height: "60px",
                background: "#1b2433",
                borderRadius: "4px",
              }}
            />
          )}
        </div>

        {/* Recent activity (span 4) */}
        <div
          style={{
            gridColumn: "span 4",
            background: "linear-gradient(180deg, #0f1521, #0c111a)",
            border: "1px solid #1b2433",
            borderRadius: "8px",
            padding: "12px",
          }}
        >
          <h3
            style={{
              margin: "0 0 8px 0",
              fontSize: "10px",
              fontFamily: "'Space Grotesk', system-ui, sans-serif",
              fontWeight: 600,
              textTransform: "uppercase",
              letterSpacing: "0.9px",
              color: "#7b8696",
            }}
          >
            Recent activity
          </h3>
          <p style={{ fontSize: "12px", color: "#566273", margin: 0, fontFamily: "'JetBrains Mono', ui-monospace, monospace" }}>
            —
          </p>
        </div>
      </div>
    </div>
  );
}

