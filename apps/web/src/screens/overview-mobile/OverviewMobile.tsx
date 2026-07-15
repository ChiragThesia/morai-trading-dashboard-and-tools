/**
 * OverviewMobile — the dedicated mobile Overview tree (35.1, <1024px branch of the
 * Overview switch). Hero-first per UI-SPEC §Screen Composition: MobileHero →
 * MobileRiskPanel → positions section (heading + card list + footer total + exitsBody) →
 * MobileMarketSection (key levels + stat grids + closed rail disclosure).
 * No horizontal padding on the root; sections own their px-4 (the chart section owns px-0).
 *
 * The exitsBody five state branches (loading / error / warming-up / empty / unlinked)
 * duplicate the desktop's JSX with identical copy + testids — view duplication is
 * sanctioned (D-02); the state itself comes from the shared model's exits slice.
 */
import { useMemo } from "react";
import { useOverviewModel } from "./useOverviewModel.ts";
import { MobileHero } from "./MobileHero.tsx";
import { MobileRiskPanel } from "./MobileRiskPanel.tsx";
import { MobileMarketSection } from "./MobileMarketSection.tsx";
import { PositionCard } from "../../components/PositionCard.tsx";
import { LiveStatusBadge } from "../../components/LiveStatusBadge.tsx";
import { SectionLabel, Button } from "../../components/system/index.tsx";
import { HeldPositionsPanel } from "../HeldPositionsPanel.tsx";
import { ExitRulesPanel } from "../ExitRulesPanel.tsx";
import { resolveLivePositionRow } from "../../lib/live-position-greeks.ts";
import { usd, signedUsd, signClass } from "../../lib/position-format.ts";
import { Dialog, DialogContent, DialogTrigger } from "@/components/ui/dialog.tsx";

export function OverviewMobile(): React.ReactElement {
  // D-01: only one tree mounts, and the model hook is the surface's single
  // useLiveStream consumer.
  const m = useOverviewModel();
  const {
    snapshot: exitsSnapshot,
    isPending: exitsIsPending,
    isError: exitsIsError,
    refetch: exitsRefetch,
    dataIsUndefined: exitsDataIsUndefined,
  } = m.exits;

  // D-11: footer total — the SAME lifted excluded set + the SAME shared lib fn
  // (resolveLivePositionRow) the desktop Net row and the chart curves use.
  const total = useMemo(() => {
    const includedLegs = m.rows
      .filter((r) => !m.excluded.has(r.key))
      .flatMap((r) => r.legs);
    return resolveLivePositionRow(includedLegs, m.spot, m.liveGreeks);
  }, [m.rows, m.excluded, m.spot, m.liveGreeks]);
  const includedCount = m.rows.filter((r) => !m.excluded.has(r.key)).length;

  // Exit-advisor status / unlinked verdicts — same five branches as the desktop
  // exitsBody, copy verbatim from the Copywriting Contract, same testids.
  let exitsBody: React.ReactElement | null;
  if (exitsIsPending && exitsDataIsUndefined) {
    exitsBody = (
      <div
        className="font-mono text-[10px] text-dim"
        data-testid="held-positions-loading"
      >
        Loading exit verdicts…
      </div>
    );
  } else if (exitsIsError) {
    exitsBody = (
      <div className="flex items-center gap-2" data-testid="held-positions-error">
        <p className="m-0 font-mono text-[12px] text-down">Couldn&apos;t load exit verdicts.</p>
        <Button
          onClick={() => {
            void exitsRefetch();
          }}
        >
          Retry
        </Button>
      </div>
    );
  } else if (exitsSnapshot === null) {
    exitsBody = (
      <div className="flex flex-col gap-1.5" data-testid="held-positions-cold-start">
        <p className="m-0 font-display text-sm font-bold text-txt">Exit advisor warming up</p>
        <p className="m-0 font-mono text-[11px] text-dim">
          First verdict pending — check back after the next chain snapshot.
        </p>
      </div>
    );
  } else if (exitsSnapshot.positions.length === 0) {
    exitsBody = (
      <div className="flex flex-col gap-1.5" data-testid="held-positions-empty">
        <p className="m-0 font-display text-sm font-bold text-txt">No open positions</p>
        <p className="m-0 font-mono text-[11px] text-dim">
          Nothing to advise on — the exit advisor activates once you have an open calendar.
        </p>
      </div>
    );
  } else if (m.unlinkedVerdicts.length > 0) {
    exitsBody = (
      <HeldPositionsPanel
        positions={m.unlinkedVerdicts}
        observedAt={exitsSnapshot.observedAt}
        marketSession={exitsSnapshot.marketSession}
        title="Unlinked verdicts"
      />
    );
  } else {
    exitsBody = null;
  }

  return (
    <div data-testid="overview-mobile-root" className="flex flex-col gap-6 pb-10">
      {/* Hero spot is the model's honest displaySpot (LIVE-04): live-or-EOD, null (→ "—")
          when the snapshot is absent, never the model's 5800 pricing fallback
          (Copywriting Contract per-segment rule). */}
      <MobileHero
        bookPnl={m.bookPnl}
        hasPositions={m.positions.length > 0}
        spot={m.displaySpot}
        vix={m.displayVix}
        regime={m.regime}
        liveStatus={m.liveStatus}
      />
      <MobileRiskPanel
        scenario={m.scenario}
        payoffDomain={m.payoffDomain}
        spot={m.spot}
        gex={m.gex}
        toggles={m.toggles}
        onToggle={m.handleToggle}
        dateControl={m.dateControl}
        bounds={m.bounds}
        positionSetSignature={m.positionSetSignature}
        excludedFromT0Count={m.excludedFromT0Count}
        freshness={m.freshness}
      />
      {/* Positions section (35.1-03, D-07/D-11): heading → card list → footer → exitsBody. */}
      <section className="px-4">
        <div className="mb-2 flex items-center justify-between gap-2">
          <SectionLabel>Positions</SectionLabel>
          <LiveStatusBadge {...m.liveBadgeProps} />
          {exitsSnapshot !== null && (
            <Dialog>
              <DialogTrigger
                data-testid="exit-rules-trigger"
                className="rounded-md bg-raise/40 px-2.5 py-1 font-display text-[10px] font-semibold tracking-[0.09em] text-muted-foreground uppercase ring-1 ring-line hover:text-txt"
              >
                Exit rules ▸
              </DialogTrigger>
              <DialogContent className="sm:max-w-md">
                <ExitRulesPanel ruleSet={exitsSnapshot.ruleSet} />
              </DialogContent>
            </Dialog>
          )}
        </div>
        {m.rows.length === 0 ? (
          <p className="font-mono text-[11px] text-dim">
            No open positions. Register a calendar via the API or paste a TOS order in the Analyzer.
          </p>
        ) : (
          <>
            <div className="flex flex-col gap-2">
              {m.rows.map((r) => (
                <PositionCard
                  key={r.key}
                  row={r}
                  spot={m.spot}
                  liveGreeks={m.liveGreeks}
                  ivNa={m.ivNaByRowKey.get(r.key) === true}
                  verdict={m.verdictByRowKey.get(r.label) ?? null}
                  marketSession={exitsSnapshot?.marketSession ?? "rth"}
                  // Expand is UN-gated by verdict (catch #23) — mobile's only greeks surface.
                  expanded={m.selectedRowKey === r.key}
                  onSelect={m.handleSelectRow}
                  included={!m.excluded.has(r.key)}
                  onToggleIncluded={m.handleToggleExcluded}
                  verdictObservedAt={exitsSnapshot?.observedAt ?? null}
                />
              ))}
            </div>
            <div
              data-testid="mobile-positions-footer"
              className="mt-2 font-mono text-[11px] text-muted-foreground tabular-nums"
            >
              Net {usd(total.netVal)} ·{" "}
              <span className={total.unreal === null ? "text-dim" : signClass(total.unreal)}>
                {total.unreal === null ? "—" : signedUsd(total.unreal)}
              </span>
              {" · "}
              {includedCount}/{m.rows.length} included
            </div>
          </>
        )}
        {exitsBody !== null && <div className="mt-3">{exitsBody}</div>}
      </section>
      {/* Market section (35.1-04, D-08): key levels + stat grids + closed rail disclosure. */}
      <MobileMarketSection
        gex={m.gex}
        railGreeks={m.railGreeks}
        zeroDte={m.zeroDte}
        regime={m.regime}
        vvix={m.displayVvix}
        dff={m.macroValues.dff}
        curveSlope={m.macroValues.curveSlope}
        cotLev={m.cotLev}
        spot={m.spot}
      />
    </div>
  );
}
