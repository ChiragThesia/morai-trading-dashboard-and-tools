/**
 * LiveStatusBadge — connection-status indicator for the live SSE stream.
 *
 * Presentational only — no hooks. Props carry all state. Designed to slot into
 * the "Position" CardHeading badge position (UI-SPEC Surface 3).
 *
 * States (D-04 state machine per UI-SPEC Surface 3):
 *   LIVE        — teal text + 6px pulsing dot (.live-dot) — stream connected, ticks arriving.
 *   STALE       — amber text on --color-raise, no dot — stream dropped, values frozen.
 *   RECONNECTING— muted text on --color-raise, no dot — reconnect attempt in progress.
 *   POLL        — dim text, transparent background, no dot — EventSource not yet connected.
 *
 * Tooltip: last-tick timestamp (HH:mm:ss) or "No data received yet."
 * Dot animation: @keyframes live-dot-pulse added to apps/web/src/index.css.
 */

import React from "react";
import { Badge } from "@/components/ui/badge.tsx";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip.tsx";
import type { LiveStreamStatus } from "../hooks/useLiveStream.ts";

// ─── Types ────────────────────────────────────────────────────────────────────

type Props = {
  /** Current EventSource connection state. */
  status: LiveStreamStatus;
  /** Timestamp of the most recently received tick (null until first tick). */
  lastTickAt: Date | null;
};

// ─── Per-state render config (locked color tokens from UI-SPEC Surface 3) ────

type StatusConfig = {
  label: string;
  textColor: string;
  background: string;
  showDot: boolean;
};

const STATUS_CONFIG = {
  live: {
    label: "LIVE",
    textColor: "#26a69a", // --color-up
    background: "transparent",
    showDot: true,
  },
  stale: {
    label: "STALE",
    textColor: "#f0b429", // --color-amber
    background: "#161d2b", // --color-raise
    showDot: false,
  },
  reconnecting: {
    label: "RECONNECTING",
    textColor: "#7b8696", // --color-muted
    background: "#161d2b", // --color-raise
    showDot: false,
  },
  poll: {
    label: "POLL",
    textColor: "#566273", // --color-dim
    background: "transparent",
    showDot: false,
  },
} as const satisfies Record<LiveStreamStatus, StatusConfig>;

// ─── Helper ──────────────────────────────────────────────────────────────────

/** Format a Date as HH:mm:ss (local time, 24-hour). */
function formatTime(d: Date): string {
  return d.toLocaleTimeString("en-US", {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  });
}

// ─── Component ────────────────────────────────────────────────────────────────

/**
 * LiveStatusBadge — renders the SSE stream state in the Position card heading.
 *
 * Pure presentational component; no hooks.
 * The live-dot-pulse keyframe and .live-dot class are defined in apps/web/src/index.css.
 */
export function LiveStatusBadge({ status, lastTickAt }: Props): React.ReactElement {
  const cfg = STATUS_CONFIG[status];

  const tooltipText =
    lastTickAt !== null
      ? status === "stale"
        ? `Last update: ${formatTime(lastTickAt)} (stream lost)`
        : `Last update: ${formatTime(lastTickAt)}`
      : "No data received yet.";

  return (
    <TooltipProvider>
      <Tooltip>
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
            style={{
              fontSize: 10,
              fontFamily: "JetBrains Mono, monospace",
              letterSpacing: "0.9px",
              textTransform: "uppercase",
              color: cfg.textColor,
              background: cfg.background,
              borderColor: "transparent",
              padding: "1px 5px",
              lineHeight: 1.4,
            }}
          >
            {cfg.label}
          </Badge>
        </TooltipTrigger>
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
