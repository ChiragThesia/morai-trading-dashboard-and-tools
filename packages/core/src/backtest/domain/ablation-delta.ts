/**
 * ablation-delta — rank delta between baseline and leave-one-rule-out ablated rankings
 * (BT-04). Diffs two already-ranked id lists (index 0 = rank 1, best); it does NOT
 * re-score — the ablated ranking is produced upstream by re-running
 * scoreCalendarCandidates with a rule's weight zeroed (27-RESEARCH.md Pattern 2).
 *
 * Invariant this fn's callers depend on: zeroing a rule whose raw contribution to a
 * candidate was positive can only push that candidate's rank index up (worse) or leave
 * it unchanged — never down (an "improved" rank). Pure — no I/O, no clock.
 */

export function ablationDelta(
  baselineRanked: ReadonlyArray<string>,
  ablatedRanked: ReadonlyArray<string>,
  candidateId: string,
): number | null {
  const baselineRank = baselineRanked.indexOf(candidateId);
  const ablatedRank = ablatedRanked.indexOf(candidateId);
  if (baselineRank === -1 || ablatedRank === -1) return null;
  return ablatedRank - baselineRank;
}
