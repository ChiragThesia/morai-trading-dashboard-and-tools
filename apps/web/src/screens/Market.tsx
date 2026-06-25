import { useGex } from "../hooks/useGex.ts";
import { classifyRegime } from "../lib/gex-regime.ts";
import { GammaProfile } from "../components/charts/GammaProfile.tsx";
import { GexBars } from "../components/charts/GexBars.tsx";
import { GexByExpiry } from "../components/charts/GexByExpiry.tsx";
import { ComingSoon } from "../components/stubs/ComingSoon.tsx";

/**
 * Market — Market structure screen (Plan 08).
 *
 * UI-SPEC "Market screen":
 *   - Regime strip: SPX spot (blue) / net γ /1% (coral when negative, blood-dark bg) /
 *     γ flip (amber) / AMPLIFY|DAMPEN via classifyRegime
 *   - 12-col grid:
 *       col-span-7: Net dealer gamma profile (GammaProfile visx, 720×230)
 *       col-span-5: GEX by strike (GexBars ECharts)
 *       col-span-4: Key levels table
 *       col-span-4: GEX by expiry (GexByExpiry ECharts)
 *       col-span-4: Charm/Vanna coming-soon stub ("○ next")
 *       col-span-4: Intraday flow coming-soon stub ("○ needs denser snapshots")
 *
 * Data: useGex() only — no browser-side GEX recompute (D-01).
 * Empty state: "GEX data unavailable — run fetch-chain to populate." (locked copy).
 * No any/as/! — all types from GexSnapshotEntry.
 *
 * Visual anchor: Net Dealer Gamma Profile (span 7) — highest visual weight.
 */

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** Compact number formatter: $1.2B / $47M / $1.2K */
function fmtDollar(v: number): string {
  const abs = Math.abs(v);
  const sign = v < 0 ? "−" : "+";
  if (abs >= 1_000_000_000) return `${sign}$${(abs / 1_000_000_000).toFixed(1)}B`;
  if (abs >= 1_000_000) return `${sign}$${(abs / 1_000_000).toFixed(0)}M`;
  if (abs >= 1_000) return `${sign}$${(abs / 1_000).toFixed(0)}K`;
  return `${sign}$${abs.toFixed(0)}`;
}

// ─── Sub-components ───────────────────────────────────────────────────────────

interface RegimeChipProps {
  label: string;
  value: string;
  valueColor: string;
  bgColor?: string;
  borderColor?: string;
}

/** Single regime strip chip */
function RegimeChip({
  label,
  value,
  valueColor,
  bgColor,
  borderColor,
}: RegimeChipProps): React.ReactElement {
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: 8,
        padding: "6px 12px",
        borderRadius: 6,
        border: `1px solid ${borderColor ?? "#27313f"}`,
        background: bgColor ?? "transparent",
      }}
    >
      <span
        style={{
          fontSize: 10,
          fontFamily: "'Space Grotesk', system-ui, sans-serif",
          fontWeight: 600,
          letterSpacing: "0.9px",
          textTransform: "uppercase",
          color: "#7b8696",
        }}
      >
        {label}
      </span>
      <span
        style={{
          fontSize: 12,
          fontFamily: "'JetBrains Mono', ui-monospace, monospace",
          fontWeight: 700,
          color: valueColor,
          fontVariantNumeric: "tabular-nums",
        }}
      >
        {value}
      </span>
    </div>
  );
}

interface CardProps {
  heading: string;
  badge?: string;
  children: React.ReactNode;
  colSpan?: number;
  minHeight?: number;
}

/** Card container per UI-SPEC (linear gradient, border) */
function Card({
  heading,
  badge,
  children,
  colSpan = 1,
  minHeight,
}: CardProps): React.ReactElement {
  return (
    <div
      style={{
        gridColumn: `span ${colSpan}`,
        background: "linear-gradient(180deg, #0f1521, #0c111a)",
        border: "1px solid #1b2433",
        borderRadius: 8,
        padding: 12,
        display: "flex",
        flexDirection: "column",
        gap: 8,
        minHeight: minHeight !== undefined ? `${minHeight}px` : undefined,
        boxSizing: "border-box",
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
        <span
          style={{
            fontSize: 10,
            fontFamily: "'Space Grotesk', system-ui, sans-serif",
            fontWeight: 600,
            textTransform: "uppercase",
            letterSpacing: "0.9px",
            color: "#7b8696",
          }}
        >
          {heading}
        </span>
        {badge !== undefined && (
          <span
            style={{
              fontSize: 10,
              fontFamily: "'JetBrains Mono', ui-monospace, monospace",
              color: "#566273",
              border: "1px solid #27313f",
              borderRadius: 4,
              padding: "1px 4px",
            }}
          >
            {badge}
          </span>
        )}
      </div>
      {children}
    </div>
  );
}

// ─── Key levels table ─────────────────────────────────────────────────────────

interface KeyLevel {
  label: string;
  value: number | null;
  color: string;
}

interface KeyLevelsTableProps {
  spot: number;
  flip: number | null;
  callWall: number | null;
  putWall: number | null;
}

function KeyLevelsTable({
  spot,
  flip,
  callWall,
  putWall,
}: KeyLevelsTableProps): React.ReactElement {
  const levels: ReadonlyArray<KeyLevel> = [
    { label: "Call Wall", value: callWall, color: "#26a69a" },
    { label: "γ flip", value: flip, color: "#f0b429" },
    { label: "Spot", value: spot, color: "#5b9cf6" },
    { label: "Put Wall", value: putWall, color: "#ef5350" },
  ];

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
      {levels.map((lvl) => {
        const dist =
          lvl.value !== null ? Math.round(lvl.value - spot) : null;
        const distStr =
          dist !== null
            ? `${dist >= 0 ? "+" : ""}${dist} pts`
            : "—";
        const valStr = lvl.value !== null ? lvl.value.toFixed(0) : "—";

        return (
          <div
            key={lvl.label}
            style={{
              display: "flex",
              justifyContent: "space-between",
              alignItems: "center",
              fontSize: 10,
              fontFamily: "'JetBrains Mono', ui-monospace, monospace",
              fontVariantNumeric: "tabular-nums",
              padding: "2px 0",
              borderBottom: "1px solid #1b2433",
            }}
          >
            <span style={{ color: lvl.color, fontWeight: 600 }}>{lvl.label}</span>
            <span style={{ color: "#d6dbe4" }}>{valStr}</span>
            <span style={{ color: "#566273" }}>{distStr}</span>
          </div>
        );
      })}
    </div>
  );
}

// ─── Market screen ────────────────────────────────────────────────────────────

/**
 * Market — renders dealer-gamma market structure from the live GEX snapshot.
 *
 * No browser-side GEX computation (D-01 — GEX is server-computed and cached).
 * Coming-soon stubs: Charm/Vanna ("○ next") + Intraday flow ("○ needs denser snapshots").
 */
export function Market(): React.ReactElement {
  const { data: gex } = useGex();

  // ── Empty / error state ──────────────────────────────────────────────────────
  if (gex === undefined) {
    return (
      <div
        style={{
          padding: 32,
          color: "#566273",
          fontSize: 12,
          fontFamily: "'JetBrains Mono', ui-monospace, monospace",
          textAlign: "center",
        }}
        data-testid="market-empty"
      >
        {/* Locked copy from UI-SPEC "Empty / loading / error states" */}
        GEX data unavailable — run fetch-chain to populate.
      </div>
    );
  }

  // ── Regime classification ────────────────────────────────────────────────────
  const regime = classifyRegime(gex.netGammaAtSpot);
  const isAmplify = regime === "AMPLIFY";

  const netGammaLabel = fmtDollar(gex.netGammaAtSpot) + " /1%";
  const flipLabel = gex.flip !== null ? gex.flip.toFixed(0) : "—";

  // Net gamma chip: blood-dark bg when negative (AMPLIFY)
  const netGammaBg = isAmplify ? "#180f10" : "transparent";
  const netGammaBorder = isAmplify ? "#5a2b2e" : "#27313f";
  const netGammaColor = isAmplify ? "#ef5350" : "#26a69a";

  // Regime chip
  const regimeLabel = isAmplify ? "▼ AMPLIFY" : "▲ DAMPEN";
  const regimeColor = isAmplify ? "#ef5350" : "#26a69a";

  // ── Layout ───────────────────────────────────────────────────────────────────
  return (
    <div
      style={{
        maxWidth: "1480px",
        margin: "0 auto",
        padding: "14px",
        boxSizing: "border-box",
        display: "flex",
        flexDirection: "column",
        gap: 12,
      }}
    >
      {/* ── Regime strip (4 chips, full width) ── */}
      <div
        style={{
          display: "flex",
          gap: 8,
          flexWrap: "wrap",
        }}
        data-testid="regime-strip"
      >
        {/* SPX spot (blue) */}
        <RegimeChip
          label="SPX spot"
          value={gex.spot.toFixed(2)}
          valueColor="#5b9cf6"
        />
        {/* net γ /1% (coral when negative with blood-dark bg) */}
        <RegimeChip
          label="net γ /1%"
          value={netGammaLabel}
          valueColor={netGammaColor}
          bgColor={netGammaBg}
          borderColor={netGammaBorder}
        />
        {/* γ flip (amber) */}
        <RegimeChip
          label="γ flip"
          value={flipLabel}
          valueColor="#f0b429"
        />
        {/* Regime label: AMPLIFY or DAMPEN */}
        <RegimeChip
          label="regime"
          value={regimeLabel}
          valueColor={regimeColor}
          bgColor={isAmplify ? "#180f10" : "transparent"}
          borderColor={isAmplify ? "#5a2b2e" : "#27313f"}
        />
      </div>

      {/* ── 12-column grid ── */}
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(12, 1fr)",
          gap: 12,
        }}
      >
        {/* Net dealer gamma profile (span 7) — visual anchor */}
        <Card
          heading="Net dealer gamma profile"
          badge="full chain · $Bn / 1% vs spot"
          colSpan={7}
        >
          <GammaProfile
            profile={gex.profile}
            spot={gex.spot}
            flip={gex.flip}
            width={720}
            height={230}
          />
          {/* Callout block — GEX note text */}
          <div
            style={{
              fontSize: 10,
              fontFamily: "'JetBrains Mono', ui-monospace, monospace",
              color: "#566273",
              borderTop: "1px solid #1b2433",
              paddingTop: 6,
              marginTop: 4,
            }}
          >
            {isAmplify
              ? "Dealers are net short gamma — moves are amplified (positive feedback)."
              : "Dealers are net long gamma — moves are dampened (mean-reversion force)."}
          </div>
        </Card>

        {/* GEX by strike (span 5) */}
        <Card
          heading="GEX by strike"
          badge="±260 · live"
          colSpan={5}
        >
          <GexBars
            strikes={gex.strikes}
            spot={gex.spot}
            callWall={gex.callWall}
            putWall={gex.putWall}
            height={260}
          />
        </Card>

        {/* Key levels (span 4) */}
        <Card
          heading="Key levels"
          badge="distance to spot"
          colSpan={4}
        >
          <KeyLevelsTable
            spot={gex.spot}
            flip={gex.flip}
            callWall={gex.callWall}
            putWall={gex.putWall}
          />
        </Card>

        {/* GEX by expiry (span 4) */}
        <Card
          heading="GEX by expiration"
          badge="$Bn · live"
          colSpan={4}
        >
          <GexByExpiry
            byExpiry={gex.byExpiry}
            height={200}
          />
        </Card>

        {/* Charm/Vanna coming-soon stub (span 4) — never omitted */}
        <Card
          heading="Charm / Vanna"
          colSpan={4}
          minHeight={140}
        >
          {/* Badge rendered inside ComingSoon — "○ next" per UI-SPEC */}
          <ComingSoon
            badge="○ next"
            title="Charm & Vanna by strike"
            body="computable from chain (Δ-drift from time & IV) — same per-strike bar pattern as GEX"
            minHeight={100}
          />
        </Card>

        {/* Intraday flow coming-soon stub (span 4) — never omitted */}
        <Card
          heading="Intraday flow"
          colSpan={4}
          minHeight={140}
        >
          {/* Badge rendered inside ComingSoon — "○ needs denser snapshots" per UI-SPEC */}
          <ComingSoon
            badge="○ needs denser snapshots"
            title="HIRO-style net delta-flow"
            body="Δ(delta-notional) between snapshots — 30-min cadence → coarse; finer feed later"
            minHeight={100}
          />
        </Card>
      </div>
    </div>
  );
}
