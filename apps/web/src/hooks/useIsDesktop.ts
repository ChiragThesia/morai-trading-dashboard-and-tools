/**
 * useIsDesktop — reactive `(min-width: 1024px)` media-query state (the app's `lg:`
 * breakpoint, Phase 35 D-01).
 *
 * Exists because CSS alone cannot force a closed `<details>` open: the UA hides
 * closed-details content in an internal slot that child `display` overrides never
 * reach, so `lg:[&>div]:!block` rendered the desktop MarketRail column EMPTY
 * (live-UAT catch, 2026-07-11). Components that must be structurally open at
 * desktop set the `open` attribute from this hook instead.
 *
 * jsdom-safe: jsdom has no `matchMedia`, so the hook reports `false` (mobile
 * default) — tests stub `window.matchMedia` to exercise the desktop branch.
 */
import { useSyncExternalStore } from "react";

const QUERY = "(min-width: 1024px)";

function subscribe(onStoreChange: () => void): () => void {
  if (typeof window.matchMedia !== "function") return () => undefined;
  const mql = window.matchMedia(QUERY);
  mql.addEventListener("change", onStoreChange);
  return () => {
    mql.removeEventListener("change", onStoreChange);
  };
}

function getSnapshot(): boolean {
  if (typeof window.matchMedia !== "function") return false;
  return window.matchMedia(QUERY).matches;
}

export function useIsDesktop(): boolean {
  return useSyncExternalStore(subscribe, getSnapshot);
}
