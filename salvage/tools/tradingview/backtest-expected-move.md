# Expected Move — calibration backtest

SPX 13019 days · VIX 9257 · VIX9D 3932 · VIX1D 1073 · VVIX 5089
Perfect calibration: 1σ 68.27% · 2σ 95.45% · 3σ 99.73% · mean|z| 0.7979

## 1. Each source over its own full history

| source | window | n | 1σ | 2σ | 3σ | mean\|z\| | implied haircut |
|---|---|---:|---:|---:|---:|---:|---:|
| VIX1D | 2022-05-16 → 2026-08-24 | 1072 | 72.67% ±1.36 | 96.83% ±0.54 | 99.53% ±0.21 | 0.720 | 1.108 |
| VIX9D | 2011-01-05 → 2026-08-24 | 3930 | 79.85% ±0.64 | 98.14% ±0.22 | 99.67% ±0.09 | 0.617 | 1.293 |
| VIX | 2006-03-07 → 2026-08-24 | 5088 | 80.80% ±0.55 | 98.03% ±0.19 | 99.69% ±0.08 | 0.600 | 1.330 |

## 2. Same days, three sources — which index prices a single session best?

| source | n | 1σ | 2σ | 3σ | mean\|z\| | haircut | 1σ after haircut |
|---|---:|---:|---:|---:|---:|---:|---:|
| VIX1D | 1072 | 72.67% ±1.36 | 96.83% | 99.53% | 0.720 | 1.108 | 68.10% |
| VIX9D | 1072 | 77.89% ±1.27 | 97.95% | 99.53% | 0.643 | 1.242 | 69.03% |
| VIX | 1072 | 80.13% ±1.22 | 98.23% | 99.72% | 0.609 | 1.311 | 69.78% |

## 3. Where the band stops being honest

VVIX is vol-OF-vol: it does not set SPX's expected move, so it should NOT move 1σ
coverage much. The question was whether the TAILS (2σ, 3σ) bunch up when VVIX is high —
which would make VVIX a 'trust the width less today' flag rather than a width input.

**They do not.** Every regime tag below is read at the PRIOR close, because that is when
the band is set and it is the only value a non-repainting study can see. Section 3b shows
what the same split looks like tagged same-day, and why that version is not a forecast.

**VIX-sourced, full history** (the only run with enough days to split three ways):

### by VIX level (VIX-sourced, full history)

| bucket | n | 1σ | 2σ | 3σ | mean\|z\| | >2σ days | >3σ days |
|---|---:|---:|---:|---:|---:|---:|---:|
| low (<15.1) | 1694 | 86.54% ±0.83 | 98.88% ±0.26 | 99.82% | 0.507 | 19 | 3 |
| mid | 1698 | 80.09% ±0.97 | 98.23% ±0.32 | 99.71% | 0.598 | 30 | 5 |
| high (≥20.4) | 1696 | 75.77% ±1.04 | 96.99% ±0.41 | 99.53% | 0.693 | 51 | 8 |

### by VVIX level (VIX-sourced, full history)

| bucket | n | 1σ | 2σ | 3σ | mean\|z\| | >2σ days | >3σ days |
|---|---:|---:|---:|---:|---:|---:|---:|
| low (<85.3) | 1695 | 83.78% ±0.90 | 98.23% ±0.32 | 99.88% | 0.557 | 30 | 2 |
| mid | 1697 | 81.20% ±0.95 | 98.29% ±0.31 | 99.76% | 0.579 | 29 | 4 |
| high (≥97.5) | 1696 | 77.42% ±1.02 | 97.58% ±0.37 | 99.41% | 0.662 | 41 | 10 |

**VIX1D-sourced** — what the study actually uses. n per bucket is ~1/3 of ~1,000, so
only a large effect is readable here:

### by VIX level (VIX1D-sourced)

| bucket | n | 1σ | 2σ | 3σ | mean\|z\| | >2σ days | >3σ days |
|---|---:|---:|---:|---:|---:|---:|---:|
| low (<15.9) | 355 | 74.93% ±2.30 | 96.34% ±1.00 | 99.44% | 0.708 | 13 | 2 |
| mid | 359 | 74.37% ±2.30 | 97.21% ±0.87 | 99.16% | 0.716 | 10 | 3 |
| high (≥19.4) | 358 | 68.72% ±2.45 | 96.93% ±0.91 | 100.00% | 0.736 | 11 | 0 |

### by VVIX level (VIX1D-sourced)

| bucket | n | 1σ | 2σ | 3σ | mean\|z\| | >2σ days | >3σ days |
|---|---:|---:|---:|---:|---:|---:|---:|
| low (<88.5) | 357 | 70.87% ±2.40 | 96.64% ±0.95 | 99.72% | 0.734 | 12 | 1 |
| mid | 357 | 76.47% ±2.25 | 96.92% ±0.91 | 99.16% | 0.700 | 11 | 3 |
| high (≥98.0) | 358 | 70.67% ±2.41 | 96.93% ±0.91 | 99.72% | 0.727 | 11 | 1 |

### VVIX *within* VIX terciles — does vol-of-vol add anything VIX has not said?

No. It only appears to when the tag is read at the close of the day being predicted.

**prior-close tags — what a chart can actually see**

| VIX tier | VVIX half | n | 2σ coverage | >2σ days | rate |
|---|---|---:|---:|---:|---:|
| VIX low | VVIX low (med 84.8) | 846 | 98.82% | 10 | 1.18% |
| VIX low | VVIX high (med 84.8) | 848 | 98.94% | 9 | 1.06% |
| VIX mid | VVIX low (med 94.3) | 849 | 98.35% | 14 | 1.65% |
| VIX mid | VVIX high (med 94.3) | 849 | 98.12% | 16 | 1.88% |
| VIX high | VVIX low (med 99.1) | 848 | 97.05% | 25 | 2.95% |
| VIX high | VVIX high (med 99.1) | 848 | 96.93% | 26 | 3.07% |

**SAME-DAY tags — the contaminated version, for contrast only**

| VIX tier | VVIX half | n | 2σ coverage | >2σ days | rate |
|---|---|---:|---:|---:|---:|
| VIX low | VVIX low (med 84.8) | 846 | 99.53% | 4 | 0.47% |
| VIX low | VVIX high (med 84.8) | 848 | 99.76% | 2 | 0.24% |
| VIX mid | VVIX low (med 94.2) | 849 | 99.53% | 4 | 0.47% |
| VIX mid | VVIX high (med 94.2) | 849 | 97.64% | 20 | 2.36% |
| VIX high | VVIX low (med 99.1) | 848 | 96.93% | 26 | 3.07% |
| VIX high | VVIX high (med 99.1) | 849 | 94.82% | 44 | 5.18% |

### Why VIX1D and not VIX — split by what the market priced for that day

| day type | n | VIX1D 1σ | VIX1D haircut | VIX 1σ | VIX haircut |
|---|---:|---:|---:|---:|---:|
| event priced in | 179 | 65.92% | 1.01 | 58.10% | 0.88 |
| ordinary session | 893 | 74.02% | 1.13 | 84.55% | 1.45 |

A haircut of 1.00 is perfect. VIX runs BELOW 1.00 on event days (band too narrow — it
under-states the move on exactly the days that hurt) and far above it on ordinary days
(too wide, never registers anything). VIX1D lands near 1.00 when a catalyst is priced.

## 4. Should the band widen when vol spikes mid-session?

| source | corr(SPX return, Δindex) | n |
|---|---:|---:|
| VIX1D | -0.464 | 1072 |
| VIX9D | -0.743 | 3930 |
| VIX | -0.814 | 5088 |

On down days (n=493) VIX1D rose on 65.1% of them.

## 4b. Each index at each horizon (non-overlapping windows)

Bold = the pairing the study actually ships. Target 1σ coverage 68.27%, haircut 1.00.

**common window (VIX1D era)**

| index | 1 day | 1 week (5d) | 1 month (21d) |
|---|---|---|---|
| VIX1D | **72.67% h=1.11 n=1072** | 74.30% h=1.10 n=214 | 68.63% h=0.98 n=51 |
| VIX9D | 77.89% h=1.24 n=1072 | **79.91% h=1.22 n=214** | 76.47% h=1.12 n=51 |
| VIX | 80.13% h=1.31 n=1072 | 82.24% h=1.30 n=214 | **80.39% h=1.19 n=51** |

**VIX full history**

| index | 1 day | 1 week (5d) | 1 month (21d) |
|---|---|---|---|
| VIX | 81.63% h=1.35 n=9223 | 82.48% h=1.34 n=1844 | **83.11% h=1.35 n=438** |

## 4c. Weekday effect at 1 day — does Monday run hot?

| weekday | n | 1σ | mean\|z\| | haircut |
|---|---:|---:|---:|---:|
| Mon | 200 | 81.50% ±2.75 | 0.616 | 1.296 |
| Tue | 222 | 72.07% ±3.01 | 0.740 | 1.079 |
| Wed | 220 | 70.91% ±3.06 | 0.735 | 1.086 |
| Thu | 214 | 67.76% ±3.20 | 0.764 | 1.044 |
| Fri | 216 | 71.76% ±3.06 | 0.738 | 1.081 |

## 5. Verdict

1. **VIX1D is the right source and the mapping is vindicated.** On the same 1072 days,
   VIX1D covers 72.67% at 1σ against a 68.27% target; VIX covers 80.13%.
   A 30-day index stretched over one session is 11.86pp too generous — which is
   what VXN/RVX/VXD will do on QQQ/IWM/DIA, since CBOE never built 1-day versions.

2. **The band is too wide, and by a measurable amount.** mean|z| = 0.720 against
   0.798 for a calibrated band. Fitted haircut 1.108 lands 1σ coverage on
   68.10% — the direction check passes. Note this is the variance risk premium
   measured on THIS construction, not the 1.15–1.25 the literature quotes for 30-day VIX.

3. **But one haircut cannot fit every regime — though it does NOT flip sign.** Tagging each
   session by the VIX level at BAND-SET TIME, the fitted haircut runs 1.13 in the calmest
   VIX tercile and 1.08 in the highest; on the 30-day VIX band the same split runs
   1.57 to 1.15. Every one is above 1.00, so the band is too wide in EVERY
   regime — least so in stress. A divisor fitted on the pooled sample is therefore too
   aggressive on the stressed days, which is reason enough to leave it at 1.00.
   CORRECTION: this item used to claim the error flipped sign, citing a 2σ breach ramp of
   ~2% to ~5% across terciles. That ramp came from tagging each day with its OWN closing
   VIX. Tagged at the prior close it is 3.66% / 3.07% — flat, and both below the
   4.55% expected.

4. **VVIX is NOT a tail flag. This item previously said it was, and that was wrong.**
   The old finding — high VVIX raising the 2σ breach rate inside the same VIX bucket —
   was produced by reading VVIX at the close of the day being predicted, which conditions
   on the answer, because a large move raises VVIX that same day. Section 3b now prints
   both taggings: prior-close 2.95% vs 3.07%, same-day 3.07% vs 5.18%, identical days.
   Within VIX deciles, prior-day VVIX against mean|z| gives t = +1.18 on n = 5,088 — a
   well-powered null, not an underpowered shrug. A study can only ever read close[1], so
   there is nothing here to put on a panel. MORAI's regime board had already deferred
   VVIX/VIX as double-counting VIX; the board was right.

5. **Do not re-scale the DAY band intraday.** corr(SPX return, ΔVIX1D) = -0.464, and on down days VIX1D rose 65.1% of the time. A band that widens
   as vol spikes chases price away and under-registers breaches on precisely the days that
   matter. The fixed band is the record of what was priced; LEFT is the number that may
   legitimately take live vol.

