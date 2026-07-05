// Streaming bounded context — ports and domain compute
// Phase 12: SSE fan-out pipeline (sidecar→server→browser)

export type {
  RawOptionTick,
  LiveGreekTick,
  ReconciledPosition,
  StreamReconcileError,
  ForReconcilingPositions,
} from "./ports.ts";

export { recomputeLiveGreek } from "./recompute-live-greek.ts";
export type { LiveGreekSkip } from "./recompute-live-greek.ts";

// SNAP-01 (20-04/20-06): rolling-window % move detector — composed in apps/server's
// onSpotObserved wiring (Pattern 2).
export {
  detectLargeMove,
  MOVE_WINDOW_MS,
  MOVE_THRESHOLD_PCT,
} from "./domain/spot-move-detector.ts";
export type { SpotSample } from "./domain/spot-move-detector.ts";
