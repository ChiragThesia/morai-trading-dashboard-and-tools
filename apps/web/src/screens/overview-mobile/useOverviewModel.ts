/**
 * useOverviewModel — the shared Overview model hook (35.1 D-02).
 *
 * ALL Overview state/derivation lives here, extracted verbatim from Overview.tsx so the
 * desktop tree (OverviewDesktop) and the dedicated mobile tree (OverviewMobile) consume
 * ONE model — view code may duplicate between the trees, data/logic never does. The hook
 * is the surface's single useLiveStream consumer (D-01: only one tree mounts, so only
 * one EventSource opens).
 *
 * The payoff hero uses `repriceScenario` over calendar positions built from
 * `pairPositionsIntoCalendars`. Per-leg calibrated IV comes via `resolveLegIv` (OVW-02)
 * — do not read DEFAULT_IV below as the hero path; it is only `netGreeksForLegs` (the
 * GEX rail's Net book greeks tile), which stays on flat DEFAULT_IV permanently (OQ2
 * deferral, recorded in 17-04-SUMMARY.md).
 */
import { useCallback, useMemo, useState } from "react";
import { usePositions } from "../../hooks/usePositions.ts";
import { useGex } from "../../hooks/useGex.ts";
import { useCot } from "../../hooks/useCot.ts";
import { useMacro } from "../../hooks/useMacro.ts";
import { useExits } from "../../hooks/useExits.ts";
import { useLiveStream } from "../../hooks/useLiveStream.ts";
import type { LiveStreamStatus } from "../../hooks/useLiveStream.ts";
import { computePositionGreeks } from "../../lib/position-greeks.ts";
import type { Row, ExpiryCell } from "../../lib/position-format.ts";
import { pairPositionsIntoCalendars, bookUnrealizedPnl, dteExact } from "../../lib/pair-calendars.ts";
import type { CalendarGroup } from "../../lib/pair-calendars.ts";
import { parseOccSymbol } from "@morai/shared";
import { resolveCarry, DEFAULT_RATE, DEFAULT_DIV } from "../../lib/resolve-carry.ts";
import { toDateInputValue } from "../../lib/date-projection.ts";
import { classifyRegime, zeroDteGex } from "../../lib/gex-regime.ts";
import type { GexRegime } from "../../lib/gex-regime.ts";
import { resolveLegIv } from "../../lib/iv-calibration.ts";
import type { LiveTick } from "../../lib/iv-calibration.ts";
import { computeProjectionBounds } from "../../lib/date-projection.ts";
import { usePayoffDateControl } from "../../hooks/usePayoffDateControl.ts";
import type { PayoffDateControl } from "../../hooks/usePayoffDateControl.ts";
import { repriceScenario, t0ExcludedPositions } from "../../lib/scenario-engine.ts";
import type { AnalyzerPosition, ScenarioParams, ScenarioResult, SpotDomain } from "../../lib/scenario-engine.ts";
import { computePayoffDomain } from "../../lib/payoff-domain.ts";
import type { PayoffChartToggles } from "../../components/charts/PayoffChart.tsx";
import { GEX_FRESH_MS } from "../Market.tsx";
import type {
  BrokerPositionResponse,
  ExitsResponse,
  GexSnapshotEntry,
  MacroResponse,
  MacroSeriesId,
} from "@morai/contracts";
import type { StreamLiveGreekEvent, StreamIndicesEvent, HeldPositionVerdict } from "@morai/contracts";

const DEFAULT_IV = 0.18;
/** Live-mark badge freshness threshold (D-03) — independent of LiveStatusBadge's
 *  connection state; a reconnected stream can still have a >5min-old last tick. */
const LIVE_MARK_FRESH_MS = 5 * 60 * 1000;

export type NetGreeks = { delta: number; gamma: number; theta: number; vega: number };

// ─── Per-leg IV calibration (OVW-02, D-01/D-02) ───────────────────────────────

type LegIvResolution = {
  readonly iv: number;
  readonly status: "ok" | "non-convergent";
  /** True only for a genuine invertIv non-convergence — NOT the wrapper's own
   *  "no-price" cold-start state (Pitfall 2 / T-17-09). Drives the "IV n/a" badge. */
  readonly ivNa: boolean;
};

/**
 * Resolve one leg's IV via `resolveLegIv` (17-01): trusts an already-converged live
 * tick's `bsmIv` when present, else calibrates from the REST-fallback price. Both a
 * genuine `IvError` AND the wrapper's "no-price" state exclude the leg from the
 * payoff-hero pricing (status "non-convergent") — the hero never substitutes a
 * guessed IV either way (T-17-05). Only a genuine `IvError` renders the "IV n/a"
 * badge; "no-price" (cold start / outside RTH) does not (Pitfall 2 / T-17-09).
 */
function resolveLeg(
  leg: BrokerPositionResponse,
  spot: number,
  liveGreeks: ReadonlyMap<string, StreamLiveGreekEvent>,
  now: Date,
): LegIvResolution {
  const netQty = leg.longQty - leg.shortQty;
  const tick = liveGreeks.get(leg.occSymbol);
  const liveTick: LiveTick | null = tick === undefined ? null : { mark: tick.mark, bsmIv: tick.bsmIv };
  const result = resolveLegIv(
    leg.occSymbol,
    spot,
    DEFAULT_RATE,
    DEFAULT_DIV,
    liveTick,
    leg.marketValue,
    netQty,
    now,
  );
  if (result.ok) {
    return { iv: result.value, status: "ok", ivNa: false };
  }
  return { iv: 0, status: "non-convergent", ivNa: result.error.kind !== "no-price" };
}

type CalendarPositionBuild = {
  readonly position: AnalyzerPosition;
  /** Either leg genuinely non-convergent (not just no-price) — drives the row badge. */
  readonly ivNa: boolean;
};

/** A leg's expiry as the GEX impliedCarry lookup key (YYYY-MM-DD, local calendar day —
 *  matches parseOccSymbol's local-Date construction, per RESEARCH Pitfall 1 / date-
 *  projection.ts's `toDateInputValue` precedent). "" (never a carry match) on an
 *  unparseable OCC symbol, which correctly degrades resolveCarry to the DEFAULTs. */
function legExpiryKey(occSymbol: string): string {
  const parsed = parseOccSymbol(occSymbol);
  return parsed.ok ? toDateInputValue(parsed.value.expiry) : "";
}

/** Build one AnalyzerPosition from a paired calendar, calibrating both legs' IV.
 *  `included` (OVW-06) is the row checkbox state lifted from PositionsTable — the single
 *  source of truth for whether this calendar contributes to the payoff curves AND the
 *  table total. It is NOT the IV-convergence gate (frontIvStatus/backIvStatus below,
 *  which the scenario engine applies independently via includedForT0/includedForExpiry).
 *  34-05: also sets the settlement-aware fractional DTE (dteExact) and each leg's own
 *  parity-implied carry (resolveCarry over `gex`) — degrading to DEFAULT_RATE/DEFAULT_DIV
 *  when gex/impliedCarry/the leg's expiry entry is unavailable. */
export function buildCalendarPosition(
  cal: CalendarGroup,
  spot: number,
  liveGreeks: ReadonlyMap<string, StreamLiveGreekEvent>,
  now: Date,
  included: boolean,
  gex: GexSnapshotEntry | undefined,
): CalendarPositionBuild {
  const front = resolveLeg(cal.front, spot, liveGreeks, now);
  const back = resolveLeg(cal.back, spot, liveGreeks, now);
  const frontCarry = resolveCarry(gex, legExpiryKey(cal.front.occSymbol));
  const backCarry = resolveCarry(gex, legExpiryKey(cal.back.occSymbol));
  // Actual fill basis (points per contract): anchors the payoff curves to the REAL
  // entry so they show true open P&L at spot, like TOS — not the model entry re-priced
  // at the live spot (which pins T+0 to $0 at spot and, on a near-flat calendar curve,
  // shifts the breakevens by hundreds of points).
  const entryNet =
    cal.back.averagePrice !== null && cal.front.averagePrice !== null
      ? cal.back.averagePrice - cal.front.averagePrice
      : null;
  return {
    position: {
      id: cal.key,
      name: `${cal.strike}${cal.optionType}`,
      live: true,
      occSymbol: cal.back.occSymbol,
      putCall: cal.optionType,
      frontDte: cal.dteFront,
      backDte: cal.dteBack,
      frontDteExact: dteExact(cal.front.occSymbol, now),
      backDteExact: dteExact(cal.back.occSymbol, now),
      frontIv: front.iv,
      backIv: back.iv,
      frontRate: frontCarry.rate,
      frontDivYield: frontCarry.divYield,
      backRate: backCarry.rate,
      backDivYield: backCarry.divYield,
      qty: Math.max(1, Math.abs(cal.back.longQty - cal.back.shortQty)),
      included,
      entryNet,
      frontIvStatus: front.status,
      backIvStatus: back.status,
    },
    ivNa: front.ivNa || back.ivNa,
  };
}

/** Sum position greeks across legs, scaled to position terms (per-share × netQty × 100).
 *  Used for the GEX rail's Net book greeks tile — NOT for the calibrated payoff-hero
 *  curve (OQ2 deferral). */
export function netGreeksForLegs(
  legs: ReadonlyArray<BrokerPositionResponse>,
  spot: number,
): NetGreeks {
  const acc: NetGreeks = { delta: 0, gamma: 0, theta: 0, vega: 0 };
  for (const leg of legs) {
    const r = computePositionGreeks({
      occSymbol: leg.occSymbol,
      spot,
      iv: DEFAULT_IV,
      rate: DEFAULT_RATE,
      divYield: DEFAULT_DIV,
      longQty: leg.longQty,
      shortQty: leg.shortQty,
    });
    if (!r.ok) continue;
    // computePositionGreeks already scales by netQty; apply ONLY the ×100 contract
    // multiplier — multiplying by netQty×100 double-applies netQty (CR-01).
    acc.delta += r.value.greeks.delta * 100;
    acc.gamma += r.value.greeks.gamma * 100;
    acc.theta += r.value.greeks.theta * 100;
    acc.vega += r.value.greeks.vega * 100;
  }
  return acc;
}

// ─── Positions rows (shared by the docked table + the mobile card list) ───────

type ExpiryCellInput =
  | {
      readonly kind: "calendar";
      readonly frontOccSymbol: string;
      readonly backOccSymbol: string;
      readonly dteFront: number;
      readonly dteBack: number;
    }
  | {
      readonly kind: "single";
      readonly occSymbol: string;
      readonly dte: number;
    };

/** Short month/day, e.g. "Aug 8" — matches the existing `gexAsOf` convention. */
function formatExpiryDate(d: Date): string {
  return d.toLocaleString("en-US", { month: "short", day: "numeric" });
}

/**
 * Structured expiry/DTE cell for a positions-table row (OVW-03): a calendar shows both
 * leg expiries + both DTEs + the calendar width (days between); a single leg shows its
 * one expiry + DTE. Pure — takes already-computed DTEs (`CalendarGroup.dteFront/dteBack`,
 * or the caller's own single-leg DTE) rather than re-deriving "now" itself. Guards the
 * `parseOccSymbol` Result and falls back to "—" for line1 on a parse failure.
 */
export function formatExpiryCell(input: ExpiryCellInput): ExpiryCell {
  if (input.kind === "single") {
    const parsed = parseOccSymbol(input.occSymbol);
    return {
      line1: parsed.ok ? formatExpiryDate(parsed.value.expiry) : "—",
      line2: `${input.dte}d`,
    };
  }
  const front = parseOccSymbol(input.frontOccSymbol);
  const back = parseOccSymbol(input.backOccSymbol);
  const line1 =
    front.ok && back.ok
      ? `${formatExpiryDate(front.value.expiry)} → ${formatExpiryDate(back.value.expiry)}`
      : "—";
  return {
    line1,
    line2: `${input.dteFront}d/${input.dteBack}d · ${input.dteBack - input.dteFront}d wide`,
  };
}

export function buildRows(positions: ReadonlyArray<BrokerPositionResponse>): Row[] {
  const { calendars, singles } = pairPositionsIntoCalendars(positions, new Date());
  const calRows: Row[] = calendars.map((c) => ({
    key: c.key,
    label: `${c.strike}${c.optionType}`,
    expiry: formatExpiryCell({
      kind: "calendar",
      frontOccSymbol: c.front.occSymbol,
      backOccSymbol: c.back.occSymbol,
      dteFront: c.dteFront,
      dteBack: c.dteBack,
    }),
    legs: [c.front, c.back],
  }));
  const singleRows: Row[] = singles.map((p) => {
    const parsed = parseOccSymbol(p.occSymbol);
    const label = parsed.ok ? `${parsed.value.strike}${parsed.value.type}` : p.occSymbol.trim();
    const dte = parsed.ok
      ? Math.max(0, Math.ceil((parsed.value.expiry.getTime() - Date.now()) / 86_400_000))
      : 0;
    return {
      key: p.occSymbol,
      label,
      expiry: formatExpiryCell({ kind: "single", occSymbol: p.occSymbol, dte }),
      legs: [p],
    };
  });
  return [...calRows, ...singleRows];
}

// ─── GEX key levels + pill formatting (shared desktop rail / mobile market section) ──

export function keyLevelsFor(
  gex: GexSnapshotEntry,
  spot?: number,
): ReadonlyArray<{ label: string; value: number | null; colorClass: string }> {
  return [
    { label: "Call Wall", value: gex.callWall, colorClass: "text-up" },
    { label: "γ flip", value: gex.flip, colorClass: "text-amber" },
    // LIVE-04: an optional live-aware override for the "Spot" row (Overview.tsx's GEX
    // rail + MobileMarketSection, the two keyLevelsFor call sites) — default preserves
    // every existing caller's behavior (gex.spot, unchanged).
    { label: "Spot", value: spot ?? gex.spot, colorClass: "text-blue" },
    { label: "Put Wall", value: gex.putWall, colorClass: "text-down" },
    // Near-term (≤45d DTE) set — the intraday-relevant walls when far-dated OI
    // dominates the all-expiry levels. Absent on pre-0019 snapshots.
    ...(gex.nearTerm !== null
      ? [
          { label: "Call Wall 45d", value: gex.nearTerm.callWall, colorClass: "text-up" },
          { label: "γ flip 45d", value: gex.nearTerm.flip, colorClass: "text-amber" },
          { label: "Put Wall 45d", value: gex.nearTerm.putWall, colorClass: "text-down" },
        ]
      : []),
  ];
}

export function fmtGammaCompact(v: number): string {
  return `${v >= 0 ? "+" : "−"}$${Math.abs(v).toFixed(1)}B`;
}

export function latestMacroValue(data: MacroResponse | undefined, id: MacroSeriesId): number | null {
  if (data === undefined) return null;
  const points = data[id];
  if (points === undefined || points.length === 0) return null;
  const latest = points[points.length - 1];
  return latest?.value ?? null;
}

// ─── The model hook ───────────────────────────────────────────────────────────

export interface OverviewModel {
  readonly positions: ReadonlyArray<BrokerPositionResponse>;
  readonly rows: ReadonlyArray<Row>;
  /** Live-aware engine spot: liveSpot while liveStatus==='live', else gex.spot ?? 5800
   *  (unchanged fallback). Feeds payoff/scenario/greeks pricing — never rendered raw
   *  in a header/hero chip (use displaySpot for that, catch #26). */
  readonly spot: number;
  /** Honest display seam for the header/hero chip: live->liveSpot, else gex.spot, else
   *  null ("—"). NEVER the 5800 engine fallback. */
  readonly displaySpot: number | null;
  /** Latest Zod-parsed live SPX spot tick (null until the first "spot" frame). */
  readonly liveSpot: number | null;
  /** Latest Zod-parsed VIX-family frame (null until the first "indices" frame). */
  readonly liveIndices: StreamIndicesEvent | null;
  readonly gex: GexSnapshotEntry | undefined;
  readonly macro: MacroResponse | undefined;
  /** Mobile hero/market slices (one-line calls to shared lib fns; desktop PillHeader
   *  keeps its own identical internal derivation untouched — byte-identity wins). */
  readonly macroValues: {
    readonly vix: number | null;
    readonly vvix: number | null;
    readonly dff: number | null;
    readonly curveSlope: number | null;
  };
  readonly regime: GexRegime | null;
  readonly zeroDte: number | null;
  readonly cotLev: number | null;
  readonly bookPnl: number;
  readonly liveGreeks: ReadonlyMap<string, StreamLiveGreekEvent>;
  readonly liveStatus: LiveStreamStatus;
  readonly liveBadgeProps: {
    readonly status: LiveStreamStatus;
    readonly lastTickAt: Date | null;
    readonly isRth: boolean | null;
    readonly hasReceivedFirstTick: boolean;
    readonly isReconnecting: boolean;
    readonly onReconnect: () => void;
  };
  readonly calendarPositions: ReadonlyArray<AnalyzerPosition>;
  readonly ivNaByRowKey: ReadonlyMap<string, boolean>;
  readonly verdictByRowKey: ReadonlyMap<string, HeldPositionVerdict>;
  readonly unlinkedVerdicts: ReadonlyArray<HeldPositionVerdict>;
  readonly exits: {
    readonly snapshot: ExitsResponse | null;
    readonly isPending: boolean;
    readonly isError: boolean;
    readonly refetch: () => Promise<unknown>;
    /** The loading branch's raw `exitsData === undefined` check (distinct from
     *  snapshot === null, which is the settled cold-start state). */
    readonly dataIsUndefined: boolean;
  };
  readonly scenario: ScenarioResult;
  readonly payoffDomain: SpotDomain;
  readonly positionSetSignature: string;
  readonly excludedFromT0Count: number;
  readonly toggles: PayoffChartToggles;
  readonly handleToggle: (key: keyof PayoffChartToggles) => void;
  readonly dateControl: PayoffDateControl;
  readonly bounds: { readonly minIso: string; readonly maxIso: string; readonly maxDaysForward: number };
  readonly excluded: ReadonlySet<string>;
  readonly handleToggleExcluded: (key: string) => void;
  readonly selectedRowKey: string | null;
  readonly handleSelectRow: (key: string) => void;
  /** Consumed by desktop only (D-13) — mobile passes highlightedPositionId={null}. */
  readonly hover: {
    readonly highlightedRowKey: string | null;
    readonly handleHoverRow: (key: string | null) => void;
    readonly highlightedScenario: ScenarioResult | null;
  };
  readonly freshness: {
    readonly gexFresh: boolean;
    readonly gexAsOf: string;
    readonly gexAgeMs: number | null;
    readonly markFresh: boolean;
    readonly markAsOf: string;
    readonly markAgeMs: number | null;
  };
  readonly railGreeks: NetGreeks;
  readonly noop: () => void;
}

export function useOverviewModel(): OverviewModel {
  const { data: posData } = usePositions();
  const { data: gex } = useGex();
  const { data: cot } = useCot();
  const { data: macro } = useMacro();
  const positions = posData?.positions ?? [];

  // ── Held positions + exit rules (moved from Analyzer, EXIT-07/EXIT-09/EXIT-10):
  // same D-18/D-19-style state precedence Analyzer used — loading → error → cold-start
  // (no verdicts computed anywhere yet) → empty (settled, zero open calendars) → loaded. ──
  const { data: exitsData, isPending: exitsIsPending, isError: exitsIsError, refetch: exitsRefetch } = useExits();
  const exitsSnapshot = exitsData ?? null;

  // ── Verdict-in-row join (overview-layout-redesign.md §Join design) ────────────
  // Deterministic, root-agnostic: key each loaded verdict by `${strike}${optionType}` and
  // look it up per positions row by its `label` (same format). A verdict with no live broker
  // row (closed calendar) is NEVER dropped — it falls to the "Unlinked verdicts" list below.
  const loadedVerdicts = exitsSnapshot?.positions ?? [];
  const verdictByRowKey = useMemo(
    () => new Map(loadedVerdicts.map((v) => [`${v.strike}${v.optionType}`, v])),
    [loadedVerdicts],
  );
  const rows = useMemo(() => buildRows(positions), [positions]);
  const rowLabels = useMemo(() => new Set(rows.map((r) => r.label)), [rows]);
  const unlinkedVerdicts = useMemo(
    () => loadedVerdicts.filter((v) => !rowLabels.has(`${v.strike}${v.optionType}`)),
    [loadedVerdicts, rowLabels],
  );

  // Phase 12-07: live stream hook (D-06 — this surface only). useLiveStream() is called
  // once here; D-01 (35.1) guarantees a single consumer because only ONE tree
  // (OverviewDesktop | OverviewMobile) mounts, and Overview/Analyzer never mount
  // simultaneously (Shell renders one screen at a time) so no second EventSource opens.
  const {
    greeks: liveGreeks,
    status: liveStatus,
    lastTickAt: liveLastTickAt,
    isRth: liveIsRth,
    hasReceivedFirstTick: liveHasReceivedFirstTick,
    isReconnecting: liveIsReconnecting,
    reconnectNow: liveReconnectNow,
    liveSpot,
    liveIndices,
  } = useLiveStream();

  // Live-aware engine spot (LIVE-04): live only while the stream itself is live AND a
  // spot tick has arrived; else the unchanged 30-min GEX snapshot fallback — never a
  // silent stale-as-live claim (catch #26). Feeds every payoff/scenario/greeks memo
  // below (they already useMemo on spot, so this needs no signature change).
  const spot = liveStatus === "live" && liveSpot !== null ? liveSpot : (gex?.spot ?? 5800);
  // Honest display seam for the header/hero chip — NEVER the 5800 engine fallback.
  const displaySpot = liveStatus === "live" && liveSpot !== null ? liveSpot : (gex?.spot ?? null);

  // ── Payoff hero positions (calendars only — the scenario engine models calendar
  // spreads; singles remain table-only rows) ──────────────────────────────────
  const { calendars } = useMemo(
    () => pairPositionsIntoCalendars(positions, new Date()),
    [positions],
  );

  // OVW-06: single lifted source of truth for row inclusion. Feeds BOTH the payoff
  // chart (via buildCalendarPosition's `included` param below) AND PositionsTable's
  // checkbox/total/opacity (passed down as a controlled prop) — no second Set, no
  // syncing useEffect. Tracks EXCLUDED keys so new positions default to "included".
  const [excludedCalendars, setExcludedCalendars] = useState<ReadonlySet<string>>(new Set());
  const handleToggleExcluded = useCallback((key: string): void => {
    setExcludedCalendars((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }, []);

  // Per-leg calibrated IV (OVW-02, D-01/D-02) — resolveLegIv per leg, never DEFAULT_IV
  // on this path (T-17-05). DEFAULT_IV remains only for netGreeksForLegs (the GEX rail's
  // Net book greeks tile, OQ2 recorded deferral).
  const calendarBuild = useMemo(
    () =>
      calendars.map((cal) =>
        buildCalendarPosition(cal, spot, liveGreeks, new Date(), !excludedCalendars.has(cal.key), gex),
      ),
    [calendars, spot, liveGreeks, excludedCalendars, gex],
  );
  const calendarPositions = useMemo<ReadonlyArray<AnalyzerPosition>>(
    () => calendarBuild.map((b) => b.position),
    [calendarBuild],
  );
  const ivNaByRowKey = useMemo(
    () => new Map(calendarBuild.map((b) => [b.position.id, b.ivNa])),
    [calendarBuild],
  );

  // OVW-05: TOS-style date picker — projects the today/date curve to a chosen future
  // date via the scenario engine's existing `daysForward` path. The @exp curve stays
  // fixed (D-01): `bookPLAtExpiry` structurally ignores `daysForward`, so no engine
  // change is needed here (locked by a characterization test in scenario-engine.test.ts).
  // A single stable `today` reference keeps re-renders/tests deterministic.
  const today = useMemo(() => new Date(), []);
  const bounds = useMemo(
    () =>
      computeProjectionBounds(
        calendarPositions
          .filter(
            (p) =>
              p.included &&
              p.frontIvStatus !== "non-convergent" &&
              p.backIvStatus !== "non-convergent",
          )
          .map((p) => p.frontDte),
        today,
      ),
    [calendarPositions, today],
  );
  // Forward date projection now lives in the shared hook (same behavior as the prior inline glue).
  const dateControl = usePayoffDateControl(today, bounds.maxDaysForward);

  // Series-visibility toggles — were a hardcoded const + static legend; now driven by the shared
  // PayoffControls chips. Defaults preserve the prior render exactly (fan off, the rest on).
  const [toggles, setToggles] = useState<PayoffChartToggles>({
    showFan: false,
    showExpiration: true,
    showWalls: true,
    showProfitZone: true,
  });
  const handleToggle = useCallback((key: keyof PayoffChartToggles): void => {
    setToggles((prev) => ({ ...prev, [key]: !prev[key] }));
  }, []);

  // ONE domain, computed from the FULL combined book (Pitfall 4: never a single-candidate
  // slice) — shared by the data grid (repriceScenario, both curves below) and the chart
  // scale (<PayoffChart domain=>) so neither clips relative to the other (Pitfall 1).
  const payoffDomain = useMemo(() => {
    const params: ScenarioParams = {
      spot,
      daysForward: dateControl.daysForward,
      ivShift: 0,
      rate: DEFAULT_RATE,
      divYield: DEFAULT_DIV,
    };
    return computePayoffDomain(calendarPositions, spot, params);
  }, [calendarPositions, spot, dateControl.daysForward]);

  const scenario = useMemo(() => {
    const params: ScenarioParams = {
      spot,
      daysForward: dateControl.daysForward,
      ivShift: 0,
      rate: DEFAULT_RATE,
      divYield: DEFAULT_DIV,
    };
    return repriceScenario(calendarPositions, params, payoffDomain);
  }, [calendarPositions, spot, dateControl.daysForward, payoffDomain]);

  const positionSetSignature = calendarPositions
    .map((p) => `${p.id}:${p.frontIvStatus ?? "ok"}:${p.backIvStatus ?? "ok"}:${p.included}`)
    .join("|");

  const noop = useCallback((): void => {}, []);

  const railGreeks = useMemo(() => {
    const allLegs = buildRows(positions).flatMap((r) => r.legs);
    return netGreeksForLegs(allLegs, spot);
  }, [positions, spot]);

  const bookPnl = useMemo(() => bookUnrealizedPnl(positions), [positions]);
  const cotLev = cot?.[0]?.netLeveraged ?? null;

  // ── Row highlight (D-05) — transient hover id + persisted click-toggle id,
  // mirroring AdHocPicker's clearHovered pattern. ──────────────────────────────
  const [hoveredRowKey, setHoveredRowKey] = useState<string | null>(null);
  const [selectedRowKey, setSelectedRowKey] = useState<string | null>(null);
  const highlightedRowKey = hoveredRowKey ?? selectedRowKey;

  const handleHoverRow = useCallback((key: string | null): void => { setHoveredRowKey(key); }, []);
  const handleSelectRow = useCallback((key: string): void => {
    setSelectedRowKey((prev) => (prev === key ? null : key));
  }, []);

  const highlightedPosition = calendarPositions.find((p) => p.id === highlightedRowKey) ?? null;
  const highlightedScenario = useMemo(() => {
    if (highlightedPosition === null) return null;
    const params: ScenarioParams = {
      spot,
      daysForward: dateControl.daysForward,
      ivShift: 0,
      rate: DEFAULT_RATE,
      divYield: DEFAULT_DIV,
    };
    return repriceScenario([highlightedPosition], params, payoffDomain);
  }, [highlightedPosition, spot, dateControl.daysForward, payoffDomain]);

  const excludedFromT0 = t0ExcludedPositions(calendarPositions);

  // ── Staleness (D-03/D-04) — two independent channels, same visual grammar. ──
  const gexTs = gex !== undefined ? new Date(gex.computedAt) : null;
  const gexAgeMs = gexTs !== null ? Date.now() - gexTs.getTime() : null;
  const gexFresh = gexAgeMs !== null && gexAgeMs < GEX_FRESH_MS;
  const gexAsOf =
    gexTs !== null
      ? gexTs.toLocaleString("en-US", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" })
      : "—";

  const markAgeMs = liveLastTickAt !== null ? Date.now() - liveLastTickAt.getTime() : null;
  const markFresh = markAgeMs !== null && markAgeMs <= LIVE_MARK_FRESH_MS;
  const markAsOf =
    liveLastTickAt !== null
      ? liveLastTickAt.toLocaleString("en-US", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" })
      : "—";

  // ── Mobile slices (35.1) — one-line calls to existing shared lib fns; desktop
  // PillHeader keeps its own identical internal derivation untouched. ──────────
  const regime = gex !== undefined ? classifyRegime(gex.netGammaAtSpot) : null;
  const zeroDte = gex !== undefined ? zeroDteGex(gex.byExpiry, gex.computedAt) : null;
  const macroValues = {
    vix: latestMacroValue(macro, "VIXCLS"),
    vvix: latestMacroValue(macro, "VVIX"),
    dff: latestMacroValue(macro, "DFF"),
    curveSlope: latestMacroValue(macro, "T10Y2Y"),
  };

  return {
    positions,
    rows,
    spot,
    displaySpot,
    liveSpot,
    liveIndices,
    gex,
    macro,
    macroValues,
    regime,
    zeroDte,
    cotLev,
    bookPnl,
    liveGreeks,
    liveStatus,
    liveBadgeProps: {
      status: liveStatus,
      lastTickAt: liveLastTickAt,
      isRth: liveIsRth,
      hasReceivedFirstTick: liveHasReceivedFirstTick,
      isReconnecting: liveIsReconnecting,
      onReconnect: liveReconnectNow,
    },
    calendarPositions,
    ivNaByRowKey,
    verdictByRowKey,
    unlinkedVerdicts,
    exits: {
      snapshot: exitsSnapshot,
      isPending: exitsIsPending,
      isError: exitsIsError,
      refetch: exitsRefetch,
      dataIsUndefined: exitsData === undefined,
    },
    scenario,
    payoffDomain,
    positionSetSignature,
    excludedFromT0Count: excludedFromT0.count,
    toggles,
    handleToggle,
    dateControl,
    bounds,
    excluded: excludedCalendars,
    handleToggleExcluded,
    selectedRowKey,
    handleSelectRow,
    hover: { highlightedRowKey, handleHoverRow, highlightedScenario },
    freshness: { gexFresh, gexAsOf, gexAgeMs, markFresh, markAsOf, markAgeMs },
    railGreeks,
    noop,
  };
}
