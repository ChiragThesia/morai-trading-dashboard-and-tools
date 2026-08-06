/**
 * push-gex.ts — push MORAI's latest GEX levels onto the live TradingView chart.
 *
 * WHY AN INPUT AND NOT A SOURCE REWRITE
 *   Pine has no network primitive, so levels must be carried in. The commercial vendors
 *   (MenthorQ, TanukiTrade) rewrite the script source and re-save it, because that is all a
 *   published-script author can do for strangers. We have CDP access to our OWN chart, so we
 *   set the indicator's input value directly instead. That skips compilation entirely, which
 *   matters: Pine bans compiling for ONE HOUR after three consecutive failed compiles, and a
 *   30-minute republish loop is exactly the thing that would trip it.
 *
 * WHY IT SKIPS NULL WALLS
 *   Off-hours both chain sources stop reporting open interest (Schwab returns 0 outside RTH,
 *   CBOE's delayed file stops refreshing), so GEX legitimately computes null walls — measured:
 *   14/14 RTH cycles produce walls, weekends produce none. Pushing nulls would erase good
 *   levels, so we leave the previous blob and let the study's staleness marker age it.
 *   Friday's levels, dimmed and labelled stale, beat an empty overlay on a Monday pre-market.
 *
 * No external dependencies — Bun's native SQL and the tradingview-mcp CLI are enough.
 *
 * Usage:
 *   bun --env-file=.env run tools/tradingview/push-gex.ts          # push once
 *   bun --env-file=.env run tools/tradingview/push-gex.ts --dry    # print, don't touch chart
 *   bun --env-file=.env run tools/tradingview/push-gex.ts --watch  # every 30 min
 *   bun --env-file=.env run tools/tradingview/push-gex.ts --last-good  # newest snapshot WITH walls
 *
 * Requires: DATABASE_URL, and TradingView Desktop running with --remote-debugging-port=9222.
 */

import { SQL } from "bun";
import { execFile, spawn } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

const TV_APP = "/Applications/TradingView.app/Contents/MacOS/TradingView";
const CDP_PORT = 9222;
/** Cold start of the Electron app to a responsive CDP endpoint. */
const LAUNCH_TIMEOUT_MS = 90_000;

const TV_CLI = `${process.env.HOME}/Desktop/tradingview-mcp/src/cli/index.js`;
const STUDY_NAME = "MORAI · Gamma Levels";
/**
 * Positional slot of the gamma blob among the script's input.*() calls; asserted before use.
 * The blob is the FIRST input in gamma-levels.pine, so in_0 — it was in_6 while the levels
 * lived inside the old combined board, where six regime inputs came first. Reordering the
 * inputs in the .pine silently repoints this, which is why setInputs asserts the id exists
 * rather than trusting the constant.
 */
const BLOB_INPUT = "in_0";
const PUSH_INTERVAL_MS = 30 * 60 * 1000;

type Snapshot = {
  cycleTime: Date;
  flip: number | null;
  callWall: number | null;
  putWall: number | null;
  netGamma: number;
};

/** PG numerics arrive as strings; null must stay null and never collapse to 0. */
function num(v: unknown): number | null {
  if (v === null || v === undefined) return null;
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? n : null;
}

/**
 * `lastGood` selects the newest snapshot that actually HAS walls rather than the newest row.
 * Off-hours the newest row is wall-less by design, so this is the pre-market / weekend
 * bootstrap: put Friday's real levels on the chart, correctly stamped with Friday's
 * cycle_time so the study renders them dimmed and labelled stale.
 */
async function latestSnapshot(sql: SQL, lastGood: boolean): Promise<Snapshot | null> {
  // Prefer the near_term (<=45d DTE) level set over the all-expiry walls, falling back
  // per-field when near_term is absent (it is null on rows written before migration 0019).
  //
  // This is not a preference, it is a correctness fix. pickWalls() scans EVERY expiry with
  // no DTE bound, so the all-expiry walls land on whichever round strike carries the most
  // open interest across the whole book — which is a LEAPS parking lot, not a hedging wall.
  // Measured live on 2026-08-05 with spot 7729: the all-expiry put wall was 7000, 9.4% away,
  // sitting on 586k of far-dated put OI whose net GEX is only -1.12 Bn; the near-term put
  // wall was 7700, 0.4% away. Same snapshot, same function, different DTE window.
  // A level 9% out is not a level you trade a calendar around.
  const cols = sql`
    cycle_time,
    coalesce((near_term ->> 'flip')::double precision,     flip)      as flip,
    coalesce((near_term ->> 'callWall')::double precision, call_wall) as call_wall,
    coalesce((near_term ->> 'putWall')::double precision,  put_wall)  as put_wall,
    net_gamma_at_spot`;

  const rows = (await (lastGood
    ? sql`
        select ${cols}
        from gex_snapshots
        where call_wall is not null or put_wall is not null
        order by cycle_time desc
        limit 1`
    : sql`
        select ${cols}
        from gex_snapshots
        order by cycle_time desc
        limit 1`)) as Array<Record<string, unknown>>;

  const r = rows[0];
  if (r === undefined) return null;

  return {
    cycleTime: new Date(String(r["cycle_time"])),
    flip: num(r["flip"]),
    callWall: num(r["call_wall"]),
    putWall: num(r["put_wall"]),
    netGamma: num(r["net_gamma_at_spot"]) ?? 0,
  };
}

/** flip|callWall|putWall|netGamma|unixMillis — the format board_merged.pine parses. */
function toBlob(s: Snapshot): string {
  const f = (v: number | null) => (v === null ? "0" : String(Math.round(v * 100) / 100));
  return [f(s.flip), f(s.callWall), f(s.putWall), f(s.netGamma), String(s.cycleTime.getTime())]
    .join("|");
}

/** Thrown when TradingView is not reachable, so callers can print help instead of a stack. */
class BridgeDown extends Error {}

const LAUNCH_HELP = `
TradingView Desktop is not reachable on the CDP debug port (9222).

Launch it with the port open — it must be owned by a Terminal window, because nohup and
'open -a --args' both die with the spawning shell on macOS:

  osascript -e 'quit app "TradingView"'; sleep 3; \\
  osascript -e 'tell application "Terminal" to do script \\
    "/Applications/TradingView.app/Contents/MacOS/TradingView \\
     --remote-debugging-port=9222 >/tmp/tv.log 2>&1"'

Leave that window open, and do NOT press Ctrl-C in it — that quits TradingView.
Note: TradingView self-relaunches to apply updates and comes back WITHOUT the debug flag,
so re-run the command after an auto-update.

Verify with:  lsof -nP -iTCP:9222 -sTCP:LISTEN`;

async function tv(args: string[]): Promise<unknown> {
  try {
    const { stdout } = await execFileAsync("node", [TV_CLI, ...args], {
      maxBuffer: 32 * 1024 * 1024,
    });
    return JSON.parse(stdout) as unknown;
  } catch (e: unknown) {
    // The CLI exits non-zero and reports the CDP failure on stderr; surface that as a typed
    // error rather than letting execFile's stack trace reach the user.
    const text = e !== null && typeof e === "object" && "stderr" in e ? String(e.stderr) : "";
    if (/CDP connection failed|ECONNREFUSED|fetch failed/i.test(text)) {
      throw new BridgeDown("TradingView bridge unreachable");
    }
    throw e;
  }
}

/** Fail fast with actionable help, before touching the DB or doing any work. */
async function assertBridge(): Promise<void> {
  const health = (await tv(["status"])) as { cdp_connected?: boolean };
  if (health.cdp_connected !== true) throw new BridgeDown("TradingView bridge unreachable");
}

// ── App lifecycle ───────────────────────────────────────────────────────────
// So a push is one command. If the debug port is already up the user is driving the app and
// we leave it entirely alone; otherwise we own the whole lifecycle: launch headless-ish,
// push, verify, quit. TradingView stores layouts server-side, so quitting loses nothing.

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function cdpUp(): Promise<boolean> {
  try {
    const res = await fetch(`http://127.0.0.1:${CDP_PORT}/json/version`, {
      signal: AbortSignal.timeout(1500),
    });
    return res.ok;
  } catch {
    return false;
  }
}

async function appRunning(): Promise<boolean> {
  try {
    await execFileAsync("pgrep", ["-f", "TradingView.app/Contents/MacOS/TradingView"]);
    return true;
  } catch {
    return false;
  }
}

async function quitApp(): Promise<void> {
  // AppleScript quit rather than SIGKILL so the app flushes its own state on the way out.
  try {
    await execFileAsync("osascript", ["-e", 'quit app "TradingView"']);
  } catch {
    /* already gone */
  }
  for (let i = 0; i < 20; i++) {
    if (!(await appRunning())) return;
    await sleep(500);
  }
}

/**
 * Launch with the debug port and wait for CDP to answer.
 *
 * detached + unref so TradingView OUTLIVES this script — the push is a one-shot, the app is
 * yours to keep using afterwards. `open -a --args` cannot be used because LaunchServices
 * silently reuses a running instance and drops the flag, which is also why an already-running
 * instance has to be quit first: there is no way to add a debug port to a live process.
 */
async function launchApp(): Promise<ReturnType<typeof spawn>> {
  if (await appRunning()) {
    console.warn("  restarting TradingView so it comes up with the debug port…");
    await quitApp();
  }
  console.warn("  launching TradingView with the debug port…");
  const child = spawn(TV_APP, [`--remote-debugging-port=${CDP_PORT}`], {
    stdio: "ignore",
    detached: true,
  });
  child.unref();

  const deadline = Date.now() + LAUNCH_TIMEOUT_MS;
  while (Date.now() < deadline) {
    if (await cdpUp()) {
      // The port answers before the chart finishes wiring up its API; wait for the CLI to
      // report a usable chart rather than racing it.
      try {
        const st = (await tv(["status"])) as { cdp_connected?: boolean; api_available?: boolean };
        if (st.cdp_connected === true && st.api_available === true) {
          console.warn("  ready");
          return child;
        }
      } catch {
        /* not up yet */
      }
    }
    await sleep(2000);
  }
  child.kill();
  throw new BridgeDown("TradingView did not become ready within 90s");
}

/** Read the blob back off the chart and confirm it is what we sent. */
async function verifyPush(id: string, expected: string): Promise<boolean> {
  const got = (await tv(["indicator", "get", "--id", id])) as {
    inputs?: Record<string, { id?: string; value?: unknown }>;
  };
  const found = Object.values(got.inputs ?? {}).find((i) => i.id === BLOB_INPUT);
  return String(found?.value ?? "") === expected;
}

async function findBoardId(): Promise<string | null> {
  const state = (await tv(["state"])) as { studies?: Array<{ id: string; name: string }> };
  return state.studies?.find((s) => s.name === STUDY_NAME)?.id ?? null;
}

/**
 * Studies finish loading AFTER the chart API reports itself available, so on a cold launch
 * the board is briefly absent. Polling here rather than failing turns a race into a wait.
 */
async function waitForBoard(timeoutMs = 45_000): Promise<string | null> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const id = await findBoardId();
    if (id !== null) return id;
    if (Date.now() >= deadline) return null;
    await new Promise((r) => setTimeout(r, 2000));
  }
}

/** The blob slot is positional, so fail loudly if the script's input order ever changes. */
async function assertBlobInput(id: string): Promise<void> {
  const got = (await tv(["indicator", "get", "--id", id])) as {
    inputs?: Record<string, { id?: string }>;
  };
  const ids = Object.values(got.inputs ?? {}).map((i) => i.id);
  if (!ids.includes(BLOB_INPUT)) {
    throw new Error(
      `"${STUDY_NAME}" has no ${BLOB_INPUT} input (found: ${ids.join(", ")}). ` +
        `The script's input order changed — update BLOB_INPUT in this file.`,
    );
  }
}

async function pushOnce(sql: SQL, dry: boolean, lastGood: boolean): Promise<void> {
  const at = new Date().toISOString().slice(11, 19);
  const snap = await latestSnapshot(sql, lastGood);

  if (snap === null) {
    console.warn(`[${at}] no gex_snapshots row — nothing to push`);
    return;
  }

  const ageMin = Math.round((Date.now() - snap.cycleTime.getTime()) / 60000);

  if (snap.callWall === null && snap.putWall === null) {
    console.warn(
      `[${at}] snapshot ${snap.cycleTime.toISOString()} (${ageMin}m old) has no walls — ` +
        `skipping push, keeping previous levels (market closed or off-hours)`,
    );
    return;
  }

  const blob = toBlob(snap);
  console.warn(
    `[${at}] flip=${snap.flip} call=${snap.callWall} put=${snap.putWall} ` +
      `netΓ=${snap.netGamma.toFixed(2)} age=${ageMin}m`,
  );

  if (dry) {
    console.warn(`[${at}] --dry: would set ${BLOB_INPUT}=${blob}`);
    return;
  }

  await assertBridge();

  const id = await waitForBoard();
  if (id === null) {
    console.error(`[${at}] "${STUDY_NAME}" is not on the chart — add it first`);
    return;
  }
  await assertBlobInput(id);
  await tv(["indicator", "set", "--id", id, "--inputs", JSON.stringify({ [BLOB_INPUT]: blob })]);

  // Setting an input changes only the LIVE chart — a reload or app restart reverts it to the
  // last saved layout, silently dropping the levels. ⌘S persists them. Failing to save is not
  // worth aborting the push over: the levels are already on screen, they just would not
  // survive a restart.
  try {
    await tv(["ui", "keyboard", "s", "--meta"]);
  } catch (e: unknown) {
    console.warn(`[${at}] pushed but layout save failed:`,
      e instanceof Error ? e.message : String(e));
  }

  // Read it back. A push that silently did not land is the failure mode worth catching —
  // the levels would look present in the log while the chart still showed the old ones.
  if (await verifyPush(id, blob)) {
    console.warn(`[${at}] pushed → ${id} ✓ verified on chart`);
  } else {
    throw new Error(`push did NOT land on ${id} — chart still holds a different blob`);
  }
}

// ── main ────────────────────────────────────────────────────────────────────
const dry = process.argv.includes("--dry");
const watch = process.argv.includes("--watch");
const lastGood = process.argv.includes("--last-good");

const url = process.env.DATABASE_URL;
if (url === undefined || url === "") {
  console.error("DATABASE_URL is not set — run with `bun --env-file=.env run ...`");
  process.exit(1);
}

const sql = new SQL(url);

// Own the app lifecycle only when we had to start it. If the port is already up the user is
// driving TradingView and we must not close it out from under them.
const weLaunchedIt = !dry && !(await cdpUp());
let child: ReturnType<typeof spawn> | null = null;

try {
  if (weLaunchedIt) child = await launchApp();
  await pushOnce(sql, dry, lastGood);
} catch (e: unknown) {
  if (e instanceof BridgeDown) {
    console.error(LAUNCH_HELP);
    await sql.close();
    if (child !== null) await quitApp();
    process.exit(1);
  }
  console.error(e instanceof Error ? e.message : String(e));
  await sql.close();
  process.exit(1);
}

// TradingView is deliberately left RUNNING — it is yours to keep using, and the debug port
// stays open so the next push needs no restart. Quitting it here also used to lose the push:
// the levels live in chart memory until the layout is saved, so a quit could roll them back.
if (child !== null) console.warn("  TradingView left running (debug port open)");

if (watch) {
  console.warn(`watching — next push in ${PUSH_INTERVAL_MS / 60000} min (ctrl-c to stop)`);
  setInterval(() => {
    // One bad cycle must never kill the loop. A bridge that went away (TradingView quit or
    // auto-updated) is the common case and worth one clear line, not a stack trace — the
    // loop keeps running so it recovers by itself once the app is back.
    void pushOnce(sql, dry, lastGood).catch((e: unknown) => {
      console.error(e instanceof BridgeDown
        ? `bridge unreachable — waiting; relaunch TradingView with --remote-debugging-port=9222`
        : `push failed: ${e instanceof Error ? e.message : String(e)}`);
    });
  }, PUSH_INTERVAL_MS);
} else {
  await sql.close();
}
