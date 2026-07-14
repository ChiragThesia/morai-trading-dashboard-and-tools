/**
 * Morai design system — molecule layer.
 *
 * Atomic structure:
 *   - Atoms      → src/components/ui/* (shadcn: Button, Badge, Card, Input, Tabs, …)
 *   - Molecules  → THIS FILE (Panel, PanelHeading, SectionLabel, Stat, MetricChip)
 *   - Organisms  → screen-level cards composed in src/screens/*
 *
 * Every visual constant comes from the LOCKED token palette in src/index.css (@theme):
 *   surfaces  bg-panel / from-panel to-panel2 / bg-raise   borders ring-line / ring-line2
 *   text      text-txt / text-muted-foreground (#7b8696) / text-dim (#566273)
 *   accents   text-up text-down text-violet text-amber text-blue
 *   type      font-display (Space Grotesk) / font-mono (JetBrains Mono)
 *
 * Rule for screens: NO hardcoded hex, NO inline color/font styles. Compose these
 * molecules + Tailwind token utilities. Layout-only inline styles (grid spans, fixed
 * px widths for charts) are fine.
 */
import * as React from "react";
import { cn } from "@/lib/utils";

export { Button, buttonClass } from "./Button.tsx";
export type { ButtonProps, ButtonVariant, ButtonTone, ButtonSize } from "./Button.tsx";
export { ChipRail } from "./ChipRail.tsx";
export { BulletGauge } from "./BulletGauge.tsx";
export type { BulletGaugeProps, BulletGaugeVariant } from "./BulletGauge.tsx";

// ─── Atoms (Morai-specific, beyond shadcn) ────────────────────────────────────

/**
 * Panel — the standard gradient card surface used for every dashboard box.
 * Replaces the repeated inline `linear-gradient(180deg,#0f1521,#0c111a)` + 1px #1b2433.
 */
export function Panel({
  className,
  ...props
}: React.ComponentProps<"div">): React.ReactElement {
  return (
    <div
      className={cn(
        "rounded-lg bg-gradient-to-b from-panel to-panel2 p-3 ring-1 ring-line",
        className,
      )}
      {...props}
    />
  );
}

/**
 * SectionLabel — the ubiquitous 10px uppercase tracked heading.
 * `tone="dim"` for the fainter section dividers, default for card titles.
 */
export function SectionLabel({
  className,
  tone = "muted",
  ...props
}: React.ComponentProps<"h3"> & {
  tone?: "muted" | "dim";
}): React.ReactElement {
  return (
    <h3
      className={cn(
        "m-0 font-display text-[10px] font-semibold tracking-[0.09em] uppercase",
        tone === "dim" ? "text-dim" : "text-muted-foreground",
        className,
      )}
      {...props}
    />
  );
}

/**
 * Stat — a label-over-value KPI cell (MARK / DEBIT / UNREAL / DTE, net-greeks rows…).
 * Value defaults to mono tabular-nums; pass valueClassName for sign colors.
 */
export function Stat({
  label,
  value,
  valueClassName,
  className,
}: {
  label: React.ReactNode;
  value: React.ReactNode;
  valueClassName?: string;
  className?: string;
}): React.ReactElement {
  return (
    <div className={cn("flex flex-col gap-0.5", className)}>
      <span className="font-display text-[10px] font-semibold tracking-[0.09em] text-dim uppercase">
        {label}
      </span>
      <span className={cn("font-mono tabular-nums text-txt", valueClassName)}>
        {value}
      </span>
    </div>
  );
}

/**
 * MetricChip — a bordered pill for the global header strip (SPX · net γ · flip · book P&L).
 * `alert` swaps to the blood-dark danger background (negative-gamma / loss emphasis).
 */
export function MetricChip({
  label,
  value,
  valueClassName,
  alert = false,
  className,
  "data-testid": dataTestId,
}: {
  label: React.ReactNode;
  value: React.ReactNode;
  valueClassName?: string;
  alert?: boolean;
  className?: string;
  "data-testid"?: string;
}): React.ReactElement {
  return (
    <div
      data-testid={dataTestId}
      className={cn(
        "flex items-center gap-1.5 rounded-md px-3 py-1.5 ring-1",
        alert ? "bg-downd ring-down/40" : "bg-raise/40 ring-line",
        className,
      )}
    >
      <span className="font-display text-[10px] font-semibold tracking-[0.09em] text-muted-foreground uppercase">
        {label}
      </span>
      <span
        className={cn(
          "font-display text-base font-bold tabular-nums",
          valueClassName,
        )}
      >
        {value}
      </span>
    </div>
  );
}

// ─── Molecules ────────────────────────────────────────────────────────────────

/**
 * PanelHeading — the title row inside a Panel: a SectionLabel, an optional inline
 * badge (e.g. "live", "closed → Journal"), and an optional right-aligned action.
 */
export function PanelHeading({
  title,
  badge,
  action,
  className,
}: {
  title: React.ReactNode;
  badge?: React.ReactNode;
  action?: React.ReactNode;
  className?: string;
}): React.ReactElement {
  return (
    <div className={cn("mb-2 flex items-center justify-between gap-2", className)}>
      <div className="flex items-center gap-2">
        <SectionLabel>{title}</SectionLabel>
        {badge}
      </div>
      {action}
    </div>
  );
}
