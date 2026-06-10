# Documentation Cleanup Sweep

**Purpose:** Systematic process to prevent documentation drift, bloat, and duplication.

**When to run:** Quarterly, after adding 10+ docs, after major restructuring, or when
drift is suspected. Not during active feature development. Not more than monthly.

**How to use:** Give the prompt below to Claude Code.

## Principles Enforced

1. **Micro-modular structure** - 20-250 lines, one concept per file
2. **Single source of truth** - each fact exists in exactly one place
3. **Reference, don't duplicate** - Rules → Templates → Docs → Code
4. **Verified completeness** - no information lost, only reorganized
5. **Synchronized references** - rules, TOPIC-MAP, cross-links all updated

---

## Cleanup Prompt

### Phase 1: Discovery

Use Explore agents for each step; report findings before changing anything.

**1.1 Bloated files** — find `docs/**/*.md` over 250 lines. For each: line count,
distinct concepts, split-or-keep recommendation (pattern collection splits;
architecture narrative stays).

**1.2 Duplication** — find overlapping content across docs; check rules don't duplicate
docs they reference. For each: primary source, duplicate locations, overlap estimate.

**1.3 Orphans** — find docs referenced nowhere: not in `TOPIC-MAP.md`, not in any
`.claude/rules/` "Where to Look", not cross-referenced, not in `CLAUDE.md`.

**1.4 Reference accuracy** — extract every markdown link from `docs/` and
`.claude/rules/`; verify targets exist; flag misleading link text and placeholders.

**1.5 Rule coverage** — for each rule: do its `paths:` patterns match real files?
Do referenced docs exist? Any file patterns missing rules? Any rules that never load?

### Phase 2: Validation Report

Produce a findings report: counts per category, detailed tables, recommendations split
by priority (blocking / quality / polish), and per-change risk assessment
(is information at risk of being lost?).

**STOP and present the report for approval before Phase 3.**

### Phase 3: Execute (only after approval)

- **Splits**: inventory every section of the original → create micro-files → verify
  every piece of content landed → audit original vs new line totals.
- **Duplication**: confirm primary source is complete → convert duplicates to
  references → verify no unique content lived in the duplicates.
- **Orphans**: add to TOPIC-MAP + relevant rule "Where to Look" sections, or delete
  with rationale if genuinely dead.
- **References**: fix paths, fix descriptions, remove placeholders.
- **Rules**: create missing rules, update references, fix dead path patterns.

### Phase 4: Verification

- Content audit: original vs new line counts; >10% shrink must be identified
  redundancy, not loss. Spot-check random sections.
- Reference integrity: every `.md` link resolves; TOPIC-MAP covers all of `docs/`;
  every rule reference valid.
- Rule system: path patterns match intended files; simulate a feature task and confirm
  the right rules load.

### Phase 5: Final Report

Changes made (splits, removals, integrations, fixes), verification results,
health metrics (file count, average size, files >250 lines, orphans, broken refs),
and recommendations for the next sweep.

---

## Success Criteria

- All files ≤250 lines (except approved narratives)
- Zero broken references, zero orphans, zero duplication
- 100% rule coverage for file patterns

**Self-improving:** each sweep report identifies improvements to this process.
Update this document when patterns emerge.
