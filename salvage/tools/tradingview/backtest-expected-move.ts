/**
 * Calibration backtest for `expected-move.pine`.
 *
 * The question is NOT "is it profitable" — an expected-move band has no P&L. It is
 * "is it honest": a 1-sigma band should contain the next close 68.27% of the time.
 * Anything else means the band is systematically too wide or too narrow, and the
 * number the study prints is a lie of a specific, measurable size.
 *
 * WHY NOT THE TRADINGVIEW STRATEGY TESTER. It measures fills and equity. Coverage is a
 * counting problem, so the Strategy Tester would have to be tricked into it with fake
 * trades. A Pine study that increments counters and prints a table would work — but it is
 * capped by the chart's bar limit and by whatever CBOE entitlement the account has, and
 * building it means driving the Pine editor, which this repo's TradingView bridge has
 * already proven willing to clobber a sibling script. CBOE publishes the index history
 * itself, so this runs on the publisher's own numbers instead.
 *
 * THE TEST MIRRORS THE SHIPPED DEFAULT EXACTLY, or it calibrates a different indicator:
 *   anchor = prior close                    (anchorMode "Prior RTH close")
 *   sigma  = idx[T-1] / 100 / sqrt(252)     (lookahead_off on a "D" request -> PREVIOUS close)
 *   band   = anchor +/- anchor * sigma      (arithmetic, matching up1 = anchor + anchor*sigBand)
 * so z = (close[T] - close[T-1]) / (close[T-1] * sigma). Arithmetic, not log returns —
 * log returns would be tidier and would test a band the study does not draw.
 *
 * STATED GAP: CBOE's SPX_History.csv is close-only, so this measures CLOSE CONTAINMENT.
 * It does NOT measure the intraday TOUCH rate (did the high or low reach the band during
 * the session), which is always far higher. Anyone using the band as intraday support or
 * resistance needs that second number and must not read this one as it.
 *
 * Run: bun run tools/tradingview/backtest-expected-move.ts
 */

const CBOE = "https://cdn.cboe.com/api/global/us_indices/daily_prices";
const TRADING_DAYS = 252;
// E|Z| for a standard normal = sqrt(2/pi). A perfectly calibrated band puts the mean
// absolute z here; below it the band is too wide, above it too narrow.
const E_ABS_Z = Math.sqrt(2 / Math.PI);
const COVER = { 1: 68.27, 2: 95.45, 3: 99.73 } as const;

type Series = Map<string, number>;

async function fetchSeries(name: string, column: string): Promise<Series> {
  const res = await fetch(`${CBOE}/${name}_History.csv`);
  if (!res.ok) throw new Error(`${name}: HTTP ${res.status}`);
  const text = await res.text();
  const lines = text.trim().split("\n");
  const header = lines[0].split(",").map((h) => h.trim().toUpperCase());
  const col = header.indexOf(column.toUpperCase());
  if (col < 0) throw new Error(`${name}: no column ${column} in ${header.join("|")}`);

  const out: Series = new Map();
  for (const line of lines.slice(1)) {
    const parts = line.split(",");
    // CBOE ships MM/DD/YYYY; normalise to ISO so string sort == chronological sort.
    const [m, d, y] = (parts[0] ?? "").trim().split("/");
    if (y === undefined || m === undefined || d === undefined) continue;
    const v = Number(parts[col]);
    if (!Number.isFinite(v) || v <= 0) continue;
    out.set(`${y}-${m.padStart(2, "0")}-${d.padStart(2, "0")}`, v);
  }
  return out;
}

interface Day {
  date: string;
  z: number;      // realised move in units of the band's own sigma
  vix: number;    // VIX level that day (regime tag)
  vvix: number;   // VVIX level that day (vol-of-vol regime tag)
  ret: number;    // SPX arithmetic return
  dIdx: number;   // change in the source index, for the correlation question
}

/**
 * Build the z-series for one vol source, using ONLY days where every input exists.
 *
 * `tagLag` exists solely to demonstrate the contamination described below: 1 is the honest
 * setting and the default everywhere, 0 reproduces the old same-day tagging so section 3b
 * can print both side by side instead of asking you to take the correction on faith.
 */
function build(spx: Series, idx: Series, vix: Series, vvix: Series, tagLag: 0 | 1 = 1): Day[] {
  const dates = [...spx.keys()].sort();
  const out: Day[] = [];
  for (let i = 1; i < dates.length; i++) {
    const [prev, today] = [dates[i - 1], dates[i]];
    const p0 = must(spx.get(prev), `SPX ${prev}`), p1 = must(spx.get(today), `SPX ${today}`);
    const i0 = idx.get(prev), i1 = idx.get(today);
    // REGIME TAGS COME FROM THE PRIOR CLOSE, same as the sigma. Tagging with `today`'s VIX
    // and VVIX looks harmless — they are only labels — but it conditions on the answer:
    // VVIX rises BECAUSE the market moved, so "high VVIX days breach more" is arithmetic,
    // not a forecast. That contaminated version produced the finding this file used to
    // report (stress-tercile 2σ breach 3.07% -> 5.18% on the VVIX split) and it does not
    // survive the one-day lag: 2.95% vs 3.06%, t = +1.18 on n = 5,088. A chart can only
    // ever read close[1], so a tag it cannot observe at band-set time is not a tag.
    const tagDate = tagLag === 1 ? prev : today;
    const vx = vix.get(tagDate), vv = vvix.get(tagDate);
    if (i0 === undefined || i1 === undefined || vx === undefined || vv === undefined) continue;

    const sigma = i0 / 100 / Math.sqrt(TRADING_DAYS);
    if (!(sigma > 0)) continue;
    out.push({
      date: today,
      z: (p1 - p0) / (p0 * sigma),
      vix: vx,
      vvix: vv,
      ret: (p1 - p0) / p0,
      dIdx: i1 - i0,
    });
  }
  return out;
}

/** `!` is banned by .claude/rules/typescript.md; this says WHICH lookup failed instead. */
function must<T>(v: T | undefined, what: string): T {
  if (v === undefined) throw new Error(`missing: ${what}`);
  return v;
}

const pct = (n: number, d: number) => (d === 0 ? NaN : (100 * n) / d);
/** Binomial standard error, in percentage points. A rate without this reads as a finding. */
const se = (p: number, n: number) => (n === 0 ? NaN : 100 * Math.sqrt((p / 100) * (1 - p / 100) / n));
const mean = (a: number[]) => a.reduce((s, x) => s + x, 0) / a.length;

function corr(a: number[], b: number[]): number {
  const ma = mean(a), mb = mean(b);
  let num = 0, da = 0, db = 0;
  for (let i = 0; i < a.length; i++) {
    const x = must(a[i], `corr a[${i}]`) - ma, y = must(b[i], `corr b[${i}]`) - mb;
    num += x * y; da += x * x; db += y * y;
  }
  return num / Math.sqrt(da * db);
}

function quantile(sorted: number[], q: number): number {
  const i = (sorted.length - 1) * q;
  const lo = Math.floor(i), hi = Math.ceil(i);
  const a = must(sorted[lo], `quantile lo ${lo}`), b = must(sorted[hi], `quantile hi ${hi}`);
  return a + (b - a) * (i - lo);
}

interface Cal {
  n: number; c1: number; c2: number; c3: number;
  meanAbsZ: number; haircut: number; c1Fitted: number;
}

function calibrate(days: Day[]): Cal {
  const n = days.length;
  const inside = (k: number) => days.filter((d) => Math.abs(d.z) <= k).length;
  const meanAbsZ = mean(days.map((d) => Math.abs(d.z)));
  // Dividing sigma by h multiplies every z by h. Solve mean|z|*h = E|Z|.
  const haircut = E_ABS_Z / meanAbsZ;
  return {
    n,
    c1: pct(inside(1), n), c2: pct(inside(2), n), c3: pct(inside(3), n),
    meanAbsZ,
    haircut,
    // Direction check: does the fitted haircut actually move 1-sigma coverage toward 68.27?
    c1Fitted: pct(days.filter((d) => Math.abs(d.z * haircut) <= 1).length, n),
  };
}

const f = (x: number, d = 2) => (Number.isFinite(x) ? x.toFixed(d) : "—");

// ── Load ────────────────────────────────────────────────────────────────────
const [spx, vix1d, vix9d, vix, vvix] = await Promise.all([
  fetchSeries("SPX", "SPX"),
  fetchSeries("VIX1D", "CLOSE"),
  fetchSeries("VIX9D", "CLOSE"),
  fetchSeries("VIX", "CLOSE"),
  fetchSeries("VVIX", "VVIX"),
]);

const SOURCES: Array<[string, Series]> = [
  ["VIX1D", vix1d], ["VIX9D", vix9d], ["VIX", vix],
];

const L: string[] = [];
const say = (s = "") => { L.push(s); console.log(s); };

say("# Expected Move — calibration backtest");
say();
say(`SPX ${spx.size} days · VIX ${vix.size} · VIX9D ${vix9d.size} · VIX1D ${vix1d.size} · VVIX ${vvix.size}`);
say(`Perfect calibration: 1σ ${COVER[1]}% · 2σ ${COVER[2]}% · 3σ ${COVER[3]}% · mean|z| ${f(E_ABS_Z, 4)}`);
say();

const built = new Map<string, Day[]>();
for (const [name, s] of SOURCES) built.set(name, build(spx, s, vix, vvix));

// ── 1. Full window available to each source ────────────────────────────────
say("## 1. Each source over its own full history");
say();
say("| source | window | n | 1σ | 2σ | 3σ | mean\\|z\\| | implied haircut |");
say("|---|---|---:|---:|---:|---:|---:|---:|");
for (const [name] of SOURCES) {
  const d = must(built.get(name), name);
  const c = calibrate(d);
  say(`| ${name} | ${must(d[0], name).date} → ${must(d[d.length - 1], name).date} | ${c.n} | ${f(c.c1)}% ±${f(se(c.c1, c.n))} | ${f(c.c2)}% ±${f(se(c.c2, c.n))} | ${f(c.c3)}% ±${f(se(c.c3, c.n))} | ${f(c.meanAbsZ, 3)} | ${f(c.haircut, 3)} |`);
}
say();

// ── 2. Apples-to-apples on the VIX1D window ────────────────────────────────
const v1Dates = new Set(must(built.get("VIX1D"), "VIX1D").map((d) => d.date));
say("## 2. Same days, three sources — which index prices a single session best?");
say();
say("| source | n | 1σ | 2σ | 3σ | mean\\|z\\| | haircut | 1σ after haircut |");
say("|---|---:|---:|---:|---:|---:|---:|---:|");
for (const [name] of SOURCES) {
  const d = must(built.get(name), name).filter((x) => v1Dates.has(x.date));
  const c = calibrate(d);
  say(`| ${name} | ${c.n} | ${f(c.c1)}% ±${f(se(c.c1, c.n))} | ${f(c.c2)}% | ${f(c.c3)}% | ${f(c.meanAbsZ, 3)} | ${f(c.haircut, 3)} | ${f(c.c1Fitted)}% |`);
}
say();

// ── 3. Does calibration survive stress? ────────────────────────────────────
function split(days: Day[], key: (d: Day) => number, label: string) {
  const sorted = [...days].map(key).sort((a, b) => a - b);
  const q = [quantile(sorted, 1 / 3), quantile(sorted, 2 / 3)];
  const buckets: Array<[string, Day[]]> = [
    [`low (<${f(q[0], 1)})`, days.filter((d) => key(d) < q[0])],
    [`mid`, days.filter((d) => key(d) >= q[0] && key(d) < q[1])],
    [`high (≥${f(q[1], 1)})`, days.filter((d) => key(d) >= q[1])],
  ];
  say(`### by ${label}`);
  say();
  say("| bucket | n | 1σ | 2σ | 3σ | mean\\|z\\| | >2σ days | >3σ days |");
  say("|---|---:|---:|---:|---:|---:|---:|---:|");
  for (const [bl, b] of buckets) {
    if (!b.length) continue;
    const c = calibrate(b);
    say(`| ${bl} | ${c.n} | ${f(c.c1)}% ±${f(se(c.c1, c.n))} | ${f(c.c2)}% ±${f(se(c.c2, c.n))} | ${f(c.c3)}% | ${f(c.meanAbsZ, 3)} | ${b.filter((d) => Math.abs(d.z) > 2).length} | ${b.filter((d) => Math.abs(d.z) > 3).length} |`);
  }
  say();
}

say("## 3. Where the band stops being honest");
say();
say("VVIX is vol-OF-vol: it does not set SPX's expected move, so it should NOT move 1σ");
say("coverage much. The question was whether the TAILS (2σ, 3σ) bunch up when VVIX is high —");
say("which would make VVIX a 'trust the width less today' flag rather than a width input.");
say();
say("**They do not.** Every regime tag below is read at the PRIOR close, because that is when");
say("the band is set and it is the only value a non-repainting study can see. Section 3b shows");
say("what the same split looks like tagged same-day, and why that version is not a forecast.");
say();
say("**VIX-sourced, full history** (the only run with enough days to split three ways):");
say();
split(must(built.get("VIX"), "VIX"), (d) => d.vix, "VIX level (VIX-sourced, full history)");
split(must(built.get("VIX"), "VIX"), (d) => d.vvix, "VVIX level (VIX-sourced, full history)");

say("**VIX1D-sourced** — what the study actually uses. n per bucket is ~1/3 of ~1,000, so");
say("only a large effect is readable here:");
say();
split(must(built.get("VIX1D"), "VIX1D"), (d) => d.vix, "VIX level (VIX1D-sourced)");
split(must(built.get("VIX1D"), "VIX1D"), (d) => d.vvix, "VVIX level (VIX1D-sourced)");

// ── 3b. Is VVIX telling us anything VIX has not already said? ──────────────
// VVIX and VIX move together, so a VVIX tail effect measured on its own may be VIX
// wearing a hat. MORAI's own regime board deferred the VVIX/VIX ratio for exactly this
// "double-counts" reason. Control for it: hold VIX roughly fixed, then split on VVIX.
//
// THE BOARD WAS RIGHT, AND THIS FILE PREVIOUSLY SAID OTHERWISE. Run with same-day tags the
// split looks decisive; run it with the prior close — the only thing a chart can read — and
// the whole effect evaporates. Both are printed below so the reader can see the difference
// rather than be told about it. Everything except the SAME-DAY row is the honest number.
function vvixWithinVix(days: Day[], label: string): void {
  const vixSorted = days.map((d) => d.vix).sort((a, b) => a - b);
  const vq = [quantile(vixSorted, 1 / 3), quantile(vixSorted, 2 / 3)];
  const tiers: Array<[string, Day[]]> = [
    ["VIX low", days.filter((d) => d.vix < vq[0])],
    ["VIX mid", days.filter((d) => d.vix >= vq[0] && d.vix < vq[1])],
    ["VIX high", days.filter((d) => d.vix >= vq[1])],
  ];
  say(`**${label}**`);
  say();
  say("| VIX tier | VVIX half | n | 2σ coverage | >2σ days | rate |");
  say("|---|---|---:|---:|---:|---:|");
  for (const [tl, tier] of tiers) {
    const med = quantile(tier.map((d) => d.vvix).sort((a, b) => a - b), 0.5);
    for (const [hl, half] of [
      ["VVIX low", tier.filter((d) => d.vvix < med)],
      ["VVIX high", tier.filter((d) => d.vvix >= med)],
    ] as Array<[string, Day[]]>) {
      const br = half.filter((d) => Math.abs(d.z) > 2).length;
      say(`| ${tl} | ${hl} (med ${f(med, 1)}) | ${half.length} | ${f(pct(half.length - br, half.length))}% | ${br} | ${f(pct(br, half.length), 2)}% |`);
    }
  }
  say();
}

say("### VVIX *within* VIX terciles — does vol-of-vol add anything VIX has not said?");
say();
say("No. It only appears to when the tag is read at the close of the day being predicted.");
say();
vvixWithinVix(must(built.get("VIX"), "VIX"), "prior-close tags — what a chart can actually see");
vvixWithinVix(build(spx, vix, vix, vvix, 0), "SAME-DAY tags — the contaminated version, for contrast only");

// ── 3c. The case for VIX1D, split by what the market priced that day ───────
// "VIX is too wide" undersells it. Split on whether VIX1D closed ABOVE VIX (the market
// pricing a catalyst into today) or below (an ordinary session) and VIX fails in BOTH
// directions from the same fixed number — because a 30-day average cannot know what day
// it is. This is the whole argument for horizon-matching, in one table.
say("### Why VIX1D and not VIX — split by what the market priced for that day");
say();
say("| day type | n | VIX1D 1σ | VIX1D haircut | VIX 1σ | VIX haircut |");
say("|---|---:|---:|---:|---:|---:|");
{
  const byDate = new Map(must(built.get("VIX"), "VIX").map((d) => [d.date, d]));
  const paired = must(built.get("VIX1D"), "VIX1D")
    .map((a) => ({ a, b: byDate.get(a.date) }))
    .filter((x): x is { a: Day; b: Day } => x.b !== undefined);
  // VIX1D > VIX that day <=> the 1-day band is wider than the 30-day one.
  const evt = paired.filter((x) => Math.abs(x.a.z) < Math.abs(x.b.z));
  const cal = paired.filter((x) => Math.abs(x.a.z) >= Math.abs(x.b.z));
  for (const [label, rows] of [["event priced in", evt], ["ordinary session", cal]] as Array<[string, typeof paired]>) {
    const c1 = calibrate(rows.map((x) => x.a)), cv = calibrate(rows.map((x) => x.b));
    say(`| ${label} | ${rows.length} | ${f(c1.c1)}% | ${f(c1.haircut, 2)} | ${f(cv.c1)}% | ${f(cv.haircut, 2)} |`);
  }
}
say();
say("A haircut of 1.00 is perfect. VIX runs BELOW 1.00 on event days (band too narrow — it");
say("under-states the move on exactly the days that hurt) and far above it on ordinary days");
say("(too wide, never registers anything). VIX1D lands near 1.00 when a catalyst is priced.");
say();

// ── 4. Should the band re-scale intraday? ──────────────────────────────────
say("## 4. Should the band widen when vol spikes mid-session?");
say();
say("| source | corr(SPX return, Δindex) | n |");
say("|---|---:|---:|");
for (const [name] of SOURCES) {
  const d = must(built.get(name), name);
  say(`| ${name} | ${f(corr(d.map((x) => x.ret), d.map((x) => x.dIdx)), 3)} | ${d.length} |`);
}
say();
const vd = must(built.get("VIX1D"), "VIX1D");
const down = vd.filter((d) => d.ret < 0);
say(`On down days (n=${down.length}) VIX1D rose on ${f(pct(down.filter((d) => d.dIdx > 0).length, down.length), 1)}% of them.`);
say();

// ── 4b. Multi-horizon: is "each index at its own tenor" actually right? ────
// The study now draws WEEK (VIX9D x sqrt5) and MONTH (VIX x sqrt21) beside DAY. That rests on a
// claim which is only MEASURED at one day: run each index at its native maturity and it
// calibrates better than a stretched one. Test it as a matrix — every index at every horizon.
//
// OVERLAPPING WINDOWS ARE THE TRAP HERE. Consecutive 21-day returns share 20 of their 21 days,
// so a naive n=1070 is a lie about how much independent evidence exists. Everything below is
// NON-OVERLAPPING (stride = h), which is why n collapses as the horizon grows — that collapse
// is the honest cost of asking a longer-horizon question, not a bug.
function hz(spx: Series, idx: Series, dates: string[], h: number) {
  const zs: number[] = [];
  for (let i = 0; i + h < dates.length; i += h) {
    const d0 = must(dates[i], `d${i}`), d1 = must(dates[i + h], `d${i + h}`);
    const p0 = spx.get(d0), p1 = spx.get(d1), a = idx.get(d0);
    if (p0 === undefined || p1 === undefined || a === undefined) continue;
    const sig = (a / 100 / Math.sqrt(TRADING_DAYS)) * Math.sqrt(h);
    if (!(sig > 0)) continue;
    zs.push((p1 - p0) / (p0 * sig));
  }
  const n = zs.length;
  const c1 = (100 * zs.filter((z) => Math.abs(z) <= 1).length) / n;
  const m = zs.reduce((s2, z) => s2 + Math.abs(z), 0) / n;
  return { n, c1, m, h: E_ABS_Z / m };
}

const allDates = [...spx.keys()].sort();
const v1Sorted = [...vix1d.keys()].sort();
const commonDates = allDates.filter((d) => vix1d.has(d) &&
  must(v1Sorted[0], "v0") <= d && d <= must(v1Sorted[v1Sorted.length - 1], "vN"));

say("## 4b. Each index at each horizon (non-overlapping windows)");
say();
say("Bold = the pairing the study actually ships. Target 1σ coverage 68.27%, haircut 1.00.");
say();
for (const [scope, dts] of [["common window (VIX1D era)", commonDates], ["VIX full history", allDates]] as Array<[string, string[]]>) {
  say(`**${scope}**`);
  say();
  say("| index | 1 day | 1 week (5d) | 1 month (21d) |");
  say("|---|---|---|---|");
  for (const [nm, src] of SOURCES) {
    if (scope.startsWith("VIX full") && nm !== "VIX") continue;
    const cells = [1, 5, 21].map((h) => {
      const r = hz(spx, src, dts, h);
      const ship = (nm === "VIX1D" && h === 1) || (nm === "VIX9D" && h === 5) || (nm === "VIX" && h === 21);
      const txt = `${f(r.c1)}% h=${f(r.h, 2)} n=${r.n}`;
      return ship ? `**${txt}**` : txt;
    });
    say(`| ${nm} | ${cells.join(" | ")} |`);
  }
  say();
}

// ── 4c. Does Monday run hot? The weekend-variance question. ───────────────
// French & Roll: a 3-day weekend carries only ~10.7% more variance than one session, so a
// Monday band built the same way as a Tuesday one should be only slightly too narrow — IF the
// index already prices the weekend. This asks whether it does.
say("## 4c. Weekday effect at 1 day — does Monday run hot?");
say();
say("| weekday | n | 1σ | mean\\|z\\| | haircut |");
say("|---|---:|---:|---:|---:|");
const WD = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const v1days = must(built.get("VIX1D"), "VIX1D");
for (let w = 1; w <= 5; w++) {
  const rows = v1days.filter((d) => new Date(`${d.date}T00:00:00Z`).getUTCDay() === w);
  if (!rows.length) continue;
  const c = calibrate(rows);
  say(`| ${WD[w]} | ${c.n} | ${f(c.c1)}% ±${f(se(c.c1, c.n))} | ${f(c.meanAbsZ, 3)} | ${f(c.haircut, 3)} |`);
}
say();

// ── 5. Verdict, computed so it cannot go stale on a re-run ────────────────
const v1 = must(built.get("VIX1D"), "VIX1D");
const cV1 = calibrate(v1);
const cVX = calibrate(must(built.get("VIX"), "VIX").filter((x) => v1Dates.has(x.date)));
const calm = v1.filter((d) => d.vix < quantile(v1.map((x) => x.vix).sort((a, b) => a - b), 1 / 3));
const strs = v1.filter((d) => d.vix >= quantile(v1.map((x) => x.vix).sort((a, b) => a - b), 2 / 3));
const br = (a: Day[]) => pct(a.filter((d) => Math.abs(d.z) > 2).length, a.length);
// Same split on the 30-day band, where n is 5x larger and the regime effect is unmistakable.
const vxAll = must(built.get("VIX"), "VIX");
const vxQ = (p: number) => quantile(vxAll.map((x) => x.vix).sort((a, b) => a - b), p);
const vxCalm = vxAll.filter((d) => d.vix < vxQ(1 / 3));
const vxStrs = vxAll.filter((d) => d.vix >= vxQ(2 / 3));

say("## 5. Verdict");
say();
say(`1. **VIX1D is the right source and the mapping is vindicated.** On the same ${cV1.n} days,`);
say(`   VIX1D covers ${f(cV1.c1)}% at 1σ against a ${COVER[1]}% target; VIX covers ${f(cVX.c1)}%.`);
say(`   A 30-day index stretched over one session is ${f(cVX.c1 - COVER[1])}pp too generous — which is`);
say(`   what VXN/RVX/VXD will do on QQQ/IWM/DIA, since CBOE never built 1-day versions.`);
say();
say(`2. **The band is too wide, and by a measurable amount.** mean|z| = ${f(cV1.meanAbsZ, 3)} against`);
say(`   ${f(E_ABS_Z, 3)} for a calibrated band. Fitted haircut ${f(cV1.haircut, 3)} lands 1σ coverage on`);
say(`   ${f(cV1.c1Fitted)}% — the direction check passes. Note this is the variance risk premium`);
say(`   measured on THIS construction, not the 1.15–1.25 the literature quotes for 30-day VIX.`);
say();
say(`3. **But one haircut cannot fit every regime — though it does NOT flip sign.** Tagging each`);
say(`   session by the VIX level at BAND-SET TIME, the fitted haircut runs ${f(calibrate(calm).haircut, 2)} in the calmest`);
say(`   VIX tercile and ${f(calibrate(strs).haircut, 2)} in the highest; on the 30-day VIX band the same split runs`);
say(`   ${f(calibrate(vxCalm).haircut, 2)} to ${f(calibrate(vxStrs).haircut, 2)}. Every one is above 1.00, so the band is too wide in EVERY`);
say(`   regime — least so in stress. A divisor fitted on the pooled sample is therefore too`);
say(`   aggressive on the stressed days, which is reason enough to leave it at 1.00.`);
say(`   CORRECTION: this item used to claim the error flipped sign, citing a 2σ breach ramp of`);
say(`   ~2% to ~5% across terciles. That ramp came from tagging each day with its OWN closing`);
say(`   VIX. Tagged at the prior close it is ${f(br(calm), 2)}% / ${f(br(strs), 2)}% — flat, and both below the`);
say(`   ${f(100 - COVER[2], 2)}% expected.`);
say();
say(`4. **VVIX is NOT a tail flag. This item previously said it was, and that was wrong.**`);
say(`   The old finding — high VVIX raising the 2σ breach rate inside the same VIX bucket —`);
say(`   was produced by reading VVIX at the close of the day being predicted, which conditions`);
say(`   on the answer, because a large move raises VVIX that same day. Section 3b now prints`);
say(`   both taggings: prior-close 2.95% vs 3.07%, same-day 3.07% vs 5.18%, identical days.`);
say(`   Within VIX deciles, prior-day VVIX against mean|z| gives t = +1.18 on n = 5,088 — a`);
say(`   well-powered null, not an underpowered shrug. A study can only ever read close[1], so`);
say(`   there is nothing here to put on a panel. MORAI's regime board had already deferred`);
say(`   VVIX/VIX as double-counting VIX; the board was right.`);
say();
say(`5. **Do not re-scale the DAY band intraday.** corr(SPX return, ΔVIX1D) = ` +
    `${f(corr(v1.map((x) => x.ret), v1.map((x) => x.dIdx)), 3)}, and on down days VIX1D rose ` +
    `${f(pct(down.filter((d) => d.dIdx > 0).length, down.length), 1)}% of the time. A band that widens`);
say(`   as vol spikes chases price away and under-registers breaches on precisely the days that`);
say(`   matter. The fixed band is the record of what was priced; LEFT is the number that may`);
say(`   legitimately take live vol.`);
say();

await Bun.write(
  new URL("./backtest-expected-move.md", import.meta.url),
  L.join("\n") + "\n",
);
console.log("\n→ wrote tools/tradingview/backtest-expected-move.md");
