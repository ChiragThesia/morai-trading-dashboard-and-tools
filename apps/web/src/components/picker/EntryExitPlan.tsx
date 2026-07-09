/**
 * EntryExitPlan — the picker's "Entry / exit plan" card (ANLZ-03, D-01b).
 *
 * Renders the 5 locked rows (Copywriting Contract, exact mockup labels) with values read from
 * `candidate.exitPlan` and `candidate.debit`: target = debit × profitTargetPct, stop = debit ×
 * stopPct, "manage short" = closeByExpiry minus manageShortDte days, and the hard-close date is
 * closeByExpiry itself. Row labels are fixed literal copy per D-01b (Phase 18 renders the fixed
 * +25%/−17.5%/21-DTE defaults verbatim — no per-candidate label templating), while every VALUE is
 * computed from the candidate's own `exitPlan` fields, never hardcoded.
 */
import type { PickerCandidate } from "@morai/contracts";

function debitUsd(v: number): string {
  return v >= 0 ? `$${v.toFixed(0)}` : `−$${Math.abs(v).toFixed(0)}`;
}

/** Fixed-sign dollar formatter for the target/stop rows: a profit target is always a gain (+)
 * and a stop is always a loss (−), by construction (Copywriting Contract row labels) —
 * magnitude is `|debit| × pct`, so a negative-debit guard candidate still renders a well-formed
 * dollar amount instead of a confusing double-negative (D-06: never NaN, never a blank number). */
function fixedSignUsd(magnitude: number, sign: "+" | "−"): string {
  return `${sign}$${Math.abs(magnitude).toFixed(0)}`;
}

/** Parse an ISO 8601 date ("YYYY-MM-DD") as a UTC date (avoids local-timezone off-by-one). */
function parseIsoDate(iso: string): Date {
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(Date.UTC(y ?? 1970, (m ?? 1) - 1, d ?? 1));
}

function fmtDate(d: Date): string {
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });
}

const MS_PER_DAY = 86_400_000;

export interface EntryExitPlanProps {
  readonly candidate: PickerCandidate;
}

export function EntryExitPlan({ candidate }: EntryExitPlanProps): React.ReactElement {
  const { debit, exitPlan } = candidate;
  const target = Math.abs(debit) * exitPlan.profitTargetPct;
  const stop = Math.abs(debit) * exitPlan.stopPct;

  const closeByDate = parseIsoDate(exitPlan.closeByExpiry);
  const manageDate = new Date(closeByDate.getTime() - exitPlan.manageShortDte * MS_PER_DAY);

  return (
    <div className="flex flex-col">
      <PlanRow label="Debit = max loss" testId="entryexit-value-debit" value={debitUsd(debit)} />
      <PlanRow
        label="Profit target (+25%)"
        testId="entryexit-value-target"
        value={fixedSignUsd(target, "+")}
        valueClassName="text-up"
      />
      <PlanRow
        label="Stop (−17.5%)"
        testId="entryexit-value-stop"
        value={fixedSignUsd(stop, "−")}
        valueClassName="text-down"
      />
      <PlanRow label="Manage short (21 DTE)" testId="entryexit-value-manage" value={fmtDate(manageDate)} />
      <PlanRow
        label="Hard close by"
        testId="entryexit-value-closeby"
        value={
          candidate.exitPlan.thetaCapturePct !== null && candidate.exitPlan.thetaCapturePct < 1
            ? `${fmtDate(closeByDate)} (pre-event · captures ~${Math.round(candidate.exitPlan.thetaCapturePct * 100)}% of θ runway)`
            : `${fmtDate(closeByDate)} (front expiry)`
        }
        valueClassName="text-amber"
      />
      <p className="m-0 mt-1.5 font-mono text-[9px] leading-[1.5] text-dim">
        Max-loss=debit holds only if closed as a spread by front expiration (European SPX, no
        early assignment). Targets are tunable defaults, not validated thresholds.
      </p>
    </div>
  );
}

function PlanRow({
  label,
  testId,
  value,
  valueClassName,
}: {
  label: string;
  testId: string;
  value: string;
  valueClassName?: string;
}): React.ReactElement {
  return (
    <div className="flex justify-between border-b border-line/40 py-1 text-xs last:border-b-0">
      <span className="text-dim">{label}</span>
      <span data-testid={testId} className={`font-mono ${valueClassName ?? "text-txt"}`}>
        {value}
      </span>
    </div>
  );
}
