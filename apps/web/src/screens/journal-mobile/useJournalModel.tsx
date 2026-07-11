/**
 * useJournalModel — the shared Journal model hook (36 D-04).
 *
 * ALL Journal state/derivation lives here, extracted verbatim from Journal.tsx so the
 * desktop tree (JournalDesktop) and the dedicated mobile tree (JournalMobile) consume ONE
 * model — view code may duplicate between the trees, data/logic never does. The hook is
 * the surface's single useLifecycle + useRuleTags consumer (D-03: only one tree mounts).
 *
 * This file is .tsx (the one deliberate deviation from the useOverviewModel .ts precedent)
 * because the shared view helpers below carry JSX — HeadingPill, RuleTagChips, and the
 * dashed honest-state stubs are single-sourced here so the mobile tree imports the exact
 * same components rather than re-implementing them.
 */
import { useState } from "react";
import { enterRuleTag, exitRuleTag, rollRuleTag } from "@morai/core";
import { useLifecycle } from "../../hooks/useLifecycle.ts";
import { useRuleTags } from "../../hooks/useRuleTags.ts";
import type { UseRuleTagsResult } from "../../hooks/useRuleTags.ts";
import { Button } from "../../components/system/index.tsx";
import type { Beat } from "../../components/BeatsCard.tsx";
import type { EventWithRulesEntry, LifecycleResponse } from "@morai/contracts";

// ─── Types ────────────────────────────────────────────────────────────────────

/** Minimal trade descriptor that the Journal screen needs from its parent. */
export interface TradeSummary {
  readonly id: string;
  readonly calendarId: string;
  /** Calendar strike in points (e.g. 7375), for the chart's price-panel reference line. */
  readonly strike: number;
  readonly name: string;
  readonly openedAt: string;
  readonly closedAt: string | null;
  readonly realizedPnl: string;
  readonly hasSnapshots: boolean;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

/** Format ISO datetime as "MMM DD YYYY" */
export function fmtDate(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleDateString("en-US", {
    month: "short",
    day: "2-digit",
    year: "numeric",
    timeZone: "UTC",
  });
}

/** Format realized P&L with sign */
export function fmtPnl(val: string | null): string {
  if (val === null) return "open";
  const n = parseFloat(val);
  if (!Number.isFinite(n)) return "—";
  const sign = n >= 0 ? "+" : "−";
  return `${sign}$${Math.abs(n).toFixed(2)}`;
}

/** Format a snapshot time as "MMM DD HH:MM" */
export function fmtSnapTime(iso: string): string {
  const d = new Date(iso);
  const month = d.toLocaleString("en-US", { month: "short", timeZone: "UTC" });
  const day = d.getUTCDate();
  const hh = String(d.getUTCHours()).padStart(2, "0");
  const mm = String(d.getUTCMinutes()).padStart(2, "0");
  return `${month} ${day} ${hh}:${mm}`;
}

/** The fainter right-aligned descriptor pill used in panel headings. */
export function HeadingPill({ children }: { children: React.ReactNode }): React.ReactElement {
  return (
    <span className="rounded-full border border-line2 px-[7px] py-px text-[9px] text-dim">
      {children}
    </span>
  );
}

// ─── RULE-01: rule-tag control ─────────────────────────────────────────────────

/** Enum values per event type (D-07: OPEN→enter, CLOSE→exit, ROLL→roll). */
export const ENTER_OPTIONS: ReadonlyArray<string> = enterRuleTag.options;
export const EXIT_OPTIONS: ReadonlyArray<string> = exitRuleTag.options;
export const ROLL_OPTIONS: ReadonlyArray<string> = rollRuleTag.options;

/** Title-case human-readable chip/pill labels (20-UI-SPEC Copywriting Contract). */
export const RULE_TAG_LABELS: Readonly<Record<string, string>> = {
  "iv-skew-favorable": "IV skew favorable",
  "term-structure-edge": "Term-structure edge",
  "event-window-play": "Event-window play",
  "gex-fit": "GEX fit",
  "profit-target": "Profit target",
  "max-loss": "Max loss",
  "time-stop": "Time stop",
  "thesis-invalidated": "Thesis invalidated",
  "defend-tested-side": "Defend tested side",
  "roll-for-duration": "Roll for duration",
  other: "Other",
};

export function tagLabel(tag: string): string {
  return RULE_TAG_LABELS[tag] ?? tag;
}

/**
 * RuleTagChips — the multi-select toggle-chip row for ONE calendar event (D-14: list-shaped,
 * multi-select). Non-optimistic (T-20-17): a chip's `active` prop is derived purely from
 * `activeTags` (server-confirmed) — clicking never flips it locally before `onSave` resolves.
 *
 * OTHER (D-21): activating it only reveals the required inline note — no save is attempted
 * until the note is confirmed (blur/Enter) with non-empty content; deactivating it needs no
 * note and saves immediately.
 */
export function RuleTagChips({
  fillIdsHash,
  options,
  activeTags,
  otherNote,
  error,
  onSave,
  onRetry,
}: {
  fillIdsHash: string;
  options: ReadonlyArray<string>;
  activeTags: ReadonlyArray<string>;
  otherNote: string | null;
  error: string | undefined;
  onSave: (tags: ReadonlyArray<string>, otherNote?: string) => void;
  onRetry: () => void;
}): React.ReactElement {
  const [pendingOther, setPendingOther] = useState(activeTags.includes("other"));
  const [noteDraft, setNoteDraft] = useState(otherNote ?? "");
  const [noteError, setNoteError] = useState(false);

  const showOtherInput = activeTags.includes("other") || pendingOther;

  function confirmNote(): void {
    if (noteDraft.trim().length === 0) {
      setNoteError(true);
      return;
    }
    setNoteError(false);
    const nextTags = activeTags.includes("other") ? activeTags : [...activeTags, "other"];
    onSave(nextTags, noteDraft);
  }

  function handleToggle(tag: string): void {
    const isActive = activeTags.includes(tag);
    const nextTags = isActive ? activeTags.filter((t) => t !== tag) : [...activeTags, tag];

    if (tag === "other") {
      if (isActive) {
        setPendingOther(false);
        setNoteError(false);
        onSave(nextTags);
      } else {
        setPendingOther(true);
      }
      return;
    }

    if (nextTags.includes("other")) {
      if (noteDraft.trim().length === 0) {
        setNoteError(true);
        return;
      }
      onSave(nextTags, noteDraft);
      return;
    }

    onSave(nextTags);
  }

  return (
    <div className="flex flex-col gap-1">
      <div className="flex flex-wrap gap-1" data-fill-ids-hash={fillIdsHash}>
        {options.map((tag) => (
          <Button
            key={tag}
            variant="toggle"
            tone="violet"
            size="xs"
            active={activeTags.includes(tag)}
            onClick={() => {
              handleToggle(tag);
            }}
          >
            {tagLabel(tag)}
          </Button>
        ))}
      </div>

      {showOtherInput && (
        <div className="flex flex-col gap-0.5">
          <input
            type="text"
            value={noteDraft}
            placeholder={'Note for "Other"…'}
            onChange={(e) => {
              setNoteDraft(e.target.value);
            }}
            onBlur={confirmNote}
            onKeyDown={(e) => {
              if (e.key === "Enter") confirmNote();
            }}
            className="box-border w-full rounded-md border border-line2 bg-panel2 px-2 py-1 font-mono text-[10px] text-txt"
          />
          {noteError && (
            <span className="font-mono text-[10px] text-down">
              Add a short note for &quot;Other.&quot;
            </span>
          )}
        </div>
      )}

      {error !== undefined && (
        <div className="flex items-center gap-1.5">
          <span className="font-mono text-[10px] text-down">{error}</span>
          <Button
            size="xs"
            onClick={() => {
              onRetry();
            }}
          >
            Retry
          </Button>
        </div>
      )}
    </div>
  );
}

// ─── Sub-components ───────────────────────────────────────────────────────────

/** Dashed-border placeholder box shared by the pre-history and too-new honest states. */
export function DashedStub({
  ariaLabel,
  heading,
  sub,
}: {
  ariaLabel: string;
  heading: string;
  sub: string;
}): React.ReactElement {
  return (
    <div
      className="flex min-h-[200px] flex-col items-center justify-center gap-2 rounded-lg border border-dashed border-line2 p-4 text-center font-mono text-[11px] text-dim"
      aria-label={ariaLabel}
    >
      <span>{heading}</span>
      <span className="text-[10px] text-faint">{sub}</span>
    </div>
  );
}

/** Pre-Jun-12 graceful stub — dashed border placeholder (JOURNAL-01), unchanged copy. */
export function PreHistoryStub(): React.ReactElement {
  return (
    <DashedStub
      ariaLabel="no day-by-day (pre Jun-12)"
      heading="no day-by-day (pre Jun-12)"
      sub="Chain history starts 2026-06-12. Only entry and exit events are available for this trade."
    />
  );
}

/** Too-new stub (0-1 usable snapshots, NOT pre-history) — new copy variant per D-05. */
export function BuildingLifecycleStub(): React.ReactElement {
  return (
    <DashedStub
      ariaLabel="Building the lifecycle"
      heading="Building the lifecycle."
      sub="Check back after the next snapshot — captured every 30 minutes during RTH."
    />
  );
}

// ─── Model hook ─────────────────────────────────────────────────────────────

/** Everything the Journal trees consume — the single source of state/derivation (D-04). */
export interface JournalModel {
  readonly openTrades: ReadonlyArray<TradeSummary>;
  readonly closedTrades: ReadonlyArray<TradeSummary>;
  readonly selectedId: string | null;
  readonly setSelectedId: (id: string) => void;
  readonly selectedTrade: TradeSummary | null;
  /** History (closed trades) open state — auto-open when there are no open trades. */
  readonly historyOpen: boolean;
  readonly toggleHistory: () => void;
  readonly hoveredIndex: number | null;
  readonly setHoveredIndex: (index: number | null) => void;
  readonly snapshots: LifecycleResponse["snapshots"];
  readonly isPending: boolean;
  readonly isError: boolean;
  readonly refetch: ReturnType<typeof useLifecycle>["refetch"];
  readonly ruleEvents: ReadonlyArray<EventWithRulesEntry>;
  readonly rulesPending: boolean;
  readonly ruleErrors: Readonly<Record<string, string>>;
  readonly saveRuleTags: UseRuleTagsResult["save"];
  readonly retryRuleTags: UseRuleTagsResult["retry"];
  readonly openEvent: EventWithRulesEntry | undefined;
  readonly closeEvent: EventWithRulesEntry | undefined;
  readonly rollEvents: ReadonlyArray<EventWithRulesEntry>;
  readonly selectedTradeTagLabels: ReadonlyArray<string>;
  readonly beats: ReadonlyArray<Beat>;
}

export function useJournalModel(trades: ReadonlyArray<TradeSummary>): JournalModel {
  // Open trades first (the "what's going on now" view); closed trades fold into History.
  const openTrades = trades.filter((t) => t.closedAt === null);
  const closedTrades = trades.filter((t) => t.closedAt !== null);

  // Default-select the first open trade (falls back to the first trade of any kind).
  const [selectedId, setSelectedId] = useState<string | null>(
    openTrades[0]?.id ?? trades[0]?.id ?? null,
  );

  // History (closed trades) is collapsed by default, but auto-expands when there are no
  // open trades — the closed list is then the only thing to show. `historyOverride` holds
  // the user's explicit toggle once clicked; until then it tracks the open-trade count,
  // which stays correct even as `trades` arrives async after an empty first render.
  const [historyOverride, setHistoryOverride] = useState<boolean | null>(null);
  const historyOpen = historyOverride ?? (openTrades.length === 0);
  const toggleHistory = (): void => {
    setHistoryOverride(!historyOpen);
  };

  const selectedTrade = trades.find((t) => t.id === selectedId) ?? trades[0] ?? null;

  // Shared crosshair state: fed by LifecycleChart.onCrosshairChange (center), consumed by
  // PnlBridgeCard (rail) so hovering the hero chart re-renders the bridge "as of {day}".
  const [hoveredIndex, setHoveredIndex] = useState<number | null>(null);

  const {
    data,
    isPending,
    isError,
    refetch,
  } = useLifecycle(selectedTrade?.calendarId ?? "");

  const {
    events: ruleEvents,
    isPending: rulesPending,
    errors: ruleErrors,
    save: saveRuleTags,
    retry: retryRuleTags,
  } = useRuleTags(selectedTrade?.calendarId ?? "");

  const snapshots: LifecycleResponse["snapshots"] = data?.snapshots ?? [];

  const openEvent = ruleEvents.find((e) => e.eventType === "OPEN");
  const closeEvent = ruleEvents.find((e) => e.eventType === "CLOSE");
  const rollEvents = ruleEvents.filter((e) => e.eventType === "ROLL");

  // D-22: aggregate all recorded tags across the selected trade's events, for the
  // trade-list read-view pill (comma-joined, truncated — neutral, not violet).
  const selectedTradeTagLabels = Array.from(
    new Set(ruleEvents.flatMap((e: EventWithRulesEntry) => e.tags)),
  ).map(tagLabel);

  // "The beats" (BeatsCard, rail): entry (openedAt) → event-move snapshots → close
  // (closedAt, when closed). Never fabricated — an empty selection yields no beats.
  const beats: ReadonlyArray<Beat> =
    selectedTrade === null
      ? []
      : [
          { date: fmtDate(selectedTrade.openedAt), kind: "entry", label: "Entered the trade." },
          ...snapshots
            .filter((s) => s.trigger === "event-move")
            .map((s) => ({
              date: fmtSnapTime(s.time),
              kind: "event" as const,
              label: `Event-driven move — net P&L ${fmtPnl(s.pnlOpen)}.`,
            })),
          ...(selectedTrade.closedAt !== null
            ? [
                {
                  date: fmtDate(selectedTrade.closedAt),
                  kind: "close" as const,
                  label: `Closed — ${fmtPnl(selectedTrade.realizedPnl)}.`,
                },
              ]
            : []),
        ];

  return {
    openTrades,
    closedTrades,
    selectedId,
    setSelectedId,
    selectedTrade,
    historyOpen,
    toggleHistory,
    hoveredIndex,
    setHoveredIndex,
    snapshots,
    isPending,
    isError,
    refetch,
    ruleEvents,
    rulesPending,
    ruleErrors,
    saveRuleTags,
    retryRuleTags,
    openEvent,
    closeEvent,
    rollEvents,
    selectedTradeTagLabels,
    beats,
  };
}
