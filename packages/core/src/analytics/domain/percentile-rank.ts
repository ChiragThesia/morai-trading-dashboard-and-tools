// Analytics domain — inclusive trailing-window percentile rank.
// Implementation promoted VERBATIM to @morai/shared (picker's slopePercentile needs it and
// may not import another context's domain — hexagon law §7). Re-exported here so existing
// analytics import paths and tests are unchanged.

export { percentileRank } from "@morai/shared";
