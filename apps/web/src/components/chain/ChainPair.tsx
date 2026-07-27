/**
 * ChainPair — surface 2 of the chain: the calendar math for the two legs the user picked.
 *
 * Browse is deliberately arithmetic-free — it shows legs, not spreads. Everything that requires
 * BOTH legs lives here: horizontal skew, the forward vol between the two expiries, the edge, the
 * net greeks the position actually carries, and the debit at the ORATS fill haircut. The user
 * asked for the calendar greeks and both legs' IVs on this surface by name; they are the reason to
 * trade a calendar off this screen at all.
 *
 * Every number arrives pre-computed from `useChainModel` — this file formats and labels, it does
 * not derive. Null renders as an em dash, never as a zero.
 *
 * The three flags are the point of the bottom row. A pair the user built by hand can be odd in
 * exactly three ways — two different OCC roots, a back leg that is not later, or two different
 * strikes — and each one changes what the numbers above mean. The old joined table made those
 * pairs accidentally and silently; here they are deliberate, and labelled.
 */
import * as React from "react";
import { Button, SectionLabel, Stat, Tag } from "../system/index.tsx";
import type { ChainLegRow, ChainPair as ChainPairModel } from "../../hooks/useChainModel.ts";
import { Num, dec, int, pct, pts, shortYmd, signedDec, strikeLabel } from "./chain-format.tsx";

function LegPanel({
  label,
  leg,
  testId,
}: {
  readonly label: string;
  readonly leg: ChainLegRow;
  readonly testId: string;
}): React.ReactElement {
  return (
    <div
      data-testid={testId}
      className="flex flex-col gap-1.5 rounded-md border border-line-subtle/60 bg-surface-raised/40 p-2"
    >
      <div className="flex flex-wrap items-center gap-2">
        <SectionLabel tone="dim">{label}</SectionLabel>
        <Tag>{shortYmd(leg.expiration)}</Tag>
        <Tag>{leg.root}</Tag>
        <span className="font-mono text-[10px] text-fg-tertiary">{leg.dte} DTE</span>
      </div>
      <div className="grid grid-cols-3 gap-x-3 gap-y-1.5 font-mono text-[11px]">
        <Stat label="Strike" value={`${strikeLabel(leg.strike)} ${leg.contractType}`} />
        <Stat label="IV" value={<Num v={leg.iv} fmt={pct} />} />
        <Stat label="V-Skew" value={<Num v={leg.vSkew} fmt={pts} sign />} />
        <Stat label="Bid" value={<Num v={leg.bid} fmt={(n) => dec(n, 2)} />} />
        <Stat label="Ask" value={<Num v={leg.ask} fmt={(n) => dec(n, 2)} />} />
        <Stat label="Open Int" value={<Num v={leg.openInterest} fmt={int} />} />
        <Stat label="Delta (Δ)" value={<Num v={leg.delta} fmt={(n) => dec(n, 3)} />} />
        <Stat label="Gamma (Γ)" value={<Num v={leg.gamma} fmt={(n) => dec(n, 4)} />} />
        <Stat label="Theta (Θ)" value={<Num v={leg.theta} fmt={(n) => dec(n, 2)} />} />
      </div>
    </div>
  );
}

/** One labelled derived number, with a stable testid so the value is assertable. */
function PairStat({
  label,
  testId,
  value,
}: {
  readonly label: string;
  readonly testId: string;
  readonly value: React.ReactNode;
}): React.ReactElement {
  return (
    <div className="flex flex-col gap-0.5" data-testid={testId}>
      <span className="font-display text-[9px] font-semibold tracking-[0.09em] text-fg-tertiary uppercase">
        {label}
      </span>
      <span className="font-mono text-[12px] tabular-nums">{value}</span>
    </div>
  );
}

function Flag({ testId, children }: { readonly testId: string; readonly children: React.ReactNode }): React.ReactElement {
  return (
    <p
      data-testid={testId}
      className="m-0 font-mono text-[10px] leading-[1.35] text-accent-warning"
    >
      {children}
    </p>
  );
}

export function ChainPair({
  pair,
  onSendToPayoff,
  onClear,
}: {
  readonly pair: ChainPairModel | null;
  readonly onSendToPayoff: (tosOrder: string) => void;
  readonly onClear: () => void;
}): React.ReactElement {
  if (pair === null) {
    return (
      <p data-testid="chain-pair-empty" className="m-0 p-3 font-mono text-[11px] text-fg-tertiary">
        Pick a <span className="text-fg-secondary">Front</span> leg and a{" "}
        <span className="text-fg-secondary">Back</span> leg in the chain above. You sell the front
        and buy the back, so the calendar math only exists once both are chosen.
      </p>
    );
  }

  const { tosOrder } = pair;

  return (
    <div className="flex flex-col gap-2">
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
        <LegPanel label="Front Leg · sold" leg={pair.front} testId="chain-pair-front" />
        <LegPanel label="Back Leg · bought" leg={pair.back} testId="chain-pair-back" />
      </div>

      {/* The three term-structure numbers, then the risk the position carries. */}
      <div className="grid grid-cols-2 gap-x-3 gap-y-2 rounded-md border border-line-subtle/60 bg-surface-raised/40 p-2 sm:grid-cols-4 lg:grid-cols-8">
        <PairStat label="H-Skew" testId="chain-pair-hskew" value={<Num v={pair.hSkew} fmt={pts} sign />} />
        <PairStat label="Fwd IV" testId="chain-pair-fwdiv" value={<Num v={pair.fwdIv} fmt={pct} />} />
        <PairStat label="Edge" testId="chain-pair-edge" value={<Num v={pair.edge} fmt={pts} sign />} />
        <PairStat
          label="Net Delta (Δ)"
          testId="chain-pair-netdelta"
          value={<Num v={pair.netDelta} fmt={(n) => signedDec(n, 3)} sign />}
        />
        <PairStat
          label="Net Gamma (Γ)"
          testId="chain-pair-netgamma"
          value={<Num v={pair.netGamma} fmt={(n) => dec(n, 4)} sign />}
        />
        <PairStat
          label="Net Theta (Θ)"
          testId="chain-pair-nettheta"
          value={<Num v={pair.netTheta} fmt={(n) => dec(n, 2)} />}
        />
        <PairStat
          label="Net Vega"
          testId="chain-pair-netvega"
          value={<Num v={pair.netVega} fmt={(n) => dec(n, 2)} />}
        />
        <PairStat label="Debit" testId="chain-pair-debit" value={<Num v={pair.debit} fmt={(n) => dec(n, 2)} />} />
      </div>

      {(pair.rootMismatch || pair.backNotLater || pair.diagonal) && (
        <div className="flex flex-col gap-1 rounded-md border border-accent-warning/40 bg-surface-raised/40 p-2">
          {pair.backNotLater && (
            <Flag testId="chain-pair-flag-order">
              The back leg is not later than the front, so there is no window between them — forward
              vol and edge have no solution. Swap the picks.
            </Flag>
          )}
          {pair.rootMismatch && (
            <Flag testId="chain-pair-flag-root">
              These legs are different OCC roots ({pair.front.root} vs {pair.back.root}). SPX
              settles AM, SPXW settles PM: two books, so this is two orders, not one calendar.
            </Flag>
          )}
          {pair.diagonal && (
            <Flag testId="chain-pair-flag-diagonal">
              The strikes differ ({strikeLabel(pair.front.strike)} vs{" "}
              {strikeLabel(pair.back.strike)}) — this is a diagonal. H-Skew and Edge compare two
              different points on the skew curve, so they no longer isolate term structure.
            </Flag>
          )}
        </div>
      )}

      <div className="flex flex-wrap items-center gap-1.5">
        {tosOrder !== null && (
          <Button
            variant="primary"
            size="sm"
            data-testid="chain-pair-send"
            title="Write this pair into the Risk profile box below as a TOS order"
            onClick={() => {
              onSendToPayoff(tosOrder);
            }}
          >
            ↓ Send to Risk profile
          </Button>
        )}
        <Button variant="ghost" data-testid="chain-pair-clear" onClick={onClear}>
          Clear pair
        </Button>
        {tosOrder !== null && (
          <span className="font-mono text-[9.5px] text-fg-tertiary">{tosOrder}</span>
        )}
      </div>

      <div
        data-testid="chain-pair-legend"
        className="px-1 font-mono text-[9.5px] leading-[1.3] text-fg-tertiary"
      >
        H-Skew = front IV − back IV, in vol points. Positive = the front month is the rich one, and
        you sell the front, so positive is the setup. Rough read only: the two IVs cover different
        windows. · Fwd IV = the vol the market prices for ONLY the stretch between the two expiries
        — what is left in the back leg once the front leg&apos;s window is stripped out. · Edge =
        front IV − forward IV, in vol points. The real number: you sell the front at its IV, and
        what you keep afterwards is worth the forward vol. Positive = selling the front for more
        than the market says the following window is worth. Edge is H-Skew done properly; when they
        disagree, trust Edge. · An inverted structure prices no forward vol, so both dash. · Net Δ
        Γ Θ vega are the CALENDAR&apos;s, back minus front — you are short the front gamma. · Debit
        = the back leg bought and the front sold at the ORATS 0.66-of-width fill haircut, not mids.
        <span className="mt-1 block text-fg-secondary">
          The two axes: <strong className="font-semibold">V-Skew picks the STRIKE</strong> (where
          on the curve you are paid most to sell),{" "}
          <strong className="font-semibold">EDGE picks the EXPIRY PAIR</strong> (when the front is
          rich against the window behind it). Vertical skew chooses where, term structure chooses
          when.
        </span>
      </div>
    </div>
  );
}
