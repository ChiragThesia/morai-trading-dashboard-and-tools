/**
 * AnalyzerMobile — the dedicated mobile Analyzer tree (Phase 36, D-06/D-07/D-18).
 *
 * The screen's flow follows the CONTEXT-locked order (D-06): the paste/Analyze row first (the
 * screen's verb), then candidates, then the scorecard verdict hero, then — in plan 36-03 — the
 * full-bleed chart block and the term/why/plan disclosures. No `Panel` wrappers anywhere in this
 * tree (ground truth §Analyzer-1): the five rail states render as BARE prompts, and the candidates
 * fold behind a real `aria-expanded` toggle (Journal's history-toggle idiom — catch #24, never a
 * CSS reveal). All state/derivation comes from the shared `useAnalyzerModel()` (D-02).
 *
 * Root owns no horizontal padding (sections own `px-4`; the chart section owns `px-0`).
 *
 * No any/as/!.
 */
import { useState } from "react";
import { cn } from "@/lib/utils";
import { CandidateCard } from "../../components/picker/CandidateCard.tsx";
import { Button, SectionLabel } from "../../components/system/index.tsx";
import { MobileScorecard } from "./MobileScorecard.tsx";
import { useAnalyzerModel } from "./useAnalyzerModel.ts";

export function AnalyzerMobile(): React.ReactElement {
  const {
    snapshot,
    isLoading,
    isError,
    refetch,
    sortedCandidates,
    pastedCandidates,
    pasteText,
    setPasteText,
    pasteError,
    handlePasteAnalyze,
    handleRemovePasted,
    handleClearAllPasted,
    selected,
    selectedId,
    handleSelect,
    combinedIds,
    handleToggleCombine,
    copiedId,
    handleCopyCandidate,
    bookCount,
    bookDebit,
    bookTheta,
    bookVega,
    repull,
  } = useAnalyzerModel();

  // The rest of the scored rail beyond the top 3 folds behind a real aria-expanded toggle
  // (D-07 / catch #24 — React state, never a CSS reveal).
  const [showAllCandidates, setShowAllCandidates] = useState(false);

  // Re-pull chains control — same testids/strings/behavior as the desktop rail heading action.
  const repullControl = (
    <div className="flex items-center gap-1.5">
      {repull.isSuccess && (
        <span className="font-mono text-[9px] text-dim" data-testid="repull-status">
          queued · ~4 min
        </span>
      )}
      {repull.isError && (
        <span className="font-mono text-[9px] text-down" data-testid="repull-status">
          failed
        </span>
      )}
      <Button
        variant="ghost"
        onClick={() => {
          repull.mutate();
        }}
        disabled={repull.isPending}
        data-testid="repull-chains-button"
        title="Fetch fresh chains and re-score the rail (runs the full pipeline, ~4 min)"
      >
        {repull.isPending ? "Queuing…" : "↻ Re-pull"}
      </Button>
    </div>
  );

  // ── Candidates body: five mutually-exclusive states (bare prompts, no Panel), precedence
  // loading → error → cold-start → zero-filtered → populated. ──
  let candidatesBody: React.ReactElement;
  if (isLoading) {
    candidatesBody = (
      <p className="font-mono text-[10px] text-dim" data-testid="picker-loading">
        Loading candidates…
      </p>
    );
  } else if (isError) {
    candidatesBody = (
      <div className="flex flex-col items-start gap-2" data-testid="picker-error">
        <p className="m-0 font-mono text-[12px] text-down">Couldn&apos;t load candidates.</p>
        <Button
          onClick={() => {
            void refetch();
          }}
        >
          Retry
        </Button>
      </div>
    );
  } else if (snapshot === null) {
    candidatesBody = (
      <div className="flex flex-col gap-1.5" data-testid="picker-empty-cold-start">
        <p className="m-0 font-display text-sm font-bold text-txt">Picker warming up</p>
        <p className="m-0 font-mono text-[11px] text-dim">
          First scoring run pending — check back after the next chain snapshot.
        </p>
      </div>
    );
  } else if (sortedCandidates.length === 0 && pastedCandidates.length === 0) {
    candidatesBody = (
      <div className="flex flex-col gap-1.5" data-testid="picker-empty-filtered">
        <p className="m-0 font-display text-sm font-bold text-txt">No candidates in this snapshot</p>
        <p className="m-0 font-mono text-[11px] text-dim">
          {`No put calendars meet net-θ>0 over the ${snapshot.asOf} snapshot.`}
        </p>
      </div>
    );
  } else {
    const topScored = sortedCandidates.slice(0, 3);
    const restScored = sortedCandidates.slice(3);
    candidatesBody = (
      <div className="flex flex-col gap-2">
        {pastedCandidates.map((candidate) => (
          <CandidateCard
            key={candidate.id}
            candidate={candidate}
            pasted
            selected={candidate.id === selectedId}
            combined={combinedIds.has(candidate.id)}
            copied={candidate.id === copiedId}
            observedAt={snapshot.observedAt}
            source={snapshot.source}
            gexContextStatus={snapshot.gexContextStatus}
            eventsContextStatus={snapshot.eventsContextStatus}
            onSelect={handleSelect}
            onToggleCombine={handleToggleCombine}
            onCopy={handleCopyCandidate}
            onRemove={handleRemovePasted}
          />
        ))}
        {topScored.map((candidate) => (
          <CandidateCard
            key={candidate.id}
            candidate={candidate}
            selected={candidate.id === selectedId}
            combined={combinedIds.has(candidate.id)}
            copied={candidate.id === copiedId}
            observedAt={snapshot.observedAt}
            source={snapshot.source}
            gexContextStatus={snapshot.gexContextStatus}
            eventsContextStatus={snapshot.eventsContextStatus}
            onSelect={handleSelect}
            onToggleCombine={handleToggleCombine}
            onCopy={handleCopyCandidate}
          />
        ))}
        {restScored.length > 0 && (
          <button
            type="button"
            aria-expanded={showAllCandidates}
            data-testid="all-candidates-toggle"
            onClick={() => {
              setShowAllCandidates((v) => !v);
            }}
            className="flex w-full items-center gap-1.5 rounded-md px-[9px] py-[6px] font-mono text-[10px] tracking-wide text-dim hover:text-txt"
          >
            {showAllCandidates ? "▾" : "▸"} All candidates ({restScored.length})
          </button>
        )}
        {showAllCandidates &&
          restScored.map((candidate) => (
            <CandidateCard
              key={candidate.id}
              candidate={candidate}
              selected={candidate.id === selectedId}
              combined={combinedIds.has(candidate.id)}
              copied={candidate.id === copiedId}
              observedAt={snapshot.observedAt}
              source={snapshot.source}
              gexContextStatus={snapshot.gexContextStatus}
              eventsContextStatus={snapshot.eventsContextStatus}
              onSelect={handleSelect}
              onToggleCombine={handleToggleCombine}
              onCopy={handleCopyCandidate}
            />
          ))}
        {sortedCandidates.length > 0 && (
          <p className="font-mono text-[9px] leading-[1.5] text-dim" data-testid="rail-legend">
            {"θ = daily $ decay · vega = $ per vol-pt · "}
            <span className="text-amber">◂f</span>
            {"/"}
            <span className="text-amber">◂b</span>
            {" = event on front / back leg · bars = scored factors (higher = better)"}
          </p>
        )}
      </div>
    );
  }

  return (
    <div data-testid="analyzer-mobile-root" className="flex flex-col gap-6 pb-10 pt-4">
      {/* ── Paste block (the screen's verb, first — D-06/D-18). ── */}
      <section className="px-4">
        <div className="flex items-center gap-2">
          <input
            type="text"
            data-testid="picker-paste-input"
            value={pasteText}
            onChange={(e) => {
              setPasteText(e.target.value);
            }}
            placeholder="Paste a TOS calendar order…"
            className="min-h-11 min-w-0 flex-1 rounded-[3px] border border-line2 bg-transparent px-2 font-mono text-base text-txt"
          />
          <Button
            variant="primary"
            size="touch"
            data-testid="picker-paste-analyze"
            onClick={handlePasteAnalyze}
          >
            Analyze
          </Button>
        </div>
        {pasteError !== null && (
          <p data-testid="picker-paste-error" className="mt-1.5 font-mono text-[9px] text-down">
            {pasteError}
          </p>
        )}
      </section>

      {/* ── Candidates (D-07): SectionLabel + Clear-all/Re-pull actions, then the rail states. ── */}
      <section className="px-4">
        <div className="mb-2 flex items-center justify-between gap-2">
          <SectionLabel>Candidates</SectionLabel>
          <div className="flex gap-1.5">
            {pastedCandidates.length > 0 && (
              <Button variant="ghost" data-testid="picker-paste-clear-all" onClick={handleClearAllPasted}>
                Clear all
              </Button>
            )}
            {repullControl}
          </div>
        </div>
        {candidatesBody}
      </section>

      {/* ── Scorecard verdict hero (D-08) — renders nothing when no candidate is selected. ── */}
      <MobileScorecard
        candidate={selected}
        ruleSet={snapshot?.ruleSet ?? []}
        gateDrops={snapshot?.gateDrops ?? { liquidity: 0, netTheta: 0 }}
        marketSession={snapshot?.marketSession ?? "rth"}
        bookCount={bookCount}
        bookDebit={bookDebit}
        bookTheta={bookTheta}
        bookVega={bookVega}
      />

      {/* Chart block + term/why/plan disclosures land in plan 36-03 (D-09/D-10). */}
    </div>
  );
}
