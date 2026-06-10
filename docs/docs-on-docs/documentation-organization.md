# Documentation Organization Guide

How documentation is organized in this repository.

## Core Principles

**Purpose**: Documentation describes **how the project works** or **how to work with it**.
Reference material that stays relevant over time.

**Exclusions**: No planning documents, progress trackers, or work-in-progress artifacts.
Those live in Beads issues or get deleted after the work merges.

## Directory Structure

```
docs/
├── TOPIC-MAP.md             # Complete documentation index (single source)
├── architecture/            # System design — the source of truth for how Morai works
├── docs-on-docs/            # How to write and maintain documentation (this directory)
└── trade-advisor-inventory.md

.claude/
├── rules/                   # Path-loaded requirements (MUST/SHOULD + references)
│   └── README.md            # How rules work
└── templates/               # Canonical code templates (created when scaffolding lands)

knowledge-base/              # Synthesized trading knowledge — READ-ONLY reference
```

## What Belongs Where

### `docs/architecture/`
System design: layers, stack decisions, data model, jobs, API, MCP, testing strategy,
deployment. Start at `overview.md`; its doc map gives the reading order.

### `docs/docs-on-docs/`
Meta-documentation: content principles, organization, style, cleanup process.

### `.claude/rules/`
Contextual requirements that load based on file paths (YAML `paths:` frontmatter).
Requirements + references only — no code examples. See [.claude/rules/README.md](../../.claude/rules/README.md).

### `.claude/templates/`
Canonical implementation patterns (use-case template, repo template, route template,
test templates). Created alongside scaffolding — rules will reference them.

### `knowledge-base/`
Read-only synthesized trading knowledge and old-system lessons. Never edited by code
tasks. Architecture docs reference it for historical rationale.

## What NOT to Commit

- Implementation plans, task breakdowns, progress trackers
- PRDs, architecture reviews from planning phases
- "Questions for review" / "next steps" documents

**Converting plans to reference docs:** after completing a feature, extract durable
knowledge — the "why" and "how it works" — into `docs/`. Drop tasks, dates, and issues
encountered.

## Naming Conventions

- `kebab-case` for all markdown files
- Descriptive and specific: `data-model.md`, not `data.md`
- No number prefixes — name files for use (`tdd.md`, `architecture-boundaries.md`);
  reading order lives in `overview.md`'s doc map, not in filenames

## Maintaining Indexes

### TOPIC-MAP.md (primary index)
Single source of truth for all documentation. Update when adding, moving, or removing
any doc. Group by topic, brief description per file.

### CLAUDE.md
High-level overview + links to essential docs. References TOPIC-MAP for the complete
index. Update only when core workflows or conventions change.

### Rules
When adding a doc, update the "Where to Look" section of every rule that should
reference it. When moving a doc, update all rule references.

## Checklist: Adding New Documentation

- [ ] Correct directory, kebab-case name
- [ ] Describes how something works or how to use it (not planning/progress)
- [ ] 20-250 lines, one concept (see [content-principles.md](content-principles.md))
- [ ] `docs/TOPIC-MAP.md` updated
- [ ] Relevant `.claude/rules/*.md` "Where to Look" sections updated
- [ ] Internal links use relative paths
- [ ] Hemingway style ([hemingway-style.md](hemingway-style.md))

## Related Resources

- [Content Principles](content-principles.md)
- [Cleanup Sweep](documentation-cleanup-sweep.md)
- [TOPIC-MAP](../TOPIC-MAP.md)
