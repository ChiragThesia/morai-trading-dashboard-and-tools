/**
 * Journal screen — trade lifecycle + per-calendar rebuild (JOURNAL-01 + REBUILD-01 + JRNL-01)
 *
 * UI-SPEC "Journal screen" 3-column layout:
 *   Left  (250px) — trade list: sorted newest-open-first, then closed reverse-chron.
 *                   history/entry-exit/OPEN badges; selected row = violet border.
 *   Center (1fr)  — lifecycle: LifecycleMasthead (verdict headline + read + net P&L) +
 *                   the D-08 stacked-panel LifecycleChart (for history trades) OR dashed
 *                   pre-history stub + "no day-by-day (pre Jun-12)" (for entry/exit-only)
 *                   OR "Building the lifecycle." (too-new) OR an error state + Retry.
 *                   RebuildButton and the always-visible honest-caveats footer are present.
 *   Right (290px) — reactive rail: P&L bridge (crosshair-synced) → the edge → greeks · now
 *                   → the beats → relocated Notes (RULE-01, unchanged).
 *
 * Data: useLifecycle(calendarId) per selected trade (60s poll, parse via lifecycleResponse).
 * Empty state: locked "No journal history yet…" copy (JOURNAL-01).
 * Pre-Jun-12 trades: graceful stub — NEVER error, NEVER blank (JOURNAL-01 invariant).
 * Rebuild: RebuildButton triggers POST /api/jobs/rebuild-journal/trigger (REBUILD-01).
 *
 * No seed data. Loading = locked copy / skeleton. No `any`/`as`/`!`.
 */

import { useState } from "react";
import { enterRuleTag, exitRuleTag, rollRuleTag } from "@morai/core";
import { classifyTradeHistory } from "../lib/journal-history.ts";
import { useLifecycle } from "../hooks/useLifecycle.ts";
import { useRuleTags } from "../hooks/useRuleTags.ts";
import { LifecycleChart } from "../components/LifecycleChart.tsx";
import { LifecycleMasthead } from "../components/LifecycleMasthead.tsx";
import { PnlBridgeCard } from "../components/PnlBridgeCard.tsx";
import { EdgeCard } from "../components/EdgeCard.tsx";
import { GreeksNowCard } from "../components/GreeksNowCard.tsx";
import { BeatsCard } from "../components/BeatsCard.tsx";
import type { Beat } from "../components/BeatsCard.tsx";
import { RebuildButton } from "../components/RebuildButton.tsx";
import { Panel, PanelHeading, SectionLabel, Button } from "../components/system/index.tsx";
import type { EventWithRulesEntry, LifecycleResponse } from "@morai/contracts";

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

/** Dashed-border placeholder box shared by the pre-history and too-new honest states. */
function DashedStub({
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
function PreHistoryStub(): React.ReactElement {
  return (
    <DashedStub
      ariaLabel="no day-by-day (pre Jun-12)"
      heading="no day-by-day (pre Jun-12)"
      sub="Chain history starts 2026-06-12. Only entry and exit events are available for this trade."
    />
  );
}

/** Too-new stub (0-1 usable snapshots, NOT pre-history) — new copy variant per D-05. */
function BuildingLifecycleStub(): React.ReactElement {
  return (
    <DashedStub
      ariaLabel="Building the lifecycle"
      heading="Building the lifecycle."
      sub="Check back after the next snapshot — captured every 30 minutes during RTH."
    />
  );
}

/** Center column lifecycle section for a selected trade */
function LifecycleSection({
  trade,
  snapshots,
  isPending,
  isError,
  onRetry,
  onCrosshairChange,
}: {
  trade: TradeSummary;
  snapshots: LifecycleResponse["snapshots"];
  isPending: boolean;
  isError: boolean;
  onRetry: () => void;
  onCrosshairChange: (index: number | null) => void;
}): React.ReactElement {
  const kind = classifyTradeHistory({
    openedAt: trade.openedAt,
    closedAt: trade.closedAt,
    hasSnapshots: snapshots.length > 0,
  });

  const eyebrow = `${trade.name} · ${fmtDate(trade.openedAt)}${
    trade.closedAt !== null ? ` → ${fmtDate(trade.closedAt)}` : " (open)"
  }`;

  return (
    <div className="flex flex-col gap-3">
      {!isPending && !isError && kind === "history" && (
        <LifecycleMasthead snapshots={snapshots} eyebrow={eyebrow} />
      )}

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

        {!isPending && isError && (
          <div className="flex min-h-[200px] flex-1 flex-col items-center justify-center gap-2 p-4 text-center font-mono text-[11px] text-dim">
            <span>Couldn&apos;t load this calendar&apos;s lifecycle.</span>
            <Button
              variant="secondary"
              size="xs"
              onClick={() => {
                onRetry();
              }}
            >
              Retry
            </Button>
          </div>
        )}

        {!isPending && !isError && kind === "entry-exit-only" && <PreHistoryStub />}

        {!isPending && !isError && kind === "history" && snapshots.length > 1 && (
          <LifecycleChart snapshots={snapshots} onCrosshairChange={onCrosshairChange} />
        )}

        {!isPending && !isError && kind === "history" && snapshots.length <= 1 && (
          <BuildingLifecycleStub />
        )}
      </Panel>

      {/* Honest-caveats footer (always visible, not dismissible — D-05) */}
      <div className="flex flex-col gap-1 px-1 font-mono text-[9.5px] leading-[1.3] text-dim">
        <span>
          Attribution is a 2nd-order approximation — the faint residual band is the
          unexplained part, never hidden.
        </span>
        <span>
          Line breaks are real feed gaps (spot=0 / NaN), drawn as gaps, never interpolated.
        </span>
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
            isError={isError}
            onRetry={() => {
              void refetch();
            }}
            onCrosshairChange={setHoveredIndex}
          />
        )}
      </div>

      {/* ── Right column — reactive rail + notes ──────────────────────────── */}
      <div className="flex min-h-0 flex-col gap-3 overflow-y-auto">
        <PnlBridgeCard snapshots={snapshots} hoveredIndex={hoveredIndex} />
        <EdgeCard snapshots={snapshots} />
        <GreeksNowCard snapshots={snapshots} />
        <BeatsCard beats={beats} />

        {/* Notes card (RULE-01) — relocated to the bottom of the rail, unchanged */}
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
