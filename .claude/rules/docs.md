---
paths:
  - "**/*.md"
  - "!node_modules/**"
  - "!knowledge-base/**"
---

# Documentation Structure and Maintenance

## Overview

This project uses a **contextual documentation system** where rules load based on file
paths. All documentation must maintain this structure and keep cross-references
synchronized.

## Requirements

### Micro-Modular Approach

20-250 lines per file, one concept per file.

**Split when:** pattern collections → individual files; comprehensive guides → break by
concept; file exceeds 250 lines; different audiences need different parts.

**Keep together when:** architecture narratives (cohesive story); API specifications
(complete contract); design rationale (tightly coupled decisions).

### Four-Tier Reference System

Never duplicate content:

1. **Rules** (`.claude/rules/`) - Requirements (MUST/SHOULD)
2. **Templates** (`.claude/templates/`) - Canonical structure (created with scaffolding)
3. **Docs** (`docs/`) - Detailed explanations
4. **Real code** (`apps/`, `packages/`) - Working examples

Rules reference docs, docs show examples, examples demonstrate patterns.

### Rules (`.claude/rules/*.md`)

- YAML frontmatter with `paths:` patterns; name files for use (`tdd.md`), no number prefixes.
- REQUIREMENTS and REFERENCES, not code examples.
- Reference config files as source of truth — never restate their contents.
- Keep concise (1-2 pages max). Link to `docs/` via a "Where to Look" section.

### Docs (`docs/**/*.md`)

- One concept per file, kebab-case names, topic subdirectories.
- Explain WHY, not just HOW. Include illustrative examples (see content principles for
  what code belongs in docs).
- Hemingway style for all prose.

### Project Documentation

- **CLAUDE.md**: project-level instructions, conventions, links to key docs.
- **docs/TOPIC-MAP.md**: complete documentation index — the single source for "what docs exist".

## Maintaining the System

**When adding documentation:**
1. Determine type: rule, doc, template, or project-level?
2. Create the file in the correct location with the correct format.
3. Add cross-references: update `docs/TOPIC-MAP.md`; update "Where to Look" in relevant rules.
4. If a rule: verify path patterns match intended files; add row to `.claude/rules/README.md`.

**When updating:** update the primary source (single source of truth), then every rule
and doc that references it. Check you're not duplicating what should be referenced.

**When moving/deprecating:** find all references first, update them, leave a redirect
note if the location changed.

## Anti-Patterns

**DON'T:**
- ❌ Duplicate requirements between rules and docs
- ❌ Put code examples in rule files (link to docs/templates instead)
- ❌ Reference line numbers (use file paths + function names)
- ❌ Create docs without updating TOPIC-MAP and relevant rules
- ❌ Commit planning documents, progress trackers, or PRDs
- ❌ Edit anything under `knowledge-base/` (read-only reference)

**DO:**
- ✅ Keep rules concise (requirements + references)
- ✅ Put examples in `docs/` or `.claude/templates/`
- ✅ Reference config files as source of truth
- ✅ Use relative paths in links

## Where to Look

- [docs/docs-on-docs/documentation-organization.md](../../docs/docs-on-docs/documentation-organization.md) - Directory structure, what belongs where, naming
- [docs/docs-on-docs/content-principles.md](../../docs/docs-on-docs/content-principles.md) - Single source of truth, when to split, code in docs, stable references
- [docs/docs-on-docs/hemingway-style.md](../../docs/docs-on-docs/hemingway-style.md) - Writing style guide
- [docs/docs-on-docs/documentation-cleanup-sweep.md](../../docs/docs-on-docs/documentation-cleanup-sweep.md) - Systematic drift-prevention process
- [.claude/rules/README.md](README.md) - How rules load and function
- [docs/TOPIC-MAP.md](../../docs/TOPIC-MAP.md) - Complete documentation index
