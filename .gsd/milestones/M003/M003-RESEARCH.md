# M003: Upstream Sync & Ecosystem — Research

**Date:** 2026-03-14

## Summary

M003 needs to solve a well-defined fork maintenance problem: Labrat forked GSD-2 at v2.10.6 (commit `ac6f27e`), added 22K+ lines across 170 files (M001+M002 research infrastructure), while upstream GSD-2 has accumulated 59 non-merge commits touching 293 files. The codebases share the same infrastructure DNA but have diverged intentionally — Labrat added research-specific modules (eval-runner, agenda, steering, simplicity-scorer, mlops-integration, morning-report) while GSD-2 continued evolving its core infrastructure (crash recovery, auto-mode stability, provider auth, TUI, native modules).

The practical challenge is that 12 GSD extension files have been modified by **both** sides since the fork point. The most critical is `auto.ts` (3275 lines in Labrat, 17+ upstream fixes) — the orchestration core that both projects heavily modify. A naive `git cherry-pick` will produce conflicts on most infrastructure bug fixes. The sync mechanism must therefore go beyond simple cherry-picking: it needs to **analyze** upstream changes, **categorize** them by relevance, and **adapt** patches to Labrat's modified codebase — ideally with LLM assistance for the adaptation step.

The recommended approach is a `labrat sync` CLI command that operates in three phases: (1) **fetch & categorize** — `git fetch upstream`, walk new commits, classify each as infrastructure/development-specific/mixed using file-path heuristics and commit message analysis; (2) **report** — present a structured report showing what's new, what's relevant, and what conflicts are expected; (3) **apply** — for selected commits, attempt cherry-pick with automatic conflict resolution, falling back to LLM-assisted adaptation for conflicts. This should be a standalone TypeScript module (`upstream-sync.ts`) following the D039 module extraction pattern established in M002.

## Recommendation

Build a three-phase sync pipeline as a new module + CLI subcommand:

**Phase 1 — Change Detection & Categorization** (prove first): Fetch upstream, walk `git log` since last sync point, classify each commit using deterministic rules (file paths, commit prefixes). Store the sync state (last evaluated upstream commit) in `.gsd/UPSTREAM-SYNC.json`. This is purely read-only and risk-free — it tells you what's available without changing anything.

**Phase 2 — Sync Report** (`labrat sync` with no flags): Generate a terminal report showing upstream changes grouped by category (infrastructure-bug-fix, infrastructure-feature, development-specific, mixed), with conflict predictions based on which files Labrat has also modified. This is the "wake up and check what's new upstream" equivalent of the morning report.

**Phase 3 — Selective Apply** (`labrat sync --apply <commit>`): Attempt `git cherry-pick` for a specific commit. On clean apply, done. On conflict, either auto-resolve (for trivial conflicts like import reordering) or present the conflict context for LLM-assisted resolution via a dispatch to an `upstream-adapt` prompt template.

Why this ordering: Phase 1 is safe, testable, and immediately valuable (visibility into upstream changes). Phase 2 is the primary user workflow. Phase 3 is the highest-risk part and should be proven last with real upstream commits.

## Don't Hand-Roll

| Problem | Existing Solution | Why Use It |
|---------|------------------|------------|
| Commit classification | `git log --format` + file path patterns | Git's built-in log formatting gives commit message, files changed, and diff stats — all the signals needed for classification |
| Conflict detection | `git cherry-pick --no-commit` + `git diff --check` | Git's own merge machinery is the ground truth for conflict prediction — don't simulate it |
| Atomic state persistence | Write-to-temp-then-rename pattern (D041, D045) | Already proven in steering.ts and agenda.ts — use same pattern for UPSTREAM-SYNC.json |
| Terminal report formatting | `generateMorningReport()` patterns in morning-report.ts | Same NO_COLOR support, same section-based layout, same pure-function pattern (D036) |
| LLM-assisted adaptation | Existing prompt dispatch via `pi.sendMessage()` pattern | showPlan, showDiscuss, showSteering all dispatch LLM workflows this way — reuse the pattern |

## Existing Code and Patterns

- `src/resources/extensions/gsd/commands.ts` — Command registration pattern. New `sync` subcommand follows exact same routing: add to `subcommands` array (line 59), add handler block in `handler()` function. 12 existing subcommands demonstrate the pattern.
- `src/resources/extensions/gsd/steering.ts` — Module extraction template (D039). Pure functions, atomic file I/O, facade functions called from auto.ts. `upstream-sync.ts` should follow this exactly.
- `src/resources/extensions/gsd/morning-report.ts` — Report generation pattern (D036). Pure formatter function, NO_COLOR support, conditional sections. The sync report should mirror this.
- `src/resources/extensions/gsd/agenda.ts` — State persistence pattern (D045). `AGENDA-STATE.json` with atomic writes and graceful degradation on corrupt state. `UPSTREAM-SYNC.json` should use the same pattern.
- `src/resources/extensions/gsd/git-service.ts` (827 lines) — All git operations go through `runGit()` helper. The sync module must use this, not raw `execSync`. Contains `discardUntrackedRuntimeFiles()`, `forceAddGsdArtifacts()`, and branch management utilities.
- `src/resources/extensions/gsd/eval-runner.ts` — `readAllExperiments()` pattern for reading JSONL state. The sync module's "evaluated commits" tracking follows the same append-only pattern.
- `src/cli.ts` — CLI subcommand pattern (lines 124-300). `labrat sync` follows the same early-exit pattern as `labrat report` and `labrat start`: parse args, do work, `process.exit(0)`.
- `src/resources/extensions/gsd/types.ts` — Type definitions. New types (`UpstreamCommitInfo`, `SyncState`, `CommitCategory`) go here.
- `src/resources/extensions/gsd/guided-flow.ts` — `showSteering()` dispatches LLM workflow via `pi.sendMessage()` with custom type. The `upstream-adapt` prompt dispatch follows this pattern.
- `src/resources/extensions/gsd/tests/steering.test.ts` — Test pattern: `assert`/`assertEq` helpers, `passed`/`failed` counters, `mkdtempSync` for temp dirs, direct import of module functions. No test framework — raw Node test runner.

## Constraints

- **12 files modified by both sides** — `auto.ts`, `commands.ts`, `crash-recovery.ts`, `dispatch-guard.ts`, `files.ts`, `git-service.ts`, `guided-flow.ts`, `index.ts`, `preferences.ts`, `state.ts`, `tests/derive-state.test.ts`, `worktree.ts`. Any upstream commit touching these files will likely conflict.
- **`auto.ts` is 3275 lines** — The highest-conflict file. 17 upstream commits touch it. Labrat added ~500 lines of research-specific logic (experiment dispatch, eval hooks, campaign lifecycle). Cherry-picks into this file will almost always need manual adaptation.
- **Fork point is `ac6f27e` (v2.10.6)** — 59 upstream non-merge commits since then. The sync module must track which commits have been evaluated/applied to avoid re-processing.
- **Upstream remote already configured** — `git remote upstream https://github.com/gsd-build/gsd-2.git` exists (R001/S01).
- **Cherry-pick selective, not merge (D009)** — The codebases diverge intentionally. Never `git merge upstream/main`.
- **Test runner is `node --test`** with custom TypeScript resolution (resolve-ts.mjs). Tests use raw assert helpers, not a framework.
- **Module extraction pattern (D039)** — New modules as separate .ts files. auto.ts remains the orchestrator with thin facade calls.
- **Atomic writes (D041/D045)** — All state files use write-to-temp-then-rename.
- **Backward compatibility (D042)** — New config fields must be optional with sensible defaults.
- **Non-fatal patterns** — Budget checks (D030), MLOps hooks (D032) never block the main flow. Sync operations should follow the same pattern — a failed sync analysis should never break the research loop.

## Common Pitfalls

- **Trying to automate everything** — The highest-value part is visibility (what changed upstream), not automated application. A report you read is more valuable than an auto-merge that silently breaks something. Phase 1+2 should be solid before attempting Phase 3.
- **Classifying by commit message alone** — Commit messages like "refactor: PR quality fixes" touch both infrastructure and development-specific code. Classification must use file paths as the primary signal, commit messages as secondary. Files in `packages/pi-ai/`, `packages/pi-tui/`, `packages/pi-coding-agent/` are always infrastructure. Files in `src/resources/extensions/gsd/` need deeper analysis (research-specific additions vs shared infrastructure).
- **Cherry-picking into `auto.ts` without understanding Labrat's additions** — Labrat added experiment dispatch, eval hooks, campaign lifecycle, budget guards, and steering integration to auto.ts. An upstream fix that moves code around in auto.ts will conflict with these additions. The adaptation step needs the full context of what Labrat changed.
- **Forgetting to track sync state** — Without persistent tracking of which upstream commits have been evaluated, the sync report will re-show old commits every time. `UPSTREAM-SYNC.json` must record the last evaluated upstream commit hash.
- **Over-engineering the LLM adaptation** — The LLM step should be a fallback for conflicts, not the primary mechanism. Most upstream commits that touch non-overlapping files will cherry-pick cleanly. The LLM is needed only for the ~12 conflicting files.
- **Testing sync with the real upstream** — Tests must use synthetic git repos (mkdtempSync + git init), not the actual upstream remote. The test pattern from git-experiment.test.ts and git-service.test.ts shows how to create isolated git repos for testing.
- **Breaking the research loop** — The sync module must be completely decoupled from the experiment loop. A sync in progress must not interfere with `labrat auto` or any campaign operation.

## Open Risks

- **`auto.ts` divergence acceleration** — As both projects continue to evolve auto.ts, the conflict surface grows. Every M004+ milestone that modifies auto.ts increases future sync difficulty. This argues for executing M003 promptly while divergence is still manageable.
- **Upstream refactors that restructure file boundaries** — If GSD-2 splits auto.ts into smaller modules (a reasonable refactor), the entire file mapping breaks. The sync module should handle file renames/splits gracefully.
- **LLM adaptation quality for complex patches** — A 50-line patch in a 3275-line file with 500 lines of Labrat-specific changes requires significant context. The LLM prompt needs to include both the patch, the current Labrat file, and a summary of Labrat's modifications. Context window limits may require chunking.
- **Testing adapted changes** — The existing test suite (899 tests across M001+M002) provides a regression safety net, but adapted upstream changes may introduce subtle behavioral differences that tests don't cover. The verification step should run the full test suite after each applied change.
- **Mixed commits** — ~30% of upstream commits touch both GSD extension files and packages/infrastructure. These "mixed" commits need per-file analysis, not whole-commit classification.

## Candidate Requirements Analysis

R026 (the only active requirement for M003) is broadly stated. Based on research, here's how it decomposes:

### Table Stakes (must have for R026)
- **Fetch upstream changes** — `git fetch upstream` and list new commits since last sync
- **Categorize changes** — Separate infrastructure (relevant) from development-specific (irrelevant)
- **Track sync state** — Remember which commits have been evaluated to avoid re-processing
- **Terminal report** — Human-readable summary of what's new upstream

### Expected Behaviors (users will assume)
- **Conflict prediction** — Tell the user which changes will conflict before they try to apply
- **Clean cherry-pick for non-conflicting commits** — When a commit doesn't touch files Labrat modified, apply it cleanly
- **Build verification after apply** — Run `npm run build` + test suite to verify adapted changes

### Candidate Requirements (from research, not yet binding)
- **CR-001: LLM-assisted conflict resolution** — When cherry-pick conflicts, provide the conflict context to an LLM for resolution. This is the differentiator but also the highest-risk feature. Could be deferred to a later phase.
- **CR-002: Per-file category override** — Allow user to mark specific files as "always skip" or "always include" to refine the automatic categorization.
- **CR-003: Batch sync report** — Show all unevaluated upstream commits in a single report, grouped by category, with a summary of each.

### Clearly Out of Scope
- Automatic merging without review (stated in M003-CONTEXT.md)
- Porting development-specific GSD-2 features (milestones, slices, shipping workflow)
- Maintaining fork parity with GSD-2

## Slice Ordering Guidance

1. **S01: Change Detection & Categorization** — Fetch, classify commits, persist sync state, generate report. Prove the classification accuracy first. This is the foundation everything else builds on. ~40% of the work.
2. **S02: Selective Apply & Verification** — Cherry-pick clean commits, run build+tests, handle conflicts gracefully (report them, don't auto-resolve). ~30% of the work.
3. **S03: LLM-Assisted Adaptation** — For conflicting commits, dispatch to an LLM with full context for resolution. Verify adapted changes. ~30% of the work. Highest risk, prove last.

The key boundary: S01 produces the report and classification. S02 consumes classifications and attempts application. S03 extends S02 with LLM-powered conflict resolution. Each slice is independently valuable.

## Skills Discovered

| Technology | Skill | Status |
|------------|-------|--------|
| Git upstream sync | `october-academy/agent-plugins@sync` | available (1.2K installs, not directly relevant — generic sync, not fork management) |
| Git fork management | `laurigates/claude-plugins@git-fork-workflow` | available (14 installs, too niche) |
| Git advanced workflows | `rmyndharis/antigravity-skills@git-advanced-workflows` | available (21 installs, generic) |

No skills installed — the available skills are either too generic or too niche. The fork sync problem here is specific to Labrat's architecture and better served by custom implementation using git primitives.

## Sources

- Upstream commit analysis: `git log ac6f27e..upstream/main --no-merges` — 59 commits, 152 fixes, 72 features
- Conflict surface: `comm -12` on files changed by both sides — 12 overlapping GSD extension files
- Module patterns: steering.ts (D039/D041), agenda.ts (D045), morning-report.ts (D036)
- CLI patterns: commands.ts subcommand routing, cli.ts early-exit subcommands
- Test patterns: steering.test.ts, simplicity-scorer.test.ts — raw Node test runner with assert helpers
- Architecture decisions: D009 (cherry-pick selective), D039 (module extraction), D041/D045 (atomic writes)
