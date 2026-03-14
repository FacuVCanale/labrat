# S04: Research Prompts & Fresh Context — Research

**Date:** 2026-03-13

## Summary

The prompt system for experiments needs three pieces: (1) a prompt template `run-experiment.md`, (2) a `buildExperimentPrompt()` function in auto.ts that assembles context from campaign config, target files, experiment history, and best metrics, and (3) helper functions to read and compress experiment history from the JSONL log and git diffs.

The existing GSD-2 prompt infrastructure is well-suited — `loadPrompt()` handles `{{variable}}` substitution from `.md` templates, and every other unit type follows the same pattern: an `async buildXxxPrompt()` function gathers context, then calls `loadPrompt("template-name", vars)`. The experiment prompt builder follows this exact pattern, replacing the 12-line stub in `dispatchNextUnit` at auto.ts line 1315.

The main design challenge is history compression. Each experiment's full JSONL entry includes metrics, decisions, diffs, costs, and timing — but the LLM needs only enough to avoid repeating failed approaches and to understand what worked. A compressed summary format (one line per experiment: id, decision, key metrics, brief diff indicator) keeps the prompt lean while providing meaningful history.

## Recommendation

Build a focused experiment prompt with five context sections:

1. **Campaign overview** — research question, eval config, metric directions, budget remaining
2. **Target file source** — full content of each target file (they're the code being modified)
3. **Best metrics** — current best results as the bar to beat
4. **Experiment history** — compressed one-liner per prior experiment (id, decision, metrics, what changed)
5. **Instructions** — modify the target file(s) to improve metrics, explain your reasoning, describe what you changed

The prompt should explicitly tell the LLM it's in a research loop and that the eval command will run automatically after it modifies files. The LLM should NOT run the eval — that's the post-processing hook's job.

Add a `researchQuestion` field to `CampaignConfig` (optional, falls back to `name`) so users can provide explicit research direction. The `ExperimentContext` type already expects this field.

## Don't Hand-Roll

| Problem | Existing Solution | Why Use It |
|---------|------------------|------------|
| Template loading + substitution | `loadPrompt()` in `prompt-loader.ts` | Every other prompt uses it. `{{variable}}` syntax, validates all placeholders before substitution. |
| Experiment log reading | `readBestMetrics()` + `countExperiments()` in `eval-runner.ts` / `state.ts` | Already handle JSONL parsing with malformed-line resilience. Extend rather than rewrite. |
| File inlining | `inlineFile()` / `inlineFileOptional()` in `auto.ts` | Standard helpers for embedding file content in prompts with labels and paths. |
| Git diff generation | `execSync("git diff ...")` or `git log --oneline` | Git is already a dependency. Commit hashes stored in `ExperimentResult.diff`. |

## Existing Code and Patterns

- `src/resources/extensions/gsd/auto.ts` lines 1308–1326 — **stub to replace**. Currently a 12-line inline prompt with no context. Replace with `buildExperimentPrompt()` call.
- `src/resources/extensions/gsd/auto.ts` lines 1893–1930 — `buildResearchSlicePrompt()` — **pattern to follow**. Gathers context, builds inlined sections, calls `loadPrompt()`. Experiment prompt builder follows same structure.
- `src/resources/extensions/gsd/auto.ts` lines 1768–1788 — `inlineFile()` / `inlineFileOptional()` — reuse for inlining target files and campaign config.
- `src/resources/extensions/gsd/prompt-loader.ts` — template loader. Create `prompts/run-experiment.md` and call `loadPrompt("run-experiment", vars)`.
- `src/resources/extensions/gsd/eval-runner.ts` lines 250–287 — `readBestMetrics()` — reads JSONL for best kept metrics. Need a companion `readAllExperiments()` for history.
- `src/resources/extensions/gsd/state.ts` lines 60–96 — `parseCampaignConfig()` / `countExperiments()` — campaign config reading. Already validates shape; extend for optional `researchQuestion`.
- `src/resources/extensions/gsd/types.ts` lines 223–237 — `CampaignConfig` and `ExperimentContext` — need `researchQuestion` added to CampaignConfig (optional field).
- `src/resources/extensions/gsd/auto.ts` line 544 — auto-commit fires before experiment post-processing. The LLM's code modifications are committed as `chore(M001/S04): auto-commit after run-experiment`, not using `commitExperiment()`. This means `commitExperiment()` (which produces greppable `experiment(E001):` messages) is NOT used in the actual flow. The prompt builder needs to account for this — experiment history comes from the JSONL log, not git log grep.

## Constraints

- **Target files are the ONLY things the LLM should modify.** The prompt must enforce the safety boundary (D006). The LLM should not touch eval scripts, infrastructure, or campaign config.
- **Eval is automatic.** The LLM must NOT run the eval command itself — the `handleAgentEnd` hook in auto.ts handles this. The prompt must clearly state this.
- **JSONL log is the source of truth for history** (D013, S03 forward intelligence). Git log grepping would find `chore(...)` messages, not `experiment(...)` messages, because auto-commit uses generic format. Use JSONL exclusively.
- **No context file writing.** Unlike development tasks (which write summaries, plans), experiments just modify target files. No `.gsd/` artifacts to produce — the JSONL append is handled by post-processing.
- **Prompt must be concise.** The LLM's main job is code modification — excessive prompt reduces the context available for reasoning about the code. Target files should dominate the prompt; history should be compressed.
- **`ExperimentResult.description` is always `'eval post-process'`** — not populated with what the LLM actually tried. For meaningful history, extract change descriptions from git diff stats or the diff itself. Consider improving this in eval-runner (set description from commit message or diff summary) as a supporting change.

## Common Pitfalls

- **Prompt too large** — Inlining full diffs for 20+ prior experiments would bloat the prompt and waste context on history rather than reasoning. Compress to one-liner per experiment: `exp-003: ✓ kept — val_bpb=1.42 (changed learning rate schedule)` vs full diff.
- **LLM runs eval command** — If the prompt doesn't clearly say "do NOT run the eval," some models will try to execute it. The post-processing hook handles eval automatically. Double-state this in the prompt.
- **History ordering** — Experiments should be shown newest-first (most relevant context at the top) with a configurable cap (e.g., last 20 experiments to avoid prompt bloat for long campaigns).
- **Missing research question** — `CampaignConfig` currently has no `researchQuestion` field. If we add it as optional, old configs without it need a fallback. Use `config.researchQuestion ?? config.name` as the default.
- **Target file reading failure** — Target files might not exist or be unreadable. The prompt builder should handle this gracefully (warn in prompt, don't crash).
- **Commit message not descriptive** — auto-commit uses `chore(M001/S04): auto-commit after run-experiment`, giving no info about what changed. For history, extract a diff stat summary (`git diff --stat <parent>..<hash>`) to show which files/lines changed.

## Open Risks

- **History compression quality** — Compressed one-liners may not give the LLM enough context to avoid repeating failed approaches. May need a "last N full diffs" section for recent experiments alongside compressed summaries for older ones. Test with the Karpathy scenario in S07.
- **Diff extraction for history** — Extracting meaningful diffs from git requires knowing the parent commit of each experiment. For reverted experiments, the revert commit exists but the original experiment commit's diff is harder to reconstruct. May need to store a diff summary in ExperimentResult during post-processing (change in eval-runner.ts).
- **`commitExperiment()` vs `autoCommit()` mismatch** — S02 built `commitExperiment()` to produce greppable `experiment(E001):` commit messages, but S03 wired the flow through the generic `autoCommit()` in `handleAgentEnd`. This means experiment commits are labeled `chore(...)` not `experiment(...)`. This isn't a blocker for S04 (we use JSONL, not git log), but it's a coherence issue that may bite S05/S07. Decide whether to fix the commit message format in the handleAgentEnd hook (use `commitExperiment()` instead of `autoCommitCurrentBranch()` for experiment units) — likely yes, but as a supporting change, not the primary deliverable.
- **ExperimentResult.description improvement** — Currently hardcoded to `'eval post-process'`. To make experiment history useful, the description should capture what changed. Options: (a) extract from git diff stat, (b) have the LLM write a description file that post-processing reads, (c) derive from commit message. Option (a) is simplest and requires no LLM cooperation.

## Skills Discovered

| Technology | Skill | Status |
|------------|-------|--------|
| TypeScript prompt engineering | n/a | none found — internal codebase pattern, no external skill needed |

## Sources

- Existing codebase analysis — `auto.ts`, `eval-runner.ts`, `types.ts`, `state.ts`, `prompt-loader.ts`, `git-service.ts`
- S02 summary forward intelligence — ExperimentContext type, stub prompt location, campaign config parsing
- S03 summary forward intelligence — JSONL is source of truth, readBestMetrics for baseline, post-processing flow
