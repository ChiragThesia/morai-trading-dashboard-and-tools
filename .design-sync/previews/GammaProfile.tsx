import { GammaProfile } from "@morai/web";

// A profile that crosses zero at ~7450 — the gamma flip level.
const PROFILE = Array.from({ length: 41 }, (_, i) => {
  const spot = 7200 + i * 15;
  return { spot, gamma: (spot - 7450) * 0.42 + Math.sin(i / 3) * 9 };
});

/** Full size (720×230) — the Market screen anchor. Teal above zero, coral below. */
export function Full() {
  return <GammaProfile profile={PROFILE} spot={7482} flip={7450} />;
}

/** Compact (300×130) — the Analyzer right panel. */
export function Compact() {
  return <GammaProfile profile={PROFILE} spot={7482} flip={7450} compact />;
}

/** No flip level in the book — the amber dashed line is omitted, not faked at zero. */
export function NoFlip() {
  return <GammaProfile profile={PROFILE} spot={7482} flip={null} width={560} height={200} />;
}
