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
import { enterRuleTag, exitRuleTag, rollRuleTag } from "@morai/core";
import { classifyTradeHistory } from "../lib/journal-history.ts";
import { useJournal } from "../hooks/useJournal.ts";
import { useRuleTags } from "../hooks/useRuleTags.ts";
import { LifecycleChart } from "../components/LifecycleChart.tsx";
import { RebuildButton } from "../components/RebuildButton.tsx";
import { Panel, PanelHeading, SectionLabel, Button } from "../components/system/index.tsx";
import type { SnapshotResponse, EventWithRulesEntry } from "@morai/contracts";

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

/** The fainter right-aligned descriptor pill used in panel headings. */
function HeadingPill({ children }: { children: React.ReactNode }): React.ReactElement {
  return (
    <span className="rounded-full border border-line2 px-[7px] py-px text-[9px] text-dim">
      {children}
    </span>
  );
}

// ─── RULE-01: rule-tag control ─────────────────────────────────────────────────

/** Enum values per event type (D-07: OPEN→enter, CLOSE→exit, ROLL→roll). */
const ENTER_OPTIONS: ReadonlyArray<string> = enterRuleTag.options;
const EXIT_OPTIONS: ReadonlyArray<string> = exitRuleTag.options;
const ROLL_OPTIONS: ReadonlyArray<string> = rollRuleTag.options;

/** Title-case human-readable chip/pill labels (20-UI-SPEC Copywriting Contract). */
const RULE_TAG_LABELS: Readonly<Record<string, string>> = {
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

function tagLabel(tag: string): string {
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
function RuleTagChips({
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

/** Snapshot table rows (right column) */
function SnapshotTable({
  snapshots,
  selectedIndex,
}: {
  snapshots: ReadonlyArray<SnapshotResponse>;
  selectedIndex: number;
}): React.ReactElement {
  return (
    <table className="w-full border-collapse font-mono text-[10.5px] tabular-nums">
      <thead>
        <tr>
          {["Time", "SPX", "Net", "P&L", "Θ", "Vega"].map((col) => (
            <th
              key={col}
              className={`border-b border-panel2 px-[5px] py-1 text-[9px] font-medium uppercase text-dim ${
                col === "Time" ? "text-left" : "text-right"
              }`}
            >
              {col}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {snapshots.map((s, i) => {
          const pnl = parseFloat(s.pnlOpen);
          const pnlClass = pnl >= 0 ? "text-up" : "text-down";
          const isSelected = i === selectedIndex;

          return (
            <tr key={s.time} className={isSelected ? "bg-raise/27" : undefined}>
              <td className="border-b border-panel2 px-[5px] py-1 text-left text-txt">
                {fmtSnapTime(s.time)}
              </td>
              <td className="border-b border-panel2 px-[5px] py-1 text-right text-blue">
                {parseFloat(s.spot).toLocaleString()}
              </td>
              <td className="border-b border-panel2 px-[5px] py-1 text-right text-txt">
                {parseFloat(s.netMark).toFixed(2)}
              </td>
              <td className={`border-b border-panel2 px-[5px] py-1 text-right ${pnlClass}`}>
                {pnl >= 0 ? "+" : ""}${Math.abs(pnl).toFixed(2)}
              </td>
              <td className="border-b border-panel2 px-[5px] py-1 text-right text-amber">
                {parseFloat(s.netTheta).toFixed(1)}
              </td>
              <td className="border-b border-panel2 px-[5px] py-1 text-right text-up">
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
      className="flex min-h-[200px] flex-col items-center justify-center gap-2 rounded-lg border border-dashed border-line2 p-4 text-center font-mono text-[11px] text-dim"
      aria-label="no day-by-day (pre Jun-12)"
    >
      <span>no day-by-day (pre Jun-12)</span>
      <span className="text-[10px] text-faint">
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
  const pnlClass = pnlNum >= 0 ? "text-up" : "text-down";
  const isOpen = trade.closedAt === null;

  // KPI calculations from snapshots
  const pnlValues = snapshots.map((s) => parseFloat(s.pnlOpen));
  const maxFav = pnlValues.length > 0 ? Math.max(...pnlValues) : null;
  const maxAdv = pnlValues.length > 0 ? Math.min(...pnlValues) : null;

  return (
    <div className="flex flex-col gap-3">
      {/* Trade header card */}
      <Panel>
        <div className="mb-2.5 flex items-baseline gap-3">
          <div className="font-display text-base font-bold text-txt">
            {trade.name}
          </div>
          <div className="font-mono text-[11px] text-dim">
            {fmtDate(trade.openedAt)}
            {!isOpen ? ` → ${fmtDate(trade.closedAt ?? "")}` : " (open)"}
          </div>
          <div
            className={`ml-auto font-display text-lg font-bold ${
              isOpen ? "text-blue" : pnlClass
            }`}
          >
            {isOpen ? "open" : fmtPnl(trade.realizedPnl)}
          </div>
        </div>

        {/* 3 KPIs */}
        <div className="grid grid-cols-3 gap-2">
          <div className="rounded-md border border-line bg-panel2 px-[9px] py-2">
            <div className="text-[9px] uppercase tracking-[0.5px] text-dim">
              Realized
            </div>
            <div
              className={`mt-px font-display text-[15px] font-bold tabular-nums ${
                isOpen ? "text-blue" : pnlClass
              }`}
            >
              {isOpen ? "open" : fmtPnl(trade.realizedPnl)}
            </div>
          </div>

          <div className="rounded-md border border-line bg-panel2 px-[9px] py-2">
            <div className="text-[9px] uppercase tracking-[0.5px] text-dim">
              Max favorable
            </div>
            <div className="mt-px font-display text-[15px] font-bold tabular-nums text-up">
              {maxFav !== null ? `+$${maxFav.toFixed(2)}` : "—"}
            </div>
          </div>

          <div className="rounded-md border border-line bg-panel2 px-[9px] py-2">
            <div className="text-[9px] uppercase tracking-[0.5px] text-dim">
              Max adverse
            </div>
            <div className="mt-px font-display text-[15px] font-bold tabular-nums text-down">
              {maxAdv !== null ? `−$${Math.abs(maxAdv).toFixed(2)}` : "—"}
            </div>
          </div>
        </div>
      </Panel>

      {/* Lifecycle chart card */}
      <Panel className="flex min-h-[300px] flex-1 flex-col">
        <div className="mb-2 flex items-center justify-between">
          <div className="font-mono text-[10px] text-dim">
            {kind === "history" ? "30-min snapshots" : "entry/exit only"}
          </div>
          <RebuildButton calendarId={trade.calendarId} />
        </div>

        {isPending && (
          <div
            className="min-h-[200px] flex-1 rounded-md bg-line opacity-40"
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
          <div className="p-4 text-center text-[11px] text-dim">
            No snapshots yet. Snapshots are captured every 30 minutes during RTH.
          </div>
        )}
      </Panel>
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

  const {
    events: ruleEvents,
    isPending: rulesPending,
    errors: ruleErrors,
    save: saveRuleTags,
    retry: retryRuleTags,
  } = useRuleTags(selectedTrade?.calendarId ?? "");

  const snapshots: ReadonlyArray<SnapshotResponse> = data?.snapshots ?? [];

  const openEvent = ruleEvents.find((e) => e.eventType === "OPEN");
  const closeEvent = ruleEvents.find((e) => e.eventType === "CLOSE");
  const rollEvents = ruleEvents.filter((e) => e.eventType === "ROLL");

  // D-22: aggregate all recorded tags across the selected trade's events, for the
  // trade-list read-view pill (comma-joined, truncated — neutral, not violet).
  const selectedTradeTagLabels = Array.from(
    new Set(ruleEvents.flatMap((e: EventWithRulesEntry) => e.tags)),
  ).map(tagLabel);

  // ── Empty state ─────────────────────────────────────────────────────────────
  if (trades.length === 0) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-2 font-mono text-xs text-dim">
        <span>No journal history yet.</span>
        <span className="text-[10px]">Trades before Jun 12 have entry/exit only.</span>
      </div>
    );
  }

  return (
    <div className="grid h-full grid-cols-[250px_1fr_290px] gap-3 overflow-hidden p-3">
      {/* ── Left column — trade list ─────────────────────────────────────── */}
      <div className="flex min-h-0 flex-col gap-3 overflow-y-auto">
        <Panel>
          {/* Heading */}
          <PanelHeading
            title="Trades"
            action={<HeadingPill>SPXW put calendars</HeadingPill>}
          />

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
              const pnlClass = isOpen
                ? "text-blue"
                : pnlNum >= 0
                  ? "text-up"
                  : "text-down";

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
                  className={`mb-[5px] grid cursor-pointer grid-cols-[1fr_auto] gap-1.5 rounded-lg border px-[9px] py-[7px] ${
                    isSelected
                      ? "border-violet bg-violetd"
                      : "border-line bg-panel2"
                  }`}
                >
                  <div>
                    <div className="flex items-center gap-1 font-display text-xs text-txt">
                      {trade.name}
                      {isOpen && (
                        <span className="rounded-[3px] border border-cyan/30 px-[5px] text-[8px] text-cyan">
                          OPEN
                        </span>
                      )}
                    </div>
                    <div className="text-[9px] text-dim">
                      {fmtDate(trade.openedAt)}
                      {trade.closedAt !== null ? ` → ${fmtDate(trade.closedAt)}` : ""}
                    </div>
                  </div>

                  <div className="text-right">
                    <div
                      className={`font-display text-xs font-bold tabular-nums ${pnlClass}`}
                    >
                      {isOpen ? "open" : fmtPnl(trade.realizedPnl)}
                    </div>
                    {/* History badge */}
                    <div
                      className={`mt-[3px] inline-block rounded-[3px] border px-[5px] text-[8px] ${
                        kind === "history"
                          ? "border-cyan/30 text-cyan"
                          : "border-line2 text-dim"
                      }`}
                    >
                      {kind === "history" ? "history" : "entry/exit"}
                    </div>
                    {/* Rule-tag read-view pill (D-22) — only known for the selected trade
                        (useRuleTags fetches one calendar's tags at a time); neutral, not violet. */}
                    {isSelected && selectedTradeTagLabels.length > 0 && (
                      <div
                        data-testid="rule-tags-pill"
                        title={selectedTradeTagLabels.join(", ")}
                        className="mt-[3px] block max-w-[110px] truncate rounded-[3px] border border-line2 px-[5px] text-[8px] text-dim"
                      >
                        {selectedTradeTagLabels.join(", ")}
                      </div>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </Panel>
      </div>

      {/* ── Center column — lifecycle ─────────────────────────────────────── */}
      <div className="flex min-h-0 flex-col gap-3 overflow-y-auto">
        {selectedTrade !== null && (
          <LifecycleSection
            trade={selectedTrade}
            snapshots={snapshots}
            isPending={isPending}
          />
        )}
      </div>

      {/* ── Right column — snapshot table + notes ─────────────────────────── */}
      <div className="flex min-h-0 flex-col gap-3 overflow-y-auto">
        {/* Snapshot table card */}
        <Panel>
          <PanelHeading
            title="Lifecycle"
            action={<HeadingPill>per snapshot</HeadingPill>}
          />

          {snapshots.length > 0 ? (
            <SnapshotTable snapshots={snapshots} selectedIndex={snapshots.length - 1} />
          ) : (
            <div className="py-2 font-mono text-[10px] text-dim">
              {isPending ? "Loading…" : "No snapshots available."}
            </div>
          )}
        </Panel>

        {/* Why it moved card */}
        <Panel>
          <PanelHeading title="Why it moved" />
          <div className="rounded-md border border-line border-l-2 border-l-violet bg-panel2 px-[10px] py-2 font-mono text-[11px] leading-normal text-dim">
            {snapshots.length > 0
              ? "For a calendar the headline driver is vega split + theta. Check front vs back vega to understand which leg drove the move."
              : "Select a trade with chain history to see the attribution narrative."}
          </div>
        </Panel>

        {/* Notes card */}
        <Panel>
          <PanelHeading
            title="Notes"
            action={<HeadingPill>thesis · review</HeadingPill>}
          />

          {/* RULE-01: enter/exit/roll rule-tag control (D-07/D-10) — ABOVE the free-text
              textarea, which stays untouched. Editable anytime; no read-only lock. */}
          {!rulesPending && (
            <div className="mb-2 flex flex-col gap-2">
              {openEvent !== undefined && (
                <div className="flex flex-col gap-1">
                  <SectionLabel tone="dim">ENTER</SectionLabel>
                  <RuleTagChips
                    fillIdsHash={openEvent.fillIdsHash}
                    options={ENTER_OPTIONS}
                    activeTags={openEvent.tags}
                    otherNote={openEvent.otherNote}
                    error={ruleErrors[openEvent.fillIdsHash]}
                    onSave={(tags, otherNote) => {
                      void saveRuleTags(openEvent.fillIdsHash, tags, otherNote);
                    }}
                    onRetry={() => {
                      retryRuleTags(openEvent.fillIdsHash);
                    }}
                  />
                </div>
              )}

              <div className="flex flex-col gap-1">
                <SectionLabel tone="dim">EXIT</SectionLabel>
                {closeEvent === undefined ? (
                  <span className="font-mono text-[10px] text-dim">Available at close.</span>
                ) : (
                  <RuleTagChips
                    fillIdsHash={closeEvent.fillIdsHash}
                    options={EXIT_OPTIONS}
                    activeTags={closeEvent.tags}
                    otherNote={closeEvent.otherNote}
                    error={ruleErrors[closeEvent.fillIdsHash]}
                    onSave={(tags, otherNote) => {
                      void saveRuleTags(closeEvent.fillIdsHash, tags, otherNote);
                    }}
                    onRetry={() => {
                      retryRuleTags(closeEvent.fillIdsHash);
                    }}
                  />
                )}
              </div>

              {rollEvents.map((rollEvent) => (
                <div key={rollEvent.fillIdsHash} className="flex flex-col gap-1">
                  <div className="flex items-center gap-1.5">
                    <SectionLabel tone="dim">ROLL</SectionLabel>
                    <span className="font-mono text-[9px] text-dim">
                      {fmtDate(rollEvent.eventedAt)}
                    </span>
                  </div>
                  <RuleTagChips
                    fillIdsHash={rollEvent.fillIdsHash}
                    options={ROLL_OPTIONS}
                    activeTags={rollEvent.tags}
                    otherNote={rollEvent.otherNote}
                    error={ruleErrors[rollEvent.fillIdsHash]}
                    onSave={(tags, otherNote) => {
                      void saveRuleTags(rollEvent.fillIdsHash, tags, otherNote);
                    }}
                    onRetry={() => {
                      retryRuleTags(rollEvent.fillIdsHash);
                    }}
                  />
                </div>
              ))}
            </div>
          )}

          <textarea
            placeholder="Entry thesis, management, post-mortem…"
            className="box-border min-h-[60px] w-full resize-y rounded-md border border-line2 bg-panel2 p-2 font-mono text-[11px] text-txt"
          />
        </Panel>
      </div>
    </div>
  );
}
