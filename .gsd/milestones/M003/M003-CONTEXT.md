# M003: Upstream Sync & Ecosystem — Context

**Gathered:** 2026-03-13
**Status:** Pending (depends on M001, M002)

## Project Description

Labrat shares GSD-2's infrastructure DNA. As GSD-2 evolves (bug fixes, new infrastructure capabilities, performance improvements), Labrat should benefit without manual porting effort. M003 establishes a mechanism for analyzing GSD-2 upstream changes and selectively integrating relevant improvements.

## Why This Milestone

GSD-2 is actively developed. Infrastructure improvements (crash recovery enhancements, new LLM provider support, performance fixes, timeout improvements) are directly relevant to Labrat. Without a sync mechanism, Labrat falls behind and loses the benefit of starting from a maintained codebase.

The key insight: since both projects share the same core infrastructure code, an LLM can analyze the diff between GSD-2's changes and Labrat's adapted codebase, identify which changes are relevant to the infrastructure layer (vs. development-specific features), and generate adapted patches.

## User-Visible Outcome

### When this milestone is complete, the user can:

- Run a command that fetches GSD-2 upstream changes and presents a report of what's new
- See which changes are infrastructure (relevant to Labrat) vs. development-specific (not relevant)
- Apply selected upstream improvements with LLM-assisted adaptation
- Verify that adapted changes don't break the research flow

### Entry point / environment

- Entry point: `labrat sync` or similar CLI command
- Environment: local dev (terminal)
- Live dependencies involved: GSD-2 upstream remote, LLM for diff analysis

## Completion Class

- Contract complete means: upstream changes are fetched, categorized, and adaptable
- Integration complete means: an adapted change from GSD-2 works correctly in Labrat's research context
- Operational complete means: the sync workflow is reliable enough to run periodically without breaking things

## Final Integrated Acceptance

To call this milestone complete, we must prove:

- A real GSD-2 upstream change (bug fix or infrastructure improvement) is successfully identified, adapted, and integrated into Labrat
- The adapted change doesn't break any existing Labrat functionality
- The categorization correctly separates infrastructure changes from development-specific ones

## Risks and Unknowns

- **Divergence over time** — as Labrat's codebase diverges from GSD-2, automated adaptation becomes harder. Early M003 execution makes this easier.
- **LLM accuracy for diff analysis** — the LLM needs to understand which parts of a GSD-2 change are infrastructure vs. development-specific. Complex changes may require human judgment.
- **Testing adapted changes** — how to verify an adapted change works in Labrat's context without comprehensive test coverage.

## Existing Codebase / Prior Art

- `git remote upstream` — already configured in M001/S01
- GSD-2's git history — the full commit log is available for analysis
- Labrat's adapted codebase — the diff between Labrat and GSD-2 defines the adaptation layer

> See `.gsd/DECISIONS.md` for all architectural and pattern decisions — it is an append-only register; read it during planning, append to it during execution.

## Relevant Requirements

- R026 — GSD-2 upstream feature sync

## Scope

### In Scope

- Fetching and analyzing GSD-2 upstream changes
- Categorizing changes as infrastructure vs. development-specific
- LLM-assisted adaptation of relevant changes
- Verification that adapted changes work in Labrat

### Out of Scope / Non-Goals

- Automatic merging without review
- Porting development-specific GSD-2 features (milestones, slices, shipping workflow)
- Maintaining fork parity with GSD-2

## Technical Constraints

- Cherry-pick selective, not merge — the codebases diverge intentionally
- Adapted changes must not break the research flow
- The sync mechanism should be usable by an LLM agent, not just a human

## Integration Points

- **GSD-2 upstream remote** — `git fetch upstream` for change detection
- **LLM** — for diff analysis, change categorization, and adaptation
- **Labrat's test suite** — for verifying adapted changes

## Open Questions

- Should this be a CLI command, a periodic check, or a manual workflow?
- How to handle upstream changes that touch both infrastructure and development-specific code (mixed changes)?
- Should Labrat track which upstream commits have been evaluated, to avoid re-analyzing old changes?
