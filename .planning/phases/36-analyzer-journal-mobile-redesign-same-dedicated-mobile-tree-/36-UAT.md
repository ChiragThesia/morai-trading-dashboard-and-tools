---
status: passed_pending_user_phone_check
phase: 36-analyzer-journal-mobile-redesign
source: [36-VALIDATION.md C1–C11, 36-05-SUMMARY.md PENDING-ORCHESTRATOR table]
started: 2026-07-11T22:20:00Z
updated: 2026-07-11T22:55:00Z
bundle: index-S15BRDgT.js (Vercel auto-deploy of 31340a6)
---

## Checks (chrome-devtools, live morai.wtf)

| # | Claim | Result |
|---|-------|--------|
| C1 | Analyzer cold/zero state: paste first, bare prompts, zero hollow shells | PASS (390×844: paste+Analyze → CANDIDATES label → two-line zero-filtered prompt; nothing else renders) |
| C2 | No horizontal page scroll both screens, 390 + 320 | PASS after live-caught fix (see below): scrollWidth === innerWidth on Analyzer (incl. pasted chip-heavy card) and Journal (incl. lifecycle pan mount) |
| C3 | Analyzer chart edge-to-edge, one slim chrome row; dialogs; disclosures fit | PASS (paste → card + 32px scorecard hero + checklist + `‹ Jul 11 · today ›  ⋯` row + full-bleed chart + caption; Term disclosure opens via real `open` attr, no overflow) |
| C4 | Journal lifecycle 60%-width bug GONE | PASS (pan container: inner 840px, clientWidth 390, scrollLeft 450 = opened at latest; page scrollWidth stays 390; chart legible at designed scale) |
| C5 | Journal cards: single OPEN affordance, focal P&L, History folds | PASS (open cards = name + OPEN badge + meta `· open · entry/exit only`; closed = dim `—` (list endpoint carries no P&L — same data path as desktop); History (16) unfolds to 18 cards) |
| C6 | ⋯ → Rebuild → confirm stack; Cancel unwinds one layer | PASS (⋯ "More journal actions" → `Rebuild journal for {id}` → confirm dialog with verbatim "This overwrites all snapshot history."; Cancel returned to the ⋯ dialog — one layer; NOT confirmed — no live rebuild fired) |
| C7 | 1440px pixel-identity vs pre-phase baselines (both screens) | PASS (Analyzer: 3-col grid + 4 panels + paste rail identical; Journal: 3-col + Rebuild in heading + footnotes + full rail identical; baselines captured pre-deploy on index-CXLMcvFl.js) |
| C8 | 320px: no wrap-break/clip/h-scroll | PASS (scrollWidth === innerWidth both screens at 320-class viewport) |
| C9 | iOS zoom guard | PASS by construction (paste input text-base = 16px, D-18; jsdom asserts class) — real-device confirm folds into C11 |
| C10 | Resize across 1024px swaps trees | PASS (same page driven 390-emulated ↔ 1440 desktop repeatedly during this UAT; no crash) |
| C11 | User phone check — Analyzer + Journal on morai.wtf | PENDING — the only bar |

## Live-caught fixes (agent UAT round, both TDD red→green, deployed)

**Catch #26 (review WR-01, spec's-own-bug class):** mobile Analyzer chart block rendered
whenever a candidate was selected — pasting during picker cold-start/error priced the
book at the `spot = 0` fallback (IV bisection at S=0, degenerate 0→strike domain) and
the caption fabricated `schwab ·` provenance. Fixed 0a66a4b: chart block gated on
`snapshot !== null`; MobileAnalyzerChart takes non-null snapshot (fallbacks deleted at
type level).

**Catch #27 (live C2 failure):** pasted chip-heavy candidate (9 event badges) blew the
page to 533px at 390 — CandidateCard's meta chips are adjacent inline spans with NO
whitespace between them → zero soft-wrap opportunities → one unbreakable line.
Pre-existing latent bug on the 300px desktop rail too. Fixed 31340a6: `flex flex-wrap`
on the meta container (wrap point at every chip). The 36-05 "CandidateCard zero diff"
tripwire was consciously superseded by the C2 hard bar + root-cause rule; desktop
re-verified at 1440 post-fix.

## Suite

303 files / 3376 tests green · typecheck clean · lint clean.
