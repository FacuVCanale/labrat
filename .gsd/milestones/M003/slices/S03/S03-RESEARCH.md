# S03: LLM-Assisted Conflict Adaptation — Research

**Date:** 2026-03-14

## Summary

S03 extends the `labrat sync --apply` pipeline (built in S02) with LLM-assisted conflict resolution. When `applyUpstreamCommit()` returns `conflicted: true` with a `ConflictContext`, S03 adds the ability to dispatch that context to an LLM which produces adapted file contents, applies them, commits, and verifies (build + tests pass).

The core implementation challenge is architectural: the existing LLM dispatch mechanism (`pi.sendMessage` / `dispatchWorkflow`) is fire-and-forget — the extension sends a prompt, the LLM autonomously executes using tools, and results land on disk. There is no synchronous "call LLM, get answer back" pattern in the codebase. This means S03's LLM adaptation must follow the same dispatch pattern: build a prompt template (`adapt-upstream.md`), dispatch it as a workflow, and let the LLM resolve conflicts by writing adapted files, staging, committing, and triggering verification.

The approach decomposes into three testable pieces: (1) a pure `buildAdaptationPrompt()` function that assembles the full context string from `ConflictContext` + Labrat's file versions — testable without an LLM; (2) an `applyAdaptedFiles()` function that takes resolved file contents, writes them, commits with an `upstream-adapt(...)` message, runs `verifyAfterApply()`, and reverts on failure — testable with synthetic git repos; (3) a prompt template and dispatch integration for the interactive `/gsd sync --apply --adapt` path and a `--adapt` CLI flag. The LLM's job is narrow: given the conflict context (merge markers, Labrat's version, upstream patch, upstream intent), produce the adapted file content that preserves both Labrat's additions and the upstream fix.

## Recommendation

**Build the adaptation pipeline as three layers, each independently testable:**

**Layer 1 — Prompt construction (pure function):** `buildAdaptationPrompt(context: ConflictContext, labratSummary?: string): string` takes the structured conflict context from S02's `getConflictContext()` and assembles a detailed prompt. For each conflicting file: the file with merge markers, Labrat's clean version, the upstream patch, and what the upstream commit is trying to do (from `subject`). The prompt instructs the LLM to produce adapted file contents as fenced code blocks with file paths. This is a pure function — no I/O, fully testable.

**Layer 2 — Adapted file application (git ops):** `applyAdaptedFiles(basePath: string, hash: string, adaptedFiles: Array<{path: string, content: string}>): ApplyResult` writes the adapted contents to disk, stages them, commits with `upstream-adapt(<short-hash>): <subject>` message pattern (following D059 stdin pattern), runs `verifyAfterApply()`, reverts on failure, and updates sync state on success. Testable with synthetic git repos — no LLM needed.

**Layer 3 — LLM dispatch integration:** Two paths:
- **Interactive** (`/gsd sync --apply <hash> --adapt`): When `applyUpstreamCommit()` returns `conflicted`, automatically dispatch the adaptation prompt via `dispatchWorkflow()` pattern. The LLM reads the prompt, writes adapted files, and the extension commits/verifies. This follows the `steer-campaign.md` / `run-experiment.md` dispatch pattern exactly.
- **CLI** (`labrat sync --apply <hash> --adapt`): When conflict detected, print the adaptation context and suggest using the interactive path. Alternatively, if running inside an interactive session, dispatch directly.

**Why this ordering:** Layer 1 is the highest-value testable artifact — it proves the prompt quality. Layer 2 proves the mechanical pipeline. Layer 3 wires them together with the LLM harness. Each layer can be tested independently.

## Don't Hand-Roll

| Problem | Existing Solution | Why Use It |
|---------|------------------|------------|
| Conflict context extraction | `getConflictContext()` from S02 | Already produces `ConflictFileInfo` with merge markers, Labrat version, upstream patch — exactly what the prompt needs |
| Build+test verification | `verifyAfterApply()` from S02 | Same verification pipeline — adapted files need the same build/test check as clean cherry-picks |
| Commit with special characters | `runGit(['commit', '-F', '-'], { input })` (D059) | Stdin commit messages avoid shell escaping issues |
| State persistence | `readSyncState()`/`writeSyncState()` from S01 | Track adapted commits in the same `appliedCommits` array |
| Prompt template loading | `loadPrompt()` from `prompt-loader.ts` | `{{variable}}` substitution, missing-variable checks, same pattern as all other prompts |
| Workflow dispatch | `dispatchWorkflow()` pattern from `guided-flow.ts` | Fire-and-forget LLM invocation with `pi.sendMessage({ triggerTurn: true })` |
| Report formatting | `generateSyncReport()` pattern from S01 | NO_COLOR support, consistent terminal output |
| Atomic writes | Write-to-temp-then-rename (D045) | Already used by sync state persistence |

## Existing Code and Patterns

- `src/resources/extensions/gsd/upstream-sync.ts` (780 lines) — S01+S02 functions. New S03 functions (`buildAdaptationPrompt`, `applyAdaptedFiles`) go here, following the same module extraction pattern. All exports are pure functions or git-operations-only functions.
- `src/resources/extensions/gsd/types.ts` — `ConflictContext`, `ConflictFileInfo`, `ApplyResult` already defined. S03 may add `AdaptedFile` type (`{path: string, content: string}`) and optionally an `AdaptationResult` extending `ApplyResult`.
- `src/resources/extensions/gsd/guided-flow.ts` — `dispatchWorkflow()` (line 113) is the canonical LLM dispatch pattern: load GSD-WORKFLOW.md, inject a task-specific note, send via `pi.sendMessage({triggerTurn: true})`. S03's interactive adaptation dispatch follows this exactly.
- `src/resources/extensions/gsd/prompt-loader.ts` — `loadPrompt(name, vars)` reads `.md` templates from `prompts/` directory, substitutes `{{var}}` placeholders. S03 needs a new `adapt-upstream.md` template.
- `src/resources/extensions/gsd/prompts/steer-campaign.md` — Example of a prompt template that provides structured context and clear instructions. The `adapt-upstream.md` template should follow this structure: context dump, clear task description, expected output format.
- `src/resources/extensions/gsd/prompts/run-experiment.md` — Shows how large context (target files, metrics, history) is assembled into a prompt via `{{placeholder}}` variables.
- `src/resources/extensions/gsd/tests/upstream-sync.test.ts` (889 lines) — S01 (63 assertions) + S02 (50 assertions). S03 tests append here, following the same pattern: `setupRepoWithUpstream()` for synthetic repos, `assert`/`assertEq` helpers, `passed`/`failed` counters.
- `src/resources/extensions/gsd/git-service.ts` — `runGit()` helper (line 159). All git operations go through this. `applyAdaptedFiles` must use `runGit` for staging, committing.
- `src/cli.ts` — `--apply` handler (line 217-244). S03 adds `--adapt` flag to trigger LLM adaptation on conflict instead of just reporting it.
- `src/resources/extensions/gsd/commands.ts` — `handleSync()` (line 367). Interactive path needs adaptation dispatch when `--adapt` is specified with a conflicting commit.

## Constraints

- **D055: Sync module fully decoupled from experiment loop** — `upstream-sync.ts` must not import from `auto.ts`, `eval-runner.ts`, or campaign lifecycle. The LLM dispatch must happen in `commands.ts` or `cli.ts`, not in `upstream-sync.ts`. The module provides the prompt and the application logic; the caller provides the LLM.
- **LLM dispatch is fire-and-forget** — `pi.sendMessage` returns void. There's no "call LLM, get response" pattern. The adaptation flow must be: dispatch prompt → LLM writes files → extension commits/verifies. This means the adaptation can't be a synchronous function that returns the adapted content.
- **No direct LLM API calls in upstream-sync.ts** — The module uses `git-service.ts` for git operations and `node:fs` for file I/O. It does not import provider APIs or SDK clients. The LLM interaction is the caller's responsibility.
- **Prompt template must be self-contained** — The `adapt-upstream.md` template must include all context the LLM needs: what the upstream commit does, what Labrat's version looks like, where the conflicts are, and what the expected output format is.
- **Context window limits** — `auto.ts` is 3275 lines. Including its full content in a prompt would consume most of a context window. The prompt should include only the conflicting files' content, not the entire codebase. For very large files, the prompt may need to include only the conflicting regions plus surrounding context.
- **Every exit path must leave the repo clean** — Same as S02: if adaptation fails, the repo must be restored to pre-apply state. `applyAdaptedFiles` must handle write failures, commit failures, and verify failures gracefully.
- **Test pattern: no test framework** — Raw `node --test` with `assert`/`assertEq` helpers, `passed`/`failed` counters, `mkdtempSync` for temp repos.
- **Commit message pattern**: `upstream-adapt(<short-hash>): <subject>` to distinguish LLM-adapted applies from clean cherry-picks (`upstream(<short-hash>): <subject>`).

## Common Pitfalls

- **Trying to make the LLM call synchronous** — The codebase has no synchronous LLM call pattern. Don't try to import the Anthropic SDK into upstream-sync.ts. The LLM dispatch is the responsibility of the interactive harness (commands.ts) or the CLI wrapper. `upstream-sync.ts` builds the prompt and applies the result — the LLM call is between those two steps, handled externally.
- **Including too much context in the prompt** — A 3275-line file in the prompt plus merge markers plus the upstream patch could exceed practical limits. The prompt should include the conflicting file content (not the entire codebase) and focus the LLM on resolving specific conflict regions. For very large files, include the Labrat version, the merge markers, and the upstream patch — the LLM can synthesize the resolution from these.
- **Forgetting to test the prompt builder independently** — `buildAdaptationPrompt()` is a pure function. Test it with synthetic `ConflictContext` objects to verify it includes all required sections: upstream intent, file-by-file conflict details, Labrat modifications, and output format instructions.
- **Not testing the file application pipeline without an LLM** — `applyAdaptedFiles()` takes `{path, content}[]` arrays — test it by providing pre-computed adapted file contents, verifying the commit is created, the verify runs, and the state is updated. No LLM needed for this test.
- **Breaking the existing `applyUpstreamCommit` contract** — The existing function returns `conflicted: true` with `conflictContext` and aborts the cherry-pick. S03 must not change this behavior. Instead, S03 adds a new function that takes the conflict context and applies the LLM's resolution as a separate step.
- **Not handling the case where the LLM produces bad content** — The adapted files might not compile, might have syntax errors, or might not actually resolve the conflict. `verifyAfterApply()` catches build/test failures. But the write step itself must handle the case where the LLM output can't be parsed (no fenced code blocks, wrong file paths, etc.).
- **Conflating the two invocation paths** — Interactive dispatch (fire-and-forget, LLM writes files) and CLI adaptation (structured prompt printed for manual use or piped to an LLM) are different. Don't force them into the same code path.

## Open Risks

- **LLM output format reliability** — The LLM must produce adapted file contents in a parseable format (e.g., fenced code blocks with file path headers). If the LLM deviates from the format, `applyAdaptedFiles` can't extract the content. Mitigation: clear prompt instructions with exact format specification, plus a lenient parser that handles common deviations.
- **Context window pressure for large files** — `auto.ts` is 3275 lines. Including its full content in the adaptation prompt is feasible for modern context windows (128K+) but consumes significant tokens. Mitigation: include only the conflicting file(s), not the entire codebase. The prompt provides Labrat's version, the upstream patch, and the merge markers — the LLM has enough context to produce a resolution.
- **Verification false positives** — An adapted file might compile and pass tests but introduce a subtle behavioral difference that tests don't cover. Mitigation: the existing 899-test suite provides a reasonable regression safety net. The verification step runs the full suite.
- **Fire-and-forget dispatch means no immediate feedback** — In the interactive path, the extension dispatches the prompt and can't observe the result synchronously. It must rely on the LLM writing files and the subsequent commit/verify step detecting success or failure. This is inherent to the architecture — not changeable without modifying the core harness.
- **Multiple conflicting files** — A single upstream commit might conflict on 3-4 files simultaneously. The prompt must handle multi-file conflicts and the LLM must produce adapted content for all of them. The `applyAdaptedFiles` function must write all files atomically before committing.

## Skills Discovered

| Technology | Skill | Status |
|------------|-------|--------|
| Git conflict resolution | `antinomyhq/forge@resolve-conflicts` | available (95 installs) — generic conflict resolution, not fork-specific |
| Git conflict resolution | `duc01226/easyplatform@git-conflict-resolve` | available (27 installs) — too niche |
| LLM code adaptation | none found | n/a |

No skills installed — the available skills are generic conflict resolution tools, not fork-maintenance-specific. The adaptation pipeline here is specific to Labrat's architecture (ConflictContext → prompt → adapted files → verify) and better served by custom implementation.

## Sources

- `applyUpstreamCommit()` conflict path (upstream-sync.ts:635-780) — returns `conflicted: true` with full `ConflictContext`
- `getConflictContext()` (upstream-sync.ts:590-617) — extracts merge markers, Labrat version, upstream patch per file
- `ConflictContext`/`ConflictFileInfo` types (types.ts:337-348) — structured conflict data ready for prompt assembly
- `dispatchWorkflow()` (guided-flow.ts:113-125) — canonical fire-and-forget LLM dispatch pattern
- `loadPrompt()` (prompt-loader.ts:23-50) — template loading with `{{var}}` substitution
- `steer-campaign.md` / `run-experiment.md` — prompt template examples showing context assembly patterns
- S02 conflict test (upstream-sync.test.ts:632-680) — synthetic conflict scenario proving ConflictContext extraction
- `verifyAfterApply()` (upstream-sync.ts:510-588) — build+test verification reusable for adapted applies
- `setupRepoWithUpstream()` (upstream-sync.test.ts:73-93) — test helper for synthetic git scenarios
