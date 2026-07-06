# Ground Truth — per-calendar P&L from real Schwab transactions

Computed independently from `get_transactions` (the authoritative signed `netAmount` cash flows),
NOT from the buggy pipeline. This is the ORACLE every fix + test must match.
Source data: scratchpad/txns.json · analyzer: scratchpad/ground-truth.mjs · date: 2026-07-05.

Convention: `netAmount` sign is authoritative (negative = cash paid, positive = cash received).
- openNetDebit (points) = −(open-order net cash) / 100
- closeNetCredit (points) = (close-order net cash) / 100
- realized P&L ($) = open cash + close cash (both signed)

| id | label | openDebit(pts) | closeCredit(pts) | realized $ | true status |
|---|---|---|---|---|---|
| 65aac62e | 7425P Aug7/Aug31 | **32.37** | 36.33 | **+395** | CLOSED (reg says OPEN ✗) |
| 24f1e72e | 7475P Jul9/Jul31 | (roll) | (roll) | +4663* | CLOSED |
| 60c46a57 | 7425P Jul8/Jul31 | 44.22 | (roll) | −4257* | CLOSED |
| 3ca74277 | 7375P Jul8/Jul31 | 43.02 | 42.33 | −70 | CLOSED |
| 8a63aa81 | 7275P Jun18/Jun23 | 10.22 | 10.53 | +30 | CLOSED |
| 6303e6af | 7275P Jun18/Jul17 | 46.02 | 46.98 | +95 | CLOSED |
| 45727d08 | 7300P Jun5/Jun29 | 44.52 | 44.98 | +45 | CLOSED |
| 53533aa7 | 7275P Jun5/Jun26 | 39.57 | 41.23 | +165 | CLOSED |
| b0d862ba | 7300P May29/Jun22 | 45.37 | 48.83 | +345 | CLOSED |
| e8bfbf41 | 7175P May22/Jun15 | 44.62 | 43.78 | −85 | CLOSED |
| 9eef2153 | 7100P May15/Jun8 | 42.87 | 46.58 | +370 | CLOSED |
| 95546839 | 7050P May20/Jun18 | 47.57 | 48.73 | +115 | CLOSED |
| f3789ddd | 6900P May7/Jun1 | 40.62 | 40.98 | +35 | CLOSED |

\* The 24f1e72e / 60c46a57 pair share ONE roll order (1006797510202): it closes the 7425P Jul8/Jul31
and opens the 7475P Jul9/Jul31. My simple analyzer double-counts across the roll; the real per-leg
split needs the WR-A1 rollOpenDebit/rollCloseCredit logic. The 11 non-roll calendars are clean.

## Root causes exposed (the pipeline vs this oracle)

1. **Sign/netting regression (round-2 side-fix):** `recomputeCalendarAmounts` now folds CLOSE credit
   into openNetDebit → 65aac62e = −4 (32.37 open − 36.33 close) instead of openNetDebit = +32.37.
   Closed calendars → ~0. openNetDebit must be OPEN-events-only; closeNetCredit CLOSE-only.
2. **Closed-status not set:** EVERY calendar has a matching close order → all 13 are CLOSED. But
   65aac62e is registered `open`, so snapshot-calendars kept snapshotting it past its Jul-1 close
   and the masthead shows a live mark-based P&L (the $4050) for a trade that's actually done.
3. **Live-vs-realized P&L:** for a CLOSED trade the journal P&L should be REALIZED
   (closeCredit − openDebit), not the live `(netMark − openNetDebit)×100` mark formula.
4. **Roll split:** the 24f1e72e ↔ 60c46a57 roll must split open vs close correctly (WR-A1).

## The real bottom line for the user
These are 13 CLOSED SPXW put-calendar trades (Apr–Jul). Net realized ≈ **+$1,846** across all of them
(modulo the roll pair). All map 1:1 to real Schwab orders — none fabricated.
