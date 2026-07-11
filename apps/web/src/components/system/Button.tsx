/**
 * Button — the shared control-affordance primitive (Phase 21).
 *
 * Every interactive control in apps/web renders through this so on/off/hover/focus/disabled
 * are never ambiguous. Filled-vs-outline states on the existing accent palette replace the old
 * flat-gray `border-line2 bg-transparent` buttons with faint 10%-opacity "active" tints.
 *
 * `variant="toggle"` is the on/off affordance (series toggles, Combine, Copy): `active=true`
 * renders a FILLED accent (bg-{tone}, dark text) — the clear "ON" — `active=false` renders an
 * outline that only fills on hover. Tailwind can't interpolate a dynamic class name
 * (`bg-${tone}` never compiles), so tone is resolved via explicit lookup maps of full class
 * strings, never string interpolation.
 */
import * as React from "react";
import { cn } from "@/lib/utils";

export type ButtonVariant = "primary" | "secondary" | "ghost" | "destructive" | "toggle";
export type ButtonTone = "violet" | "amber" | "up" | "down";
export type ButtonSize = "xs" | "sm" | "touch";

export interface ButtonProps extends React.ComponentProps<"button"> {
  readonly variant?: ButtonVariant;
  /** Accent used by `variant="toggle"` for the active fill (and its inactive hover border). */
  readonly tone?: ButtonTone;
  /** Toggle on-state. Ignored by non-toggle variants. */
  readonly active?: boolean;
  readonly size?: ButtonSize;
}

const BASE =
  "inline-flex items-center justify-center gap-1 cursor-pointer rounded-[3px] font-mono transition-colors select-none focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet focus-visible:ring-offset-1 focus-visible:ring-offset-bg disabled:opacity-40 disabled:cursor-not-allowed disabled:pointer-events-none";

const SIZE_CLASS: Record<ButtonSize, string> = {
  xs: "px-[7px] py-0.5 text-[9px]",
  sm: "px-2.5 py-1 text-[10px]",
  touch: "min-h-11 px-3 py-1.5 text-[11px] lg:min-h-0 lg:px-[7px] lg:py-0.5 lg:text-[9px]",
};

const VARIANT_CLASS: Record<Exclude<ButtonVariant, "toggle">, string> = {
  primary: "bg-violet text-bg border border-violet hover:bg-violet/85",
  secondary: "bg-raise text-txt border border-line2 hover:border-violet/60 hover:bg-violet/10",
  ghost: "bg-transparent text-dim border border-transparent hover:text-txt hover:bg-line/60",
  destructive: "bg-transparent text-dim border border-transparent hover:text-down hover:bg-down/15",
};

/** toggle + active=true: filled accent, dark text — the clear "ON". */
const TOGGLE_ACTIVE_CLASS: Record<ButtonTone, string> = {
  violet: "bg-violet text-bg border border-violet",
  amber: "bg-amber text-bg border border-amber",
  up: "bg-up text-bg border border-up",
  down: "bg-down text-bg border border-down",
};

/** toggle + active=false: outline "OFF", hoverable toward the tone. */
const TOGGLE_INACTIVE_CLASS: Record<ButtonTone, string> = {
  violet: "bg-transparent text-dim border border-line2 hover:border-violet/60 hover:text-txt",
  amber: "bg-transparent text-dim border border-line2 hover:border-amber/60 hover:text-txt",
  up: "bg-transparent text-dim border border-line2 hover:border-up/60 hover:text-txt",
  down: "bg-transparent text-dim border border-line2 hover:border-down/60 hover:text-txt",
};

export interface ButtonClassOptions {
  readonly variant?: ButtonVariant;
  readonly tone?: ButtonTone;
  readonly active?: boolean;
  readonly size?: ButtonSize;
  readonly className?: string;
}

/** Resolves the full class string for a given variant/tone/active/size combo — usable directly
 * on a raw `<button>` when the caller can't route through the `<Button>` component itself. */
export function buttonClass({
  variant = "secondary",
  tone = "violet",
  active = false,
  size = "xs",
  className,
}: ButtonClassOptions): string {
  const variantClass =
    variant === "toggle"
      ? active
        ? TOGGLE_ACTIVE_CLASS[tone]
        : TOGGLE_INACTIVE_CLASS[tone]
      : VARIANT_CLASS[variant];
  return cn(BASE, SIZE_CLASS[size], variantClass, className);
}

export function Button({
  variant = "secondary",
  tone = "violet",
  active = false,
  size = "xs",
  className,
  type = "button",
  ...props
}: ButtonProps): React.ReactElement {
  return (
    <button type={type} className={buttonClass({ variant, tone, active, size, className })} {...props} />
  );
}
