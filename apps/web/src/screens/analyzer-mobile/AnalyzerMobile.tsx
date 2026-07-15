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
import {
  CandidateTable,
  cycleSort,
  sortCandidates,
  DEFAULT_CANDIDATE_SORT,
} from "../../components/picker/CandidateTable.tsx";
import type { CandidateSortKey, CandidateSortState } from "../../components/picker/CandidateTable.tsx";
import { WhyPanel } from "../../components/picker/WhyPanel.tsx";
import { TermStructureChart } from "../../components/picker/TermStructureChart.tsx";
import { EntryExitPlan } from "../../components/picker/EntryExitPlan.tsx";
import { Button, SectionLabel } from "../../components/system/index.tsx";
import { MobileScorecard } from "./MobileScorecard.tsx";
import { MobileAnalyzerChart } from "./MobileAnalyzerChart.tsx";
import { useAnalyzerModel, PASTED_NOT_SCORED_NOTE } from "./useAnalyzerModel.ts";

/**
 * Disclosure — a closed-by-default native `<details>` whose body mounts ONLY when the real `open`
 * attribute is set (catch #24: the content is React-gated on the toggle event, never CSS-revealed
 * behind a closed disclosure). Summary styled per the Typography table (10px tracked uppercase).
 */
function Disclosure({
  summary,
  children,
}: {
  readonly summary: string;
  readonly children: React.ReactNode;
}): React.ReactElement {
  // Controlled: React owns the real `open` attribute (never a CSS reveal — catch #24). The
  // summary's default toggle is cancelled so the state is the single source (synchronous, so the
  // body mounts the instant the user opens it — jsdom fires the native `toggle` event async).
  const [open, setOpen] = useState(false);
  return (
    <details className="group border-t border-line/40" open={open}>
      <summary
        onClick={(e) => {
          e.preventDefault();
          setOpen((v) => !v);
        }}
        className="flex min-h-11 cursor-pointer list-none items-center gap-1.5 py-3 font-display text-[10px] font-semibold tracking-[0.09em] text-muted-foreground uppercase [&::-webkit-details-marker]:hidden"
      >
        <span aria-hidden className="transition-transform group-open:rotate-90">
          ▸
        </span>
        <span>{summary}</span>
      </summary>
      {open && <div className="pb-3">{children}</div>}
    </details>
  );
}

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
    bounds,
    dateControl,
    toggles,
    handleToggle,
    payoffDomain,
    scenarioResult,
    spot,
    liveBadgeProps,
    bookCount,
    bookDebit,
    bookTheta,
    bookVega,
    positionSetSignature,
    repull,
  } = useAnalyzerModel();

  // Table sort state — local to this view (mirrors AnalyzerDesktop; 2026-07-14 user lock:
  // the ranked table replaces the phase-36 card stack on mobile, horizontal scroll OK).
  const [sort, setSort] = useState<CandidateSortState>(DEFAULT_CANDIDATE_SORT);
  const handleSortChange = (key: CandidateSortKey): void => {
    setSort((prev) => cycleSort(prev, key));
  };

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
    // The ranked table (2026-07-14 user lock, replacing the phase-36 card stack): every scored
    // row renders — the table scrolls horizontally inside its own wrapper (never the page) and
    // vertically past ~7 rows, matching the desktop rail's TOS idiom.
    candidatesBody = (
      <div className="flex flex-col gap-2">
        <CandidateTable
          candidates={sortCandidates(sortedCandidates, sort)}
          pastedCandidates={pastedCandidates}
          selectedId={selectedId}
          combinedIds={combinedIds}
          sort={sort}
          onSortChange={handleSortChange}
          onSelect={handleSelect}
          onToggleCombine={handleToggleCombine}
          onRemovePasted={handleRemovePasted}
          wrapperClassName="-mx-4 max-h-[318px] overflow-x-auto overflow-y-auto px-4"
          tableClassName="min-w-[640px]"
          wrapperTestId="mobile-candidate-table-scroll"
        />
        {sortedCandidates.length > 0 && (
          <p className="font-mono text-[9px] leading-[1.5] text-dim" data-testid="rail-legend">
            {"θ = daily $ decay · vega = $ per vol-pt · "}
            <span className="text-amber">◂f</span>
            {"/"}
            <span className="text-amber">◂b</span>
            {" = event on front / back leg"}
          </p>
        )}
        {selected !== null && (
          <Button
            variant="toggle"
            tone="up"
            size="touch"
            active={copiedId === selected.id}
            data-testid="copy-tos-order"
            onClick={() => {
              handleCopyCandidate(selected);
            }}
            title="Copy this calendar as a Thinkorswim order"
          >
            {copiedId === selected.id ? "Copied ✓" : "⧉ Copy TOS order"}
          </Button>
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

      {/* ── Chart block (D-09) — one chrome row + full-bleed PayoffChart + caption.
          Gated on snapshot: without it, spot is the 0 fallback and the chart would price
          the book at S=0 with fabricated provenance (review WR-01, catch #26). ── */}
      {selected !== null && scenarioResult !== null && snapshot !== null && (
        <MobileAnalyzerChart
          selected={selected}
          scenarioResult={scenarioResult}
          snapshot={snapshot}
          payoffDomain={payoffDomain}
          spot={spot}
          toggles={toggles}
          onToggle={handleToggle}
          dateControl={dateControl}
          bounds={bounds}
          positionSetSignature={positionSetSignature}
          liveBadgeProps={liveBadgeProps}
        />
      )}

      {/* ── Term/Why/Plan disclosures (D-10) — render whenever a candidate is selected (catch #23:
          never gated on scoring); a not-scored candidate shows the pasted-note inside each. ── */}
      {selected !== null && (
        <section className="px-4">
          <Disclosure summary="Term structure + your legs">
            {selected.breakdown.length === 0 ? (
              <p className="font-mono text-[10px] text-dim">{PASTED_NOT_SCORED_NOTE}</p>
            ) : (
              snapshot !== null && (
                <TermStructureChart
                  termStructure={snapshot.termStructure}
                  events={snapshot.events}
                  asOf={snapshot.asOf}
                  candidate={selected}
                />
              )
            )}
          </Disclosure>
          <Disclosure summary="Why this calendar">
            {selected.breakdown.length === 0 ? (
              <p className="font-mono text-[10px] text-dim">{PASTED_NOT_SCORED_NOTE}</p>
            ) : (
              snapshot !== null && <WhyPanel candidate={selected} gex={snapshot.gex} />
            )}
          </Disclosure>
          <Disclosure summary="Entry / exit plan">
            {selected.breakdown.length === 0 ? (
              <p className="font-mono text-[10px] text-dim">{PASTED_NOT_SCORED_NOTE}</p>
            ) : (
              <EntryExitPlan candidate={selected} sizing={snapshot?.sizing ?? null} />
            )}
          </Disclosure>
        </section>
      )}
    </div>
  );
}
