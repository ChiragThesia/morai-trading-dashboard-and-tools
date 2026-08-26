# Refuted

Beliefs that were held, acted on, and disproved. Plus every approach tried and abandoned.

This file exists to stop the rebuild re-adopting something already killed. A refuted
belief looks exactly like an untested one from the outside — plausible, well-argued, often
published by someone credible. The only difference is that this project already paid to
find out.

Two parts. **Part 1** is beliefs that were wrong: what was believed, what is actually
true, and how the error was caught. **Part 2** is approaches abandoned or evaluated and
rejected — not always wrong, but not worth rebuilding.

Cite as `R###`.

---

## Part 1: beliefs held and disproved

### R001. CBOE timestamps are Eastern Time and need conversion.

**Believed.** A US options vendor stamps Eastern time, so apply an ET-to-UTC conversion before storage.

**Actually.** They are already UTC. The conversion shifted every stored timestamp by the offset.

**Caught by.** A Phase 2 regular-hours UAT run, which surfaced a systematic −4h shift in production alongside two other blockers. Fixed 2026-06-12 by deleting the conversion outright; 9 of 9 tests green, deployed live. Now a standing regression gate carried through three milestones, and [V016](vendors-and-infra.md#v016-cboe-timestamps-are-utc-not-eastern).

### R002. The near-term GEX wall fix was already built.

**Believed.** A prior session's own notes recorded that the wall computation had been fixed to use near-term (≤45 DTE) data instead of all-expiry data.

**Actually.** It had never been built. The pusher still queried all expiries. The note was a false memory.

**Caught by.** Checking the notes against the code during a later rebuild. Fixed in the same session — near-term walls moved the put wall from 7000 to 7700, and the distance filter from 3% to 4% — and the memory was corrected.

**Generalize.** A session log claiming "fixed X" is not evidence X was fixed, even when the log is your own. The same class bit harder once: a progress note claimed fixes that were never committed. See [P026](process-and-verification.md#p026-verify-a-claimed-fix-against-the-code-not-against-the-note-claiming-it).

### R003. Calendar entry wants positive term-structure carry.

**Believed.** A scoring term built on a carry rationale, implicitly rewarding steep positive contango between the two legs. Sourced to Johnson (2017).

**Actually.** Calendar entry wants the **front leg rich** relative to the back — mild backwardation between the legs.

**Caught by.** A dedicated backtest: an ORATS backwardation study moving from −0.09%/yr to +0.58%/yr, plus independent negative-differential evidence from a second source. The scoring curve was redesigned so the best score sits at mild negative slope, and the original carry rationale was demoted in the rule's own documentation to historical rationale, superseded by backtest evidence.

**Note.** This is a *sign* reversal on the same measure, and it is distinct from [R009](#r009-a-slope-to-return-relationship-measured-on-single-names-holds-on-an-index). Do not merge them.

### R004. IV-rank gates, a fixed IV-diff band, and a debit-percent-of-back band select calendars.

**Believed.** Three entry criteria, encoded in the picker and shipped.

**Actually.** All three failed on this exact strategy. Barred from being re-encoded in any future picker: IV-rank gates; a fixed −1% to −3% IV-diff band; a debit-as-percent-of-back-price band.

**Caught by.** Live cross-sectional runs plus the adversarial research pass in [R008](#r008-four-textbook-calendar-selection-criteria). Carried as a non-negotiable regression gate across v1.2 and v1.3, and enforced in code — a registry test asserts none of these appear as rule ids, and the criterion enum stays closed so one cannot return under a new name.

### R005. HS256 is what the auth provider issues.

**Believed.** Shared-secret HS256 JWT verification, because it was the provider's older default. The code passed review and presumably any hand-built test token.

**Actually.** The live project had switched to issuing ES256. HS256 cannot verify an ES256 signature, so **every real user's token returned 401**.

**Caught by.** Empirical inspection of a live token. Fixed by fetching the issuer's JWKS and verifying asymmetrically — which also removed the shared-secret environment variable and stays correct through any future algorithm the issuer adopts.

**Generalize.** Verify the live issuer's actual token format before trusting a documented default. Same discipline as [P028](process-and-verification.md#p028-discover-vendor-behavior-empirically-never-from-docs-or-memory).

### R006. A per-pair term-inversion gate encodes crisis avoidance.

**Believed.** "Front IV > back IV" applied per candidate, inside the strike-selection loop, as a literal encoding of a crisis-avoidance playbook rule.

**Actually.** It deleted exactly the trades with edge. Front-richness *between the two legs of one calendar* is a different signal from market-wide crisis volatility. The two look alike — both describe "front rich versus back" — but operate at different levels of the system. Conflating them means the per-trade signal that predicts profit is treated as the market-wide signal that predicts danger. ORATS' own position is that you want backwardation when buying a calendar.

**Caught by.** Live measurement showing gated-out trades had positive edge. Retired 2026-07-09.

**Replaced by.** A single market-level gate (VIX level, VIX/VIX3M ratio) computed once per scoring cycle over cohort scalars, entirely outside the candidate loop — and shaped as a hysteresis-banded penalty rather than a cliff ([D034](domain-trading.md#d034-a-hard-gate-at-a-noisy-boundary-flaps-and-deletes-the-trades-with-edge-prefer-hysteresis-or-a-graded-penalty)). The per-candidate front-richness signal survives as an ordinary continuous score term.

**Generalize.** A per-unit structural signal and a system-wide regime signal must be evaluated at their own natural scope. Never collapse them into one gate because the sign of the number looks the same.

### R007. daisyUI can consolidate the design system.

**Believed.** A CSS component library would replace hand-rolled table and button primitives.

**Actually.** Rejected on three counts, evaluated 2026-07-15. It is CSS-only with no table interaction behavior — no sort state, no `aria-sort`, no sticky header, no selection — which is exactly what the DataTable primitive needed. Adopting it introduces a **third** competing styling idiom alongside the already-adopted shadcn and custom system layer. Its default rounded-SaaS aesthetic fights the locked dense-terminal look.

**Replaced by.** Consolidating on the existing shadcn and system layer. Zero new dependencies. The hand-rolled DataTable was kept.

### R008. Four textbook calendar-selection criteria.

**Believed.** Four widely-repeated practitioner heuristics for calendar entry.

**Actually.** All four refuted — voted down, not merely unsupported — in a 102-agent, 3-vote adversarial pass over 25 claims:

| Claim | Vote |
|---|---|
| IV-rank / IV-percentile entry gates for calendars, including "enter when IV is low because the position is vega-positive" | killed 0-3, 1-2, 1-2 |
| "Back-minus-front IV differential of −1% to −3% is the ideal band" | killed 0-3 |
| "Fair debit is 25-40% of back-month premium" | killed 0-3 |
| "Further-OTM strikes monotonically decrease both debit and probability of profit" | killed 1-2 |

The two numeric heuristics traced to a single source with fabricated specifics.

**Generalize.** A source repeating a specific numeric heuristic with no cited derivation is a red flag, however authoritative it sounds.

### R009. A slope-to-return relationship measured on single names holds on an index.

**Confidence: claimed, not verified.** Recorded here because acting on it is expensive, not because it was measured here.

**Believed.** A slope-to-return signal calibrated on single-name equity chains can be ported to SPX by recalibrating the threshold.

**Reported.** The 102-agent research pass (2026-08-24) found the sign **flips** between index and single names — Johnson 2016 against Vasquez 2015. Rescaling a threshold does not fix a sign error.

**Caught by.** Literature comparison, not by our own data. The same pass also established that the published forward-flatness gate is a monthly **decile rank**, not a threshold — which makes the vendor's `FF ≥ 16-20%` unsourceable as stated. The primary sources, since the decile-rank claim is the load-bearing half. Campasano's forward-factor sort is chapter 2 of his 2018 UMass PhD thesis, circulated as SSRN 3240028 with a co-authored companion at SSRN 2871616: 284,984 calendar spreads across 6,799 equities, 1996 to 2015, ranked by a *monthly cross-sectional decile*. A grep of both full texts returns zero hits for threshold, cutoff or breakpoint. On the sign flip, Jones and Wang (2012) sits with Vasquez on the single-name side, giving two independent positive-sign findings against Johnson's negative one on the index.

**Owed.** Regress forward-flatness percentile against realised P&L on our own SPX history. Until that runs, treat the index sign as unknown, not as flipped.

### R010. The expected-move error flips sign across vol regimes.

**Believed.** A shipped tooltip claimed the band's over-width flips to under-width in stressed regimes.

**Actually.** It is too wide in **every** regime, least so in stress. Fitted 1σ haircut by VIX tercile: 1.13 in the calmest down to 1.08 in the highest for a VIX1D band, 1.57 down to 1.15 for a 30-day-VIX band. Every bucket sits above 1.00. The true prior-close-tagged 2σ breach rates run 3.66% and 3.07%, both below the 4.55% expected — flat, and consistently on the wide side.

**Caught by.** The same contamination as [R011](#r011-high-vvix-predicts-wider-expected-move-tails): the original figures were tagged with same-day VIX. Re-tagged at the prior close, the flip disappears. Corrected finding lives at [D022](domain-trading.md#d022-a-1-day-expected-move-band-from-vix1d-reads-about-11-too-wide-a-30-day-proxy-is-12-points-worse).

### R011. High VVIX predicts wider expected-move tails.

**Believed.** High VVIX roughly doubled the 2σ breach rate within the same VIX bucket. Proposed as a "trust this band less today" panel flag.

**Actually.** The effect does not exist. The finding tagged each session's VVIX regime using VVIX's **same-day close** — and a large price move itself raises VVIX that day, so the label conditioned on the outcome it claimed to predict.

**Caught by.** Re-tagging with the prior close, the only value a non-repainting study can read, on identical days:

| Tagging | Low VVIX 2σ breach | High VVIX 2σ breach |
|---|---|---|
| Prior close (n = 848 each) | 2.95% | 3.07% |
| Same day, identical days | 3.07% | 5.18% |

A regression of mean \|z\| against prior-day VVIX within VIX deciles gives t = +1.18 on n = 5,088 — a well-powered null. Measured 2026-08-25 and refuted for the fourth time. The flag was never built.

**The law.** A regime tag readable only at the close of the day you are predicting is the answer, not a predictor. If a chart cannot see it in time, do not measure with it.

**Also refuted with it.** The Johnson coefficient `k = 2` assumption for the 6-month tenor that fed this work. A stability test across fitted `k` of 1.168 to 1.782 reversed the planned coefficient swap rather than shipping it. Do not re-attempt the `k = 2` approach without re-deriving from that stability range. See [D024](domain-trading.md#d024-a-term-structure-de-trending-coefficient-does-not-survive-a-tenor-substitution).

### R012. Smile-aware IV would close the ThinkorSwim breakeven gap.

**Believed.** Per-strike smile interpolation was a missing feature blocking T+0 parity with the reference tool.

**Actually.** Not needed, and recorded as a researched DO-NOT-BUILD. The reference tool's own default "Individual Implied Volatility" mode holds each option series' calibrated IV fixed as spot moves, with no smile re-interpolation — exactly what a flat front/back scenario model already does for a single-strike calendar. Smile interpolation matters only for multi-strike books such as verticals and condors.

**Caught by.** Checking the reference tool's own default behavior before building complexity to out-match it. The real gap closed on fractional settlement DTE and parity-implied carry instead ([D013](domain-trading.md#d013-the-t0-breakeven-gap-to-thinkorswim-closes-on-fractional-settlement-dte-plus-parity-carry-smile-iv-is-not-needed)). The smile revisit trigger was never tripped.

### R013. Matching a vol index's own maturity to the forecast horizon improves calibration.

**Believed.** VIX9D calibrates best for a one-week move, VIX for a one-month move.

**Actually.** False when measured. VIX's fitted haircut is flat at roughly 1.35 across 1-day, 5-day and 21-day horizons over 9,221 sessions — it does not improve at its native 30-day tenor. The systematic over-width is the variance risk premium baked into the index **level**; sqrt(t) scaling carries that premium proportionally to any horizon. VIX1D carries the smallest premium and beat both at every horizon tested (21-day haircut 0.98 against 1.12 and 1.19), though on thin evidence — n = 50 non-overlapping months, one low-vol regime.

**Caught by.** Running every index at every horizon rather than assuming. The tenor pairing was kept anyway, but only because it matches market convention and what a chain quote would show — explicitly not because it calibrates best.

### R014. A `?? 0` in the vendor adapters caused the null-open-interest bug.

**Believed.** Reading the adapter code, an `optional() ?? 0` fallback looked like the cause: the vendor must be omitting the field. Written up and acted on as a confirmed root cause. A nullable-contract migration was built for it.

**Actually.** The vendor sent open interest correctly the whole time — 21,320 contracts non-zero, 78.7%. The migration fixed a field that was never broken. The real cause was ingest **merge order**: a second vendor legitimately reports zero outside regular hours and its row landed after the first in the same dedup window.

**Caught by.** One `curl` of the public vendor endpoint. See [P020](process-and-verification.md#p020-a-root-cause-read-off-the-code-is-a-hypothesis-a-root-cause-read-off-the-wire-is-a-finding) and [V019](vendors-and-infra.md#v019-cboe-sends-open-interest-correctly-do-not-blame-the-adapter).

**Still resurfacing.** The `?? 0` reading reappeared in project memory months later, written up again as the confirmed cause with both adapter files named. It is a good-looking wrong answer, which is exactly why this entry exists. The wire check settles it in one command; the code read never will.

### R015. A VIX futures spread is the futures equivalent of the spot term structure.

**Believed.** An earlier draft asserted that a front-to-second VIX futures spread substitutes for the spot 3-month-over-1-month ratio.

**Actually.** They are not interchangeable. Refuted using the 2024-08-05 spot-versus-futures backwardation gap (BIS Bulletin 95), and reverted to two separate rows.

### R016. VIX9DCLS is a FRED series.

**Believed.** A natural-looking sibling to `VIXCLS` and `VXVCLS`, proposed during regime-board indicator research.

**Actually.** It does not exist. Confirmed HTTP 404 and absent from FRED's own category listing. A hallucinated identifier.

**Caught by.** Resolving the id against the live API before admitting the indicator. The real VIX9D came from CBOE's delayed-quote endpoint instead. See [V021](vendors-and-infra.md#v021-a-plausible-sounding-series-id-can-simply-not-exist).

### R017. The mobile breakpoint is 768px.

**Believed.** A design directive specified `<768px` for the mobile redesign.

**Actually.** The codebase's only real, already-in-use responsive boundary was `lg:` / 1024px. The spec was corrected to match reality rather than introducing a second unused breakpoint.

**Generalize.** Check a directive's assumed constant against the codebase's actual live value before building to it.

### R018. RSP:SPY, the VVIX/VIX ratio, and HYG are admissible regime indicators.

**Believed.** Three candidate indicators for the regime board.

**Actually.** All three dropped, each for its own documented reason and each with a revival path recorded:

| Candidate | Why dropped |
|---|---|
| RSP:SPY equal-weight breadth | No verified server-fetchable source. No equity-quote endpoint on the broker side; the secondary vendor's CSV endpoint returns a bot challenge, not data |
| VVIX/VIX ratio | Double-counts the same two raw series under a threshold set the user had never battle-tested, alongside the already-shipped absolute VVIX indicator |
| HYG closing price | Same ETF-quote availability gap as RSP:SPY. Superseded by a FRED high-yield-spread series that is available |

**Generalize.** Verify a candidate indicator has an actually-reachable live source before admitting it to any evidence table.

### R049. The ThinkorSwim payoff date line prices at the picked date's close plus one day.

**Believed.** A reported bug in the T+0 date line was fixed by pricing the picked date at close-of-day plus one whole day. The fix matched the user's reported numbers and shipped (commit 0a54729).

**Actually.** It prices at the **start** of the picked date, with today clamped to zero so it prices at now with live theta. The close-plus-one convention only looked correct because a separate carry-identity bug was in flight at the same time and the two errors cancelled.

**Caught by.** A dollar-exact single-position comparison after the carry bug was fixed. ThinkorSwim's 7/29 line read $785; start-of-date computes $764-785, close-of-date $869, and close-plus-one $1,031 — which is exactly what the earlier "fix" produced. Corrected in commit 4c7a29d.

**Generalize.** One approximate breakeven-pair match cannot pin a convention while another error is in flight, because two wrong numbers multiply into a right-looking one. Demand a dollar-exact single-position oracle before locking any pricing convention. See [P018](process-and-verification.md#p018-build-a-validated-oracle-before-touching-money-code).

### R050. "ThinkorSwim fidelity" means matching the vendor's palette.

**Believed.** A chart requirement written as "TOS-fidelity" was read as pixel-matching the reference platform's colours — magenta and cyan.

**Actually.** The user retired that reading outright: "keep TOS graph LOGIC, use MORAI UI design, don't need pixel-perfect." A fidelity requirement against a reference tool means emulating its *behaviour* — combined y-domain, round x-ticks, date projection, axis scaling — and styling it in your own design tokens.

**Caught by.** Asking, after building to the wrong reading. Worth asking first: a vendor-parity requirement almost always names behaviour and almost never names colour. See [L079](LAWS.md#l079-reserve-color-for-what-is-abnormal) for what governs colour once it is yours to choose.

### R051. Low implied volatility means entering further out of the money.

**Believed.** The trader's own prior: when volatility is low, push the strike further from spot.

**Actually.** The expected-move tent widens in proportion to implied vol, so a constant-delta selection rule already scales strike distance with volatility. There is nothing left for an IV-conditioned adjustment to add, and adding one double-counts.

**Caught by.** A research pass on the picker rule engine, which refuted it in the same round that killed the IV-rank gate for calendar screening on SPX — see [R004](#r004-iv-rank-gates-a-fixed-iv-diff-band-and-a-debit-percent-of-back-band-select-calendars).

### R052. Two vol-ratio gates predict a calendar's realised cost.

**Believed.** `VIX9D/VIX ≥ 1.00` marked expensive entries, worth −$592. `VIX3M/VIX < 1.111` marked another, worth −$378. Both were candidate entry gates.

**Actually.** Both are noise. Rebuilt on non-overlapping windows they collapse to −$214 at t = −0.74 and −$184 at t = −0.70.

**Caught by.** Rebuilding the sample by walking forward and skipping the hold length, instead of taking every date as a new observation with an overlapping hold. Full mechanism at [P033](process-and-verification.md#p033-overlapping-windows-inflate-a-t-statistic-and-inflate-it-toward-what-you-were-hoping-for). Neither gate was built.

---

## Part 2: approaches abandoned

Not always wrong. Not worth rebuilding.

### R019. A same-slice hypothetical trade simulation.

Priced entry and exit from one as-of chain slice. Measured transaction cost, not edge — the P&L is algebraically sign-fixed. Replaced by a genuine forward walk to expiry or first actionable verdict. Full mechanism and algebra at [D021](domain-trading.md#d021-a-backtest-that-prices-entry-and-exit-from-the-same-chain-slice-measures-the-spread-not-edge). Do not rebuild the same-instant version.

### R020. A preview clock derived from the stored data's own `asOf`.

Defeats every staleness check, because the age comparison is always zero. Replaced by a real injected `now()` port. See [L050](LAWS.md#l050-a-preview-that-substitutes-stored-datas-own-timestamp-for-now-defeats-every-staleness-check).

### R021. Uniform weight scaling to simulate a weight change in a preview.

Produces a fake uniform delta under sum-normalized scoring. Replaced by the actual per-field weights plus bonus, matching the real formula. See [L031](LAWS.md#l031-uniform-scaling-of-every-weight-is-a-no-op-under-sum-normalized-scoring).

### R022. Scoring normalized theta as a strike discriminator.

`thetaCarry` — net theta over extrinsic value — is U-shaped in strike and systematically picks the most extreme strike. The replacement tried next, `netTheta/|netGamma|`, was worse: monotonic with no minimum at all. See [D007](domain-trading.md#d007-theta-as-a-percent-of-extrinsic-value-is-u-shaped-in-strike-it-is-a-tenor-comparator-not-a-strike-comparator).

### R023. Scoring `frontVrp` as a fourth independent term.

Collinear with the existing forward-vol edge term (correlation 0.954), because the shared snapshot-wide scalar cannot move any pairwise ranking. See [D008](domain-trading.md#d008-a-scalar-shared-by-every-candidate-is-mathematically-inert-in-a-percentile-rank-scorer).

### R024. Widen the single Schwab chain call to cover the full strike range.

`strikeCount ≥ 150` reliably triggers the vendor's own 502 gateway body-buffer-overflow limit, regardless of date-range narrowing. Dual-sourcing was used instead — a narrow Schwab call unioned per cycle with a wide CBOE call. Never try widening the single call again. See [V004](vendors-and-infra.md#v004-an-unbounded-strike-ladder-returns-502-before-auth-or-parameter-validation-runs), [V005](vendors-and-infra.md#v005-the-narrow-window-does-not-just-miss-data-it-biases-the-derived-risk-metric-in-a-known-direction).

### R025. Adopt `schwab-py` as the whole Schwab client.

Evaluated and rejected even though it is the more mature library. It does not beat the hard 7-day refresh-token expiry ([V001](vendors-and-infra.md#v001-the-refresh-token-expires-7-days-after-issuance-nothing-extends-it)), does not fix the 502 body-size limit any better than three added query parameters, and forces either duplicating token-encryption logic in a second language or stripping the library to a dumb HTTP wrapper. The existing adapter was fixed with request-scoping parameters instead.

**Note.** A Python sidecar *was* eventually adopted, for a different reason — single-process token and streamer-session ownership ([L051](LAWS.md#l051-isolate-a-vendor-that-demands-single-process-ownership-in-its-own-service)). That is not the same decision as adopting the library wholesale.

### R026. Rewrite and recompile the Pine source on every scheduled push.

This is what every public vendor GEX script does. Rejected because three consecutive failed compiles ban the script from compiling for one hour, and a 30-minute republish loop is exactly what eventually trips it. The compiled indicator's input value is set directly over CDP instead — no compilation at all. See [V057](vendors-and-infra.md#v057-three-failed-compiles-ban-the-script-from-compiling-for-one-hour).

### R027. Nearest-available-strike as a delta reference.

Degenerates on a sparse ladder, and a tolerance alone is not enough. Replaced by linear interpolation in delta space with a never-extrapolate refusal. See [D006](domain-trading.md#d006-nearest-available-strike-to-a-target-delta-degenerates-on-a-sparse-ladder-interpolate-or-refuse).

### R028. Open interest ≥ 100 as a liquidity gate.

Removes 82% of candidates, including 69% of the near-ATM strikes the strategy wants, because OI legitimately starts low on freshly listed weeklies. See [D009](domain-trading.md#d009-on-a-fresh-weekly-index-chain-neither-open-interest-nor-spread-is-a-usable-liquidity-filter).

### R029. Per-expiry carry lookup with a silent flat fallback on cache miss.

Priced the two legs of 56% of live candidates on different carry regimes and reordered the ranked list. Replaced by a single snapshot-wide carry constant. See [D015](domain-trading.md#d015-carry-must-come-from-the-same-computation-that-solved-the-iv-it-reprices).

### R030. A per-candidate event-blackout entry gate.

It was really an **exit** discipline mistakenly encoded as an **entry** block, and it rejected structures the user actually trades. Killed 2026-07-14. Replaced by a score penalty plus a pre-computed forced-close date. Same shape as [R006](#r006-a-per-pair-term-inversion-gate-encodes-crisis-avoidance): the wrong scope for the signal.

### R031. Automated weight optimization against the 13 closed trades.

Rejected in every research pass as dishonest by construction — 9 free weights against 13 correlated outcomes. The design settled on refutation only: leave-one-out sign stability, bootstrap confidence intervals, human-reviewed diffs, and no promotion until n ≥ 30 real closed trades. Enforced structurally, not by process rule. See [D036](domain-trading.md#d036-n13-is-overfitting-formalized-no-confidence-percentage-no-weight-promotion-below-n30).

Excluded alongside it, for the same reason: Kelly and optimal-f position sizing (the sample cannot supply a reliable edge estimate to size against), and an ML regime-classification model (two threshold gates were judged sufficient).

### R032. A dual TypeScript-side OAuth token refresher.

The pre-sidecar auth design. Abandoned after a rotating-token race produced `invalid_grant`. Replaced by making one process the sole token owner and sole streaming-session owner. See [V002](vendors-and-infra.md#v002-two-processes-refreshing-the-same-rotating-token-invalidate-each-other-inside-one-cycle).

### R033. "Live-write-only, never backfill" as the journal's data-loss policy.

Abandoned once it became clear the raw source data survived and could reconstruct the gaps. Replaced by self-heal plus an on-demand rebuild. See [L039](LAWS.md#l039-a-live-write-only-pipeline-turns-every-outage-into-a-permanent-hole), [L040](LAWS.md#l040-stopping-bad-writes-without-a-repair-path-just-moves-the-failure-mode).

### R034. A hand-rolled-only SVG chart stack.

A locked architecture decision, partially reversed for the four highest-traffic charts after the same bug class kept recurring. Others retained. See [L080](LAWS.md#l080-a-real-charting-library-kills-the-overflow-bug-class-structurally).

### R035. A single joined row-per-strike chain table.

An implicit inner join. Unmatched strikes vanished with no dash and no marker. Replaced by a Browse plus Pair split. See [L062](LAWS.md#l062-a-joined-row-per-key-display-is-an-implicit-inner-join-unmatched-rows-vanish-with-no-marker).

### R036. Browser-side BSM and greeks math.

Already deleted once, in the commit that made the browser read the chain table from the server. Do not resurrect client-side pricing.

### R037. Rescaling the expected-move DAY band intraday as realized vol spikes.

Rejected on measurement: the correlation between SPX return and the change in VIX1D is −0.464, and VIX1D rose on 65.1% of down days. A band that widens on a vol spike chases price away and under-registers exactly the days that matter. Only the separate remaining-move number moves; the DAY band stays fixed at its anchor.

### R038. sqrt(365) calendar-day annualisation for the expected-move band.

Scores nearer the 68.27% coverage target on raw numbers — but only by cancelling two separate errors into one number: a wrong time base, and a variance risk premium pointing the other way. That silently breaks the day the premium changes. sqrt(252) plus an explicit visible haircut was kept instead. See [D017](domain-trading.md#d017-vix1d-defines-a-session-as-exactly-1252-dividing-by-sqrt252-inverts-its-own-construction).

### R039. All-expiry GEX walls as calendar trading levels — and the shipped ≤45 DTE field as the fix.

Unbounded walls are 44.3% near-term noise. But the shipped `near_term` field is also wrong for this purpose: it keeps the 0DTE noise **and** cuts the largest single expiry line. A properly DTE-windowed wall computation was identified as the fix and was not built. See [D001](domain-trading.md#d001-meaningful-gamma-walls-need-both-tails-cut-8-to-45-dte).

### R040. A 15-day floor for the GEX near-term window.

Tried before landing on 8. The 8-14 day bucket carries 11.9% of gamma and a maturing front leg still belongs in that window.

### R041. Three rejected fixes for the skew call/put key collision.

All three considered and rejected while building migration 0030:

| Rejected fix | Why |
|---|---|
| Dedupe in the writer | The colliding rows are the two wings of one smile, not duplicates. Deduping drops the same 1,748 rows deliberately instead of arbitrarily |
| Narrow the smile read to OTM-only quotes | The risk-reversal interpolation needs both wings to bracket ±25Δ. This silently changes every value going forward — a model change disguised as a bugfix |
| Backfill the orphaned pre-0029 rows as `SPXW` | A best guess. "The precise failure mode this whole line of work exists to remove." DELETE-and-restart was chosen instead |

See [L001](LAWS.md#l001-a-composite-key-missing-a-true-discriminator-silently-drops-30-50-of-every-batch).

### R042. Widening the self-heal slot window speculatively.

The root window-semantics bug was diagnosed and deliberately **not** fixed in the same session. Observability shipped first — a per-run coverage log — because widening the window risks fabricating a row for a genuinely empty slot from a prior slot's stale observation, which breaks a locked invariant. See [L041](LAWS.md#l041-an-honest-gap-beats-a-fabricated-value-fill-only-never-overwrite), [L043](LAWS.md#l043-a-job-that-logs-nothing-on-success-makes-healed-nothing-never-ran-and-errored-per-slot-identical), [L048](LAWS.md#l048-a-half-open-slot-window-is-blind-to-an-observation-just-before-the-anchor).

### R043. Collapsing the two SPX and SPXW chain fetch calls into one.

Both already resolve server-side to the identical `$SPX` request — a known, evidenced redundancy. Evaluated several times and declined as not cheap or safe: it restructures a concurrency and error-collection shape plus roughly 9 tests, and risked interacting with a call-failure fallback path shipped in the same session.

### R044. A batching and time-budget guard inside the shared rebuild engine.

Deferred in favour of the lighter fix — continue-on-error instead of abort-on-first-error ([L019](LAWS.md#l019-a-single-items-failure-must-not-abort-the-whole-batch)). The unbounded "repair all" scope stayed a CLI-only escape hatch rather than being solved structurally.

### R045. A third "sustained price trend" anti-criteria brake.

Deliberately not built. The corpus (n = 13) was too small to calibrate a threshold honestly, and existing vol-regime gates plus exit-side stop and gamma rungs were judged to cover the same risk indirectly.

### R046. A ThinkorSwim custom column computing per-leg gap days for calendar rolls.

`GetDaysTillDate` is unavailable inside custom columns. A sign-opposite DTE workaround was designed and its implementation also failed. Abandoned in favour of manual roll-ladder tracking, 2026-08-11.

### R047. Nushell as a shell replacement.

Evaluated twice (2026-06-25, and again 2026-06-27/28) and declined both times in favour of zsh with starship and carapace. Repeated re-evaluation with no new reason is itself the signal not to keep re-opening it.

### R048. Excluded by scope, permanently.

Not failures. Decisions, each with a stated reason. Listed so the rebuild does not re-derive them.

| Excluded | Reason |
|---|---|
| Auto-execution of exits and rolls, auto-constructed roll orders, tick-level exit re-evaluation | The advise/execute boundary — [L052](LAWS.md#l052-advise-and-execute-are-separated-in-code-not-in-policy) |
| A generic backtest DSL or strategy language | One trader, one strategy family, one engine |
| Multi-user support and public API versioning | Single user — [L068](LAWS.md#l068-the-journal-is-the-anchor-one-user-by-design) |
| Live regime and timing advice | A separate plugin owns it; this system scores structures, not advice timing |
| Confidence percentages on verdicts | No calibration basis at n = 13 — fabricated precision |

### R053. A 200-day moving-average regime skip filter.

172 "on" days that are really 16 episodes, 129 of the days from 2022 alone, and it catches none of the five worst non-2022 windows because all five were above the 200-day. One episode of evidence dressed as a decade of it. See [D049](domain-trading.md#d049-count-a-regime-filters-episodes-not-its-days-one-crisis-wears-the-filters-clothes).

---

## Still open

One dead end is not resolved and should not be treated as either result.

**Calendar strike selection above versus below spot.** A 10-year SPX simulation produced a
result that inverted the retail prior. The result was attributed to a percent-of-debit
measurement artifact, and a re-run in absolute-dollar terms was left pending as of
2026-08-25. Do not trust the inverted-prior finding until the absolute-dollar re-run
actually happens.
