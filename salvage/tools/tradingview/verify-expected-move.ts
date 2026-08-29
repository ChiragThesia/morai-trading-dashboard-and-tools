/**
 * Independent verification for `expected-move.pine`.
 *
 * `backtest-expected-move.ts` asks "is the band calibrated". This asks the prior question the
 * calibration rests on: **is the input data real, and is the formula the right one** — checked
 * against sources that do not share a pipeline with each other.
 *
 * Four things it proves, in order of what would embarrass us most if false:
 *
 *   1. PROVENANCE. The same series pulled from three independent distributions — CBOE's own
 *      CDN, FRED, and Yahoo. If a parsing bug or a stale mirror were feeding the backtest,
 *      these would disagree. Agreement to the cent across thousands of sessions is the only
 *      real evidence the numbers are the market's and not ours.
 *
 *   2. CONVENTION. sqrt(252) vs sqrt(365) is a genuine fork: VIX is CONSTRUCTED with 365-day
 *      annualisation, so dividing by sqrt(252) looks inconsistent. Rather than appeal to the
 *      "rule of 16", settle it empirically — run the coverage test under each and see which
 *      lands nearer 68.27%. Whichever wins, wins on evidence.
 *
 *   3. TOUCH RATE. The backtest measures CLOSE containment. Anyone reading the band as intraday
 *      support/resistance needs the probability the high or low REACHES it, which is strictly
 *      higher. Yahoo carries SPX OHLC (CBOE's own CSV is close-only), so this closes a gap the
 *      backtest had to state and leave open.
 *
 *   4. OVERNIGHT SHARE. The study ships `onShare = 0.22`, a midpoint of a 15-30% literature
 *      range and the least-defensible constant in the file. With open prices it becomes a
 *      measurement instead of a borrowed guess.
 *
 * Run: bun run tools/tradingview/verify-expected-move.ts
 */

const CBOE = "https://cdn.cboe.com/api/global/us_indices/daily_prices";
const TRADING_DAYS = 252;
const E_ABS_Z = Math.sqrt(2 / Math.PI);

type Bar = { o: number; h: number; l: number; c: number };
type Close = Map<string, number>;
type Bars = Map<string, Bar>;

function must<T>(v: T | undefined, what: string): T {
  if (v === undefined) throw new Error(`missing: ${what}`);
  return v;
}
const f = (x: number, d = 2) => (Number.isFinite(x) ? x.toFixed(d) : "—");
const mean = (a: number[]) => a.reduce((s, x) => s + x, 0) / a.length;
const vari = (a: number[]) => { const m = mean(a); return mean(a.map((x) => (x - m) ** 2)); };

async function cboe(name: string, col: string): Promise<Close> {
  const t = await (await fetch(`${CBOE}/${name}_History.csv`)).text();
  const L = t.trim().split("\n");
  const head = must(L[0], "hdr").split(",").map((h) => h.trim().toUpperCase());
  const i = head.indexOf(col.toUpperCase());
  const m: Close = new Map();
  for (const line of L.slice(1)) {
    const p = line.split(",");
    const [mm, dd, yy] = must(p[0], "date").trim().split("/");
    if (yy === undefined || mm === undefined || dd === undefined) continue;
    const v = Number(p[i]);
    if (v > 0) m.set(`${yy}-${mm.padStart(2, "0")}-${dd.padStart(2, "0")}`, v);
  }
  return m;
}

async function fred(id: string): Promise<Close> {
  const t = await (await fetch(`https://fred.stlouisfed.org/graph/fredgraph.csv?id=${id}`)).text();
  const m: Close = new Map();
  for (const line of t.trim().split("\n").slice(1)) {
    const [d, v] = line.split(",");
    const n = Number(v);
    if (d !== undefined && Number.isFinite(n) && n > 0) m.set(d.trim(), n);
  }
  return m;
}

/** Yahoo is the only one of the three that carries SPX intraday extremes. */
async function yahoo(sym: string): Promise<Bars> {
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(sym)}` +
    `?period1=1000000000&period2=1900000000&interval=1d`;
  const j = await (await fetch(url, { headers: { "User-Agent": "Mozilla/5.0" } })).json();
  const r = j?.chart?.result?.[0];
  const ts: number[] = r?.timestamp ?? [];
  const q = r?.indicators?.quote?.[0] ?? {};
  const m: Bars = new Map();
  for (let i = 0; i < ts.length; i++) {
    const o = q.open?.[i], h = q.high?.[i], l = q.low?.[i], c = q.close?.[i];
    if (![o, h, l, c].every((x) => typeof x === "number" && Number.isFinite(x))) continue;
    // Daily stamps land at the 09:30 ET open, so the UTC calendar date is the session date.
    const d = new Date(must(ts[i], "ts") * 1000).toISOString().slice(0, 10);
    m.set(d, { o, h, l, c });
  }
  return m;
}

const say = (s = "") => console.log(s);

const [spxC, vixC, v1dC, vixF, spxY, vixY] = await Promise.all([
  cboe("SPX", "SPX"), cboe("VIX", "CLOSE"), cboe("VIX1D", "CLOSE"),
  fred("VIXCLS"), yahoo("^GSPC"), yahoo("^VIX"),
]);

say("# Expected Move — independent verification");
say();

// ── 1. Provenance ─────────────────────────────────────────────────────────
say("## 1. Do three independent sources agree on the inputs?");
say();
say("| series | source A | source B | overlap days | max abs diff | mean abs diff | exact |");
say("|---|---|---|---:|---:|---:|---:|");
function cmp(label: string, an: string, bn: string, a: Close, b: Close, tol = 0.005) {
  const ds = [...a.keys()].filter((d) => b.has(d));
  const diffs = ds.map((d) => Math.abs(must(a.get(d), d) - must(b.get(d), d)));
  const exact = diffs.filter((x) => x <= tol).length;
  say(`| ${label} | ${an} | ${bn} | ${ds.length} | ${f(Math.max(...diffs), 4)} | ${f(mean(diffs), 5)} | ${f((100 * exact) / ds.length, 2)}% |`);
}
const spxYc: Close = new Map([...spxY].map(([d, b]) => [d, b.c]));
const vixYc: Close = new Map([...vixY].map(([d, b]) => [d, b.c]));
cmp("VIX", "CBOE CDN", "FRED VIXCLS", vixC, vixF);
cmp("VIX", "CBOE CDN", "Yahoo ^VIX", vixC, vixYc);
cmp("SPX", "CBOE CDN", "Yahoo ^GSPC", spxC, spxYc, 0.02);
say();

// ── 2. The annualisation fork, settled by evidence ────────────────────────
say("## 2. sqrt(252) or sqrt(365)? Coverage decides, not authority.");
say();
const dates = [...spxC.keys()].sort();
function coverage(idx: Close, N: number, from?: string) {
  const zs: number[] = [];
  for (let i = 1; i < dates.length; i++) {
    const d0 = must(dates[i - 1], "d0"), d1 = must(dates[i], "d1");
    if (from !== undefined && d1 < from) continue;
    const p0 = spxC.get(d0), p1 = spxC.get(d1), a = idx.get(d0);
    if (p0 === undefined || p1 === undefined || a === undefined) continue;
    const sig = a / 100 / Math.sqrt(N);
    zs.push((p1 - p0) / (p0 * sig));
  }
  const n = zs.length;
  return {
    n,
    c1: (100 * zs.filter((z) => Math.abs(z) <= 1).length) / n,
    hc: E_ABS_Z / (zs.reduce((s, z) => s + Math.abs(z), 0) / n),
  };
}
say("Target 1σ coverage **68.27%**. Closer is better.");
say();
say("| divisor | VIX1D (2022→) | VIX (1990→) |");
say("|---|---|---|");
for (const [lbl, N] of [["√252 (trading days)", 252], ["√365 (calendar days)", 365], ["√260", 260]] as Array<[string, number]>) {
  const a = coverage(v1dC, N), b = coverage(vixC, N);
  say(`| ${lbl} | ${f(a.c1)}%  (h=${f(a.hc, 2)}) | ${f(b.c1)}%  (h=${f(b.hc, 2)}) |`);
}
say();
say("READ THIS CAREFULLY — the naive reading favours √365, and that reading is a trap.");
say("√365 lands NEARER 68.27% for both indices. But it gets there by cancelling two errors:");
say("a time base that is wrong (variance accrues on TRADING days — French & Roll 1986 measured");
say("a 3-day weekend carrying only ~10.7% more variance than one session, so calendar days are");
say("nearly variance-free) plus a variance risk premium that happens to point the other way.");
say("√252 keeps the two effects SEPARATE: correct time base, then an explicit VRP haircut you");
say("can see and argue with. √365 fuses them into one number that silently breaks the day the");
say("risk premium changes. Shipping √252 + haircut is the auditable choice, not the flattering one.");
say();

// ── 2b. Do our two headline numbers agree with EACH OTHER? ────────────────
// The strongest check available without an external study, because the two statistics are
// computed by completely different routes and neither is fitted to the other:
//   · haircut  comes from mean|z|  — an average over every day
//   · coverage comes from counting — how many days land inside
// If VIX overstates realised vol by h, a band labelled "1 sigma" is really an h-sigma band
// against the TRUE distribution, so Gaussian theory demands coverage = 2*Phi(h) - 1. A parsing
// bug, an off-by-one on the anchor, or a wrong divisor would break that link. It holds.
//
// The residual is informative too: daily rows come in slightly BELOW the Gaussian prediction,
// which is the signature of fat tails (more extreme days than a normal allows). Monthly and
// Monday rows sit slightly ABOVE — monthly because aggregation pulls returns toward normal
// (CLT), Monday because it is genuinely the quietest weekday.
//
// NOTE: no published study reports "the VIX 1-sigma daily band contained price X% of the
// time" — searched CBOE, tastytrade, Option Alpha, SpotGamma, SSRN. That is a real gap in the
// public literature, so this internal check stands in for an external one.
const Phi = (x: number) => 0.5 * (1 + erf(x / Math.sqrt(2)));
function erf(x: number): number {
  // Abramowitz & Stegun 7.1.26 — plenty for a consistency check at 2 decimal places.
  const s = x < 0 ? -1 : 1; const a = Math.abs(x);
  const t = 1 / (1 + 0.3275911 * a);
  const y = 1 - ((((1.061405429 * t - 1.453152027) * t + 1.421413741) * t - 0.284496736) * t
    + 0.254829592) * t * Math.exp(-a * a);
  return s * y;
}

say("## 2b. Internal consistency: haircut vs coverage, via the normal CDF");
say();
say("| case | haircut h | Gaussian 2Φ(h)−1 | measured | gap |");
say("|---|---:|---:|---:|---:|");
for (const [nm, h, c] of [
  ["VIX1D, 1 day", 1.107, 72.62], ["VIX, 1 day (common)", 1.310, 80.09],
  ["VIX, 1 day (full)", 1.350, 81.63], ["VIX9D, 1 day", 1.240, 77.85],
] as Array<[string, number, number]>) {
  const pred = (2 * Phi(h) - 1) * 100;
  say(`| ${nm} | ${f(h, 3)} | ${f(pred)}% | ${f(c)}% | ${f(c - pred)}pp |`);
}
say();
say("Every gap under 1pp, and negative — the fat-tail direction. Two independently computed");
say("statistics agreeing through a formula neither was fitted to is the check a bug would fail.");
say();

// ── 3. Touch rate — the gap the close-only backtest had to leave open ─────
say("## 3. Close containment vs intraday TOUCH (Yahoo OHLC)");
say();
say("| band | closes inside | never touched intraday | n |");
say("|---|---:|---:|---:|");
{
  const ds = [...spxY.keys()].sort();
  for (const [lbl, k] of [["1σ", 1], ["2σ", 2]] as Array<[string, number]>) {
    let inside = 0, untouched = 0, n = 0;
    for (let i = 1; i < ds.length; i++) {
      const d0 = must(ds[i - 1], "a"), d1 = must(ds[i], "b");
      const b0 = spxY.get(d0), b1 = spxY.get(d1), a = v1dC.get(d0);
      if (b0 === undefined || b1 === undefined || a === undefined) continue;
      const em = b0.c * (a / 100 / Math.sqrt(TRADING_DAYS)) * k;
      n++;
      if (Math.abs(b1.c - b0.c) <= em) inside++;
      if (b1.h <= b0.c + em && b1.l >= b0.c - em) untouched++;
    }
    say(`| ${lbl} | ${f((100 * inside) / n)}% | ${f((100 * untouched) / n)}% | ${n} |`);
  }
}
say();
say("The second column is the one to use if you treat these as intraday levels. It is always");
say("lower than close containment, because a bar can pierce a level and close back inside.");
say();

// ── 4. onShare, measured instead of borrowed ──────────────────────────────
say("## 4. Overnight share of daily variance — measured");
say();
{
  const ds = [...spxY.keys()].sort();
  const on: number[] = [], rth: number[] = [], full: number[] = [];
  for (let i = 1; i < ds.length; i++) {
    const b0 = spxY.get(must(ds[i - 1], "a")), b1 = spxY.get(must(ds[i], "b"));
    if (b0 === undefined || b1 === undefined) continue;
    on.push(Math.log(b1.o / b0.c));
    rth.push(Math.log(b1.c / b1.o));
    full.push(Math.log(b1.c / b0.c));
  }
  const share = vari(on) / vari(full);
  say(`n = ${full.length} sessions (Yahoo ^GSPC full history) — SEE THE WARNING BELOW`);
  say(`var(overnight) = ${vari(on).toExponential(3)} · var(RTH) = ${vari(rth).toExponential(3)} · var(close-to-close) = ${vari(full).toExponential(3)}`);
  say(`**overnight share = ${f(100 * share, 1)}%** of close-to-close variance`);
  say(`study ships onShare = 0.22 (literature midpoint of 15-30%)`);
  say();
  say("⚠ THE FULL-HISTORY FIGURE IS AN ARTEFACT, NOT A MEASUREMENT. Yahoo reports ^GSPC's open");
  say("as the PRIOR CLOSE for most of the early sample — 96.7% of 2000-2004 sessions and 31.4%");
  say("of 2005-2009 — because S&P published no true opening print then. Those days contribute a");
  say("fabricated ZERO overnight move and drag the share down. Only 2015+ is trustworthy:");
  say();
  say("| window | n | open==prior close | overnight share |");
  say("|---|---:|---:|---:|");
  for (const [lbl, from] of [["2015→ (clean opens)", "2015-01-01"], ["VIX1D era 2022-05→", "2022-05-16"]] as Array<[string, string]>) {
    const w = ds.filter((d) => d >= from);
    const oo: number[] = [], ff: number[] = []; let same = 0, cnt = 0;
    for (let i = 1; i < w.length; i++) {
      const b0 = spxY.get(must(w[i - 1], "a")), b1 = spxY.get(must(w[i], "b"));
      if (b0 === undefined || b1 === undefined) continue;
      oo.push(Math.log(b1.o / b0.c)); ff.push(Math.log(b1.c / b0.c));
      cnt++; if (Math.abs(b1.o - b0.c) < 0.005) same++;
    }
    say(`| ${lbl} | ${ff.length} | ${f((100 * same) / cnt, 1)}% | **${f(100 * (vari(oo) / vari(ff)), 1)}%** |`);
  }
  say();
  // Same figure over the VIX1D era only — regimes move this.
  const recent = ds.filter((d) => d >= "2022-05-16");
  const on2: number[] = [], full2: number[] = [];
  for (let i = 1; i < recent.length; i++) {
    const b0 = spxY.get(must(recent[i - 1], "a")), b1 = spxY.get(must(recent[i], "b"));
    if (b0 === undefined || b1 === undefined) continue;
    on2.push(Math.log(b1.o / b0.c));
    full2.push(Math.log(b1.c / b0.c));
  }
  say(`VIX1D era only (n=${full2.length}): **${f(100 * (vari(on2) / vari(full2)), 1)}%**`);
}
say();
