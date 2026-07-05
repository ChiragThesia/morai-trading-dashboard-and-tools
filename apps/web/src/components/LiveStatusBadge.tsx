/**
 * LiveStatusBadge — connection-status indicator for the live SSE stream (WATCH-01).
 *
 * Presentational only — no hooks except the internal last-known-good guard below.
 * Props carry all state. Designed to slot into the "Position" CardHeading badge
 * position (UI-SPEC Surface 3).
 *
 * States (D-01 3-state model, 20-UI-SPEC.md Color contract):
 *   LIVE    — text-up + 6px pulsing dot (.live-dot) — ticks arriving during RTH.
 *   QUIET   — text-dim, transparent, no dot — market closed (benign).
 *   STALLED — text-down on bg-downd + ring-down/40, no dot — a genuine alarm (D-20):
 *             RTH but ticks frozen past STALL_THRESHOLD_MS, or transport dead.
 *   CONNECTING — a copy-only condition (SAME classes as QUIET, D-11): status==='quiet'
 *             AND the last heartbeat's isRth===true AND no tick has arrived yet. This
 *             is deliberately not a 4th status value (D-01) — cold-start/mid-reconnect
 *             during RTH must never flash red.
 *
 * Tooltip copy and the STALLED force-reconnect action come from the Copywriting
 * Contract in 20-UI-SPEC.md. Dot animation: @keyframes live-dot-pulse in
 * apps/web/src/index.css (unchanged).
 */

import React, { useRef } from "react";
import { Badge } from "@/components/ui/badge.tsx";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip.tsx";
import { Button } from "@/components/system/Button.tsx";
import type { LiveStreamStatus } from "../hooks/useLiveStream.ts";
import { STALL_THRESHOLD_MS } from "../hooks/useLiveStream.ts";

// ─── Types ────────────────────────────────────────────────────────────────────

type Props = {
  /** Current 3-state stream status. */
  status: LiveStreamStatus;
  /** Timestamp of the most recently received tick (null until first tick). */
  lastTickAt: Date | null;
  /** Server-pushed RTH truth from the last well-formed ping (null until the first ping). */
  isRth: boolean | null;
  /** True once at least one valid tick has been processed. */
  hasReceivedFirstTick: boolean;
  /** True while a manual reconnectNow() call is in flight (D-17). */
  isReconnecting: boolean;
  /** Force-reconnect action, wired to the hook's reconnectNow (D-17, STALLED only). */
  onReconnect: () => void;
};

// ─── Per-state render config (locked tokens from 20-UI-SPEC.md Color contract) ──

type StatusConfig = {
  label: string;
  /** Tailwind utility classes (text/background/ring) — the badge's design tokens. */
  className: string;
  showDot: boolean;
};

const STATUS_CONFIG = {
  live: {
    label: "LIVE",
    className: "text-up bg-transparent",
    showDot: true,
  },
  quiet: {
    label: "QUIET",
    className: "text-dim bg-transparent",
    showDot: false,
  },
  stalled: {
    // D-20 resolution: the down/red alarm token, not the retired amber "stale" look —
    // STALLED must read as a genuine fault, never merely stale.
    label: "STALLED",
    className: "text-down bg-downd ring-1 ring-down/40",
    showDot: false,
  },
} as const satisfies Record<LiveStreamStatus, StatusConfig>;

const KNOWN_STATUSES: ReadonlySet<LiveStreamStatus> = new Set<LiveStreamStatus>([
  "live",
  "quiet",
  "stalled",
]);

const STALL_THRESHOLD_SECONDS = STALL_THRESHOLD_MS / 1000;

// ─── Helpers ─────────────────────────────────────────────────────────────────

/** Format a Date as HH:mm:ss (local time, 24-hour). */
function formatTime(d: Date): string {
  return d.toLocaleTimeString("en-US", {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  });
}

/** Per-state tooltip copy (20-UI-SPEC.md Copywriting Contract). */
function resolveTooltipText(params: {
  status: LiveStreamStatus;
  isConnecting: boolean;
  lastTickAt: Date | null;
}): string {
  const { status, isConnecting, lastTickAt } = params;
  if (status === "stalled") {
    return `No ticks for ${STALL_THRESHOLD_SECONDS}s — your data may be frozen.`;
  }
  if (isConnecting) {
    return "Waiting for first tick…";
  }
  if (status === "quiet") {
    return "Market closed — outside regular trading hours.";
  }
  return lastTickAt !== null ? `Last update: ${formatTime(lastTickAt)}` : "No data received yet.";
}

// ─── Component ────────────────────────────────────────────────────────────────

/**
 * LiveStatusBadge — renders the SSE stream state in the Position card heading.
 *
 * Holds last-known-good on a malformed/unrecognized status value — never renders a
 * blank/undefined label.
 */
export function LiveStatusBadge({
  status,
  lastTickAt,
  isRth,
  hasReceivedFirstTick,
  isReconnecting,
  onReconnect,
}: Props): React.ReactElement {
  const lastGoodStatusRef = useRef<LiveStreamStatus>("quiet");
  const effectiveStatus = KNOWN_STATUSES.has(status) ? status : lastGoodStatusRef.current;
  lastGoodStatusRef.current = effectiveStatus;

  const cfg = STATUS_CONFIG[effectiveStatus];
  // D-11: cold-start/mid-reconnect during RTH — same classes as QUIET, label/tooltip only.
  const isConnecting = effectiveStatus === "quiet" && isRth === true && !hasReceivedFirstTick;
  const label = isConnecting ? "CONNECTING" : cfg.label;
  const tooltipText = resolveTooltipText({ status: effectiveStatus, isConnecting, lastTickAt });

  return (
    <TooltipProvider>
      <Tooltip>
        <span style={{ display: "inline-flex", alignItems: "center", gap: 4 }}>
          <TooltipTrigger
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: 4,
              cursor: "default",
              background: "transparent",
              border: "none",
              padding: 0,
            }}
          >
            {cfg.showDot && (
              <span
                className="live-dot"
                aria-hidden="true"
              />
            )}
            <Badge
              variant="outline"
              className={cfg.className}
              style={{
                fontSize: 10,
                fontFamily: "JetBrains Mono, monospace",
                letterSpacing: "0.9px",
                textTransform: "uppercase",
                borderColor: "transparent",
                padding: "1px 5px",
                lineHeight: 1.4,
              }}
            >
              {label}
            </Badge>
          </TooltipTrigger>
          {effectiveStatus === "stalled" && (
            <Button
              variant="primary"
              size="xs"
              disabled={isReconnecting}
              onClick={onReconnect}
            >
              {isReconnecting ? "Reconnecting…" : "Reconnect now"}
            </Button>
          )}
        </span>
        <TooltipContent>
          <span
            style={{
              fontSize: 12,
              fontFamily: "JetBrains Mono, monospace",
              color: "#7b8696", // --color-muted
            }}
          >
            {tooltipText}
          </span>
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}
