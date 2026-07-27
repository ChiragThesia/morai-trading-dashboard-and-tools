/**
 * Analyzer — the option-chain DATA TABLE.
 *
 * The screen used to propose scored calendars. It does not any more (user,
 * 2026-07-26): "DO NOT ANALYZE or measure, just give me the data and then we can
 * determine how to auto surface best ones after." So the verdict hero, the WHY
 * column, the ranked candidate rail and every scoring helper are gone.
 *
 * What is here instead:
 *   1. An expiry-pair header — front/back selects, put/call switch, spot, the
 *      observation instant, and each expiry's 25Δ risk reversal.
 *   2. The chain table — one row per strike, horizontal skew, vertical skew,
 *      edge, debit and net greeks; click a row and both legs open in place.
 *   3. The risk profile — paste a TOS order and see its payoff. Survives from the
 *      old screen unchanged; it is the only part that was never about ranking.
 *
 * ONE TREE FOR ALL VIEWPORTS (Journal.tsx precedent). No `useIsDesktop` split, no
 * analyzer-mobile/. Responsiveness is the scroll wrapper plus a table min-width.
 * No column is dropped on a phone — this is a dense professional tool, so mobile
 * gets progressive disclosure, never fewer numbers.
 *
 * No any/as/!.
 */
import { useMemo, useState } from "react";
import { EventLegRibbon } from "../components/picker/EventLegRibbon.tsx";
import { Panel, PanelHeading, Button } from "../components/system/index.tsx";
import { PayoffChart } from "../components/charts/PayoffChart.tsx";
import { PayoffControls } from "../components/charts/PayoffControls.tsx";
import { LiveStatusBadge } from "../components/LiveStatusBadge.tsx";
import { ChainTable } from "../components/chain/ChainTable.tsx";
import { useChainModel } from "../hooks/useChainModel.ts";
import { useAnalyzerModel, TODAY_CURVE_COLOR, EXPIRATION_CURVE_COLOR } from "./useAnalyzerModel.ts";

const DASH = "—";

function noop(): void {}

// ─── Formatting ───────────────────────────────────────────────────────────────

const ET_STAMP = new Intl.DateTimeFormat("en-US", {
  timeZone: "America/New_York",
  month: "short",
  day: "numeric",
  hour: "numeric",
  minute: "2-digit",
});

/** ISO-Z instant → "Jul 26, 2:00 PM ET". Quotes are read in ET; never a sliced ISO. */
function formatObserved(iso: string | null): string {
  if (iso === null) return DASH;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return DASH;
  return `${ET_STAMP.format(d)} ET`;
}

/** 0.0184 → "+1.84" vol points. */
function volPts(v: number | null): string {
  return v === null ? DASH : `${v >= 0 ? "+" : ""}${(v * 100).toFixed(2)}`;
}

// ─── Header stat ──────────────────────────────────────────────────────────────

function HeaderStat({
  label,
  value,
  testId,
  className,
}: {
  readonly label: string;
  readonly value: string;
  readonly testId: string;
  readonly className?: string;
}): React.ReactElement {
  return (
    <div className="flex flex-col gap-0.5">
      <span className="font-display text-[9px] font-semibold tracking-[0.09em] text-fg-tertiary uppercase">
        {label}
      </span>
      <span
        data-testid={testId}
        className={`font-mono text-[12px] tabular-nums ${className ?? "text-fg-primary"}`}
      >
        {value}
      </span>
    </div>
  );
}

const SELECT_CLASS =
  "min-w-0 rounded-[3px] border border-line-strong bg-transparent px-2 py-1.5 font-mono text-[11px] text-fg-primary";

// ─── Screen ───────────────────────────────────────────────────────────────────

export function Analyzer(): React.ReactElement {
  const chain = useChainModel();
  const {
    snapshot,
    pastedCandidates,
    pasteText,
    setPasteText,
    pasteError,
    handlePasteAnalyze,
    pasteAnalyzing,
    handleRemovePasted,
    handleClearAllPasted,
    selected,
    handleSelect,
    combinedIds,
    handleToggleCombine,
    copiedId,
    handleCopyCandidate,
    selectedPosition,
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

  // Sort and row expansion are ChainTable's own state — it is self-contained, unlike the
  // candidate rail it replaced, which needed the screen to own sort so the score column
  // could drive it. There is no score column now, so there is nothing to lift.

  // Re-pull chains — refreshes the data this whole screen reads.
  const repullControl = (
    <div className="flex items-center gap-1.5">
      {repull.isSuccess && (
        <span className="font-mono text-[9px] text-fg-tertiary" data-testid="repull-status">
          queued · ~4 min
        </span>
      )}
      {repull.isError && (
        <span className="font-mono text-[9px] text-value-negative" data-testid="repull-status">
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
        title="Fetch fresh chains (runs the full pipeline, ~4 min)"
      >
        {repull.isPending ? "Queuing…" : "↻ Re-pull"}
      </Button>
    </div>
  );

  // ── Chain body: five mutually-exclusive states, precedence
  // loading → error → cold-start → empty (inside ChainTable) → populated. ──
  let chainBody: React.ReactElement;
  if (chain.isLoading) {
    chainBody = (
      <div
        className="flex items-center justify-center p-6 text-center font-mono text-[10px] text-fg-tertiary"
        data-testid="chain-loading"
      >
        Loading chain…
      </div>
    );
  } else if (chain.isError) {
    chainBody = (
      <div className="flex flex-col items-center gap-2 p-6 text-center" data-testid="chain-error">
        <p className="m-0 font-mono text-[12px] text-value-negative">Couldn&apos;t load the chain.</p>
        <Button
          onClick={() => {
            chain.refetch();
          }}
        >
          Retry
        </Button>
      </div>
    );
  } else if (chain.expirations.length === 0) {
    chainBody = (
      <div className="flex flex-col gap-1.5 p-6" data-testid="chain-cold-start">
        <p className="m-0 font-display text-sm font-bold text-fg-primary">Chain warming up</p>
        <p className="m-0 font-mono text-[11px] text-fg-tertiary">
          No snapshot yet — check back after the next chain pull.
        </p>
      </div>
    );
  } else if (chain.rows.length === 0) {
    // The chain HAS expiries, but no strike is quoted in both of the selected ones — so the
    // join is legitimately empty. Distinct from cold start (no snapshot at all): here the
    // fix is to pick a different pair, not to wait. Saying so beats an empty table, which
    // reads as a bug.
    chainBody = (
      <div className="flex flex-col gap-1.5 p-6" data-testid="chain-empty">
        <p className="m-0 font-display text-sm font-bold text-fg-primary">No overlapping strikes</p>
        <p className="m-0 font-mono text-[11px] text-fg-tertiary">
          No strike is quoted in both of the selected expiries. Try a different pair.
        </p>
      </div>
    );
  } else {
    chainBody = <ChainTable rows={chain.rows} />;
  }

  const hasPasted = pastedCandidates.length > 0;

  return (
    <div data-testid="analyzer-root" className="flex h-full flex-col gap-3 overflow-y-auto bg-surface-base p-3">
      {/* ── Chain ───────────────────────────────────────────────────────── */}
      <Panel>
        <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <PanelHeading title="Option chain" />
            <LiveStatusBadge {...liveBadgeProps} />
          </div>
          {repullControl}
        </div>

        {/* Expiry pair + side. Native selects — the OS picker is the best mobile
            control there is, and it costs nothing. */}
        <div className="mb-2 flex flex-wrap items-end gap-x-3 gap-y-2">
          <label className="flex flex-col gap-0.5">
            <span className="font-display text-[9px] font-semibold tracking-[0.09em] text-fg-tertiary uppercase">
              Front expiry
            </span>
            <select
              data-testid="chain-front-select"
              className={SELECT_CLASS}
              value={chain.frontExpiry ?? ""}
              onChange={(e) => {
                chain.setFrontExpiry(e.target.value);
              }}
            >
              {chain.expirations.map((e) => (
                <option key={e.expiration} value={e.expiration}>
                  {`${e.expiration} · ${e.dte}d`}
                </option>
              ))}
            </select>
          </label>

          <label className="flex flex-col gap-0.5">
            <span className="font-display text-[9px] font-semibold tracking-[0.09em] text-fg-tertiary uppercase">
              Back expiry
            </span>
            <select
              data-testid="chain-back-select"
              className={SELECT_CLASS}
              value={chain.backExpiry ?? ""}
              onChange={(e) => {
                chain.setBackExpiry(e.target.value);
              }}
            >
              {chain.expirations.map((e) => (
                <option key={e.expiration} value={e.expiration}>
                  {`${e.expiration} · ${e.dte}d`}
                </option>
              ))}
            </select>
          </label>

          <div className="flex items-center gap-1">
            <Button
              variant="toggle"
              active={chain.contractType === "P"}
              data-testid="chain-type-put"
              onClick={() => {
                chain.setContractType("P");
              }}
            >
              Puts
            </Button>
            <Button
              variant="toggle"
              active={chain.contractType === "C"}
              data-testid="chain-type-call"
              onClick={() => {
                chain.setContractType("C");
              }}
            >
              Calls
            </Button>
          </div>
        </div>

        {/* Provenance + the two expiry-level skew numbers. */}
        <div className="mb-2 flex flex-wrap gap-x-6 gap-y-2 border-t border-line-subtle pt-2">
          <HeaderStat
            label="Spot"
            testId="chain-spot"
            value={chain.spot === null ? DASH : chain.spot.toFixed(2)}
            className={chain.spot === null ? "text-fg-tertiary" : "text-fg-primary"}
          />
          <HeaderStat
            label="Observed"
            testId="chain-observed"
            value={formatObserved(chain.observedAt)}
            className={chain.observedAt === null ? "text-fg-tertiary" : "text-fg-secondary"}
          />
          <HeaderStat
            label="25Δ RR front"
            testId="chain-rr-front"
            value={volPts(chain.frontRr)}
            className={chain.frontRr === null ? "text-fg-tertiary" : "text-fg-primary"}
          />
          <HeaderStat
            label="25Δ RR back"
            testId="chain-rr-back"
            value={volPts(chain.backRr)}
            className={chain.backRr === null ? "text-fg-tertiary" : "text-fg-primary"}
          />
        </div>

        {chainBody}
      </Panel>

      {/* ── Risk profile ────────────────────────────────────────────────── */}
      <Panel>
        <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
          <PanelHeading title="Risk profile" />
          {selected !== null && (
            <div className="flex items-center gap-1.5">
              <Button
                variant="toggle"
                tone="amber"
                active={combinedIds.has(selected.id)}
                data-testid="detail-combine"
                onClick={() => {
                  handleToggleCombine(selected);
                }}
                title="Add this calendar to the combined-book payoff"
              >
                {combinedIds.has(selected.id) ? "✓ Combined" : "⊕ Combine"}
              </Button>
              <Button
                variant="toggle"
                tone="up"
                active={copiedId === selected.id}
                data-testid="copy-tos-order"
                onClick={() => {
                  handleCopyCandidate(selected);
                }}
                title="Copy this calendar as a Thinkorswim order"
              >
                {copiedId === selected.id ? "Copied ✓" : "⧉ Copy TOS order"}
              </Button>
            </div>
          )}
        </div>

        {/* Paste box — the screen's only verb now. */}
        <div className="mb-2 flex flex-wrap items-center gap-1.5">
          <input
            type="text"
            data-testid="picker-paste-input"
            value={pasteText}
            onChange={(e) => {
              setPasteText(e.target.value);
            }}
            placeholder="Paste a TOS calendar order…"
            className="min-w-0 flex-1 rounded-[3px] border border-line-strong bg-transparent px-3 py-2 font-mono text-[12px] text-fg-primary"
          />
          <Button
            variant="primary"
            size="sm"
            data-testid="picker-paste-analyze"
            disabled={pasteAnalyzing}
            onClick={handlePasteAnalyze}
          >
            {pasteAnalyzing ? "Analyzing…" : "Analyze"}
          </Button>
          {hasPasted && (
            <Button variant="ghost" data-testid="picker-paste-clear-all" onClick={handleClearAllPasted}>
              Clear all
            </Button>
          )}
        </div>
        {pasteError !== null && (
          <p data-testid="picker-paste-error" className="mb-2 font-mono text-[9px] text-value-negative">
            {pasteError}
          </p>
        )}

        {/* Pasted calendars — select one to chart it, ⊕ to add it to the book. */}
        {hasPasted && (
          <div data-testid="pasted-list" className="mb-2 flex flex-wrap items-center gap-1.5">
            {pastedCandidates.map((c) => (
              <span key={c.id} className="flex items-center gap-0.5">
                <Button
                  variant="toggle"
                  active={selected?.id === c.id}
                  data-testid={`pasted-row-${c.id}`}
                  onClick={() => {
                    handleSelect(c);
                  }}
                >
                  {c.name}
                </Button>
                <Button
                  variant="toggle"
                  tone="amber"
                  active={combinedIds.has(c.id)}
                  data-testid={`pasted-combine-${c.id}`}
                  title="Add to the combined-book payoff"
                  onClick={() => {
                    handleToggleCombine(c);
                  }}
                >
                  ⊕
                </Button>
                <Button
                  variant="ghost"
                  data-testid={`pasted-remove-${c.id}`}
                  title="Remove this pasted calendar"
                  onClick={() => {
                    handleRemovePasted(c);
                  }}
                >
                  ×
                </Button>
              </span>
            ))}
          </div>
        )}

        {selected === null ? (
          <p data-testid="payoff-empty" className="m-0 p-3 font-mono text-[11px] text-fg-tertiary">
            Paste a TOS calendar order to see its payoff. The table above is the chain, unfiltered
            and unranked.
          </p>
        ) : (
          <>
            <div className="mb-1.5 flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
              <p className="m-0 font-mono text-[10px] text-fg-tertiary">
                <span className="text-accent-primary" data-testid="risk-profile-selected-name">
                  {selected.name}
                </span>
                {` · debit $${Math.round(selected.debit)} · θ ${selected.theta >= 0 ? "+" : ""}${selected.theta.toFixed(1)}/d · vega +${selected.vega.toFixed(2)}`}
                {bookCount > 1 && (
                  <span className="ml-2 text-accent-warning" data-testid="combined-book-summary">
                    {`+ ${bookCount - 1} more → combined debit $${Math.round(bookDebit)} (max loss) · θ ${bookTheta >= 0 ? "+" : ""}${bookTheta.toFixed(1)}/d · vega +${bookVega.toFixed(2)}`}
                  </span>
                )}
              </p>
            </div>
            {selectedPosition !== null && scenarioResult !== null && (
              <>
                <PayoffControls
                  dateInputValue={dateControl.dateInputValue}
                  minIso={bounds.minIso}
                  maxIso={bounds.maxIso}
                  onDateChange={dateControl.setDate}
                  onStepDate={dateControl.stepDate}
                  onResetDate={dateControl.resetDate}
                  toggles={toggles}
                  onToggle={handleToggle}
                />
                {snapshot !== null && (
                  <EventLegRibbon
                    events={snapshot.events}
                    asOf={snapshot.asOf}
                    frontDte={selected.frontLeg.dte}
                    backDte={selected.backLeg.dte}
                  />
                )}
                <PayoffChart
                  todayCurve={scenarioResult.payoffCurve}
                  fanCurves={[]}
                  expirationCurve={scenarioResult.expirationCurve}
                  rollCurve={null}
                  gex={{
                    callWall: snapshot?.gex.callWall ?? null,
                    putWall: snapshot?.gex.putWall ?? null,
                    flip: snapshot?.gex.flip ?? null,
                  }}
                  domain={payoffDomain}
                  spot={spot}
                  toggles={toggles}
                  fitY={false}
                  onFitYConsumed={noop}
                  positionSetSignature={positionSetSignature}
                  baseExpirationCurve={scenarioResult.expirationCurve}
                  todayCurveColor={TODAY_CURVE_COLOR}
                  expirationCurveColor={EXPIRATION_CURVE_COLOR}
                  expectedMoveBand={selected.expectedMove > 0 ? { spot, em: selected.expectedMove } : null}
                  aspectRatio={2.9}
                />
              </>
            )}
          </>
        )}
      </Panel>
    </div>
  );
}
