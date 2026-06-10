# Documentation Content Principles

Guidelines for what to write in documentation and how to write it.

## Single Source of Truth

Don't duplicate content across documentation files. Shared concepts live in one place, other docs reference them.

**Four-tier reference system:**
1. **Rules** (`.claude/rules/*.md`) - Requirements (MUST/SHOULD)
2. **Templates** (`.claude/templates/`) - Canonical structure (created when scaffolding lands)
3. **Docs** (`docs/`) - Detailed explanations
4. **Real code** (`apps/`, `packages/`) - Working examples

Never duplicate across these tiers. Always reference.

**Path-specific rules reference docs:**
- Rules contain requirements, not examples
- "Where to Look" section points to templates and docs
- Never duplicate requirements between rules and docs

**When you find duplication:**
1. Identify the authoritative source (usually the most comprehensive doc)
2. Keep complete content there
3. Replace duplicates with brief summary + reference link

## Document Current State, Not History

Focus on how things work now, not how they used to work or how they were built.

**Remove:**
- "This used to be X, now is Y" narratives
- Implementation checklists for completed features
- Version history tables (git tracks this)
- Bug fix chronicles
- Migration paths for completed migrations
- "Next steps" for completed work

**Exception: Implementation Notes.** Complex implementations may need notes explaining
tricky parts — subtle edge cases, surprising complexities, non-obvious decisions.
Format: "Complexity Y: the code must handle Z because..." — not "Bug #1 (Fixed): we had...".

In this repo, the old-dashboard lessons in `knowledge-base/` are the approved home for
historical knowledge. Architecture docs reference them; they don't retell them.

## Code in Documentation

### Keep

**Schemas** - Data structures, interfaces, table definitions. These ARE the design.
Example: the table shapes in `docs/architecture/data-model.md`.

**Declarative queries** - SQL that defines transformation logic.

**Pseudocode for complex algorithms** - 5-10 lines showing key steps and the pattern.

**Port/type signatures** - Function-type port examples in
`docs/architecture/hexagonal-ddd.md` define the convention. They stay.

### Avoid

**Full implementation code** - It drifts from the codebase.
Instead point to the actual code: "See `makeSnapshotCalendars()` in
`packages/core/src/journal/application/snapshotCalendar.ts`".

### Pattern vs Architecture Docs

- **Pattern/how-to docs**: succinct working examples. Illustrative, not exhaustive.
- **Architecture docs**: design decisions + pseudocode + pointers to real files.

## Stable References

Link to code with identifiers that survive refactoring.

✅ Use: file paths (`packages/shared/src/result.ts`), function/class names
(`makeSnapshotCalendars()`), relative doc paths (`../architecture/jobs.md`).

❌ Avoid: line numbers (`foo.ts:123`), line ranges, absolute paths
(`/Users/<name>/...`). They break immediately or only work on one machine.

## Micro-Modular Documentation

**20-250 lines per file. One focused concept per file.**

**Split when:**
- Pattern collections → individual pattern files
- Comprehensive guides → break by concept
- Different audiences need different parts
- File exceeds 250 lines

**Keep together when:**
- Architecture narratives → cohesive story
- API specifications → complete contract
- Design rationale → tightly coupled decisions

Use subdirectories to group related files: `docs/architecture/`, `docs/docs-on-docs/`.

## Quick References Should Be Quick

Scannable in under 60 seconds. Tables, bullet lists, brief descriptions.
Link to comprehensive guides for details. A "quick reference" that duplicates 90%
of the full guide is not quick.

## Related Resources

- [Hemingway Style](hemingway-style.md) - Writing style guide
- [Documentation Organization](documentation-organization.md) - File structure and naming
- [Cleanup Sweep](documentation-cleanup-sweep.md) - Drift prevention process
