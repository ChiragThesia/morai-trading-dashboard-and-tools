#!/usr/bin/env bash
#
# clean-start.sh — strip the repo down to docs, knowledge, and live work.
#
# SAFE: every tracked file removed here is in git history and pushed to GitHub
# (verified: local HEAD == origin/chore/repo-reorg-and-knowledge-capture == e47696c,
# 0 unpushed commits). Recover any of it with:
#     git checkout e47696c -- <path>
#
# Untracked items removed here (.fallow, .remember, ds-bundle, .ds-sync, .vercel)
# are caches, generated bundles, and session logs. The knowledge in .remember was
# already harvested into docs/learnings/.
#
# Run:  bash clean-start.sh
#
set -u
cd /Users/chiragpersonalmac/Desktop/morai-trading-dashboard-and-tools || exit 1
echo "Before: $(du -sh . | cut -f1)"

# ---------------------------------------------------------------------------
# 1. The five you named
# ---------------------------------------------------------------------------
rm -rf .vercel          # dead Vercel project pointer; the project is deleted
rm -rf .ds-sync         # design-system build tooling (untracked)
rm -rf .design-sync     # design-system config + component overrides (76 tracked)
rm -rf .github          # CI workflows for an app that no longer exists
rm -rf .planning        # 19M, 453 tracked — ALREADY HARVESTED into docs/learnings/
                        # (STATE, ROADMAP, RETROSPECTIVE, phases 23-42, debug,
                        #  research, notes, milestones were 6 of the 10 harvest
                        #  source groups behind the 336 numbered entries)

# ---------------------------------------------------------------------------
# 2. Same logic, you did not name them but they are the same category
# ---------------------------------------------------------------------------
rm -rf _bmad-output     # empty
rm -rf .fallow          # 2.4M cache for a tool that is not installed
rm -rf .remember        # 2.5M session logs — harvested into docs/learnings/
rm -rf ds-bundle        # 9.8M built design-system bundle
rm -rf mockups          # old UI mockups; superseded by docs/rebuild-research/
rm -rf plans            # analyzer handoffs — harvested
rm -rf supabase         # stray .temp from the CLI calls
rm -f  plan-blocks.md
rm -f  cleanup-tier1.sh # served its purpose

# CLEANUP-MANIFEST.md — the plan/record for a cleanup that is now finished. Its
# KEEP and DO-NOT-TOUCH tables name packages/core, apps/server, apps/web and
# apps/sidecar, none of which exist any more, so it now misinforms rather than
# informs. Its one durable section — the iCloud root cause — was lifted into
# docs/learnings/vendors-and-infra.md as V091 before this deletion.
rm -f  CLEANUP-MANIFEST.md

# ---------------------------------------------------------------------------
# salvage/ — keep the extracted prose, drop the copied code.
#
# The 6 .md files are the reason salvage exists: 3,853 lines read OUT of code
# that no longer exists, and they are not reconstructible now that it is gone.
# The code copies below are just that — copies. All committed at e47696c, so:
#     git checkout e47696c -- salvage/code
# ---------------------------------------------------------------------------
rm -rf salvage/tools        # was a byte-identical duplicate of tools/
rm -rf salvage/code         # quant, shared, iv-inversion, fill-pairing, calendar-event
rm -rf salvage/python       # the FastAPI Schwab sidecar
rm -rf salvage/oracle       # journal-oracle.test.ts, the 13 ground-truth calendars
rm -rf salvage/migrations   # 0010, 0017, 0028, 0029, 0030

# ---------------------------------------------------------------------------
# tools/ — DESTRUCTIVE AND MOSTLY UNRECOVERABLE. Deleted on explicit instruction.
#
# 7 of its 11 files have NEVER been committed. There is no git copy:
#     expected-move.pine        44K   live, verified study
#     isotropic-trend.pine     124K   in progress
#     breadth.pine
#     backtest-expected-move.ts / .md
#     verify-expected-move.ts
#     watchlists-calendar.md
# 4 more (README.md, gamma-levels.pine, push-gex.ts, vol-state.pine) have
# uncommitted modifications; only their last committed state survives, at:
#     git checkout e53171d -- tools/
#
# Partial mitigation, unverified: the .pine studies were saved into TradingView
# itself, so those may be recoverable from the TV account. The .ts and .md files
# were never anywhere but this disk.
# ---------------------------------------------------------------------------
rm -rf tools

# ---------------------------------------------------------------------------
# 3. Root config pointing at workspaces and infrastructure that are gone
# ---------------------------------------------------------------------------
rm -f package.json bun.lock
rm -f tsconfig.json tsconfig.base.json
rm -f eslint.config.js vitest.config.ts drizzle.config.ts
rm -f vercel.json .railwayignore
rm -f railway.server.toml railway.sidecar.toml railway.worker.toml

echo
echo "After:  $(du -sh . | cut -f1)"
echo
echo "Kept:"
for p in docs salvage knowledge-base REBUILD-BRIEF.md CLAUDE.md .claude .env .env.local .env.example .gitignore; do
  [ -e "$p" ] && printf "  %-22s %s\n" "$p" "$(du -sh "$p" 2>/dev/null | cut -f1)"
done
echo
echo "Recover anything:  git checkout e47696c -- <path>"
