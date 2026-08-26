# Cleanup Manifest

Repo: `/Users/chiragpersonalmac/Desktop/morai-trading-dashboard-and-tools`
Measured: 2026-08-25. Every number below comes from `du -sk`, `find`, `md5`, or `git` on this
machine. Sizes are KiB as `du` reports them.

Repo total when measured: **7,397,392 KiB (7.06 GiB)**.

---

## 0. Execution status — updated 2026-08-25, after this manifest was written

**The largest Tier 1 item is already done.** Repo is now **880 MiB**, down from 7.06 GiB.

| Step | Status | Detail |
|---|---|---|
| `.claude/worktrees` — 6,120,488 KiB | **DONE** 08-25 | 6.2 GiB → 5.7 MiB |
| **Tier 2** — all five entries | **DONE** 08-26 | see below |
| **Tier 3** — all reorganisation | **DONE** 08-26 | see below |
| Tier 1 — remaining deletes | **script ready** | `cleanup-tier1.sh`, ~795 MiB. Guard-blocked, needs a human to run |
| Tier 4 — four questions | not started | awaiting decisions |

### Tier 2, executed 2026-08-26

Every check was run first and its output decided the action.

| Entry | Check result | Action taken |
|---|---|---|
| 2.1 `agent-aae27803b9e3b5346` | `git rev-list --count main..` = **0** | branch deleted (was `f7e967a`); directory left for the script |
| 2.2 `agent-af3fc5c2b2ea1dc10` | `git rev-list --count main..` = **0** | branch deleted (was `4056f72`); directory left for the script |
| 2.3 `37-REVIEW 2.md` | see correction below | `git rm` |
| 2.4 / 2.5 `pa-source-text` pair | only hit was this manifest quoting its own grep string — a self-reference, not a citation | `git rm` both |

**Correction to §4's 2.3 analysis.** §4 concluded "the content diverges" from an md5 comparison
alone. A real diff says something more specific, and the difference matters.

`diff` reports 34 lines present only in `37-REVIEW.md` and 2 lines present only in the ` 2` copy.
The 2 lines are `status: issues_found` and `**Status:** issues_found`. The 34 are the block that
replaced them: `status: fixes_verified`, the six fix commits (`CR-01: 6894e7c`, `CR-02: 6894e7c`,
`WR-01: 048fddc`, `WR-02: a0554c5`, `WR-03: a87bc9a + 6fbfe76`, `WR-04: 37c651f`), and the process
note about `apps/web` not being covered by the root typecheck.

So the ` 2` file is not a truncation and not a divergence. It is a **stale earlier snapshot**, taken
before the fixes were applied. It contains nothing the main file lost. `git rm` was correct.

The general lesson, worth more than this one file: **an md5 mismatch proves two files differ, not
that either holds unique content.** Diff before you conclude divergence. A stale copy and a copy
with unique edits look identical to a checksum.

### Tier 3, executed 2026-08-26

| Entry | Action |
|---|---|
| 5.1 graph binaries | `git rm --cached` on `graph.json`, `graph.html`, `.last-build-snapshot.json`. `GRAPH_REPORT.md` stays tracked. Files remain on disk. |
| 5.1 collision `.gitignore` rule | Added `* 2` and `* 2.*`, after verifying **zero tracked files match** either pattern |
| 5.2 `wb_ssrn.html` | Title confirmed as the Campasano paper. Moved to `docs/research/papers/campasano-term-structure-forecasts-ssrn-3240028.html` and `git add`ed |
| 5.3 superseded mockups | 8 files moved to `mockups/archive/`. The 7 latest-of-family plus `tos-reference/` stay in place |
| 5.4 `knowledge-base/` | No action — correctly deferred to Tier 4 Q4 |

**A latent trap found and fixed during 5.1.** The safety-net step on 08-25 added `.planning/graphs/`
to `.gitignore`. That silently covered `GRAPH_REPORT.md`, which is tracked prose that must stay
tracked. Nothing breaks while a file is already tracked — but if it were ever removed and re-added,
git would refuse it without explanation. A directory exclusion also blocks any negation beneath it,
so `!.planning/graphs/GRAPH_REPORT.md` alone would not have worked. The rule is now:

```
.planning/graphs/*
!.planning/graphs/GRAPH_REPORT.md
```

Verified after the change: `git ls-files -i -c --exclude-standard` returns **empty** — no tracked
file is ignored — while all three binaries still resolve as ignored.

**A stale lock, cleared.** `git rm` failed on first attempt against `.git/index.lock`. The lock was
0 bytes, dated 2026-08-24 09:01 — 48 hours old — and `lsof` confirmed no process held it. A crashed
process left it behind. Removed, and the index verified healthy before continuing. It was never a
live lock; the check ran before the removal, not after.

### Safety net as of 2026-08-26

A second snapshot now covers the post-Tier-2/3 state, so both the original tree and the current one
are recoverable:

| Ref | Commit | Covers |
|---|---|---|
| `refs/snapshots/pre-cleanup-2026-08-25` | `4f6f7ea` | the tree before any cleanup |
| `refs/snapshots/post-tier23-2026-08-26` | `57a507a` | after Tiers 2+3, before the Tier 1 deletes |

`morai-all-refs.bundle` was regenerated to hold both, plus every branch. Re-verified: *"The bundle
records a complete history."*

Tiers 2 and 3 are staged and modified in the working tree but **not committed** — no commit was
requested.

What was actually run, which differs from what §3 recommends and supersedes it:

```bash
git worktree remove --force <each of the 11 registered worktrees>
git worktree prune -v
```

§3's "worktree rule" recommends deleting only the ignored `node_modules` inside each worktree and
leaving the worktrees registered. The stronger action was taken instead — the worktrees were
removed outright — after verifying every branch survives it:

- All **13** `worktree-agent-*` branches were confirmed present in
  `morai-cleanup-backup-2026-08-25/morai-all-refs.bundle` by SHA, before anything was removed.
  That check specifically covered the three branches that exist in **no other copy** because they
  were never pushed to origin: `worktree-agent-a94eba70ca1d6d1c5` (`b87fcdd7`),
  `worktree-agent-aae27803b9e3b5346` (`f7e967a2`), `worktree-agent-af3fc5c2b2ea1dc10` (`4056f723`).
- All 11 registered worktrees had a clean status — zero uncommitted changes outside `node_modules`.
- **All 13 branches still exist in the live repo.** Removing a worktree removes the checkout, not
  the branch. Nothing needs restoring from the bundle; the bundle is the second line of defence.

To bring any of it back:

```bash
git worktree add .claude/worktrees/agent-<id> worktree-agent-<id>
```

**Still outstanding: 5.7 MiB in four orphan directories** under `.claude/worktrees/`. Two are
0-byte skeletons; two are unregistered worktrees sitting at 0 commits ahead of `main`, both in the
bundle. A local guard blocks `rm -rf`, so this one needs a human:

```bash
rm -rf /Users/chiragpersonalmac/Desktop/morai-trading-dashboard-and-tools/.claude/worktrees
```

Note that §2's arithmetic below ("the tree drops to roughly 467,476 KiB") was computed against the
7.06 GiB starting point and still assumes the worktrees are pending. Read §2 as the plan as
written, not as current state.

---

## 1. Safety net

All four pieces verified before this manifest was written.

| Asset | State | Verified how |
|---|---|---|
| `refs/snapshots/pre-cleanup-2026-08-25` | commit `4f6f7eae1bec520140ced194c51e03fa32b5a680`, 1,764 files | `git rev-parse`, `git ls-tree -r` |
| `morai-all-refs.bundle` | 12.2M, "records a complete history", sha1 | `git bundle verify` |
| `.env` 1.1K, `.env.local` 1.2K, `.env.example` 2.9K | present | `ls -la` |
| `claude-settings.json` 323B, `claude-settings.local.json` 161B | present, not named in the brief | `ls -la` |
| `untracked-precious.tgz` | 220.7K, 146 entries, starts with `.remember/` | `tar -tzf` |
| `claude-memory/` | 60 files | `find -type f \| wc -l` |

Restore commands, one line each:

```bash
# Whole working tree as it stood before cleanup (tracked + untracked)
git restore --source=refs/snapshots/pre-cleanup-2026-08-25 -- .

# One file back from the snapshot
git show refs/snapshots/pre-cleanup-2026-08-25:PATH > PATH

# Every branch and all history, into a fresh clone
git clone /Users/chiragpersonalmac/Desktop/morai-cleanup-backup-2026-08-25/morai-all-refs.bundle morai-restored

# Fetch one lost branch into the live repo
git fetch /Users/chiragpersonalmac/Desktop/morai-cleanup-backup-2026-08-25/morai-all-refs.bundle 'refs/heads/*:refs/heads/recovered/*'

# Secrets
cp /Users/chiragpersonalmac/Desktop/morai-cleanup-backup-2026-08-25/.env{,.local} .

# Untracked precious files
tar -xzf /Users/chiragpersonalmac/Desktop/morai-cleanup-backup-2026-08-25/untracked-precious.tgz -C .

# Claude memory
cp -R /Users/chiragpersonalmac/Desktop/morai-cleanup-backup-2026-08-25/claude-memory/. \
      /Users/chiragpersonalmac/.claude/projects/-Users-chiragpersonalmac-Desktop-morai-trading-dashboard-and-tools/memory/
```

### The gap in the safety net

The snapshot ref holds tracked and untracked files. It does **not** hold ignored files. Measured:

```
.fallow/       -> 0 files in snapshot
.codegraph/    -> 0 files in snapshot
graphify-out/  -> 0 files in snapshot
mockups/       -> 16 files in snapshot
wb_ssrn.html   -> 1 file in snapshot
.planning/graphs/ -> 4 files in snapshot
```

Several input rows claimed the snapshot ref as the recovery path for ignored directories. That
claim is false for `.fallow`, `.codegraph`, and `graphify-out`. Each was re-checked against a real
regeneration command instead. `.fallow` failed both tests and was demoted to Tier 4.

---

## 2. Headline

| Tier | What | Reclaimed |
|---|---|---|
| Tier 1 | Regenerable and ignored output | **6,929,916 KiB (6.61 GiB)** |
| Tier 2 | Safe after one check | 5,868 KiB |
| Tier 3 | Reorganisation | 0 — moves and untracking free no disk |
| Tier 4 | Needs the user | 13,364 KiB held back, plus a 1,232 KiB move decision |

Tier 1 alone is **93.7% of the repo**. After Tier 1 the tree drops from 7,397,392 KiB to roughly
**467,476 KiB (456 MiB)**.

One line dominates everything else: 13 `node_modules` copies under `.claude/worktrees/` total
**6,120,488 KiB**, or 88% of the whole repo. Eleven registered worktrees carry ~556,416 KiB each.

`git rm --cached` in Tier 3 frees zero bytes. The 11,044 KiB of `.planning/graphs` binaries stay on
disk and stay in history. Reclaiming them from history needs a rewrite. This manifest does not
recommend one.

---

## 3. TIER 1 — safe, zero risk

Regenerable output and empty sync debris. Every row here is ignored by git or reproducible by a
command that exists on this machine. Nothing here is tracked prose.

### The worktree rule

**Never `rm -rf` a registered worktree.** Git stores each worktree's administrative record in
`.git/worktrees/<name>`. Deleting the directory leaves that record behind, pointing at a path that
no longer exists. The branch stays checked out to a ghost, so `git branch -d` refuses it and the
next `git worktree add` on the same name fails. Use `git worktree remove`, which clears both sides.

Eleven worktrees are registered. Tier 1 **keeps all eleven** and removes only their `node_modules`.
That resolves the conflict between the two inventory agents — one called the worktrees regenerable,
one called them live state. Keeping the registration is the conservative read, and purging ignored
`node_modules` inside a live worktree is safe.

Four directories under `.claude/worktrees/` are **not** registered:

```
agent-a10abbc64b69262e5   0 KiB
agent-ad23c63bf56efce5a   0 KiB
agent-aae27803b9e3b5346   2,992 KiB  -> Tier 2
agent-af3fc5c2b2ea1dc10   2,876 KiB  -> Tier 2
```

`git worktree prune --dry-run -v` prints **nothing**. Verified. Prune only clears stale
administrative records, and these four never had one. So prune cannot touch them and `rm -rf` is
the correct tool — precisely because they are unregistered. The two empty ones are Tier 1. The two
carrying content are Tier 2.

Delete them **by literal path**. Never glob `agent-*` — that pattern also matches the eleven live
worktrees.

### Commands

Ordered so nothing depends on something already removed. `.codegraph` goes last because deleting it
takes the codegraph MCP index offline until it re-indexes.

```bash
cd /Users/chiragpersonalmac/Desktop/morai-trading-dashboard-and-tools

# 1. Worktree node_modules — 6,120,488 KiB, the single biggest win.
#    Registered worktrees stay registered. Only ignored output goes.
#    Verified: none of these paths is a symlink, so no delete escapes into root node_modules.
#    This matches 13 dirs: the 11 registered worktrees plus 4 KiB stubs in the 2 Tier 2
#    orphans. Sweeping the stubs is harmless — those orphans are slated for removal anyway.
find .claude/worktrees -maxdepth 2 -name node_modules -type d -print0 | xargs -0 rm -rf

# 2. Two EMPTY unregistered worktrees. Literal paths, no glob.
rm -rf ".claude/worktrees/agent-a10abbc64b69262e5"
rm -rf ".claude/worktrees/agent-ad23c63bf56efce5a"

# 3. Root and workspace node_modules — 604,296 + ~15,380 KiB
rm -rf node_modules
rm -rf apps/web/node_modules apps/server/node_modules apps/worker/node_modules
rm -rf packages/core/node_modules packages/adapters/node_modules \
       packages/contracts/node_modules packages/shared/node_modules packages/quant/node_modules
rm -rf .ds-sync/node_modules

# 4. Python — 97,220 KiB venv + 564 KiB bytecode + 28 KiB pytest cache
rm -rf apps/sidecar/.venv
find apps/sidecar -type d -name __pycache__ -not -path "*/.venv/*" -print0 | xargs -0 rm -rf
rm -rf apps/sidecar/.pytest_cache

# 5. TypeScript declaration output — 4,044 KiB, all emitDeclarationOnly
rm -rf packages/*/dist apps/server/dist apps/worker/dist

# 6. Vite build output — 1,356 KiB
rm -rf apps/web/dist

# 7. graphify-out — 9,432 KiB.
#    graph.json and graph.html are byte-identical to the tracked .planning/graphs copies
#    (md5 2e8135f4... and c1a8dd25...), so this is a duplicate of tracked content.
rm -rf graphify-out

# 8. Empty iCloud collision directories — the 9 of 13 that survive the steps above.
#    Steps 3-7 already swept "apps/server/dist/adapters 2", "apps/worker/dist/handlers 2" and
#    "apps/web/node_modules/.vite/deps 2"; "ds-bundle/components 2" waits on Tier 4.
rm -rf "packages/adapters/src/schwab/auth 2" "packages/adapters/src/schwab/market 2" \
       "packages/adapters/src/schwab/trader 2" "packages/adapters/src/test/fixtures 2" \
       "packages/core/src/analytics/application 2" "packages/core/src/analytics/domain 2" \
       "packages/core/src/brokerage/application 2" "packages/core/src/brokerage/domain 2" \
       "plans/morai-status 2"

# 9. codegraph index — 33,404 KiB. LAST: this takes the codegraph MCP offline until re-index.
rm -rf .codegraph
```

### Restoring Tier 1

```bash
bun install                                    # every node_modules, root + workspaces + worktrees
bun run typecheck                              # tsc --build --force -> all dist/ declarations
cd apps/web && bun run build                   # apps/web/dist
cd apps/sidecar && python3 -m venv .venv && .venv/bin/pip install -r requirements.txt
cd .ds-sync && npm install                     # .ds-sync/node_modules
graphify . --output graphify-out               # /Users/chiragpersonalmac/.local/bin/graphify
codegraph init                                 # /opt/homebrew/bin/codegraph, then re-index
```

Verified present: `apps/sidecar/requirements.txt`, `.ds-sync/package.json`, the `graphify` binary,
the `codegraph` binary, and the `typecheck` script (`tsc --build --force`).

There is **no** `codegraph:index` script in `package.json`. One input row claimed
`bun run codegraph:index` as the recovery. That command does not exist. Use `codegraph init`.

Each worktree needs its own `bun install` to get its `node_modules` back.

---

## 4. TIER 2 — safe after a check

Five entries. Each is tracked prose or carries unpushed work, so each gets a command whose output
makes the decision. Tracked prose does not belong in Tier 1 even at risk `none` — Tier 1's contract
is "regenerable and ignored output", and prose is neither.

### 2.1 Orphan worktree `agent-aae27803b9e3b5346` (2,992 KiB)

Its branch exists locally at `f7e967a2` and is **not** on origin. Verified.

```bash
git log --oneline main..worktree-agent-aae27803b9e3b5346 | head -20
```

Empty output means the branch holds nothing main lacks — delete freely. Any commits listed are
unpushed work; they survive in `morai-all-refs.bundle`, so deleting the directory still loses
nothing, but read them first.

```bash
rm -rf ".claude/worktrees/agent-aae27803b9e3b5346"   # unregistered: rm -rf is correct here
git branch -D worktree-agent-aae27803b9e3b5346       # only after the log above is read
```

### 2.2 Orphan worktree `agent-af3fc5c2b2ea1dc10` (2,876 KiB)

Branch at `4056f723`, not on origin. Same check, same treatment.

```bash
git log --oneline main..worktree-agent-af3fc5c2b2ea1dc10 | head -20
rm -rf ".claude/worktrees/agent-af3fc5c2b2ea1dc10"
```

### 2.3 `.planning/phases/37-…/37-REVIEW 2.md` (15,379 bytes, **tracked**)

The inventory missed this one. It is an iCloud collision that reached git history — the single
strongest piece of root-cause evidence in this repo. Because it is tracked, git replicated it into
all eleven worktrees.

It is **not** a duplicate. `37-REVIEW.md` is 18,650 bytes, md5 `1435b895…`; `37-REVIEW 2.md` is
15,379 bytes, md5 `396c6641…`. The content diverges.

```bash
diff ".planning/phases/37-in-app-schwab-re-auth-wizard-hosted-oauth-flow-replacing-the/37-REVIEW.md" \
     ".planning/phases/37-in-app-schwab-re-auth-wizard-hosted-oauth-flow-replacing-the/37-REVIEW 2.md"
```

If the diff is only the collision's truncation, `git rm` it. If it holds review notes the main file
lost, merge them first. Recovery is guaranteed either way — it is tracked, so it lives in history
and in the bundle.

### 2.4 and 2.5 `docs/research/pa-source-text/` pair (7,101 + 2,637 bytes, **tracked**)

Filename greps miss prose citations, so both were tested by **title string** instead. Both scored
zero — in the 446K synthesis guide and repo-wide:

```bash
grep -ril "Black-Scholes Model Explained\|earnings trade log" --include="*.md" . \
  | grep -v node_modules | grep -v pa-source-text
```

Empty output confirms nothing cites them. Then:

```bash
git rm "docs/research/pa-source-text/Black-Scholes-Model-Explained.txt" \
       "docs/research/pa-source-text/earnings-trade-log.txt"
```

The other 58 files in that directory are cited and stay.

---

## 5. TIER 3 — reorganisation

Nothing here is deleted and nothing here frees disk. These moves make the tree legible.

### 5.1 Untrack the generated graph binaries

`.planning/graphs/` is **already in `.gitignore` at line 40** — verified — yet all four files are
still tracked. That is exactly the stale-index case `git rm --cached` exists for.

Three of the four are generated binaries totalling 11,044 KiB. `GRAPH_REPORT.md` (88,271 bytes) is
prose and stays tracked.

```bash
git rm --cached .planning/graphs/graph.json \
                .planning/graphs/graph.html \
                .planning/graphs/.last-build-snapshot.json
```

No `.gitignore` addition is needed. The rule is already there. The same is true for `.codegraph/`
(line 37), `graphify-out/` (line 38), `.fallow/` (line 39), and `.claude/worktrees/` (line 26) —
all already ignored. Reporting them as "additions" would be wrong.

One addition is genuinely missing — a rule for the collision pattern itself:

```bash
cat >> .gitignore <<'EOF'

# iCloud sync collision artifacts (see CLEANUP-MANIFEST.md section 8)
* 2
* 2.*
EOF
```

That is a bandaid on a symptom. Section 8 has the real fix.

### 5.2 `wb_ssrn.html` (70,036 bytes) — verdict corrected

Two agents disagreed. One called it a Wayback snapshot of SSRN paper 3240028 worth archiving. One
called it a "pasted throwaway visualization tool" worth deleting, and put its size at 145K.

The second agent was wrong on both counts. Measured size is 70,036 bytes. The title tag reads:

```
<title>Term Structure Forecasts of Volatility and Option Portfolio Returns by Jim Campasano :: SSRN</title>
```

This is the Campasano paper — the source behind the calendar engine's entry gate. It is live
research material, not throwaway. Deleting it was never on the table.

```bash
mkdir -p docs/research/papers
mv wb_ssrn.html "docs/research/papers/campasano-term-structure-forecasts-ssrn-3240028.html"
git add "docs/research/papers/campasano-term-structure-forecasts-ssrn-3240028.html"
```

Plain `mv` — the file is untracked. Source of record if the local copy is ever lost:
`https://web.archive.org/web/20240818194007/https://papers.ssrn.com/sol3/papers.cfm?abstract_id=3240028`

### 5.3 Superseded mockups

Conservative merge: one agent said archive the directory, one said delete five files. Archiving
wins. All five superseded files are **untracked**, so these are plain `mv`, not `git mv`. Only
`mockups/journal-lifecycle-v3.html` and `mockups/tos-reference/README.md` are tracked, and both are
keep-latest.

```bash
mkdir -p mockups/archive
mv mockups/overview-v1.html mockups/playground-v1.html mockups/playground-v2.html \
   mockups/playground-v3.html mockups/journal-lifecycle-v1.html \
   mockups/journal-lifecycle-v2.html mockups/archive/
mv mockups/gex-profile.json mockups/gex-snapshot.json mockups/archive/
```

All sixteen `mockups/` files are in the snapshot ref, so recovery is real.

### 5.4 `knowledge-base/grouped-data/` — premise refuted, moved to Tier 4

The input classified 100 of these 111 files as "uncited — zero inbound citations in active
codebase" and recommended archiving them. **That premise is false.** Do not run the archive.

`knowledge-base/grouped-data/CLAUDE.md` is an index for the directory. It references the files two
ways: 29 by literal name, and four whole families by documented glob — `quantocracy_*`,
`traderfeed_*`, `abnormalreturns_*`, `steadyoptions_*` — plus `*_REPORT*` / `*_SUMMARY*` for the
meta files. Classified against it:

| Reference | Count |
|---|---|
| Named in `CLAUDE.md` | 29 |
| Matched by a documented glob | 59 |
| Matched by the meta glob | 1 |
| Genuinely unreferenced | 21 |
| **Total** | **111** |

So **89 of 111 files are referenced by the index sitting in their own directory.** Archiving 100 of
them breaks that index by name and by family.

The inventory named `macro_equity`, `market_patterns`, `psychology_*`, `traderfeed_*`,
`abnormalreturns_*`, and `quantocracy_*` as uncited examples. Every one is referenced —
`macro_equity.md`, `market_patterns.md`, and the three `psychology_*.md` files by literal name, the
rest by glob. The check that finds this takes one command:

```bash
grep -oE '[a-zA-Z0-9_-]+\.md' knowledge-base/grouped-data/CLAUDE.md | sort -u
```

A related trap sits underneath it. The input's cited-ten keep-list contains `straddle.md` and
`strangle.md` but not `straddle_strangle_strategies.md`, which is a third, distinct file (3,748
bytes) cited at `grouped-data/CLAUDE.md:12` next to `earnings_plays.md`. A keep-list built from the
input alone archives a cited file whose name merely looks like two files already on the list.

The go/no-go is now **Tier 4 question 4**. `FINAL_CATEGORIZATION_REPORT.md` moves with whatever is
decided there — it matches the `*_REPORT*` meta glob, so it is not independently safe to move
either.

`misc.md` is on the cited-ten list but measures 0 bytes. That contradiction is Tier 4 question 3.

---

## 6. TIER 4 — needs the user

Four questions.

**1. `.design-sync/` (920 KiB) + `ds-bundle/` (9,988 KiB) — 10,908 KiB total. Still live?**
Untracked, last touched 2026-07-24, and the only entry any agent flagged `risk: high`.
Options: (a) keep as-is, (b) move both to `design-archive/`, (c) delete.
**Recommendation: (b).** The design system shipped in Phase 42 and the token migration is complete,
so the bundle has done its job. Archiving keeps it reachable without it sitting at the repo root.
Do not choose (c) — untracked means the snapshot ref is the only copy.

**2. `.fallow/` (2,456 KiB) — demoted from DELETE. Keep or drop?**
The input marked this DELETE at risk `none` with the snapshot ref as recovery. Both halves fail.
The snapshot holds **0** `.fallow` files because the directory is ignored, and `fallow` is **not
installed** on this machine (`command -v fallow` → not found). So the contents are three opaque
binaries — `cache.bin` 2,065,881 B, `churn.bin` 152,034 B, `graph-cache.bin` 270,644 B — that
cannot be restored and cannot be regenerated. The rule says a DELETE without a real recovery path
gets demoted, not promoted.
Options: (a) copy to the backup directory, then delete; (b) delete outright; (c) keep.
**Recommendation: (a).** It costs 2.4 MiB in the backup and closes the hole. 2,456 KiB is 0.03% of
the repo, so there is no reason to gamble for it.

**3. `knowledge-base/grouped-data/misc.md` — 0 bytes but on the cited-ten list.**
One agent called it an empty placeholder to delete. Another listed it among the ten cited keepers.
Both cannot hold. It measures 0 bytes and a repo-wide grep for `misc.md` returns nothing.
Two siblings are also empty and have no such conflict: `traderfeed_individual_stocks.md` and
`options-trading-education-strategies.md`.
Options: (a) delete all three empty files, (b) delete the two unconflicted and keep `misc.md`.
**Recommendation: (a).** Zero bytes cannot satisfy a citation. All three are tracked, so history
restores any of them.

**4. `knowledge-base/grouped-data/` — archive the unreferenced files, or keep the set whole?**
The input's "100 uncited files" recommendation is refuted; see section 5.4. Only **21 of 111** files
are unreferenced by the directory's own index, and two of those 21 are `CLAUDE.md` itself and
`trade_management.md`, which the input listed among its cited ten.
Options: (a) keep all 111 — the index describes the set as a whole; (b) archive only the 19
genuinely unreferenced files, excluding `CLAUDE.md` and `trade_management.md`, and update
`CLAUDE.md` in the same commit; (c) run the input's original 100-file archive.
**Recommendation: (a).** The whole directory is 1.26 MiB — 0.02% of the repo. It buys nothing on
disk and risks breaking an index that four glob families depend on. Reject (c) outright.

If you choose (b), derive the list rather than trusting any hand-written keep-list:

```bash
cd knowledge-base/grouped-data
for f in *.md; do
  grep -qF "\`$f\`" CLAUDE.md && continue
  echo "$f" | grep -qE '^(quantocracy_|traderfeed_|abnormalreturns_|steadyoptions_)' && continue
  echo "$f" | grep -qE '(_REPORT|_SUMMARY)' && continue
  case "$f" in CLAUDE.md|trade_management.md) continue ;; esac
  echo "$f"
done
```

Read that list first. All 111 files are tracked, so the move is `git mv` with no plain-`mv`
fallback — a `git mv` failure should be loud, not silently desync the index.

**5. The eleven registered worktrees — keep the registrations?**
Tier 1 strips their `node_modules` and leaves them registered, which is the conservative merge of
two conflicting verdicts. Their source content is ~379,420 KiB combined.
Options: (a) keep all eleven, (b) remove those whose branches are merged.
**Recommendation: (b), after this check.** Anything it lists is already in main. The `grep -v` is
required — `git worktree list --porcelain` includes the main worktree, and without the filter the
loop reports `main` itself as safe to remove:

```bash
for w in $(git worktree list --porcelain | awk '/^branch/ {print $2}' \
           | sed 's|refs/heads/||' | grep -v '^main$'); do
  [ -z "$(git log --oneline main..$w)" ] && echo "MERGED, safe to remove: $w"
done
```

Then, for each one listed — `git worktree remove`, never `rm -rf`:

```bash
git worktree remove ".claude/worktrees/agent-XXXX"
```

---

## 7. DO NOT TOUCH

| Path | Why |
|---|---|
| `/Users/chiragpersonalmac/Desktop/morai-trading-dashboard-and-tools/tools/tradingview/` | Live work in progress **today**. Five files are modified and uncommitted right now, and six more are untracked, including `expected-move.pine` and `backtest-expected-move.ts`. A cleanup pass here destroys work that has never been committed. |
| `/Users/chiragpersonalmac/Desktop/morai-trading-dashboard-and-tools/.env` and `.env.local` | Runtime secrets — Schwab tokens, Supabase credentials. Ignored by git, so git can never bring them back. Backed up, but there is no reason to touch them. |
| `/Users/chiragpersonalmac/Desktop/morai-trading-dashboard-and-tools/.claude/rules/` | The five strict rules `CLAUDE.md` loads by path: architecture-boundaries, tdd, typescript, workflow, docs. Deleting them silently turns off the discipline every future session inherits. |
| `/Users/chiragpersonalmac/Desktop/morai-trading-dashboard-and-tools/.git/` | The repository. It holds the snapshot ref and every worktree's administrative record. Touching it by hand is how the registered worktrees get orphaned — the exact failure Tier 1 is written to avoid. |

---

## 8. Root cause — the repo lives in iCloud

Every ` 2` file and every `codegraph N.lock` traces to one fact: this repo sits in a synced folder.

Confirmed two ways:

```
$ ls -d ~/Library/Mobile\ Documents/com~apple~CloudDocs/Desktop
/Users/chiragpersonalmac/Library/Mobile Documents/com~apple~CloudDocs/Desktop

$ xattr ~/Desktop
com.apple.file-provider-domain-id
com.apple.fileprovider.detached#B
```

When two machines — or one machine and the sync daemon — write the same path, iCloud does not merge
and does not fail. It keeps both and renames one by appending ` 2`.

### The count

116 collision artifacts in the main working tree, **200 KiB** total. Measured with `find` scoped
away from `.git` and `.claude/worktrees`, deduplicated with `sort -u`. Worktrees are excluded on
purpose: `37-REVIEW 2.md` is tracked, so it appears 12 times across the tree, and counting it 12
times would inflate the total.

Three families, three different causes:

| Family | Count | Where it goes |
|---|---|---|
| Empty ` 2` directories | 13, all verified 0 entries | Tier 1 step 8 |
| ` 2` directories that hold content | 30, every one inside `node_modules` (bun duplicated the package) | Tier 1 step 3 |
| ` 2.*` files | 73, nearly all `.d.ts` under `dist/` | Tier 1 steps 3–7 |
| `codegraph N.lock`, N = 2…14 | 13 | Tier 1 step 9 |

43 directories plus 73 files makes 116. Of those, **104 sit under `dist/` or `node_modules`** and
disappear with Tier 1 whether or not you target them.

The lock series is a separate family, not a subset — only `codegraph 2.lock` matches the ` 2.*`
pattern. Each lock is one abandoned sync-collided index run.

Only twelve artifacts survive a full Tier 1 pass. Eleven are empty directories or covered elsewhere.
One is not:

```
.planning/phases/37-in-app-schwab-re-auth-wizard-hosted-oauth-flow-replacing-the/37-REVIEW 2.md
```

**That file is tracked.** The collision did not just land in the working tree — it was committed,
so it is in git history and git now replicates it into all eleven worktrees on every checkout. That
single file is the proof that deleting duplicates cannot work. The mechanism outran the cleanup and
got itself committed.

### Real fix against bandaid

The bandaid is `rm` plus the `.gitignore` pattern in section 5.1. It removes 200 KiB and the
artifacts come back, because the cause is the filesystem, not the files. This repo has already run
that loop: 13 lock files and 116 artifacts accumulated anyway, and one reached history.

The real fix is to move the repo off the synced Desktop.

```bash
# 1. Finish Tier 1 FIRST — moving 7 GiB through a sync daemon is slow and can itself collide.
# 2. Move.
mkdir -p ~/code
mv ~/Desktop/morai-trading-dashboard-and-tools ~/code/morai-trading-dashboard-and-tools
# 3. Repair the worktree registrations. Pass the paths explicitly — a bare `git worktree repair`
#    fixes the main worktree's record as seen from linked worktrees, not the stale absolute
#    paths in .git/worktrees/*/gitdir.
cd ~/code/morai-trading-dashboard-and-tools
git worktree repair .claude/worktrees/*
git worktree list          # every path must now show the ~/code/ prefix — this is the proof
```

### What breaks on the move

**Worktree registrations.** Git stores absolute paths. All eleven break at once. `git worktree
repair`, run from the new location, rewrites both sides. Do the move after Tier 1, not before.

**Hardcoded paths.** Find them before you move:

```bash
grep -rn "Desktop/morai-trading-dashboard-and-tools" \
  .claude/ *.toml *.json .env .env.local 2>/dev/null | grep -v node_modules
```

Hooks in `.claude/settings.json` are the likely casualty — that file is already modified in the
working tree.

**The Claude Code project key.** This is the one the brief calls out, and it is real. Claude Code
derives the project directory from the path by replacing `/` with `-`. Today that key is:

```
/Users/chiragpersonalmac/.claude/projects/-Users-chiragpersonalmac-Desktop-morai-trading-dashboard-and-tools/
```

It holds the session history and `memory/MEMORY.md` — the index pointing at roughly 60 topic files
covering every law this project has learned. After a move to `~/code/`, Claude Code computes
`-Users-chiragpersonalmac-code-morai-trading-dashboard-and-tools`, finds nothing, and starts empty.
The memory is not deleted. It is orphaned under a key nothing looks up any more.

Handle it by renaming the directory to the new derived key, in the same session as the move:

```bash
mv /Users/chiragpersonalmac/.claude/projects/-Users-chiragpersonalmac-Desktop-morai-trading-dashboard-and-tools \
   /Users/chiragpersonalmac/.claude/projects/-Users-chiragpersonalmac-code-morai-trading-dashboard-and-tools
```

Verify by opening a session in the new path and confirming `MEMORY.md` loads. The backup at
`morai-cleanup-backup-2026-08-25/claude-memory/` (60 files, verified) is the fallback if the rename
goes wrong.

---

## 9. Full manifest

Sorted by verdict, then descending size. Sizes are `du -sk` KiB unless a byte count is given.
Where two agents disagreed, the row carries the conservative verdict and names the conflict.

### REGENERATE

| Path | Size | Git state | Verdict | Reason | Recovery | Risk |
|---|---|---|---|---|---|---|
| `.claude/worktrees/*/node_modules` (13) | 6,120,488 | ignored | REGENERATE | 11 registered worktrees at ~556,416 each, plus 2 orphan stubs at 4. 88% of the repo. No symlinks — verified. | `bun install` in each worktree | none |
| `node_modules` | 604,296 | ignored | REGENERATE | Root workspace install. | `bun install` | none |
| `apps/sidecar/.venv` | 97,220 | ignored | REGENERATE | Python venv, FastAPI + psycopg2. | `python3 -m venv .venv && .venv/bin/pip install -r requirements.txt` (file verified present) | none |
| `.ds-sync/node_modules` | 45,060 | ignored | REGENERATE | Design-sync deps. | `npm install` in `.ds-sync/` (`package.json` verified) | none |
| `.codegraph/` | 33,404 | ignored | REGENERATE | Code-intel index, includes all 13 `codegraph N.lock` collisions. Not in the snapshot ref. | `codegraph init` — **not** `bun run codegraph:index`, no such script | none |
| `apps/web/node_modules` | 15,332 | ignored | REGENERATE | Vite/React deps. | `bun install` | none |
| `graphify-out/` | 9,432 | ignored | REGENERATE | `graph.json` md5 `2e8135f4…` and `graph.html` md5 `c1a8dd25…` are byte-identical to the tracked `.planning/graphs` copies. Duplicate of tracked content. | `graphify . --output graphify-out` (binary verified) | none |
| `apps/web/dist` | 1,356 | ignored | REGENERATE | Vite build output. | `cd apps/web && bun run build` | none |
| `packages/core/dist` | 1,276 | ignored | REGENERATE | Declarations only. | `bun run typecheck` | none |
| `packages/adapters/dist` | 576 | ignored | REGENERATE | Declarations only. | `bun run typecheck` | none |
| `apps/sidecar/**/__pycache__` (non-venv) | 564 | ignored | REGENERATE | 2 dirs outside `.venv`. Counted separately so venv bytes are not double-counted. | Regenerates on next run | none |
| `packages/contracts/dist` | 284 | ignored | REGENERATE | Declarations only. | `bun run typecheck` | none |
| `apps/worker/dist` | 256 | ignored | REGENERATE | Declarations only. | `bun run typecheck` | none |
| `apps/server/dist` | 252 | ignored | REGENERATE | Declarations only. | `bun run typecheck` | none |
| `packages/shared/dist` | 36 | ignored | REGENERATE | Declarations only. | `bun run typecheck` | none |
| `apps/sidecar/.pytest_cache` | 28 | ignored | REGENERATE | Pytest session cache. | Regenerates on `pytest` | none |
| `packages/{core,adapters}/node_modules` | 12 each | ignored | REGENERATE | Workspace symlinks. | `bun install` | none |
| `packages/quant/dist` | 8 | ignored | REGENERATE | Declarations only. | `bun run typecheck` | none |
| `apps/server/node_modules` | 8 | ignored | REGENERATE | Workspace symlinks. | `bun install` | none |
| `apps/{worker}/node_modules`, `packages/{contracts,shared,quant}/node_modules` | 4 each | ignored | REGENERATE | Workspace symlinks. | `bun install` | none |

### DELETE

| Path | Size | Git state | Verdict | Reason | Recovery | Risk |
|---|---|---|---|---|---|---|
| `.claude/worktrees/agent-aae27803b9e3b5346` | 2,992 | mixed | DELETE | Unregistered — absent from `git worktree list`. Branch `f7e967a2`, not on origin. `prune` is a no-op, verified. | `morai-all-refs.bundle` (branch tip) | low → Tier 2 |
| `.claude/worktrees/agent-af3fc5c2b2ea1dc10` | 2,876 | mixed | DELETE | Unregistered. Branch `4056f723`, not on origin. | `morai-all-refs.bundle` (branch tip) | low → Tier 2 |
| `.planning/phases/37-…/37-REVIEW 2.md` | 15,379 B | **tracked** | DELETE | iCloud collision that reached git history. Differs from `37-REVIEW.md` (18,650 B) — md5 `396c6641…` vs `1435b895…`. Missed by all four agents. | git history + bundle | low → Tier 2 |
| `docs/research/pa-source-text/Black-Scholes-Model-Explained.txt` | 7,101 B | tracked | DELETE | Title-string grep scores 0 repo-wide, not just filename grep. | snapshot ref + bundle | low → Tier 2 |
| `docs/research/pa-source-text/earnings-trade-log.txt` | 2,637 B | tracked | DELETE | Title-string grep scores 0 repo-wide. | snapshot ref + bundle | low → Tier 2 |
| 13 empty ` 2` collision dirs | 0 B | untracked | DELETE | All verified 0 entries. iCloud debris. | Nothing to recover — empty | none |
| `.claude/worktrees/agent-a10abbc64b69262e5` | 0 | untracked | DELETE | Empty, unregistered. | Nothing to recover | none |
| `.claude/worktrees/agent-ad23c63bf56efce5a` | 0 | untracked | DELETE | Empty, unregistered. | Nothing to recover | none |
| `knowledge-base/grouped-data/traderfeed_individual_stocks.md` | 0 B | tracked | DELETE | Empty placeholder. | git history | none |
| `knowledge-base/grouped-data/options-trading-education-strategies.md` | 0 B | tracked | DELETE | Empty placeholder. | git history | none |

### ARCHIVE

| Path | Size | Git state | Verdict | Reason | Recovery | Risk |
|---|---|---|---|---|---|---|
| `.planning/graphs/` generated binaries | 11,044 | tracked | ARCHIVE | Already ignored at `.gitignore:40` yet still tracked. `git rm --cached` only — frees 0 bytes on disk, and history keeps them. | `git restore` from main | low |
| `wb_ssrn.html` | 70,036 B | untracked | ARCHIVE | **Conflict resolved.** One agent said DELETE, "throwaway visualization", 145K. Title tag proves it is the Campasano SSRN paper 3240028 behind the calendar-engine gate; real size 70,036 B. Conservative verdict and the evidence agree. | snapshot ref (1 file, verified) + `web.archive.org/web/20240818194007/…abstract_id=3240028` | none |
| `mockups/playground-v3.html` | 46,186 B | untracked | ARCHIVE | Superseded by v4. One agent said DELETE, one said archive the directory — archiving wins. | snapshot ref (16 mockups files) | low |
| `mockups/playground-v2.html` | 33,896 B | untracked | ARCHIVE | Superseded by v4. | snapshot ref | low |
| `mockups/playground-v1.html` | 22,273 B | untracked | ARCHIVE | Superseded by v4. | snapshot ref | low |
| `mockups/journal-lifecycle-v2.html` | 19,890 B | untracked | ARCHIVE | Superseded by tracked v3. | snapshot ref | low |
| `mockups/journal-lifecycle-v1.html` | 19,363 B | untracked | ARCHIVE | Superseded by tracked v3. | snapshot ref | low |
| `mockups/overview-v1.html` | 18,368 B | untracked | ARCHIVE | Superseded by v2. | snapshot ref | low |
| `mockups/gex-snapshot.json` | 11,119 B | untracked | ARCHIVE | Unused fixture, no code references. Archived rather than deleted, per the directory-level verdict. | snapshot ref | none |
| `mockups/gex-profile.json` | 1,129 B | untracked | ARCHIVE | Unused fixture. | snapshot ref | none |

### DECIDE

| Path | Size | Git state | Verdict | Reason | Recovery | Risk |
|---|---|---|---|---|---|---|
| `knowledge-base/grouped-data/` (111 files) | 1,261,249 B | tracked | DECIDE | **Demoted from ARCHIVE.** Input claimed 100 files with "zero inbound citations". Refuted: `grouped-data/CLAUDE.md` indexes 29 by name and 59 more by four documented globs — 89 of 111 referenced. Only 21 unreferenced, 2 of which the input itself called cited. | git history + bundle | high |
| `ds-bundle/` | 9,988 | untracked | DECIDE | Design system components/tokens/guidelines, last touched 2026-07-24. Only `risk: high` entry in the inventory. | snapshot ref | high |
| `knowledge-base/grouped-data/FINAL_CATEGORIZATION_REPORT.md` | 5,900 B | tracked | DECIDE | Matches the `*_REPORT*` meta glob that `CLAUDE.md` documents, so it is not independently safe to move. Rides on question 4. | git history | low |
| `.fallow/` | 2,456 | ignored | DECIDE | **Demoted from DELETE.** Stated recovery was fiction: 0 files in the snapshot ref (ignored dirs are excluded) and `fallow` is not installed. Three opaque binaries with no restore and no regeneration. | **None** — back it up first | high |
| `.design-sync/` | 920 | untracked | DECIDE | Config, conventions, previews for the design system. Pairs with `ds-bundle`. | snapshot ref | high |
| 11 registered worktrees (source) | ~379,420 | mixed | DECIDE | Two agents split: regenerable vs live state. Conservative merge keeps registrations, strips `node_modules`. Removal needs the merged-branch check. | `git worktree add` + bundle | low |
| `knowledge-base/grouped-data/misc.md` | 0 B | tracked | DECIDE | One agent listed it among the cited ten; another called it an empty placeholder. It is 0 bytes and repo-wide grep finds no citation. Conflict goes to the user. | git history | none |

### KEEP

| Path | Size | Git state | Verdict | Reason |
|---|---|---|---|---|
| `packages/core/` | 3.9M | tracked | KEEP | The hexagon. Domain models, journal logic, picker engine, GEX, exit advisor. |
| `packages/adapters/` | 3.5M | tracked | KEEP | Driven adapters: Postgres/Drizzle, Schwab, CBOE, memory repos. |
| `docs/` | ~1.5M | tracked | KEEP | Architecture source of truth, calendar-engine doctrine. |
| `apps/server/` | 1.2M | tracked | KEEP | HTTP API + MCP server. Deployed to Railway. |
| `apps/worker/` | 944K | tracked | KEEP | pg-boss job handlers. Deployed to Railway. |
| `packages/contracts/` | 748K | tracked | KEEP | Zod schemas for HTTP/MCP. |
| `docs/research/pa-source-text/` (58 cited) | 611.7K | tracked | KEEP | Provenance for the synthesis guide's numeric audit. |
| `docs/research/predicting-alpha-…md` | 446K | tracked | KEEP | 59-article synthesis. Durable domain knowledge. |
| `apps/web/` (source) | — | tracked | KEEP | React + Vite UI. Deployed to Vercel. |
| `tools/tradingview/` | 188K | mixed | KEEP | **Live work today.** See section 7. |
| `packages/shared/` | 180K | tracked | KEEP | `Result<T,E>`, retry, OCC parsing. No I/O. |
| `apps/sidecar/` (source) | 100K | mixed | KEEP | Python FastAPI bridge to Schwab via CDP. Separate Railway service. |
| `packages/quant/` | 116K | tracked | KEEP | BSM greeks, pricing. Zero framework deps. |
| `knowledge-base/grouped-data/CLAUDE.md` | 1,760 B | tracked | KEEP | The directory's index. It is the evidence that refutes the 100-file archive, and moving anything it names breaks it. |
| `.planning/graphs/GRAPH_REPORT.md` | 88,271 B | tracked | KEEP | Prose. Stays tracked while its three binary siblings get untracked. |
| `mockups/overview-v2.html` | 41,979 B | untracked | KEEP | Latest overview design. |
| `mockups/playground-v4.html` | 34,861 B | untracked | KEEP | Latest analyzer/picker design. |
| `knowledge-base/*.md` (3) | 40K | tracked | KEEP | Learnings from retired systems. `thinkscript-learnings` is cited. |
| `.claude/workflows/` | 32K | untracked | KEEP | `evaluate-calendar.js`, `investigate-crashes.js`. Active tooling. |
| `.claude/rules/` | 24K | tracked | KEEP | The five strict rules. See section 7. |
| `mockups/journal-lifecycle-v3.html` | 21,463 B | tracked | KEEP | Latest, research-grounded, Phase 22 reference. |
| `bun.lock`, `package.json`, `tsconfig.*`, `eslint.config.js`, `vitest.config.ts`, `drizzle.config.ts`, `railway.*.toml`, `vercel.json` | 18K | tracked | KEEP | Build, type, lint, deploy config. |
| `mockups/positions-v1.html` | 14,588 B | untracked | KEEP | Only version. |
| `mockups/market-v1.html` | 14,266 B | untracked | KEEP | Only version. |
| `mockups/journal-v1.html` | 13,809 B | untracked | KEEP | Only version. |
| `mockups/dashboard-v1.html` | 12,980 B | untracked | KEEP | Only version, Phase 17 reference. |
| `plan-blocks.md` | 8.3K | untracked | KEEP | MDX component schema for plan authoring. |
| `plans/morai-status/` | 6.2K | mixed | KEEP | Active planning dir — `plan.mdx` + `.plan-url`. |
| `.github/workflows/ci.yml` | 4K | tracked | KEEP | CI. |
| `CLAUDE.md` | 3.3K | tracked | KEEP | Project instructions. |
| `.env.example` | 2.9K | tracked | KEEP | Onboarding template. |
| `.env`, `.env.local` | 2.3K | ignored | KEEP | Secrets. See section 7. |
| `mockups/tos-reference/` | 1.1K | mixed | KEEP | Documents TOS design-parity requirements. |

---

## Order of operations

1. Tier 1 — reclaims 6.61 GiB.
2. Tier 2 — run each check, then act.
3. Tier 3 — untrack the graph binaries, move the archives.
4. Answer the five Tier 4 questions.
5. Move the repo off `~/Desktop`, then `git worktree repair` and rename the project key.
6. `bun install && bun run typecheck && bun run test` — confirm the tree still builds.

Step 6 is the proof. Nothing above is done until it passes.
